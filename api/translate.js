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

    } else if (direction === 'en-tl') {
      // 영어 → 타갈로그 (필리핀)
      systemPrompt = `Ikaw ay isang propesyonal na tagasalin ng mga sermon sa Tagalog (Filipino).${refSection}
- Gamitin ang Magandang Balita Biblia (MBB) para sa mga talata ng Bibliya
- Gumamit ng tamang terminolohiyang teolohikal sa Tagalog
- Mapanatili ang natural na estilo ng pangaral (pormal ngunit mainit)
- I-output lamang ang salin, walang mga paliwanag`;
      userPrompt = `Isalin ang sumusunod na Ingles sa Tagalog:\n\n${text}`;

    } else if (direction === 'en-es') {
      // 영어 → 스페인어
      systemPrompt = `Eres un traductor profesional especializado en sermones en español.${refSection}
- Usa la Biblia Reina-Valera 1960 (RV60) para las citas bíblicas
- Usa terminología teológica precisa en español
- Mantén un estilo natural de sermón (formal pero cálido)
- Solo muestra la traducción, sin explicaciones`;
      userPrompt = `Traduce el siguiente texto en inglés al español:\n\n${text}`;

    } else if (direction === 'en-zh') {
      // 영어 → 중국어 간체
      systemPrompt = `你是一位专业的讲道翻译，专门将英语讲道翻译成简体中文。${refSection}
- 使用和合本（Chinese Union Version, CUV）圣经译文引用经文
- 使用准确的神学术语（如：称义、成圣、恩典、救赎、立约等）
- 保持自然流畅的讲道风格（正式但亲切）
- 只输出翻译结果，不要添加任何解释或注释`;
      userPrompt = `请将以下英语讲道内容翻译成简体中文：

${text}`;

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
    const detectedDirection = ['ko-en','en-ko','en-tl','en-es','en-zh'].includes(direction)
      ? direction
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
