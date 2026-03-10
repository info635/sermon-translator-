const Pusher = require('pusher');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text, refText } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '번역할 텍스트를 입력해주세요' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다' });
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET)
    return res.status(500).json({ error: 'Pusher 환경변수가 없습니다' });

  try {
    // 참고자료가 있으면 시스템 프롬프트에 포함
    const systemPrompt = refText
      ? `당신은 영어 설교를 한국어로 번역하는 전문 번역가입니다.

[참고자료 — 오늘의 설교 원고 및 자료]
${refText}
[참고자료 끝]

위 참고자료를 바탕으로 번역 시 다음을 지켜주세요:
- 참고자료의 고유명사, 인명, 지명, 신학 용어를 그대로 사용
- 참고자료에 등장하는 성경 구절은 개역개정판 그대로 사용
- 설교자의 문체와 어조를 파악하여 일관성 있게 번역
- 자연스러운 설교 문체 (합쇼체)
- 번역문만 출력 (설명이나 주석 없이)`
      : `당신은 영어 설교를 한국어로 번역하는 전문 번역가입니다.
- 한국 개역개정판 성경 구절 사용
- 개혁주의 신학 용어 정확히 사용 (칭의, 성화, 은혜, 속죄, 언약 등)
- 자연스러운 설교 문체 (합쇼체)
- 번역문만 출력 (설명이나 주석 없이)`;

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
        messages: [{ role: 'user', content: `다음 영어 설교를 한국어로 번역해주세요:\n\n${text}` }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      return res.status(500).json({ error: `Claude API 오류 (${claudeRes.status})`, detail: errBody });
    }

    const claudeData = await claudeRes.json();
    const korean = claudeData.content[0].text;

    const pusher = new Pusher({
      appId:   process.env.PUSHER_APP_ID,
      key:     process.env.PUSHER_KEY,
      secret:  process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS:  true
    });

    await pusher.trigger('sermon', 'translation', {
      korean,
      time: new Date().toLocaleTimeString('ko-KR')
    });

    res.status(200).json({ korean, success: true });

  } catch (err) {
    console.error('오류:', err);
    res.status(500).json({ error: err.message });
  }
};
