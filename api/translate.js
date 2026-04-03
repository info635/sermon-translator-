const Pusher = require('pusher');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text, refText, langs, srcLang } = req.body;
  // srcLang: 'en' | 'ko' (원본 언어)
  // langs: 번역 대상 언어 배열 ['ko', 'en', 'es', 'zh-cn', 'zh-hk', 'fa', 'pa']

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

  // 용어집을 언어별 지시문으로 변환
  function buildGlossarySection(refText, targetLang) {
    if (!refText) return '';
    // 이미 파싱된 용어집 형식 (broadcast.html에서 전송됨)
    return `\n\n[용어집 — 반드시 아래 번역어를 일관되게 사용할 것]\n${refText}\n[용어집 끝]\n`;
  }
  const src = srcLang || 'en';
  const SRC_NAME = { en: 'English', ko: '한국어' };

  // Claude가 붙이는 주석/경고/메타 텍스트 제거 + 전체 거부 응답 감지
  function cleanTranslation(text) {
    let t = text.trim();

    // ── 전체 거부 응답 감지 ──
    // 이런 패턴이 포함된 경우 → 빈 문자열 반환 (뷰어에 전송 안 함)
    const refusalPatterns = [
      /제공해주신 텍스트가.{0,50}(완전하지|명확하지|불완전|충분하지)/,
      /완전한 설교.{0,30}(제공|다시|원문)/,
      /텍스트가.{0,30}(설교|내용)으로 보이지 않/,
      /번역을.{0,20}(제공하기 어렵|도와드리기 어렵|어렵습니다)/,
      /죄송합니다.{0,50}(텍스트|내용|원문)/,
      /I'm sorry.{0,80}(translate|provide|text)/i,
      /I cannot.{0,80}(translate|provide)/i,
      /I'm unable.{0,80}(translate|provide)/i,
      /The (text|input|content).{0,80}(incomplete|unclear|insufficient)/i,
      /Please provide.{0,80}(complete|full|more)/i,
      /Could you please.{0,80}(provide|share|give)/i,
    ];
    for (const p of refusalPatterns) {
      if (p.test(t)) return ''; // 거부 응답 → 빈 문자열
    }

    // ── 마지막 괄호 주석 제거 ──
    t = t.replace(/\s*[\(\（][^\)\）]{5,300}[\)\）]\s*$/g, '');
    t = t.replace(/\n\s*[\(\（][^\)\）]{5,300}[\)\）]\s*$/g, '');

    // ── 경고/안내 줄 제거 ──
    const lines = t.split('\n');
    const filtered = [];
    for (const line of lines) {
      const tr = line.trim();
      const isMeta =
        /^[\(\（]?(참고|주의|알림|Note|Notice|Warning|Nota|注|注意|備考)\s*[:：]/i.test(tr) ||
        /^[\(\（]?(제공|입력|텍스트|원문|This text|The text|The provided|죄송)/i.test(tr) ||
        /완전한 설교.{0,30}(제공|원문|다시)/.test(tr) ||
        /번역을.{0,20}(어렵|제공하기)/.test(tr);
      if (!isMeta) filtered.push(line);
    }
    return filtered.join('\n').trim();
  }

  // ── 범개신교 개혁주의/복음주의 핵심 신학 용어 (내장) ──
  const BUILT_IN_GLOSSARY = `
[구원론]
justification = 칭의 (의롭다 하심)
sanctification = 성화
glorification = 영화
regeneration = 중생 (거듭남)
conversion = 회심
repentance = 회개
faith = 믿음
grace = 은혜
atonement = 속죄
redemption = 구속
propitiation = 화목제물
reconciliation = 화목
forgiveness of sins = 죄 사함
salvation = 구원
election = 선택 / 택하심
predestination = 예정

[하나님론]
sovereignty = 주권
omnipotence = 전능하심
omniscience = 전지하심
omnipresence = 편재하심
holiness = 거룩하심
righteousness = 공의
mercy = 자비
lovingkindness = 인자하심
Trinity = 삼위일체
the Father = 하나님 아버지
the Son = 성자
the Holy Spirit = 성령
incarnation = 성육신
glory = 영광
wrath = 진노
kingdom of God = 하나님 나라

[기독론]
Lord = 주님
Savior = 구주
Messiah = 메시아
Christ = 그리스도
resurrection = 부활
ascension = 승천
second coming = 재림
cross = 십자가
crucifixion = 십자가 죽음 / 십자가 처형
the blood of Christ = 그리스도의 보혈
sacrifice = 희생 / 제사

[성령론]
the Holy Spirit = 성령
indwelling = 내주하심
filling = 충만
fruit of the Spirit = 성령의 열매
gifts of the Spirit = 성령의 은사
conviction = 죄를 깨닫게 하심

[교회론]
the Church = 교회
congregation = 회중 / 성도
baptism = 세례
Lord's Supper = 성찬
communion = 성찬
worship = 예배
sermon = 설교
pastor = 목사
elder = 장로
deacon = 집사
fellowship = 교제
ministry = 사역
mission = 선교
discipleship = 제자도
stewardship = 청지기 정신

[성경론]
Scripture = 성경
the Word = 말씀
the Word of God = 하나님의 말씀
inspiration = 영감
inerrancy = 무오성
revelation = 계시
covenant = 언약
the Old Testament = 구약
the New Testament = 신약
the Gospel = 복음

[종말론]
eternal life = 영생
heaven = 천국 / 하늘나라
hell = 지옥
judgment = 심판
the last day = 마지막 날
resurrection = 부활
`.trim();

  // ── 설교 문체 규칙 ──
  const SERMON_STYLE_KO = `
[청중 호칭]
- beloved / dear friends / brothers and sisters → "사랑하는 여러분" 또는 "사랑하는 성도 여러분"
- saints / congregation → "성도 여러분"

[설교 특유 표현]
- I want you to know / understand → "아시기 바랍니다"
- Let me tell you / say → "말씀드리겠습니다"
- I believe → "믿습니다"
- The Bible says / Scripture tells us → "성경은 말씀합니다"
- God is saying / God is telling us → "하나님께서 말씀하십니다"
- Turn with me to → "함께 ~말씀을 펴시겠습니다"
- Let us pray → "기도하겠습니다"
- Amen → "아멘"
- Hallelujah → "할렐루야"

[문장 마무리 패턴]
- 권면: "~하시기 바랍니다" / "~하십시오"
- 선포: "~입니다" / "~습니다"
- 강조: "반드시 ~해야 합니다" / "~해야 할 것입니다"
- 질문: "~하지 않겠습니까?" / "~하시겠습니까?"

[번역 금지]
- 영어 어순 직역 금지
- 구어체/존댓말 혼용 금지
- 서양식 표현을 한국 설교 표현으로 자연스럽게 변환
`.trim();

  function buildConfig(targetLang) {
    const srcName = SRC_NAME[src] || 'English';
    const refSection = buildGlossarySection(refText, targetLang);

    // 컨텍스트 섹션 (앞 문장 맥락)
    const contextSection = req.body.context
      ? `\n\n[이전 번역 맥락 — 대명사/고유명사 일관성 유지에 활용]\n${req.body.context}\n[맥락 끝]`
      : '';

    const targets = {
      ko: {
        system: `당신은 범개신교 개혁주의/복음주의 설교 전문 번역가입니다.
영어 설교를 자연스러운 한국어 설교 문체로 번역합니다.${contextSection}${refSection}

━━━ 내장 신학 용어집 (반드시 아래 번역어 사용) ━━━
${BUILT_IN_GLOSSARY}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 설교 문체 규칙 ━━━
${SERMON_STYLE_KO}
━━━━━━━━━━━━━━━━━━━━━

━━━ 절대 규칙 ━━━
- 반드시 번역문만 출력 (설명, 주석, 괄호 메모 절대 금지)
- 번역 거부 절대 금지 (텍스트가 짧거나 불완전해도 번역)
- 개역개정판 성경 구절 사용
- 합쇼체 사용 (~입니다, ~습니다, ~하십시오)
- "죄송합니다", "제공해주신" 같은 표현 절대 사용 금지`,
        prompt: `다음 영어 설교를 한국어로 번역하세요:\n\n${text}`
      },
      en: {
        system: `You are a translator. Translate any input text to English. No exceptions.${refSection}
Absolute rules:
- Always translate, no matter how short or unclear the input
- NEVER refuse, NEVER ask for clarification, NEVER add notes or warnings
- NEVER say "I'm sorry", "the text is incomplete", "please provide more context"
- If the input seems incomplete, translate it as-is
- Use theological terminology appropriate for sermons
- Output: translation only`,
        prompt: `Translate:\n\n${text}`
      },
      es: {
        system: `Eres un traductor. Traduce cualquier texto al español. Sin excepciones.${refSection}
Reglas absolutas:
- Siempre traduce, sin importar lo corto o confuso que sea el texto
- NUNCA te niegues, NUNCA pidas aclaraciones, NUNCA añadas notas
- Si el texto parece incompleto, tradúcelo tal como está
- Salida: solo la traducción`,
        prompt: `Traduce:\n\n${text}`
      },
      'zh-cn': {
        system: `你是翻译专家。无论如何都要将输入文本翻译成简体中文。${refSection}
绝对规则：
- 无论输入多短或多不清楚，必须翻译
- 绝对不能拒绝、不能要求澄清、不能添加注释或警告
- 使用和合本圣经，准确神学术语
- 输出：仅翻译结果`,
        prompt: `翻译：\n\n${text}`
      },
      'zh-hk': {
        system: `你係翻譯專家。無論如何都要將輸入文本翻譯成繁體中文廣東話。${refSection}
絕對規則：
- 無論輸入幾短或幾唔清楚，必須翻譯
- 絕對唔可以拒絕、唔可以要求澄清、唔可以加注釋
- 使用和合本聖經，準確神學術語
- 輸出：只係翻譯結果`,
        prompt: `翻譯：\n\n${text}`
      },
      fa: {
        system: `شما مترجم هستید. هر متنی را به فارسی ترجمه کنید. بدون استثنا.${refSection}
قوانین مطلق:
- همیشه ترجمه کنید، مهم نیست متن چقدر کوتاه یا نامشخص باشد
- هرگز از ترجمه نپرهیزید، هرگز توضیح نخواهید، هرگز یادداشت اضافه نکنید
- خروجی: فقط ترجمه`,
        prompt: `ترجمه کنید:\n\n${text}`
      },
      pa: {
        system: `ਤੁਸੀਂ ਅਨੁਵਾਦਕ ਹੋ। ਕਿਸੇ ਵੀ ਟੈਕਸਟ ਨੂੰ ਪੰਜਾਬੀ ਵਿੱਚ ਅਨੁਵਾਦ ਕਰੋ। ਕੋਈ ਅਪਵਾਦ ਨਹੀਂ।${refSection}
ਨਿਯਮ:
- ਹਮੇਸ਼ਾ ਅਨੁਵਾਦ ਕਰੋ, ਚਾਹੇ ਟੈਕਸਟ ਕਿੰਨਾ ਵੀ ਛੋਟਾ ਜਾਂ ਅਸਪਸ਼ਟ ਹੋਵੇ
- ਕਦੇ ਵੀ ਅਨੁਵਾਦ ਤੋਂ ਇਨਕਾਰ ਨਾ ਕਰੋ, ਕੋਈ ਨੋਟ ਨਾ ਜੋੜੋ
- ਆਉਟਪੁੱਟ: ਸਿਰਫ਼ ਅਨੁਵਾਦ`,
        prompt: `ਅਨੁਵਾਦ ਕਰੋ:\n\n${text}`
      }
    };

    return targets[targetLang];
  }

  const results = {};
  const errors = {};

  // 선택된 언어 동시 번역
  await Promise.all(langs.map(async (lang) => {
    const cfg = buildConfig(lang);
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
        errors[lang] = `Claude 오류 (${claudeRes.status})`;
        return;
      }

      const data = await claudeRes.json();
      const raw = data.content[0].text;

      // 번역문만 추출 — Claude가 붙이는 주석/경고 제거
      const translated = cleanTranslation(raw);

      // 번역 결과가 없으면 에러 처리 (뷰어에 빈 내용 전송 안 함)
      if (!translated.trim()) {
        errors[lang] = '번역 결과 없음 (원문을 확인해주세요)';
        return;
      }

      results[lang] = translated;

      // 언어별 Pusher 채널로 전송
      await pusher.trigger(`sermon-${lang}`, 'translation', {
        translated,
        lang,
        srcLang: src,
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
