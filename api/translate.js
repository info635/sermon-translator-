// api/translate.js
// ✝ 설교 번역 서버 — Claude로 번역하고 Pusher로 성도에게 전송

const Pusher = require('pusher');

module.exports = async (req, res) => {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '번역할 텍스트를 입력해주세요' });
  }

  // ── 환경변수 확인 (누락 시 명확한 오류 메시지)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY 환경변수가 없습니다');
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. Vercel 설정을 확인해주세요.' });
  }
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) {
    console.error('Pusher 환경변수가 없습니다');
    return res.status(500).json({ error: 'Pusher 환경변수가 설정되지 않았습니다. Vercel 설정을 확인해주세요.' });
  }

  try {
    // ① Claude API로 번역
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
        system: `당신은 영어 설교를 한국어로 번역하는 전문 번역가입니다.
- 한국 개역개정판 성경 구절 사용
- 개혁주의 신학 용어 정확히 사용 (칭의, 성화, 은혜, 속죄, 언약 등)
- 자연스러운 설교 문체 (합쇼체)
- 번역문만 출력 (설명이나 주석 없이)`,
        messages: [{ role: 'user', content: `다음 영어 설교를 한국어로 번역해주세요:\n\n${text}` }]
      })
    });

    // 오류 시 Anthropic의 실제 오류 메시지를 반환
    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error('Claude API 오류 상태코드:', claudeRes.status);
      console.error('Claude API 오류 내용:', errBody);
      return res.status(500).json({
        error: `Claude API 오류 (${claudeRes.status})`,
        detail: errBody
      });
    }

    const claudeData = await claudeRes.json();
    const korean = claudeData.content[0].text;

    // ② Pusher로 모든 성도에게 실시간 전송
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

    // ③ 방송실에 결과 반환
    res.status(200).json({ korean, success: true });

  } catch (err) {
    console.error('전체 오류:', err);
    res.status(500).json({ error: err.message });
  }
};
