const Pusher = require('pusher');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text, refText, direction } = req.body;
  // direction: 'auto' | 'en-ko' | 'ko-en'

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '번역할 텍스트를 입력해주세요' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다' });
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET)
    return res.status(500).json({ error: 'Pusher 환경변수가 없습니다' });

  try {
    const refSection = refText
      ? `\n\n[참고자료]\n${refText}\n[참고자료 끝]\n` : '';

    // 방향에 따른 시스템 프롬프트
    let systemPrompt = '';
    let userPrompt = '';

    if (direction === 'en-ko') {
      // 영어 → 한국어 (고정)
      systemPrompt = `당신은 영어 설교를 한국어로 번역하는 전문 번역가입니다.${refSection}
- 한국 개역개정판 성경 구절 사용
- 개혁주의 신학 용어 정확히 사용 (칭의, 성화, 은혜, 속죄, 언약 등)
- 자연스러운 설교 문체 (합쇼체)
- 번역문만 출력 (설명 없이)`;
      userPrompt = `다음 영어를 한국어로 번역해주세요:\n\n${text}`;

    } else if (direction === 'ko-en') {
      // 한국어 → 영어 (고정)
      systemPrompt = `You are a professional translator specializing in Korean sermons and religious content.${refSection}
- Use accurate theological terminology in English
- Maintain a natural sermon style (formal but warm)
- Output translation only, no explanations`;
      userPrompt = `Translate the following Korean to English:\n\n${text}`;

    } else {
      // 자동 감지 (auto)
      systemPrompt = `당신은 영한/한영 양방향 설교 번역 전문가입니다.${refSection}

규칙:
1. 입력 텍스트의 언어를 자동으로 감지합니다
2. 영어 입력 → 한국어로 번역 (개역개정 성경, 합쇼체, 신학 용어 정확히)
3. 한국어 입력 → 영어로 번역 (정확한 신학 용어, 자연스러운 설교 문체)
4. 번역문만 출력 (언어 감지 결과나 설명 없이)`;
      userPrompt = `다음 텍스트를 번역해주세요 (언어 자동 감지):\n\n${text}`;
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      return res.status(500).json({ error: `Claude API 오류 (${claudeRes.status})`, detail: errBody });
    }

    const claudeData = await claudeRes.json();
    const translated = claudeData.content[0].text;

    // 번역 방향 감지 (뷰어에 표시용)
    const detectedDirection = direction === 'ko-en' ? 'ko-en'
      : direction === 'en-ko' ? 'en-ko'
      : detectLang(text) === 'ko' ? 'ko-en' : 'en-ko';

    const pusher = new Pusher({
      appId:   process.env.PUSHER_APP_ID,
      key:     process.env.PUSHER_KEY,
      secret:  process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS:  true
    });

    await pusher.trigger('sermon', 'translation', {
      translated,
      direction: detectedDirection,
      time: new Date().toLocaleTimeString('ko-KR')
    });

    res.status(200).json({ translated, direction: detectedDirection, success: true });

  } catch (err) {
    console.error('오류:', err);
    res.status(500).json({ error: err.message });
  }
};

// 간단한 언어 감지 (한글 포함 여부)
function detectLang(text) {
  const koreanChars = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
  return koreanChars > text.length * 0.1 ? 'ko' : 'en';
}
