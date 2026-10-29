// 提示词：三件事——演绎、抽事件、写成一章。
import { brief } from './style-engine.js';
import { KIND_BY_ID } from './store.js';

export const POV_MODES = [
  { id: 'third', name: '第三人称', desc: '像小说，站在外面写' },
  { id: 'first', name: '第一人称', desc: '以某个角色的「我」来写' },
  { id: 'omni', name: '全知', desc: '多个人的心思都能写' },
];

/* ---------------- 公共 ---------------- */

export function settingsBlock(story) {
  const cards = story.cards || [];
  if (!cards.length) return '【设定】还没有任何设定，只能靠常识推演，遇到关键处先停下来问。';
  const parts = cards.map((c) => {
    const k = KIND_BY_ID[c.kind] || { name: '设定' };
    return `【${k.name}·${c.title}】\n${(c.body || '（空）').trim()}`;
  });
  return '【已确定的设定】\n' + parts.join('\n\n');
}

export function cardPovNote(card) {
  if (card.kind === 'character') return '你是这个人，用第一人称「我」，只写这个人的所见、所想、所做。';
  if (card.kind === 'outline') return '你是这部书的导演，负责判断这一幕该不该发生、和大纲是否一致。';
  return '你在写史书：以上帝视角记录大事件、势力变化和趋势，不进入某个人的内心。';
}

/* ---------------- 演绎 ---------------- */

