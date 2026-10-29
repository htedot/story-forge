// 文风标定引擎。
// 一根轴一个变量，一次只动一根；用户只做一件事——把四段排个序。
// 排序位置直接反推档位，不做中心化的加权平均（那会把每根轴都往保守偏一档）。

export const AXES = [
  {
    id: 'length',
    name: '句长与密度',
    ask: '句子多长，分句之间靠什么连',
    levels: [
      '一句一停，多数分句不超过八个字，句号多，读起来是断的',
      '以十五字上下的短句为主，偶尔插一个长句',
      '分句十五到二十五字，靠逗号推进，三到五个分句串成一句',
      '一句四十到七十字，三到五个分句连写，句号很少，靠连接词推进',
    ],
  },
  {
    id: 'link',
    name: '连接方式',
    ask: '句子之间靠什么粘住',
    levels: [
      '几乎不用连接词，一件事一件事平行排下去',
      '用然后、后来、接着这类时间词推进',
      '用所以、因为、但是、而且这类逻辑连词，用得密',
      '用根据、至于、之所以、而非、相较于、届时这类书面连接词，句子之间是论证关系',
    ],
  },
  {
    id: 'register',
    name: '语域',
    ask: '用词偏口语还是偏书面',
    levels: [
      '像说话，可以用语气词、口头禅、把字句',
      '干净的日常书面语，不用书面词，也不刻意口语',
      '用书面词，少量成语，句子讲究',
      '用署名、刊于、断言、归结于、超负荷这类正式词，句式偏定性判断',
    ],
  },
  {
    id: 'trope',
    name: '修辞密度',
    ask: '打不打比方',
    levels: [
      '不打比方。要说的东西直接写，不借别的物件来比',
      '全篇最多一处比喻，必须是日常物件，一次就够',
      '每两三百字一个比喻，可以用一点通感',
      '比喻和意象密集，允许华丽',
    ],
  },
  {
    id: 'certainty',
    name: '确定性',
    ask: '下不下判断，怎么下',
    levels: [
      '只写发生了什么，不说这意味着什么',
      '说的时候加条件、范围和可能',
      '直接下判断，不用也许、可能',
      '给判断标置信度，会写「我倾向于」「大概率」「不为零」',
    ],
  },
  {
    id: 'stance',
    name: '「我」的位置',
    ask: '「我」是干什么用的',
    levels: [
      '没有「我」，只有事情本身',
      '有「我」，只用来做动作和说话',
      '「我」主要用来放观点、标推断',
      '直接对读者说话，会写「你可以认为」「你会看到」',
    ],
  },
  {
    id: 'ending',
    name: '收尾动作',
    ask: '一段话结尾落在哪儿',
    levels: [
      '写到动作停就停，不总结',
      '最后落在一个物件或一个画面上',
      '最后给一个解释：为什么会这样',
      '最后给它一个类别或一个更大的说法，拔高一层',
    ],
  },
  {
    id: 'emotion',
    name: '情绪处理',
    ask: '情绪写不写、怎么写',
    levels: [
      '只写动作、对话、沉默的长度，不出现情绪词',
      '情绪通过身体反应写，最多一个情绪词',
      '直接写他害怕、她生气',
      '情绪展开写，可以写内心独白',
    ],
  },
  {
    id: 'grain',
    name: '观察颗粒',
    ask: '细节具体到什么程度',
    levels: [
      '写类型化的场景，不写具体细节',
      '每段一个具体物件或数字',
      '几乎每句都有具体的物件、数量、时间',
      '精确到能被查证的程度：品牌、型号、金额、日期',
    ],
  },
  {
    id: 'source',
    name: '材料来源',
    ask: '写的东西从哪儿来',
    levels: [
      '全靠编，不需要现实依据',
      '取材于日常见闻',
      '会引用资料、数据、文献，写进正文',
      '以可查证的外部材料为主，写明出处',
    ],
  },
];

export const AXIS_BY_ID = Object.fromEntries(AXES.map((a) => [a.id, a]));

// 固定材料：同一件事，四段都写它，才比得出来。
export const PROBE_MATERIAL =
  '一个人晚上回家，发现家门口放着一样不属于自己的东西。';

// 除了正在测的那根轴，其余一律钉住。
export const NEUTRAL =
  '句子长度中等，日常书面语，不打比方，不写情绪词和内心独白，每段有一个具体物件，第三人称，结尾停在动作上。';

export function levelText(axisId, level) {
  const a = AXIS_BY_ID[axisId];
  if (!a) return '';
  return a.levels[Math.max(0, Math.min(3, level | 0))];
}

/**
 * 从排序反推档位。
 * order：从最差到最好的四个编号（0–3）。
 * 取排第一那一格的位置；单峰、单调都能用，掉头两次以上只记录不采信。
 */
