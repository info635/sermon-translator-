// ═══════════════════════════════════════════════════════════════
//  Gemini STT 엔드포인트
//  오디오 청크를 받아서 텍스트로 변환 (한국어/영어/프랑스어)
// ═══════════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 디버그 모드 (GET 또는 POST에서 ?debug=1)
  if (req.query && req.query.debug === '1') {
    return res.status(200).json({
      status: process.env.GEMINI_API_KEY ? '✓ 준비됨' : '✗ GEMINI_API_KEY 미설정',
      mode: 'Gemini 2.5 Flash',
      hasKey: !!process.env.GEMINI_API_KEY,
    });
  }

  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST만 허용' });

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

  // 시스템 프롬프트 — 정확한 받아쓰기 + 자연스러운 구두점
  const prompt = `You are a professional speech-to-text transcriber for sermons and Christian preaching.

Task: Transcribe the following audio EXACTLY as spoken in ${langInfo.code}.

CRITICAL — Punctuation rules (very important for sentence boundary detection):
- Add a period (.) at the end of complete sentences
- Add a comma (,) at natural pauses within a sentence
- Add a question mark (?) for questions
- Add an exclamation mark (!) for emphatic statements
- For Korean: 마침표(.)를 문장 끝(다/요/까/네 등)에 반드시 추가
- For French: utilisez la ponctuation française correctement

Transcription rules:
- Output ONLY the transcribed text — no commentary, no labels, no quotation marks around the whole text
- Preserve the speaker's natural speech patterns
- For Bible verse references, transcribe as spoken (e.g., "John 3:16", "요한복음 3장 16절")
- If the audio is silent or contains no speech, output an empty string (nothing)
- If the audio is unclear or incomplete, transcribe what you can hear
- If the chunk starts mid-sentence (continuing from a previous chunk), don't add a starting capital
- If the chunk ends mid-sentence (will continue in next chunk), don't add a period — leave it open
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
    let parseError = null;
    try {
      text = data.candidates[0].content.parts[0].text || '';
    } catch(e) {
      parseError = e.message;
      console.error('Gemini response parsing error:', JSON.stringify(data).slice(0, 500));
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

    // 디버그 정보 포함 — 빈 응답일 때 원인 추적용
    const debug = {
      audioSizeBytes: audio ? Math.round(audio.length * 3/4) : 0,
      mimeType,
      lang,
      promptFeedback: data.promptFeedback || null,
      finishReason: data.candidates?.[0]?.finishReason || null,
      safetyRatings: data.candidates?.[0]?.safetyRatings?.length || 0,
      parseError,
      rawTextLen: text.length,
    };
    if (text.length === 0) {
      console.log('[Transcribe] Empty result:', JSON.stringify(debug));
    }

    res.status(200).json({ text, lang, debug });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