export function sessionSystem(story, card, style) {
  const k = KIND_BY_ID[card.kind] || { name: '设定' };
  const others = (story.cards || []).filter((c) => c.kind === 'character' && c.id !== card.id);

  return [
    `你在和这部书的作者一起演绎《${story.title}》。`,
    '',
    settingsBlock(story),
    '',
    `【这一场演的是·${k.name}：${card.title}】`,
    (card.body || '（这张卡还是空的，先问作者想要什么。）').trim(),
    '',
    '【视角】',
    cardPovNote(card),
    '',
    '【怎么演】',
    '- 你负责世界和别的人怎么反应，作者负责他自己那一下：说什么、做什么、退还是进。不要替作者做决定，不要写他的台词。',
    '- 在场的人不许配合。他们有自己的目的，会拒绝、会敷衍、会撒谎、会绕开。要让作者付出代价才能推进。',
    '- 写具体的过程：谁说了什么话，做了什么动作，结果是什么。写清楚，但不要文学加工，不要比喻，不要升华，不要替他总结意义。',
    '- 每次回应 120–250 字，停在作者需要接话的地方。一章要演十来轮，不要一次演完。',
    '- 作者的设定不许自己改。发现设定有冲突或不够用，就停下来问他一句。',
    others.length
      ? '- 其他角色：' + others.map((c) => c.title).join('、') + '。他们对作者的态度要按各自设定来，不要一见面就掏心掏肺。'
      : '',
    '',
    '【第一步】',
    '先不要开始演。先用四五句话复述你对这张卡的理解：这个人（或这个世界）是什么状况、想要什么、说话什么调子、此刻处在什么地方。',
    '然后问一句：「是这样吗？要不要改什么？」',
    '作者确认之后，你再演第一轮。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function sessionUser(messages, ctx) {
  const last = messages[messages.length - 1];
  return last ? last.content : '开始';
}

/* ---------------- 抽事件 ---------------- */

export function timelineMessages(story, session, card) {
  const lines = session.messages
    .map((m) => (m.role === 'user' ? '作者：' : '演绎：') + m.content)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        '你在把一次演绎整理成书的事实底账。只记录发生了什么，不记录谁的心情。',
        settingsBlock(story),
        '',
        '输出 JSON，不要别的话：',
        '{"summary":"这一章发生了什么，80–120字",',
        ' "events":[{"at":"时间标识，如 第一天 傍晚","title":"一行小标题","detail":"发生了什么，谁做了什么，结果如何，40–80字"}],',
        ' "suggestions":[{"cardId":"要改的卡片id","action":"append 或 replace","title":"卡片标题","body":"改后的完整内容"}]}',
        '',
        '规则：',
        '- events 按发生顺序排，3–8 条；只写演绎里真实发生过的，不要补。',
        '- at 用故事内的时间，作者没给就按前后顺序推一个合理的。',
        '- suggestions 只在演绎暴露出设定不足或矛盾时才给，可以给空数组。',
        `- 卡片id 只能用这些：${(story.cards || []).map((c) => `${c.id}=${c.title}`).join('，')}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: `这场演的是【${KIND_BY_ID[card.kind] ? KIND_BY_ID[card.kind].name : ''}·${card.title}】。\n\n${lines}`,
    },
  ];
}

/* ---------------- 写成一章 ---------------- */

export function chapterMessages(story, items, pov, style, span, extra) {
  const mode = pov.mode || 'third';
  const who = (pov.who || []).map((id) => (story.cards || []).find((c) => c.id === id)).filter(Boolean);
  const ex = extra || {};

  const povLine =
    mode === 'first' && who.length
      ? `用第一人称写，叙述者就是「${who[0].title}」，只写他知道的。`
      : mode === 'omni'
      ? '用全知视角写，几个人的心思都可以写，但不要跳来跳去。'
      : '用第三人称写，站在外面看，不进入任何人的内心。';

  const events = items.map((t, i) => `${i + 1}. ${t.at ? t.at + '，' : ''}${t.title}：${t.detail}`).join('\n');

  const styleText = brief(style);

  const transcripts = (ex.transcripts || []).length
    ? [
        '',
        '【这场戏的原始演绎】',
        '下面是作者当时实际演出来的内容，是这一章最可靠的材料。',
        '取里面的具体动作、语气、物件和原话；把对话记录转化成叙述，不要把「作者：」「演绎：」这种格式写进小说。',
        (ex.transcripts || []).map((t) => `—— ${t.title} ——\n${t.text}`).join('\n\n'),
      ].join('\n')
    : '';

  const prev = ex.prevTail
    ? ['', '【上一章最后一段】', ex.prevTail, '接着这个往下写，不要重复上一章已经交代过的信息。'].join('\n')
    : '';

  return [
    {
      role: 'system',
      content: [
        `你在写小说《${story.title}》的一章。`,
        '',
        settingsBlock(story),
        '',
        styleText ? '【写法】\n' + styleText : '【写法】写具体的动作、对话、物件和时间；不写「她很累」，写「她眼底有一层青」；不用比喻装饰；不替读者总结意义；结尾停在动作上。',
        '',
        '【写这一章】',
        povLine,
        '- 下面的事件是事实骨架，不许改；原始演绎里的细节可以取用，但要写成小说，不是记录。',
        '- 一整章，1200–2500 字。分段，不要小标题，不要解说，不要写「本章完」。',
        '- 开头直接进入场面，不要交代背景。',
        prev,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      role: 'user',
      content: `这一章覆盖：${span && span.from ? span.from : '未标'} 到 ${span && span.to ? span.to : '未标'}\n\n事件：\n${events}${transcripts}\n\n现在写这一章。`,
    },
  ];
}

// 把一场演绎压成纯文本，供写章节时取用；超长时保留结尾（结尾通常是这一场真正发生的事）
export function sessionTranscript(session, cardTitle, budget = 2600) {
  const lines = (session.messages || [])
    .map((m) => (m.role === 'user' ? '作者：' : '演绎：') + String(m.content || '').trim())
    .filter((x) => x.length > 2);
  let text = lines.join('\n');
  if (text.length > budget) text = '……（前略）\n' + text.slice(text.length - budget);
  return { title: session.title || cardTitle || '一场演绎', text };
}

// 取上一章结尾，保持接续
export function tailOf(text, n = 320) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? '…' + s.slice(s.length - n) : s;
}

/* ---------------- 杂项 ---------------- */

export function chapterWordCount(text) {
  return String(text || '').replace(/\s+/g, '').length;
}
