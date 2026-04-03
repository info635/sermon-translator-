// /api/tts.js — Google Cloud TTS 엔드포인트
// GET /api/tts?text=...&lang=ko

// 동일 텍스트 중복 요청 방지용 인메모리 캐시 (같은 인스턴스 한정)
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60초

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용' });

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GOOGLE_TTS_API_KEY 환경변수가 없습니다' });
  }

  const { text, lang } = req.query;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text 파라미터 필요' });
  if (!lang) return res.status(400).json({ error: 'lang 파라미터 필요' });

  // 언어코드 → Google TTS languageCode + voiceName 매핑
  const VOICE_MAP = {
    'ko':    { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C' },
    'en':    { languageCode: 'en-US', name: 'en-US-Neural2-F' },
    'es':    { languageCode: 'es-ES', name: 'es-ES-Neural2-A' },
    'zh-cn': { languageCode: 'zh-CN', name: 'zh-CN-Neural2-D' },
    'zh-hk': { languageCode: 'zh-HK', name: 'zh-HK-Neural2-B' },
    'fa':    { languageCode: 'fa-IR', name: 'fa-IR-Standard-B' }, // Neural2 미지원
    'pa':    { languageCode: 'pa-IN', name: 'pa-IN-Standard-B' }, // Neural2 미지원
  };

  const voice = VOICE_MAP[lang];
  if (!voice) return res.status(400).json({ error: '지원하지 않는 언어: ' + lang });

  // 캐시 키
  const cacheKey = lang + '::' + text.slice(0, 200);
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    const buf = Buffer.from(cached.audio, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Cache', 'HIT');
    return res.end(buf);
  }

  try {
    const body = {
      input: { text: text.trim().slice(0, 5000) }, // Google TTS 최대 5000자
      voice: {
        languageCode: voice.languageCode,
        name: voice.name,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0,
        volumeGainDb: 0,
        effectsProfileId: ['headphone-class-device'],
      },
    };

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error('[TTS] Google API error:', err);
      return res.status(502).json({ error: 'Google TTS 오류', detail: err.error?.message });
    }

    const data = await response.json();
    const audioBase64 = data.audioContent;

    // 캐시 저장
    cache.set(cacheKey, { audio: audioBase64, ts: Date.now() });
    // 캐시 크기 제한 (최대 50개)
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }

    const buf = Buffer.from(audioBase64, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Cache', 'MISS');
    return res.end(buf);

  } catch (err) {
    console.error('[TTS] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
