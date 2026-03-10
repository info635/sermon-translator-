const Pusher = require('pusher');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text, refText, langs } = req.body;
  // langs: 배열 예) ['ko', 'tl', 'es', 'zh']

  if (!text || !text.trim()) return res.status(400).json({ error: '번역할 텍스트를 입력해주세요' });
  if (!langs || !langs.length) return res.status(400).json({ error: '번역할 언어를 선택해주세요' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다' });
  if (!process.env.PUSHER_APP_ID) return res.status(500).json({ error: 'Pusher 환경변수가 없습니다' });

  const pusher = new Pusher({
    appId:   process.env.PUSHER_APP_ID,
    key:     process.env.PUSHER_KEY,
    secret:  process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || 'us2',
    useTLS:  true
  });

  const refSection = refText ? `\n\n[참고자료]\n${refText}\n[참고자료 끝]\n` : '';

  // 언어별 설정
  const LANG_CONFIG = {
    ko: {
      system: `당신은 영어 설교를 한국어로 번역하는 전문 번역가입니다.${refSection}
- 한국 개역개정판 성경 구절 사용
- 개혁주의 신학 용어 정확히 사용 (칭의, 성화, 은혜, 속죄, 언약 등)
- 자연스러운 설교 문체 (합쇼체)
- 번역문만 출력 (설명 없이)`,
      prompt: `다음 영어 설교를 한국어로 번역해주세요:\n\n${text}`
    },
    en: {
      system: `You are a professional translator specializing in Korean sermons.${refSection}
- Use accurate theological terminology in English
- Maintain a natural sermon style (formal but warm)
- Output translation only, no explanations`,
      prompt: `Translate the following Korean sermon to English:\n\n${text}`
    },
    tl: {
      system: `Ikaw ay isang propesyonal na tagasalin ng mga sermon sa Tagalog (Filipino).${refSection}
- Gamitin ang Magandang Balita Biblia (MBB) para sa mga talata ng Bibliya
- Gumamit ng tamang terminolohiyang teolohikal sa Tagalog
- Mapanatili ang natural na estilo ng pangaral (pormal ngunit mainit)
- I-output lamang ang salin, walang mga paliwanag`,
      prompt: `Isalin ang sumusunod na sermon sa Tagalog:\n\n${text}`
    },
    es: {
      system: `Eres un traductor profesional especializado en sermones en español.${refSection}
- Usa la Biblia Reina-Valera 1960 (RV60) para las citas bíblicas
- Usa terminología teológica precisa en español
- Mantén un estilo natural de sermón (formal pero cálido)
- Solo muestra la traducción, sin explicaciones`,
      prompt: `Traduce el siguiente sermón al español:\n\n${text}`
    },
    zh: {
      system: `你是一位专业的讲道翻译，专门将讲道内容翻译成简体中文。${refSection}
- 使用和合本（Chinese Union Version, CUV）圣经译文引用经文
- 使用准确的神学术语（如：称义、成圣、恩典、救赎、立约等）
- 保持自然流畅的讲道风格（正式但亲切）
- 只输出翻译结果，不要添加任何解释或注释`,
      prompt: `请将以下讲道内容翻译成简体中文：\n\n${text}`
    }
  };

  const results = {};
  const errors = {};

  // 선택된 언어 동시 번역 (Promise.all)
  await Promise.all(langs.map(async (lang) => {
    const cfg = LANG_CONFIG[lang];
    if (!cfg) return;

    try {
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
          system: cfg.system,
          messages: [{ role: 'user', content: cfg.prompt }]
        })
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        errors[lang] = `Claude 오류 (${claudeRes.status})`;
        return;
      }

      const data = await claudeRes.json();
      const translated = data.content[0].text;
      results[lang] = translated;

      // 언어별 Pusher 채널로 전송
      await pusher.trigger(`sermon-${lang}`, 'translation', {
        translated,
        lang,
        time: new Date().toLocaleTimeString('ko-KR')
      });

    } catch (err) {
      errors[lang] = err.message;
    }
  }));

  res.status(200).json({
    results,
    errors: Object.keys(errors).length ? errors : undefined,
    success: true
  });
};
