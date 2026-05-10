const Pusher = require('pusher');
const BIBLE_KO = require('./bible-ko.json'); // 개역한글 전체 31,104절 (별도 JSON 파일)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { text, refText, langs, srcLang, sermonContext } = req.body;
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
  const SRC_NAME = { en: 'English', ko: '한국어', fr: 'Français' };

  // ═══════════════════════════════════════════════════════════════
  // 성경 구절 데이터베이스 (ESV + 개역개정)
  // 설교에 가장 자주 인용되는 핵심 구절 — Claude paraphrase 방지
  // ═══════════════════════════════════════════════════════════════
  const BIBLE_VERSES = {
    // [책-장:절] : { en: ESV, ko: 개역개정 }
    'gen-1:1':    { en: "In the beginning, God created the heavens and the earth.", ko: "태초에 하나님이 천지를 창조하시니라" },
    'gen-1:27':   { en: "So God created man in his own image, in the image of God he created him; male and female he created them.", ko: "하나님이 자기 형상 곧 하나님의 형상대로 사람을 창조하시되 남자와 여자를 창조하시고" },
    'gen-3:15':   { en: "I will put enmity between you and the woman, and between your offspring and her offspring; he shall bruise your head, and you shall bruise his heel.", ko: "내가 너로 여자와 원수가 되게 하고 네 후손도 여자의 후손과 원수가 되게 하리니 여자의 후손은 네 머리를 상하게 할 것이요 너는 그의 발꿈치를 상하게 할 것이니라 하시고" },
    'ex-3:14':    { en: "God said to Moses, 'I AM WHO I AM.'", ko: "하나님이 모세에게 이르시되 나는 스스로 있는 자이니라" },
    'ex-20:3':    { en: "You shall have no other gods before me.", ko: "너는 나 외에는 다른 신들을 네게 두지 말라" },
    'deut-6:5':   { en: "You shall love the LORD your God with all your heart and with all your soul and with all your might.", ko: "너는 마음을 다하고 뜻을 다하고 힘을 다하여 네 하나님 여호와를 사랑하라" },
    'josh-1:9':   { en: "Be strong and courageous. Do not be frightened, and do not be dismayed, for the LORD your God is with you wherever you go.", ko: "강하고 담대하라 두려워하지 말며 놀라지 말라 네가 어디로 가든지 네 하나님 여호와가 너와 함께 하느니라" },
    'ps-1:1':     { en: "Blessed is the man who walks not in the counsel of the wicked, nor stands in the way of sinners, nor sits in the seat of scoffers", ko: "복 있는 사람은 악인들의 꾀를 따르지 아니하며 죄인들의 길에 서지 아니하며 오만한 자들의 자리에 앉지 아니하고" },
    'ps-23:1':    { en: "The LORD is my shepherd; I shall not want.", ko: "여호와는 나의 목자시니 내게 부족함이 없으리로다" },
    'ps-23:4':    { en: "Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.", ko: "내가 사망의 음침한 골짜기로 다닐지라도 해를 두려워하지 않을 것은 주께서 나와 함께 하심이라 주의 지팡이와 막대기가 나를 안위하시나이다" },
    'ps-46:10':   { en: "Be still, and know that I am God.", ko: "너희는 가만히 있어 내가 하나님 됨을 알지어다" },
    'ps-119:105': { en: "Your word is a lamp to my feet and a light to my path.", ko: "주의 말씀은 내 발에 등이요 내 길에 빛이니이다" },
    'prov-3:5':   { en: "Trust in the LORD with all your heart, and do not lean on your own understanding.", ko: "너는 마음을 다하여 여호와를 신뢰하고 네 명철을 의지하지 말라" },
    'prov-3:6':   { en: "In all your ways acknowledge him, and he will make straight your paths.", ko: "너는 범사에 그를 인정하라 그리하면 네 길을 지도하시리라" },
    'isa-9:6':    { en: "For to us a child is born, to us a son is given; and the government shall be upon his shoulder, and his name shall be called Wonderful Counselor, Mighty God, Everlasting Father, Prince of Peace.", ko: "이는 한 아기가 우리에게 났고 한 아들을 우리에게 주신 바 되었는데 그의 어깨에는 정사를 메었고 그의 이름은 기묘자라, 모사라, 전능하신 하나님이라, 영존하시는 아버지라, 평강의 왕이라 할 것임이라" },
    'isa-40:31':  { en: "But they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.", ko: "오직 여호와를 앙망하는 자는 새 힘을 얻으리니 독수리가 날개치며 올라감 같을 것이요 달음박질하여도 곤비하지 아니하겠고 걸어가도 피곤하지 아니하리로다" },
    'isa-53:5':   { en: "But he was pierced for our transgressions; he was crushed for our iniquities; upon him was the chastisement that brought us peace, and with his wounds we are healed.", ko: "그가 찔림은 우리의 허물 때문이요 그가 상함은 우리의 죄악 때문이라 그가 징계를 받으므로 우리는 평화를 누리고 그가 채찍에 맞으므로 우리는 나음을 받았도다" },
    'isa-55:8':   { en: "For my thoughts are not your thoughts, neither are your ways my ways, declares the LORD.", ko: "이는 내 생각이 너희의 생각과 다르며 내 길은 너희의 길과 다름이니라 여호와의 말씀이니라" },
    'jer-29:11':  { en: "For I know the plans I have for you, declares the LORD, plans for welfare and not for evil, to give you a future and a hope.", ko: "여호와의 말씀이니라 너희를 향한 나의 생각을 내가 아나니 평안이요 재앙이 아니니라 너희에게 미래와 희망을 주는 것이니라" },
    'matt-5:3':   { en: "Blessed are the poor in spirit, for theirs is the kingdom of heaven.", ko: "심령이 가난한 자는 복이 있나니 천국이 그들의 것임이요" },
    'matt-5:6':   { en: "Blessed are those who hunger and thirst for righteousness, for they shall be satisfied.", ko: "의에 주리고 목마른 자는 복이 있나니 그들이 배부를 것임이요" },
    'matt-5:14':  { en: "You are the light of the world. A city set on a hill cannot be hidden.", ko: "너희는 세상의 빛이라 산 위에 있는 동네가 숨겨지지 못할 것이요" },
    'matt-5:16':  { en: "In the same way, let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven.", ko: "이같이 너희 빛이 사람 앞에 비치게 하여 그들로 너희 착한 행실을 보고 하늘에 계신 너희 아버지께 영광을 돌리게 하라" },
    'matt-6:9':   { en: "Pray then like this: 'Our Father in heaven, hallowed be your name.'", ko: "그러므로 너희는 이렇게 기도하라 하늘에 계신 우리 아버지여 이름이 거룩히 여김을 받으시오며" },
    'matt-6:33':  { en: "But seek first the kingdom of God and his righteousness, and all these things will be added to you.", ko: "그런즉 너희는 먼저 그의 나라와 그의 의를 구하라 그리하면 이 모든 것을 너희에게 더하시리라" },
    'matt-7:7':   { en: "Ask, and it will be given to you; seek, and you will find; knock, and it will be opened to you.", ko: "구하라 그리하면 너희에게 주실 것이요 찾으라 그리하면 찾아낼 것이요 문을 두드리라 그리하면 너희에게 열릴 것이니" },
    'matt-11:28': { en: "Come to me, all who labor and are heavy laden, and I will give you rest.", ko: "수고하고 무거운 짐 진 자들아 다 내게로 오라 내가 너희를 쉬게 하리라" },
    'matt-22:37': { en: "You shall love the Lord your God with all your heart and with all your soul and with all your mind.", ko: "네 마음을 다하고 목숨을 다하고 뜻을 다하여 주 너의 하나님을 사랑하라 하셨으니" },
    'matt-22:39': { en: "You shall love your neighbor as yourself.", ko: "네 이웃을 네 자신 같이 사랑하라 하셨으니" },
    'matt-28:19': { en: "Go therefore and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.", ko: "그러므로 너희는 가서 모든 민족을 제자로 삼아 아버지와 아들과 성령의 이름으로 세례를 베풀고" },
    'matt-28:20': { en: "teaching them to observe all that I have commanded you. And behold, I am with you always, to the end of the age.", ko: "내가 너희에게 분부한 모든 것을 가르쳐 지키게 하라 볼지어다 내가 세상 끝날까지 너희와 항상 함께 있으리라 하시니라" },
    'mark-10:45': { en: "For even the Son of Man came not to be served but to serve, and to give his life as a ransom for many.", ko: "인자가 온 것은 섬김을 받으려 함이 아니라 도리어 섬기려 하고 자기 목숨을 많은 사람의 대속물로 주려 함이니라" },
    'luke-6:31':  { en: "And as you wish that others would do to you, do so to them.", ko: "남에게 대접을 받고자 하는 대로 너희도 남을 대접하라" },
    'luke-19:10': { en: "For the Son of Man came to seek and to save the lost.", ko: "인자가 온 것은 잃어버린 자를 찾아 구원하려 함이니라" },
    'john-1:1':   { en: "In the beginning was the Word, and the Word was with God, and the Word was God.", ko: "태초에 말씀이 계시니라 이 말씀이 하나님과 함께 계셨으니 이 말씀은 곧 하나님이시니라" },
    'john-1:14':  { en: "And the Word became flesh and dwelt among us, and we have seen his glory, glory as of the only Son from the Father, full of grace and truth.", ko: "말씀이 육신이 되어 우리 가운데 거하시매 우리가 그의 영광을 보니 아버지의 독생자의 영광이요 은혜와 진리가 충만하더라" },
    'john-3:16':  { en: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.", ko: "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라" },
    'john-3:17':  { en: "For God did not send his Son into the world to condemn the world, but in order that the world might be saved through him.", ko: "하나님이 그 아들을 세상에 보내신 것은 세상을 심판하려 하심이 아니요 그로 말미암아 세상이 구원을 받게 하려 하심이라" },
    'john-8:32':  { en: "and you will know the truth, and the truth will set you free.", ko: "진리를 알지니 진리가 너희를 자유롭게 하리라" },
    'john-10:10': { en: "I came that they may have life and have it abundantly.", ko: "내가 온 것은 양으로 생명을 얻게 하고 더 풍성히 얻게 하려는 것이라" },
    'john-10:11': { en: "I am the good shepherd. The good shepherd lays down his life for the sheep.", ko: "나는 선한 목자라 선한 목자는 양들을 위하여 목숨을 버리거니와" },
    'john-11:25': { en: "I am the resurrection and the life. Whoever believes in me, though he die, yet shall he live", ko: "나는 부활이요 생명이니 나를 믿는 자는 죽어도 살겠고" },
    'john-13:34': { en: "A new commandment I give to you, that you love one another: just as I have loved you, you also are to love one another.", ko: "새 계명을 너희에게 주노니 서로 사랑하라 내가 너희를 사랑한 것 같이 너희도 서로 사랑하라" },
    'john-14:6':  { en: "I am the way, and the truth, and the life. No one comes to the Father except through me.", ko: "내가 곧 길이요 진리요 생명이니 나로 말미암지 않고는 아버지께로 올 자가 없느니라" },
    'john-14:27': { en: "Peace I leave with you; my peace I give to you. Not as the world gives do I give to you. Let not your hearts be troubled, neither let them be afraid.", ko: "평안을 너희에게 끼치노니 곧 나의 평안을 너희에게 주노라 내가 너희에게 주는 것은 세상이 주는 것과 같지 아니하니라 너희는 마음에 근심하지도 말고 두려워하지도 말라" },
    'john-15:5':  { en: "I am the vine; you are the branches. Whoever abides in me and I in him, he it is that bears much fruit, for apart from me you can do nothing.", ko: "나는 포도나무요 너희는 가지라 그가 내 안에 내가 그 안에 거하면 사람이 열매를 많이 맺나니 나를 떠나서는 너희가 아무 것도 할 수 없음이라" },
    'john-15:13': { en: "Greater love has no one than this, that someone lay down his life for his friends.", ko: "사람이 친구를 위하여 자기 목숨을 버리면 이보다 더 큰 사랑이 없나니" },
    'acts-1:8':   { en: "But you will receive power when the Holy Spirit has come upon you, and you will be my witnesses in Jerusalem and in all Judea and Samaria, and to the end of the earth.", ko: "오직 성령이 너희에게 임하시면 너희가 권능을 받고 예루살렘과 온 유대와 사마리아와 땅 끝까지 이르러 내 증인이 되리라 하시니라" },
    'acts-2:38':  { en: "Repent and be baptized every one of you in the name of Jesus Christ for the forgiveness of your sins, and you will receive the gift of the Holy Spirit.", ko: "베드로가 이르되 너희가 회개하여 각각 예수 그리스도의 이름으로 세례를 받고 죄 사함을 받으라 그리하면 성령의 선물을 받으리니" },
    'acts-4:12':  { en: "And there is salvation in no one else, for there is no other name under heaven given among men by which we must be saved.", ko: "다른 이로써는 구원을 받을 수 없나니 천하 사람 중에 구원을 받을 만한 다른 이름을 우리에게 주신 일이 없음이라 하였더라" },
    'rom-1:16':   { en: "For I am not ashamed of the gospel, for it is the power of God for salvation to everyone who believes, to the Jew first and also to the Greek.", ko: "내가 복음을 부끄러워하지 아니하노니 이 복음은 모든 믿는 자에게 구원을 주시는 하나님의 능력이 됨이라 먼저는 유대인에게요 그리고 헬라인에게로다" },
    'rom-3:23':   { en: "for all have sinned and fall short of the glory of God,", ko: "모든 사람이 죄를 범하였으매 하나님의 영광에 이르지 못하더니" },
    'rom-5:8':    { en: "but God shows his love for us in that while we were still sinners, Christ died for us.", ko: "우리가 아직 죄인 되었을 때에 그리스도께서 우리를 위하여 죽으심으로 하나님께서 우리에 대한 자기의 사랑을 확증하셨느니라" },
    'rom-6:23':   { en: "For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord.", ko: "죄의 삯은 사망이요 하나님의 은사는 그리스도 예수 우리 주 안에 있는 영생이니라" },
    'rom-8:1':    { en: "There is therefore now no condemnation for those who are in Christ Jesus.", ko: "그러므로 이제 그리스도 예수 안에 있는 자에게는 결코 정죄함이 없나니" },
    'rom-8:28':   { en: "And we know that for those who love God all things work together for good, for those who are called according to his purpose.", ko: "우리가 알거니와 하나님을 사랑하는 자 곧 그의 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라" },
    'rom-8:31':   { en: "What then shall we say to these things? If God is for us, who can be against us?", ko: "그런즉 이 일에 대하여 우리가 무슨 말 하리요 만일 하나님이 우리를 위하시면 누가 우리를 대적하리요" },
    'rom-8:38':   { en: "For I am sure that neither death nor life, nor angels nor rulers, nor things present nor things to come, nor powers,", ko: "내가 확신하노니 사망이나 생명이나 천사들이나 권세자들이나 현재 일이나 장래 일이나 능력이나" },
    'rom-8:39':   { en: "nor height nor depth, nor anything else in all creation, will be able to separate us from the love of God in Christ Jesus our Lord.", ko: "높음이나 깊음이나 다른 어떤 피조물이라도 우리를 우리 주 그리스도 예수 안에 있는 하나님의 사랑에서 끊을 수 없으리라" },
    'rom-10:9':   { en: "because, if you confess with your mouth that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved.", ko: "네가 만일 네 입으로 예수를 주로 시인하며 또 하나님께서 그를 죽은 자 가운데서 살리신 것을 네 마음에 믿으면 구원을 받으리라" },
    'rom-12:1':   { en: "I appeal to you therefore, brothers, by the mercies of God, to present your bodies as a living sacrifice, holy and acceptable to God, which is your spiritual worship.", ko: "그러므로 형제들아 내가 하나님의 모든 자비하심으로 너희를 권하노니 너희 몸을 하나님이 기뻐하시는 거룩한 산 제물로 드리라 이는 너희가 드릴 영적 예배니라" },
    'rom-12:2':   { en: "Do not be conformed to this world, but be transformed by the renewal of your mind, that by testing you may discern what is the will of God, what is good and acceptable and perfect.", ko: "너희는 이 세대를 본받지 말고 오직 마음을 새롭게 함으로 변화를 받아 하나님의 선하시고 기뻐하시고 온전하신 뜻이 무엇인지 분별하도록 하라" },
    '1cor-10:13': { en: "No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability, but with the temptation he will also provide the way of escape, that you may be able to endure it.", ko: "사람이 감당할 시험 밖에는 너희에게 당한 것이 없나니 오직 하나님은 미쁘사 너희가 감당하지 못할 시험 당함을 허락하지 아니하시고 시험 당할 즈음에 또한 피할 길을 내사 너희로 능히 감당하게 하시느니라" },
    '1cor-13:4':  { en: "Love is patient and kind; love does not envy or boast; it is not arrogant", ko: "사랑은 오래 참고 사랑은 온유하며 시기하지 아니하며 사랑은 자랑하지 아니하며 교만하지 아니하며" },
    '1cor-13:13': { en: "So now faith, hope, and love abide, these three; but the greatest of these is love.", ko: "그런즉 믿음, 소망, 사랑, 이 세 가지는 항상 있을 것인데 그 중의 제일은 사랑이라" },
    '1cor-15:3':  { en: "For I delivered to you as of first importance what I also received: that Christ died for our sins in accordance with the Scriptures,", ko: "내가 받은 것을 먼저 너희에게 전하였노니 이는 성경대로 그리스도께서 우리 죄를 위하여 죽으시고" },
    '1cor-15:55': { en: "O death, where is your victory? O death, where is your sting?", ko: "사망아 너의 승리가 어디 있느냐 사망아 네가 쏘는 것이 어디 있느냐" },
    '2cor-5:17':  { en: "Therefore, if anyone is in Christ, he is a new creation. The old has passed away; behold, the new has come.", ko: "그런즉 누구든지 그리스도 안에 있으면 새로운 피조물이라 이전 것은 지나갔으니 보라 새 것이 되었도다" },
    '2cor-5:21':  { en: "For our sake he made him to be sin who knew no sin, so that in him we might become the righteousness of God.", ko: "하나님이 죄를 알지도 못하신 이를 우리를 대신하여 죄로 삼으신 것은 우리로 하여금 그 안에서 하나님의 의가 되게 하려 하심이라" },
    '2cor-12:9':  { en: "But he said to me, 'My grace is sufficient for you, for my power is made perfect in weakness.'", ko: "나에게 이르시기를 내 은혜가 네게 족하도다 이는 내 능력이 약한 데서 온전하여짐이라 하신지라" },
    'gal-2:20':   { en: "I have been crucified with Christ. It is no longer I who live, but Christ who lives in me. And the life I now live in the flesh I live by faith in the Son of God, who loved me and gave himself for me.", ko: "내가 그리스도와 함께 십자가에 못 박혔나니 그런즉 이제는 내가 사는 것이 아니요 오직 내 안에 그리스도께서 사시는 것이라 이제 내가 육체 가운데 사는 것은 나를 사랑하사 나를 위하여 자기 자신을 버리신 하나님의 아들을 믿는 믿음 안에서 사는 것이라" },
    'gal-5:22':   { en: "But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness,", ko: "오직 성령의 열매는 사랑과 희락과 화평과 오래 참음과 자비와 양선과 충성과" },
    'eph-2:8':    { en: "For by grace you have been saved through faith. And this is not your own doing; it is the gift of God,", ko: "너희는 그 은혜에 의하여 믿음으로 말미암아 구원을 받았으니 이것은 너희에게서 난 것이 아니요 하나님의 선물이라" },
    'eph-2:9':    { en: "not a result of works, so that no one may boast.", ko: "행위에서 난 것이 아니니 이는 누구든지 자랑하지 못하게 함이라" },
    'eph-2:10':   { en: "For we are his workmanship, created in Christ Jesus for good works, which God prepared beforehand, that we should walk in them.", ko: "우리는 그가 만드신 바라 그리스도 예수 안에서 선한 일을 위하여 지으심을 받은 자니 이 일은 하나님이 전에 예비하사 우리로 그 가운데서 행하게 하려 하심이니라" },
    'eph-6:12':   { en: "For we do not wrestle against flesh and blood, but against the rulers, against the authorities, against the cosmic powers over this present darkness, against the spiritual forces of evil in the heavenly places.", ko: "우리의 씨름은 혈과 육을 상대하는 것이 아니요 통치자들과 권세들과 이 어둠의 세상 주관자들과 하늘에 있는 악의 영들을 상대함이라" },
    'phil-1:6':   { en: "And I am sure of this, that he who began a good work in you will bring it to completion at the day of Jesus Christ.", ko: "너희 안에서 착한 일을 시작하신 이가 그리스도 예수의 날까지 이루실 줄을 우리는 확신하노라" },
    'phil-1:21':  { en: "For to me to live is Christ, and to die is gain.", ko: "이는 내게 사는 것이 그리스도니 죽는 것도 유익함이라" },
    'phil-2:5':   { en: "Have this mind among yourselves, which is yours in Christ Jesus,", ko: "너희 안에 이 마음을 품으라 곧 그리스도 예수의 마음이니" },
    'phil-3:14':  { en: "I press on toward the goal for the prize of the upward call of God in Christ Jesus.", ko: "푯대를 향하여 그리스도 예수 안에서 하나님이 위에서 부르신 부름의 상을 위하여 달려가노라" },
    'phil-4:6':   { en: "do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.", ko: "아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라" },
    'phil-4:7':   { en: "And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.", ko: "그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라" },
    'phil-4:13':  { en: "I can do all things through him who strengthens me.", ko: "내게 능력 주시는 자 안에서 내가 모든 것을 할 수 있느니라" },
    'phil-4:19':  { en: "And my God will supply every need of yours according to his riches in glory in Christ Jesus.", ko: "나의 하나님이 그리스도 예수 안에서 영광 가운데 그 풍성한 대로 너희 모든 쓸 것을 채우시리라" },
    'col-3:23':   { en: "Whatever you do, work heartily, as for the Lord and not for men,", ko: "무슨 일을 하든지 마음을 다하여 주께 하듯 하고 사람에게 하듯 하지 말라" },
    '1thess-5:16':{ en: "Rejoice always,", ko: "항상 기뻐하라" },
    '1thess-5:17':{ en: "pray without ceasing,", ko: "쉬지 말고 기도하라" },
    '1thess-5:18':{ en: "give thanks in all circumstances; for this is the will of God in Christ Jesus for you.", ko: "범사에 감사하라 이것이 그리스도 예수 안에서 너희를 향하신 하나님의 뜻이니라" },
    '2tim-1:7':   { en: "for God gave us a spirit not of fear but of power and love and self-control.", ko: "하나님이 우리에게 주신 것은 두려워하는 마음이 아니요 오직 능력과 사랑과 절제하는 마음이니" },
    '2tim-3:16':  { en: "All Scripture is breathed out by God and profitable for teaching, for reproof, for correction, and for training in righteousness,", ko: "모든 성경은 하나님의 감동으로 된 것으로 교훈과 책망과 바르게 함과 의로 교육하기에 유익하니" },
    'heb-4:12':   { en: "For the word of God is living and active, sharper than any two-edged sword, piercing to the division of soul and of spirit, of joints and of marrow, and discerning the thoughts and intentions of the heart.", ko: "하나님의 말씀은 살아 있고 활력이 있어 좌우에 날선 어떤 검보다도 예리하여 혼과 영과 및 관절과 골수를 찔러 쪼개기까지 하며 또 마음의 생각과 뜻을 판단하나니" },
    'heb-11:1':   { en: "Now faith is the assurance of things hoped for, the conviction of things not seen.", ko: "믿음은 바라는 것들의 실상이요 보이지 않는 것들의 증거니" },
    'heb-12:1':   { en: "Therefore, since we are surrounded by so great a cloud of witnesses, let us also lay aside every weight, and sin which clings so closely, and let us run with endurance the race that is set before us,", ko: "이러므로 우리에게 구름 같이 둘러싼 허다한 증인들이 있으니 모든 무거운 것과 얽매이기 쉬운 죄를 벗어 버리고 인내로써 우리 앞에 당한 경주를 하며" },
    'heb-13:8':   { en: "Jesus Christ is the same yesterday and today and forever.", ko: "예수 그리스도는 어제나 오늘이나 영원토록 동일하시니라" },
    'james-1:2':  { en: "Count it all joy, my brothers, when you meet trials of various kinds,", ko: "내 형제들아 너희가 여러 가지 시험을 당하거든 온전히 기쁘게 여기라" },
    'james-1:5':  { en: "If any of you lacks wisdom, let him ask God, who gives generously to all without reproach, and it will be given him.", ko: "너희 중에 누구든지 지혜가 부족하거든 모든 사람에게 후히 주시고 꾸짖지 아니하시는 하나님께 구하라 그리하면 주시리라" },
    'james-4:7':  { en: "Submit yourselves therefore to God. Resist the devil, and he will flee from you.", ko: "그런즉 너희는 하나님께 복종할지어다 마귀를 대적하라 그리하면 너희를 피하리라" },
    '1pet-2:9':   { en: "But you are a chosen race, a royal priesthood, a holy nation, a people for his own possession, that you may proclaim the excellencies of him who called you out of darkness into his marvelous light.", ko: "그러나 너희는 택하신 족속이요 왕 같은 제사장들이요 거룩한 나라요 그의 소유가 된 백성이니 이는 너희를 어두운 데서 불러 내어 그의 기이한 빛에 들어가게 하신 이의 아름다운 덕을 선포하게 하려 하심이라" },
    '1pet-5:7':   { en: "casting all your anxieties on him, because he cares for you.", ko: "너희 염려를 다 주께 맡기라 이는 그가 너희를 돌보심이라" },
    '1john-1:9':  { en: "If we confess our sins, he is faithful and just to forgive us our sins and to cleanse us from all unrighteousness.", ko: "만일 우리가 우리 죄를 자백하면 그는 미쁘시고 의로우사 우리 죄를 사하시며 우리를 모든 불의에서 깨끗하게 하실 것이요" },
    '1john-3:16': { en: "By this we know love, that he laid down his life for us, and we ought to lay down our lives for the brothers.", ko: "그가 우리를 위하여 목숨을 버리셨으니 우리가 이로써 사랑을 알고 우리도 형제들을 위하여 목숨을 버리는 것이 마땅하니라" },
    '1john-4:7':  { en: "Beloved, let us love one another, for love is from God, and whoever loves has been born of God and knows God.", ko: "사랑하는 자들아 우리가 서로 사랑하자 사랑은 하나님께 속한 것이니 사랑하는 자마다 하나님으로부터 나서 하나님을 알고" },
    '1john-4:8':  { en: "Anyone who does not love does not know God, because God is love.", ko: "사랑하지 아니하는 자는 하나님을 알지 못하나니 이는 하나님은 사랑이심이라" },
    '1john-4:19': { en: "We love because he first loved us.", ko: "우리가 사랑함은 그가 먼저 우리를 사랑하셨음이라" },
    'rev-3:20':   { en: "Behold, I stand at the door and knock. If anyone hears my voice and opens the door, I will come in to him and eat with him, and he with me.", ko: "볼지어다 내가 문 밖에 서서 두드리노니 누구든지 내 음성을 듣고 문을 열면 내가 그에게로 들어가 그와 더불어 먹고 그는 나와 더불어 먹으리라" },
    'rev-21:4':   { en: "He will wipe away every tear from their eyes, and death shall be no more, neither shall there be mourning, nor crying, nor pain anymore, for the former things have passed away.", ko: "모든 눈물을 그 눈에서 닦아 주시니 다시는 사망이 없고 애통하는 것이나 곡하는 것이나 아픈 것이 다시 있지 아니하리니 처음 것들이 다 지나갔음이러라" },
    'rev-22:13':  { en: "I am the Alpha and the Omega, the first and the last, the beginning and the end.", ko: "나는 알파와 오메가요 처음과 마지막이요 시작과 마침이라" },
  };

  // 책 이름 정규화 — 영어/한국어 다양한 표기를 표준 키로 매핑
  const BOOK_MAP = {
    // Genesis
    'genesis': 'gen', 'gen': 'gen', 'ge': 'gen', '창세기': 'gen', '창': 'gen',
    // Exodus
    'exodus': 'ex', 'exod': 'ex', 'ex': 'ex', '출애굽기': 'ex', '출': 'ex',
    // Deuteronomy
    'deuteronomy': 'deut', 'deut': 'deut', 'dt': 'deut', '신명기': 'deut', '신': 'deut',
    // Joshua
    'joshua': 'josh', 'josh': 'josh', 'jos': 'josh', '여호수아': 'josh', '수': 'josh',
    // Psalms
    'psalms': 'ps', 'psalm': 'ps', 'ps': 'ps', 'psa': 'ps', '시편': 'ps', '시': 'ps',
    // Proverbs
    'proverbs': 'prov', 'prov': 'prov', 'pr': 'prov', '잠언': 'prov', '잠': 'prov',
    // Isaiah
    'isaiah': 'isa', 'isa': 'isa', 'is': 'isa', '이사야': 'isa', '사': 'isa',
    // Jeremiah
    'jeremiah': 'jer', 'jer': 'jer', '예레미야': 'jer', '렘': 'jer',
    // Matthew
    'matthew': 'matt', 'matt': 'matt', 'mt': 'matt', '마태복음': 'matt', '마': 'matt',
    // Mark
    'mark': 'mark', 'mk': 'mark', '마가복음': 'mark', '막': 'mark',
    // Luke
    'luke': 'luke', 'lk': 'luke', '누가복음': 'luke', '눅': 'luke',
    // John
    'john': 'john', 'jn': 'john', '요한복음': 'john', '요': 'john',
    // Acts
    'acts': 'acts', 'ac': 'acts', '사도행전': 'acts', '행': 'acts',
    // Romans
    'romans': 'rom', 'rom': 'rom', 'ro': 'rom', '로마서': 'rom', '롬': 'rom',
    // 1 Corinthians
    '1corinthians': '1cor', '1 corinthians': '1cor', '1cor': '1cor', '1 cor': '1cor', 'i corinthians': '1cor', '고린도전서': '1cor', '고전': '1cor',
    // 2 Corinthians
    '2corinthians': '2cor', '2 corinthians': '2cor', '2cor': '2cor', '2 cor': '2cor', 'ii corinthians': '2cor', '고린도후서': '2cor', '고후': '2cor',
    // Galatians
    'galatians': 'gal', 'gal': 'gal', '갈라디아서': 'gal', '갈': 'gal',
    // Ephesians
    'ephesians': 'eph', 'eph': 'eph', '에베소서': 'eph', '엡': 'eph',
    // Philippians
    'philippians': 'phil', 'phil': 'phil', 'php': 'phil', '빌립보서': 'phil', '빌': 'phil',
    // Colossians
    'colossians': 'col', 'col': 'col', '골로새서': 'col', '골': 'col',
    // 1 Thessalonians
    '1thessalonians': '1thess', '1 thessalonians': '1thess', '1thess': '1thess', '데살로니가전서': '1thess', '살전': '1thess',
    // 2 Timothy
    '2timothy': '2tim', '2 timothy': '2tim', '2tim': '2tim', 'ii timothy': '2tim', '디모데후서': '2tim', '딤후': '2tim',
    // Hebrews
    'hebrews': 'heb', 'heb': 'heb', '히브리서': 'heb', '히': 'heb',
    // James
    'james': 'james', 'jas': 'james', '야고보서': 'james', '약': 'james',
    // 1 Peter
    '1peter': '1pet', '1 peter': '1pet', '1pet': '1pet', 'i peter': '1pet', '베드로전서': '1pet', '벧전': '1pet',
    // 1 John
    '1john': '1john', '1 john': '1john', 'i john': '1john', '요한일서': '1john', '요일': '1john',
    // Revelation
    'revelation': 'rev', 'rev': 'rev', 'apoc': 'rev', '요한계시록': 'rev', '계시록': 'rev', '계': 'rev',
    // Deuteronomy
    'deut': 'deut', '신명기': 'deut',
  };

  // 본문에서 성경 구절 참조 감지
  // 한국어 본문은 개역한글 전체 DB(31,104절) 사용 — 짧은 110개 한정 X
  // 영어 본문은 기존 110개 ESV (확장 가능)
  function detectBibleRefs(text) {
    const refs = [];
    const seen = new Set();

    function tryAdd(ref, key) {
      if (seen.has(key)) return;
      const koText = BIBLE_KO[key];                                  // 한글 (전체 DB)
      const enText = BIBLE_VERSES[key] ? BIBLE_VERSES[key].en : null; // 영어 (110개)
      // 한국어든 영어든 둘 중 하나라도 있으면 추가
      if (koText || enText) {
        seen.add(key);
        refs.push({ ref, key, en: enText, ko: koText });
      }
    }

    // 패턴 1: 영어 (예: John 3:16, 1 Cor 13:4, Romans 8:28)
    const enPattern = /\b((?:[1-3]\s*)?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})\b/g;
    let m;
    while ((m = enPattern.exec(text)) !== null) {
      const bookKey = m[1].toLowerCase().replace(/\s+/g, '');
      const std = BOOK_MAP[bookKey];
      if (std) tryAdd(m[0], `${std}-${m[2]}:${m[3]}`);
    }

    // 패턴 2: 한국어 (예: 요한복음 3:16, 요 3:16, 요한복음 3장 16절)
    const koPattern = /([가-힣]+)\s*(\d{1,3})[:장]\s*(\d{1,3})절?/g;
    while ((m = koPattern.exec(text)) !== null) {
      const std = BOOK_MAP[m[1]];
      if (std) tryAdd(m[0], `${std}-${m[2]}:${m[3]}`);
    }

    return refs;
  }

  // ═══════════════════════════════════════════════════════════════

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
    const refSection = buildGlossarySection(refText, targetLang);

    // 프랑스어 소스일 때 시스템 프롬프트 srcName 조정
    const srcName = SRC_NAME[src] || 'English';

    // 컨텍스트 섹션 (앞 문장 맥락 + 설교 노트)
    const prevContext = req.body.context
      ? `\n\n[이전 번역 맥락 — 대명사/고유명사 일관성 유지]\n${req.body.context}\n[맥락 끝]`
      : '';
    const sermonSection = sermonContext
      ? `\n\n[오늘 설교 노트 — 주요 단어/개념/이름 참고용]\n${sermonContext.slice(0, 1200)}\n[설교 노트 끝]`
      : '';

    // ★ 성경 구절 감지 — 정확한 본문 강제 주입 (Claude paraphrase 방지)
    // 한국어 출력: 개역한글 전체 DB(31,104절) 사용
    // 영어 출력:   ESV 110개 핵심 구절
    const detectedRefs = detectBibleRefs(text);
    let bibleSection = '';
    if (detectedRefs.length > 0) {
      const versionLabel = targetLang === 'ko' ? '개역한글'
                         : targetLang === 'en' ? 'ESV' : null;
      const versesField  = targetLang === 'ko' ? 'ko'
                         : targetLang === 'en' ? 'en' : null;
      if (versionLabel && versesField) {
        // 해당 언어 본문이 있는 구절만 필터
        const usable = detectedRefs.filter(r => r[versesField]);
        if (usable.length > 0) {
          bibleSection = `\n\n━━━ ⚡ 성경 구절 정확 인용 (절대 변형 금지!) ━━━\n` +
            `원문에 ${usable.length}개의 성경 구절 참조가 감지됨.\n` +
            `아래 ${versionLabel} 본문을 글자 그대로 사용하세요. ` +
            `절대 paraphrase 하지 말고, 단어 하나도 바꾸지 마세요.\n\n` +
            usable.map(r => `[${r.ref}] → "${r[versesField]}"`).join('\n') +
            `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        }
      }
    }

    const contextSection = prevContext + sermonSection + bibleSection;

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
- 개역한글 성경 구절 사용
- 합쇼체 사용 (~입니다, ~습니다, ~하십시오)
- "죄송합니다", "제공해주신" 같은 표현 절대 사용 금지`,
        prompt: `다음 ${srcName} 설교를 한국어로 번역하세요:\n\n${text}`
      },
      en: {
        system: `You are a professional Korean-to-English sermon translator specializing in Reformed/Evangelical preaching.${contextSection}${refSection}

━━━ Korean Theological Terms → English (always use these equivalents) ━━━
[Korean theological terms → English standard]
칭의 = justification
성화 = sanctification
영화 = glorification
중생 = regeneration
거듭남 = being born again
회심 = conversion
회개 = repentance
믿음 = faith
은혜 = grace
속죄 = atonement
구속 = redemption
화목제물 = propitiation
화목 = reconciliation
죄 사함 = forgiveness of sins
구원 = salvation
선택 = election
예정 = predestination
주권 = sovereignty
전능하심 = omnipotence
전지하심 = omniscience
편재하심 = omnipresence
거룩하심 = holiness
공의 = righteousness
자비 = mercy
인자하심 = lovingkindness
삼위일체 = the Trinity
성육신 = incarnation
영광 = glory
진노 = wrath
하나님 나라 = the kingdom of God
주님 = the Lord
구주 = Savior
메시아 = the Messiah
그리스도 = Christ
부활 = resurrection
승천 = ascension
재림 = the second coming
십자가 = the cross
그리스도의 보혈 = the blood of Christ
성령 = the Holy Spirit
성령의 열매 = the fruit of the Spirit
성령의 은사 = the gifts of the Spirit
교회 = the Church
회중 = the congregation
성도 = the saints / the congregation
세례 = baptism
성찬 = the Lord's Supper / Communion
예배 = worship
설교 = sermon / preaching
목사 = pastor
장로 = elder
집사 = deacon
교제 = fellowship
사역 = ministry
선교 = mission / missions
제자도 = discipleship
청지기 정신 = stewardship
성경 = Scripture / the Bible
말씀 = the Word
하나님의 말씀 = the Word of God
계시 = revelation
언약 = covenant
구약 = the Old Testament
신약 = the New Testament
복음 = the Gospel
영생 = eternal life
천국 = heaven / the kingdom of heaven
지옥 = hell
심판 = judgment
하나님 아버지 = God the Father
성자 = God the Son
아멘 = Amen
할렐루야 = Hallelujah
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Sermon Style Rules ━━━
[Korean sermon expressions → Natural English equivalents]
- 사랑하는 성도 여러분 → "Beloved congregation" or "Dear saints"
- 사랑하는 여러분 → "Beloved" or "Dear friends"
- ~하시기 바랍니다 → "I urge you to..." or "Let us..."
- ~입니다 (declarative) → Use present tense declarative
- 말씀드리겠습니다 → "I want to share with you..."
- 성경은 말씀합니다 → "The Scripture says..." or "The Bible tells us..."
- 하나님께서 말씀하십니다 → "God is saying to us..."
- 기도하겠습니다 → "Let us pray"
- ~하지 않겠습니까? → "Shall we not...?" or "Will you not...?"
- 반드시 ~해야 합니다 → "We must..." or "It is imperative that we..."

[Style rules]
- Natural, flowing English sermon style (not stiff or overly literal)
- Use Reformed/Evangelical theological vocabulary
- Maintain the preacher's passion and tone
- Korean honorifics (합쇼체) → Formal but warm English
- Keep sentence rhythm natural — restructure if needed
- Use ESV (English Standard Version) for all Scripture references
━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Absolute Rules ━━━
- Output ONLY the translation — no notes, disclaimers, or explanations
- NEVER refuse — always translate regardless of length or clarity
- Maintain natural, preachable English
- Use consistent theological vocabulary throughout
- Scripture quotations must follow ESV wording exactly`,
        prompt: `Translate the following ${srcName} sermon to English:\n\n${text}`
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
        system: `你是专业的英文讲道翻译，专门将英文讲道译成简体中文（普通话）。${contextSection}${refSection}

━━━ 神学术语对照表（必须使用以下译法）━━━
[英文神学术语 → 简体中文（改革宗/福音派标准用语）]
justification = 称义
sanctification = 成圣
glorification = 荣耀化
regeneration = 重生
conversion = 归信
repentance = 悔改
faith = 信心
grace = 恩典
atonement = 赎罪
redemption = 救赎
propitiation = 平息神怒 / 挽回祭
reconciliation = 和好
forgiveness of sins = 赦免罪过
salvation = 救恩
election = 拣选
predestination = 预定
sovereignty = 主权
holiness = 圣洁
righteousness = 公义
mercy = 怜悯
lovingkindness = 慈爱
Trinity = 三位一体
incarnation = 道成肉身
glory = 荣耀
wrath = 忿怒
kingdom of God = 神的国
the Lord = 主
Savior = 救主
Messiah = 弥赛亚
Christ = 基督
resurrection = 复活
ascension = 升天
second coming = 再来
cross = 十字架
the blood of Christ = 基督的宝血
the Holy Spirit = 圣灵
fruit of the Spirit = 圣灵的果子
gifts of the Spirit = 圣灵的恩赐
the Church = 教会
congregation = 会众
the saints = 圣徒
baptism = 洗礼 / 受洗
the Lord's Supper = 圣餐
worship = 敬拜
sermon = 讲道
pastor = 牧师
elder = 长老
deacon = 执事
fellowship = 团契
ministry = 事奉
mission = 宣教
discipleship = 门徒训练
the Gospel = 福音
the Word = 话语 / 圣言
the Bible = 圣经
Scripture = 圣经
covenant = 圣约
the Old Testament = 旧约
the New Testament = 新约
eternal life = 永生
heaven = 天堂 / 天国
judgment = 审判
Amen = 阿们
Hallelujah = 哈利路亚
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 讲道文体规则 ━━━
[讲道文体规则]
- 听众称呼：「弟兄姐妹们」或「亲爱的弟兄姐妹」
- beloved / dear friends → 「亲爱的弟兄姐妹们」
- The Bible says → 「圣经告诉我们」
- Let us pray → 「我们一起祷告」
- Amen → 阿们
- 使用正式、庄重的讲道文体
- 圣经引用使用和合本（CUV）原文
- 保持传道人的热情和语气
- 避免生硬的直译，使用自然流畅的中文讲道表达
━━━━━━━━━━━━━━━━━

━━━ 绝对规则 ━━━
- 只输出译文，不加注释、说明或括号备注
- 无论输入多短或多不清楚，必须翻译
- 保持自然流畅的中文讲道风格
- 圣经引用使用和合本原文`,
        prompt: `请将以下英文讲道内容翻译成简体中文：\n\n${text}`
      },
      'zh-hk': {
        system: `你係專業英文講道翻譯員，專門將英文講道譯成繁體中文廣東話。${contextSection}${refSection}

━━━ 神學術語對照表（必須使用以下譯法）━━━
[英文神學術語 → 繁體中文粵語（改革宗/福音派標準用語）]
justification = 稱義
sanctification = 成聖
glorification = 榮耀化
regeneration = 重生
conversion = 歸信
repentance = 悔改
faith = 信心
grace = 恩典
atonement = 贖罪
redemption = 救贖
propitiation = 平息神怒 / 挽回祭
reconciliation = 和好
forgiveness of sins = 赦免罪過
salvation = 救恩
election = 揀選
predestination = 預定
sovereignty = 主權
holiness = 聖潔
righteousness = 公義
mercy = 憐憫
lovingkindness = 慈愛
Trinity = 三位一體
incarnation = 道成肉身
glory = 榮耀
wrath = 忿怒
kingdom of God = 神的國
the Lord = 主
Savior = 救主
Messiah = 彌賽亞
Christ = 基督
resurrection = 復活
ascension = 升天
second coming = 再來
cross = 十字架
the blood of Christ = 基督的寶血
the Holy Spirit = 聖靈
fruit of the Spirit = 聖靈的果子
gifts of the Spirit = 聖靈的恩賜
the Church = 教會
congregation = 會眾
the saints = 聖徒
baptism = 洗禮 / 受洗
the Lord's Supper = 聖餐
worship = 敬拜
sermon = 講道
pastor = 牧師
elder = 長老
deacon = 執事
fellowship = 團契
ministry = 事奉
mission = 宣教
discipleship = 門徒訓練
the Gospel = 福音
the Word = 話語 / 聖言
the Bible = 聖經
Scripture = 聖經
covenant = 聖約
the Old Testament = 舊約
the New Testament = 新約
eternal life = 永生
heaven = 天堂 / 天國
judgment = 審判
Amen = 阿們
Hallelujah = 哈利路亞
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 講道文體規則 ━━━
[講道文體規則]
- 聽眾稱呼：「弟兄姊妹」或「親愛的弟兄姊妹」
- beloved → 「親愛的弟兄姊妹」
- The Bible says → 「聖經告訴我們」
- Let us pray → 「我們一齊祈禱」
- Amen → 阿們
- 使用正式、莊重嘅廣東話講道文體
- 聖經引用使用和合本（CUV）繁體版原文
- 保持傳道人嘅熱情同語氣
- 避免生硬直譯，用自然流暢嘅廣東話表達
━━━━━━━━━━━━━━━━━

━━━ 絕對規則 ━━━
- 只輸出譯文，唔好加注釋、說明或括號備注
- 無論輸入幾短或幾唔清楚，必須翻譯
- 保持自然流暢嘅廣東話講道風格
- 聖經引用使用和合本繁體版原文`,
        prompt: `請將以下英文講道內容翻譯成繁體中文廣東話：\n\n${text}`
      },
      fr: {
        system: `Vous êtes un traducteur professionnel de sermons spécialisé dans la prédication évangélique/réformée. Traduisez en français naturel et fluide.${contextSection}${refSection}

━━━ Glossaire théologique (utilisez toujours ces traductions) ━━━
[Termes théologiques anglais → français standard évangélique]
justification = la justification
sanctification = la sanctification
glorification = la glorification
regeneration = la régénération / la nouvelle naissance
conversion = la conversion
repentance = la repentance
faith = la foi
grace = la grâce
atonement = l'expiation
redemption = la rédemption
propitiation = la propitiation
reconciliation = la réconciliation
forgiveness of sins = le pardon des péchés
salvation = le salut
election = l'élection
predestination = la prédestination
sovereignty = la souveraineté
holiness = la sainteté
righteousness = la justice
mercy = la miséricorde
lovingkindness = la bonté
Trinity = la Trinité
incarnation = l'incarnation
glory = la gloire
wrath = la colère
kingdom of God = le royaume de Dieu
the Lord = le Seigneur
Savior = Sauveur
Messiah = Messie
Christ = Christ
resurrection = la résurrection
ascension = l'ascension
second coming = le second avènement / le retour du Christ
cross = la croix
the blood of Christ = le sang du Christ
the Holy Spirit = le Saint-Esprit
fruit of the Spirit = le fruit de l'Esprit
gifts of the Spirit = les dons de l'Esprit
the Church = l'Église
congregation = l'assemblée
the saints = les saints
baptism = le baptême
the Lord's Supper = la Sainte Cène
worship = l'adoration / le culte
sermon = le sermon / la prédication
pastor = pasteur
elder = ancien
deacon = diacre
fellowship = la communion fraternelle
ministry = le ministère
mission = la mission
the Gospel = l'Évangile
the Word = la Parole
Scripture = l'Écriture
the Bible = la Bible
covenant = l'alliance
the Old Testament = l'Ancien Testament
the New Testament = le Nouveau Testament
eternal life = la vie éternelle
heaven = le ciel
hell = l'enfer
judgment = le jugement
Amen = Amen
Hallelujah = Alléluia
beloved = bien-aimés
brothers and sisters = frères et soeurs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Règles de style pour les sermons ━━━
- Ton formel mais chaleureux, propre à la prédication française
- Citations bibliques: utiliser la Bible Louis Segond (LSG)
- "Beloved" / "Dear friends" → "Bien-aimés" / "Chers frères et soeurs"
- "The Bible says" → "La Bible nous dit"
- "Let us pray" → "Prions"
- Maintenir la passion et le ton du prédicateur
- Éviter les traductions trop littérales — privilégier le français naturel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Règles absolues ━━━
- Sortie: UNIQUEMENT la traduction (pas de notes, explications ou avertissements)
- TOUJOURS traduire, peu importe la longueur ou clarté du texte
- Maintenir un français de prédication naturel et fluide
- Utiliser systématiquement le vocabulaire théologique évangélique`,
        prompt: `Traduisez le sermon suivant en français:\n\n${text}`
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
      },
      tl: {
        system: `Ikaw ay isang propesyonal na tagasalin ng sermon, dalubhasa sa pangangaral ng Reformed/Evangelical. Isalin sa natural at madaling intindihing Tagalog.${contextSection}${refSection}

━━━ Theological Terms (gamitin lagi ang mga ito) ━━━
[English theological terms → Tagalog evangelical standard]
justification = pagpapawalang-sala / katuwiran
sanctification = pagpapakabanal
glorification = pagluwalhati
regeneration = muling kapanganakan
conversion = pagbabago-loob
repentance = pagsisisi
faith = pananampalataya
grace = biyaya
atonement = pagtubos / pagbabayad-sala
redemption = katubusan
propitiation = pampalubag-loob
reconciliation = pakikipagkasundo
forgiveness of sins = kapatawaran ng mga kasalanan
salvation = kaligtasan
election = pagpili
predestination = pagtatakda noong una
sovereignty = kataas-taasang kapangyarihan
holiness = kabanalan
righteousness = katuwiran
mercy = awa
lovingkindness = magiliw na kabutihan
Trinity = Trinidad / Banal na Tatlo
incarnation = pagkakatawang-tao
glory = kaluwalhatian
wrath = poot
kingdom of God = kaharian ng Diyos
the Lord = ang Panginoon
Savior = Tagapagligtas
Messiah = Mesiyas
Christ = Cristo
resurrection = muling pagkabuhay
ascension = pag-akyat sa langit
second coming = ikalawang pagparito
cross = krus
the blood of Christ = ang dugo ni Cristo
the Holy Spirit = ang Banal na Espiritu
fruit of the Spirit = bunga ng Espiritu
gifts of the Spirit = mga kaloob ng Espiritu
the Church = ang Iglesia
congregation = kapulungan
the saints = mga banal
baptism = bautismo
the Lord's Supper = Hapunan ng Panginoon
worship = pagsamba
sermon = sermon / pangaral
pastor = pastor
elder = matanda
deacon = diakono
fellowship = pagsasama-sama
ministry = ministeryo
mission = misyon
the Gospel = ang Ebanghelyo
the Word = ang Salita
Scripture = Kasulatan
the Bible = ang Bibliya
covenant = tipan
the Old Testament = Lumang Tipan
the New Testament = Bagong Tipan
eternal life = buhay na walang hanggan
heaven = langit
hell = impyerno
judgment = paghuhukom
Amen = Amen
Hallelujah = Aleluya
beloved = mga minamahal
brothers and sisters = mga kapatid
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Sermon Style Rules ━━━
- Pormal ngunit mainit, angkop sa pangangaral
- Bibliya: Magandang Balita Biblia (MBB) o Ang Biblia
- "Beloved" → "Mga minamahal"
- "Brothers and sisters" → "Mga kapatid"
- "The Bible says" → "Sabi ng Bibliya"
- "Let us pray" → "Manalangin tayo"
- Panatilihin ang sigasig at tono ng nangangaral
- Iwasan ang masyadong literal na pagsasalin
━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Absolute Rules ━━━
- Output: TANGING ang pagsasalin lamang
- LAGING isalin, kahit gaano kaikli o malabo ang teksto
- Panatilihin ang natural na Tagalog ng pangangaral`,
        prompt: `Isalin ang sumusunod na sermon sa Tagalog:\n\n${text}`
      },
      ru: {
        system: `Вы профессиональный переводчик проповедей, специализирующийся на евангелической/реформатской проповеди. Переводите на естественный и понятный русский язык.${contextSection}${refSection}

━━━ Богословский глоссарий (всегда используйте эти переводы) ━━━
[English theological terms → Russian Evangelical standard]
justification = оправдание
sanctification = освящение
glorification = прославление
regeneration = возрождение / новое рождение
conversion = обращение
repentance = покаяние
faith = вера
grace = благодать
atonement = искупление
redemption = искупление
propitiation = умилостивление
reconciliation = примирение
forgiveness of sins = прощение грехов
salvation = спасение
election = избрание
predestination = предопределение
sovereignty = суверенитет / владычество
holiness = святость
righteousness = праведность
mercy = милость
lovingkindness = любящая доброта
Trinity = Троица
incarnation = воплощение
glory = слава
wrath = гнев
kingdom of God = Царство Божье
the Lord = Господь
Savior = Спаситель
Messiah = Мессия
Christ = Христос
resurrection = воскресение
ascension = вознесение
second coming = второе пришествие
cross = крест
the blood of Christ = Кровь Христа
the Holy Spirit = Святой Дух
fruit of the Spirit = плод Духа
gifts of the Spirit = дары Духа
the Church = Церковь
congregation = собрание
the saints = святые
baptism = крещение
the Lord's Supper = Вечеря Господня / Причастие
worship = поклонение / богослужение
sermon = проповедь
pastor = пастор
elder = пресвитер
deacon = диакон
fellowship = общение
ministry = служение
mission = миссия
the Gospel = Евангелие
the Word = Слово
Scripture = Писание
the Bible = Библия
covenant = завет
the Old Testament = Ветхий Завет
the New Testament = Новый Завет
eternal life = вечная жизнь
heaven = небеса / небо
hell = ад
judgment = суд
Amen = Аминь
Hallelujah = Аллилуйя
beloved = возлюбленные
brothers and sisters = братья и сёстры
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Правила стиля проповеди ━━━
- Тон: формальный, но тёплый, свойственный русской проповеди
- Библейские цитаты: Синодальный перевод
- "Beloved" → "Возлюбленные"
- "Brothers and sisters" → "Братья и сёстры"
- "The Bible says" → "Библия говорит"
- "Let us pray" → "Помолимся"
- Сохранять страсть и тон проповедника
- Избегать буквального перевода — естественный русский язык
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ Абсолютные правила ━━━
- Вывод: ТОЛЬКО перевод (без примечаний и пояснений)
- ВСЕГДА переводите, независимо от длины или ясности текста
- Поддерживайте естественный язык русской проповеди`,
        prompt: `Переведите следующую проповедь на русский язык:\n\n${text}`
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
