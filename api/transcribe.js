// ═══════════════════════════════════════════════════════════════
//  Gemini STT 엔드포인트
//  오디오 청크를 받아서 텍스트로 변환 (한국어/영어/프랑스어)
// ═══════════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST만 허용' });

  // 디버그 모드
  if (req.query && req.query.debug === '1') {
    return res.status(200).json({
      status: process.env.GEMINI_API_KEY ? '✓ 준비됨' : '✗ GEMINI_API_KEY 미설정',
      mode: 'Gemini 2.5 Flash',
      hasKey: !!process.env.GEMINI_API_KEY,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다' });
  }

  const { audio, lang, mimeType } = req.body;
  if (!audio) return res.status(400).json({ error: '오디오 데이터가 없습니다' });

  // 언어별 프롬프트
  const langMap = {
    'en': { name: 'English',  code: 'English'  },
    'ko': { name: '한국어',     code: 'Korean'   },
    'fr': { name: 'Français', code: 'French'   },
  };
  const langInfo = langMap[lang] || langMap['en'];

  // 시스템 프롬프트 — 정확한 받아쓰기에 집중
  const prompt = `You are a professional speech-to-text transcriber for sermons and Christian preaching.

Task: Transcribe the following audio EXACTLY as spoken in ${langInfo.code}.

Rules:
- Output ONLY the transcribed text — no commentary, no labels, no quotation marks
- Preserve the speaker's natural speech patterns
- For Bible verse references, transcribe as spoken (e.g., "John 3:16", "요한복음 3장 16절")
- If the audio is silent or contains no speech, output an empty string (nothing)
- If the audio is unclear or incomplete, transcribe what you can hear
- Do not add any explanations, headers, or metadata
- Do not translate — only transcribe in ${langInfo.code}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType || 'audio/webm',
                  data: audio, // base64
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1000,
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return res.status(500).json({
        error: 'Gemini API 오류',
        status: response.status,
        detail: errText.slice(0, 200),
      });
    }

    const data = await response.json();
    let text = '';
    try {
      text = data.candidates[0].content.parts[0].text || '';
    } catch(e) {
      console.error('Gemini response parsing error:', JSON.stringify(data).slice(0, 300));
    }

    // 정리 — Gemini가 가끔 따옴표나 메타 텍스트를 붙임
    text = text.trim()
      .replace(/^["「『'']\s*/, '')
      .replace(/\s*["」』'']$/, '')
      .replace(/^Transcription:\s*/i, '')
      .replace(/^\(no speech\)$/i, '')
      .replace(/^\(silent\)$/i, '')
      .replace(/^\(unclear\)$/i, '')
      .trim();

    res.status(200).json({ text, lang });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
