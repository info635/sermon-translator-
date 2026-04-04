// /api/tts.js — Google Cloud TTS
// 두 가지 인증 방식 모두 지원:
//   1. GOOGLE_TTS_CREDENTIALS = Service Account JSON 전체
//   2. GOOGLE_TTS_API_KEY     = 단순 API Key

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5분

const VOICE_MAP = {
  'ko':    { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C' },
  'en':    { languageCode: 'en-US', name: 'en-US-Neural2-F' },
  'es':    { languageCode: 'es-ES', name: 'es-ES-Neural2-A' },
  'zh-cn': { languageCode: 'zh-CN', name: 'zh-CN-Neural2-D' },
  'zh-hk': { languageCode: 'zh-HK', name: 'zh-HK-Neural2-B' },
  'fa':    { languageCode: 'fa-IR', name: 'fa-IR-Standard-B' },
  'pa':    { languageCode: 'pa-IN', name: 'pa-IN-Standard-B' },
};

async function getServiceAccountToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(credentials.private_key, 'base64url')}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // 디버그 모드: 브라우저에서 /api/tts?debug=1 접속
  if (req.query.debug === '1') {
    const hasKey   = !!process.env.GOOGLE_TTS_API_KEY;
    const hasCreds = !!process.env.GOOGLE_TTS_CREDENTIALS;
    let credsOk = false, credsEmail = null;
    if (hasCreds) {
      try {
        const c = JSON.parse(process.env.GOOGLE_TTS_CREDENTIALS);
        credsOk    = !!(c.client_email && c.private_key);
        credsEmail = c.client_email;
      } catch(e) { credsEmail = 'JSON 파싱 오류: ' + e.message; }
    }
    return res.status(200).json({
      GOOGLE_TTS_API_KEY:     hasKey   ? '✓ 설정됨' : '✗ 없음',
      GOOGLE_TTS_CREDENTIALS: hasCreds ? '✓ 설정됨' : '✗ 없음',
      credentials_valid:      credsOk,
      service_account_email:  credsEmail,
      mode:   hasKey ? 'API Key' : credsOk ? 'Service Account' : 'none',
      status: (hasKey || credsOk) ? '✓ 준비됨' : '✗ 환경변수 설정 필요',
    });
  }

  const { text, lang } = req.query;
  if (!text?.trim()) return res.status(400).json({ error: 'text 필요' });
  if (!lang)         return res.status(400).json({ error: 'lang 필요' });
  const voice = VOICE_MAP[lang];
  if (!voice) return res.status(400).json({ error: '미지원 언어: ' + lang });

  // 캐시
  const cacheKey = lang + '::' + text.slice(0, 200);
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    const buf = Buffer.from(cached.audio, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.end(buf);
  }

  const apiKey   = process.env.GOOGLE_TTS_API_KEY;
  const credsJson = process.env.GOOGLE_TTS_CREDENTIALS;

  if (!apiKey && !credsJson) {
    return res.status(503).json({
      error: '환경변수 미설정',
      help: 'Vercel → Settings → Environment Variables 에서 GOOGLE_TTS_API_KEY 또는 GOOGLE_TTS_CREDENTIALS 설정',
      debug: '진단하려면 브라우저에서 /api/tts?debug=1 접속',
    });
  }

  try {
    const ttsBody = {
      input: { text: text.trim().slice(0, 5000) },
      voice,
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
    };

    let ttsRes;
    if (apiKey) {
      // API Key 방식
      ttsRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ttsBody) }
      );
    } else {
      // Service Account 방식
      const creds = JSON.parse(credsJson);
      const token = await getServiceAccountToken(creds);
      ttsRes = await fetch(
        'https://texttospeech.googleapis.com/v1/text:synthesize',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(ttsBody) }
      );
    }

    if (!ttsRes.ok) {
      const err = await ttsRes.json();
      console.error('[TTS] Google API error:', err);
      return res.status(502).json({
        error: 'Google TTS API 오류',
        message: err.error?.message,
        status: ttsRes.status,
        debug: '/api/tts?debug=1 접속하여 설정 확인',
      });
    }

    const data = await ttsRes.json();
    cache.set(cacheKey, { audio: data.audioContent, ts: Date.now() });
    if (cache.size > 50) cache.delete(cache.keys().next().value);

    const buf = Buffer.from(data.audioContent, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.end(buf);

  } catch (err) {
    console.error('[TTS] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