export function estimateLevel(order) {
  if (!Array.isArray(order) || order.length !== 4) return { level: null, shape: 'invalid', turns: 0 };
  if (new Set(order).size !== 4) return { level: null, shape: 'invalid', turns: 0 };

  // 单调？
  const inc = order.every((v, i) => i === 0 || v > order[i - 1]);
  const dec = order.every((v, i) => i === 0 || v < order[i - 1]);
  if (inc) return { level: 3, shape: 'up', turns: 0 };
  if (dec) return { level: 0, shape: 'down', turns: 0 };

  // 单峰 / 单谷：看极值位置
  let turns = 0;
  let dir = 0;
  for (let i = 1; i < order.length; i++) {
    const d = Math.sign(order[i] - order[i - 1]);
    if (d === 0) continue;
    if (dir === 0) dir = d;
    else if (d !== dir) {
      turns++;
      dir = d;
    }
  }

  const best = order[3];
  if (turns <= 1) return { level: best, shape: 'peak', turns };
  return { level: null, shape: 'noise', turns };
}

export function estimateAll(style) {
  const axes = {};
  const rounds = style.rounds || [];
  for (const r of rounds) {
    if (r.level == null) continue;
    if (!axes[r.axis]) axes[r.axis] = [];
    axes[r.axis].push(r.level);
  }
  const out = {};
  for (const k of Object.keys(axes)) {
    const arr = axes[k];
    out[k] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  return out;
}

/** 把一份文风渲染成给模型的写作指令。没标定的轴不写。 */
export function brief(style) {
  if (!style) return '';
  const axes = style.axes || {};
  const lines = [];
  for (const a of AXES) {
    const v = axes[a.id];
    if (v == null) continue;
    lines.push(`- ${a.name}：${a.levels[v]}`);
  }
  const notes = (style.notes || []).filter(Boolean);
  const out = [];
  const text = String(style.text || '').trim();
  if (text) out.push('叙述严格按这份写法来：\n' + text);
  if (lines.length) out.push('叙述按下面这份写法来：\n' + lines.join('\n'));
  if (notes.length) out.push('另外这几条必须守住：\n' + notes.map((n) => '- ' + n).join('\n'));
  return out.join('\n');
}

export function describe(style) {
  const text = String((style && style.text) || '').trim();
  if (text) {
    const n = text.split('\n').filter((l) => l.trim()).length;
    return `实验法 · ${n} 条规则`;
  }
  const axes = (style && style.axes) || {};
  const set = AXES.filter((a) => axes[a.id] != null);
  if (!set.length) return '还没标定';
  const top = set
    .slice(0, 3)
    .map((a) => a.levels[axes[a.id]].split('，')[0])
    .join(' · ');
  return `${set.length}/${AXES.length} 轴 · ${top}`;
}

export function probeMessages(axis, material) {
  const a = AXIS_BY_ID[axis];
  const body = a.levels
    .map((lv, i) => `${'ABCD'[i]}：${lv}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        '你在做文风标定。同一件事，用四种写法各写一段，每段 70–110 字。\n' +
        '四段之间只有一项不同，其余必须完全一致。\n' +
        `这一项是「${a.name}」。\n\n` +
        body +
        `\n\n其余一律保持一致：${NEUTRAL}\n` +
        '不要开头称呼，不要编号，不要解释和点评，只出正文。\n' +
        '四段之间用单独一行 --- 隔开。除了正文和 ---，不要输出任何别的东西。',
    },
    { role: 'user', content: '材料：' + (material || PROBE_MATERIAL) },
  ];
}

// 把模型吐回来的四段正文切出来。优先按 --- 切，其次按空行切，兜底按编号切。
export function parseProbe(raw) {
  let text = String(raw || '').trim();
  if (!text) return [];

  // 模型偶尔还是会给 JSON
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      const arr = o.passages || o.variants || o.texts || o.items;
      if (Array.isArray(arr)) {
        const got = arr.map((x) => String(x || '').trim()).filter((x) => x.length >= 8);
        if (got.length >= 4) return got.slice(0, 4);
      }
    } catch {
      /* 不是 JSON 就往下走 */
    }
  }

  let parts = text
    .split(/\n[ \t]*---+[ \t]*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 4) {
    parts = text
      .split(/\n[ \t]*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (parts.length < 4) {
    const m = text.match(/[A-Da-d１-４一二三四1-4][）).、:：][ \t]*([^\n]+)/g);
    if (m && m.length >= 4) parts = m.map((s) => s.replace(/^[A-Da-d１-４一二三四1-4][）).、:：][ \t]*/, '').trim());
  }

  parts = parts.filter((s) => s.length >= 8);
  return parts.slice(0, 4);
}

/* ---------------- 对话式敲定 ---------------- */

const FORGE_SYS = `你在帮一个人把「他自己动笔时的习惯」问出来。这些答案后来会变成一份规则，交给另一个 AI，让它在写小说时模仿他。

怎么问：
- 一次只问一个问题，问题要短，一句话就能答。
- 不要问「你喜欢什么风格」「你想要什么感觉」这种没法回答的问题。
- 要问具体的事：同一个场面你会从哪儿起头；写到哪一句就停；一句话大概多少字；会不会打比方；情绪是直接写出来，还是绕开只写动作；会不会用括号；结尾是下判断还是收住；对话里用不用「他说」。
- 每问一个新问题之前，先用一句话说你从上一次回答里读到了什么。要具体，比如「你句子偏短，情绪不点名，只写动作」。不要说他很有文学感、很细腻、很深刻。
- 不要夸他，不要安慰，不要给人生建议。
- 一次只推进一步。问满五个问题就停，说：差不多了，点「敲定」。

只说中文，不要用书面腔，不要加小标题。`;

const DISTILL_SYS = `下面是一段对话记录：一个人在被问到「他自己写东西时的习惯」时给出的回答。请据此写一份「写作指令」，交给另一个 AI，让它照着这份指令替这个人写小说。

要求：
- 6 到 9 条，每条一行，以「· 」开头。
- 每条必须是可执行的规则：怎么写。不能是形容词：写得怎样。
- 不要出现这些词：优美、细腻、有张力、引人入胜、生动、深刻、丰富、独特、流畅。
- 只写指令。不要开场白，不要总结，不要解释你为什么这么写。
- 某一条如果没有依据，就不要写。`;

export function forgeMessages(chat) {
  return [{ role: 'system', content: FORGE_SYS }, ...(chat || [])];
}

export function forgeDistillMessages(chat) {
  const transcript = (chat || [])
    .filter((m) => m && m.content)
    .map((m) => (m.role === 'user' ? '我：' : '你：') + String(m.content).trim())
    .join('\n\n');
  return [
    { role: 'system', content: DISTILL_SYS },
    { role: 'user', content: '记录如下：\n\n' + transcript },
  ];
}

/* ---------------- 实验法：随笔 → 规则 → 仿写 → 排序 → 改规则 ----------------
   和上面那套「对话敲定」的区别：规则在第一轮就存在，之后每轮只是改它。
   所以「敲定」永远不是一次高风险的大生成，只是把手里这版存下来。 */

export const ESSAY_MATERIAL = '深夜的便利店。一个人结账的时候发现手机没电了，身上只有一张不认识的卡。';

const ANALYZE_SYS = `你会读到一个人随手写的一小段话。请从中读出他动笔时的习惯，然后做两件事。

第一件，用三行写下你读到了什么。每行以「读到：」开头，后面跟一句话。必须具体，指得出东西：句子多长、从哪儿起头、停在哪里、有没有打比方、情绪是写出来还是绕开只写动作、有没有用括号。不要说他文笔好、有文学感、有张力、细腻。

第二件，把这套习惯写成一份「写作规则」，交给另一个 AI 照着写。6 到 9 条，每条一行，直接写内容，不要加 · 或编号，不要分小标题。
每条必须是可执行的动作——怎么写。不能是形容词——写得怎样。
不要出现这些词：优美、细腻、有张力、引人入胜、生动、深刻、丰富、独特、流畅。
没把握的不要写。宁可少写两条。

只说中文。不要开场白，不要总结。`;

export function analyzeMessages(essay) {
  return [
    { role: 'system', content: ANALYZE_SYS },
    { role: 'user', content: '他写的：\n\n' + String(essay || '').trim() },
  ];
}

const stripMark = (s) => String(s || '').replace(/^\s*(?:\d+[.、)）]|[-*•·‣∙])\s*/, '').trim();

const RULE_HEADER =
  /^[（(【\[]?\s*(?:写作规则|新的?规则|修改后的规则|规则如下|规则|以下是规则)\s*[）)】\]]?\s*[:：]?$/;

/**
 * 把一段「规则」收拾成可以直接编辑的纯文本：一行一条，不带符号。
 * 这里刻意不做结构化解析——规则本来就是人读的文本，
 * 强行按固定格式拆只会在模型换一种排版时全崩。
 */
export function cleanRules(raw) {
  let t = String(raw || '').replace(/\r/g, '').trim();
  if (!t) return '';
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const out = [];
  for (const rawLine of t.split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    if (RULE_HEADER.test(line)) continue;
    line = line.replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^__(.+?)__$/, '$1').trim();
    line = line
      .replace(/^[-–—*·•‣∙]+\s*/, '')
      .replace(/^(?:\d+[.、)）]|[（(]\d+[）)])\s*/, '')
      .trim();
    if (line) out.push(line);
  }
  return out.join('\n').trim();
}

export function parseAnalyze(raw) {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const read = [];
  const ruleLines = [];
  for (const line of lines) {
    const bare = stripMark(line);
    const m = bare.match(/^(?:读到|观察|看出|我读到)\s*[：:]\s*(.+)$/);
    if (m) {
      read.push(m[1].trim());
      continue;
    }
    ruleLines.push(line);
  }
  const text = cleanRules(ruleLines.join('\n'));
  const rules = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  return { read: read.slice(0, 3), rules, text: rules.join('\n') };
}

const IMITATE_SYS = `你会拿到一份「写作规则」。请照着它写四段文字。

四段都写同一个材料。都尽量遵守规则；但在规则没有说清楚的地方，每一段各自做一个不同的选择——句子的松紧、信息给的早晚、停在哪里、要不要解释。四段必须真的不一样，否则这个人排不出序。

输出格式：四段正文，每段之间单独一行写 ---。不要编号，不要标题，不要解释，不要加引号。`;

export function imitateMessages(rules, material) {
  return [
    { role: 'system', content: IMITATE_SYS },
    {
      role: 'user',
      content: `材料：${material || ESSAY_MATERIAL}\n\n规则：\n${String(rules || '').trim()}`,
    },
  ];
}

const SEP = /^\s*-{3,}\s*$/m;

// 一次只写一段：比一次要四段稳得多，也能边写边显示进度。
const IMITATE_ONE_SYS = `你在模仿一个人写小说的手感和句子。严格按给到的「写作规则」写。

只输出这一段的正文。不要标题，不要编号，不要解释，不要用引号把整段括起来，不要写"好的"。120–200 字。`;

const IMITATE_VARIANTS = [
  '这一段把句子压得更短、更碎，多断句。',
  '这一段句子可以长一点、连一点，但一个比喻都不要用。',
  '这一段多写环境声和物件的状态，少写我自己的动作。',
  '这一段多写我自己的动作顺序，少写环境。',
];

export function imitateOneMessages(rules, material, i) {
  return [
    { role: 'system', content: IMITATE_ONE_SYS },
    {
      role: 'user',
      content: `【写作规则】\n${String(rules || '').trim()}\n\n【这一段怎么处理】\n${IMITATE_VARIANTS[i % IMITATE_VARIANTS.length]}\n\n【材料】\n${material || ESSAY_MATERIAL}`,
    },
  ];
}

export function parsePassages(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const parts = text.split(/^\s*-{3,}\s*$/m);
  const out = parts
    .map((p) => p.trim().replace(/^\s*\d+[.、)）]\s*/, '').trim())
    .filter((p) => p.length >= 10);
  return out.slice(0, 4);
}

const REVISE_SYS = `一个人写了一份「写作规则」，AI 照着它写了四段。这个人把四段从最差排到最好。

请据此修改规则。

- 他排在越后面（越好）的段，说明规则在这些地方是对的，保留。
- 他排在越前面（越差）的段，说明规则在这些地方偏了，改掉。要能说出偏在哪儿：句子太整齐？解释太多？停得太早？太爱打比方？
- 如果四段都被排得很差，说明规则整体偏了，重写。
- 如果他说「都不像」并给了话，以那句话为准。

输出一份新的完整规则，6 到 9 条，每条一行，直接写内容，不要加 · 或编号，不要分小标题。
只输出规则。不要解释，不要总结，不要说他很有眼光。
不要出现这些词：优美、细腻、有张力、引人入胜、生动、深刻、丰富、独特、流畅。`;

export function reviseMessages(rules, passages, order, note) {
  const list = (order || [])
    .map((idx, k) => {
      const tag =
        k === 0 ? '——他排在最前，最差' : k === order.length - 1 ? '——他排在最后，最好' : '——中间';
      return `【第 ${idx + 1} 段】${tag}\n${String(passages[idx] || '').trim()}`;
    })
    .join('\n\n');
  const tail = String(note || '').trim();
  return [
    { role: 'system', content: REVISE_SYS },
    {
      role: 'user',
      content:
        `旧规则：\n${String(rules || '').trim()}\n\n四段与他排的顺序：\n\n${list}` +
        (tail ? `\n\n他另外说了一句：${tail}` : ''),
    },
  ];
}

export function parseRules(raw) {
  return cleanRules(raw)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 12);
}

export function rulesToText(rules) {
  return (rules || []).map((r) => '· ' + r).join('\n');
}
