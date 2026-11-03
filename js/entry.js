// 启动模块：什么都没构思的人，从这里五分钟进第一场戏。
// 只产出一个「画面」和一个人，不产大纲、不产设定表。

export const PACKS = [
  {
    id: 'real',
    name: '现实',
    hint: '当下，身边的人和事。',
    hard: ['人死不能复生', '人的性格不会一夜之间变掉', '时间、钱、体力都是有限的'],
  },
  {
    id: 'xianxia',
    name: '修仙',
    hint: '山门、修为、长生。',
    hard: ['人死不能复生', '修为不能跳级', '每次突破都要付代价', '消息传不过千里，飞剑也要时间'],
  },
  {
    id: 'scifi',
    name: '科幻',
    hint: '技术改变了某件事。',
    hard: ['物理定律不被打破', '每一项技术都有成本和使用条件', '信息和物资的流动有延迟'],
  },
  {
    id: 'history',
    name: '历史',
    hint: '一个确定的年代，确定的规矩。',
    hard: ['那个年代没有的东西就是没有', '等级和礼法是真的约束', '现代观念不会被当成常识'],
  },
  {
    id: 'mystery',
    name: '悬疑',
    hint: '有一件已经发生的事。',
    hard: ['所有关键线索读者都看得见', '答案不能靠巧合或新人物', '凶手的行为必须自洽'],
  },
  {
    id: 'game',
    name: '游戏',
    hint: '规则就是世界。',
    hard: ['规则一旦写下就不能临时改', '失败有真实代价', '数值和资源是有限的'],
  },
];

export const ENTRIES = [
  {
    id: 'image',
    label: '一个画面',
    ask: '你脑子里有没有一个画面？说清楚那一格就够了：谁、在哪、正在干什么。',
    placeholder: '例：藏经阁里，一个人跪着，师父背对着他没回头。',
  },
  {
    id: 'situation',
    label: '一个处境',
    ask: '如果要写一个人被困住，你想让他被什么困住？',
    placeholder: '例：一整天只能说真话；一觉醒来全世界都记得昨天的事。',
  },
  {
    id: 'person',
    label: '一个人',
    ask: '你想写一个什么样的人？',
    placeholder: '例：一个特别冷的人；一个谁都不信的人；一个什么都忍得住的人。',
  },
];

export const packById = (id) => PACKS.find((p) => p.id === id) || PACKS[0];

const SYS = `你在帮一个人开始写小说。他还没构思好，只有很模糊的一点东西。
你的任务不是设计世界观，是把他给的那一点东西，变成**一个具体的画面**和**一个具体的人**。

要求：
- opening 是第一人称「我」的一小段正文，80–150 字，直接落在那个画面里。不要解释背景，不要交代来历。
- 这一段必须能让人看见具体的东西：一个地点、一个时间、一个正在发生的动作、至少一个物件。
- 这一段结尾要停在一个「还没解决」的地方。
- 人物三格要具体到能写：他要什么（具体到一个动作或一件东西）、他不肯说什么（一句他说不出口的话）、他说话什么方式（一个可以模仿的特征）。
- hard 是「这个世界里什么不可能」，给 2–4 条，要能真正约束写法。
- need 是这一场还差什么，一句话。

只输出 JSON，不要代码块：
{"title":"书的名字，4–10 字","opening":"正文第一段","person":{"name":"名字","want":"…","secret":"…","voice":"…"},"hard":["…"],"need":"这一场还差什么"}`;

export function seedMessages({ packId, entryId, answer, dislike, extraHard }) {
  const pack = packById(packId);
  const entry = ENTRIES.find((e) => e.id === entryId) || ENTRIES[0];
  const parts = [`题材：${pack.name}（${pack.hint}）`, `这个题材默认的「什么不可能」：${pack.hard.join('；')}`];
  if (extraHard && String(extraHard).trim()) parts.push(`作者要补的一条：${String(extraHard).trim()}`);
  if (answer && String(answer).trim()) parts.push(`${entry.label}：${String(answer).trim()}`);
  if (dislike && String(dislike).trim()) parts.push(`作者在这个题材里最受不了：${String(dislike).trim()}`);
  parts.push('把它变成第一场戏。');
  return [
    { role: 'system', content: SYS },
    { role: 'user', content: parts.join('\n') },
  ];
}

export function parseSeed(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j;
  try {
    j = JSON.parse(t.slice(a, b + 1));
  } catch (e) {
    return null;
  }
  const opening = String(j.opening || '').trim();
  if (!opening) return null;
  const p = j.person || {};
  return {
    title: String(j.title || '').trim() || '未命名',
    opening,
    person: {
      name: String(p.name || '').trim() || '我',
      want: String(p.want || '').trim(),
      secret: String(p.secret || '').trim(),
      voice: String(p.voice || '').trim(),
    },
    hard: Array.isArray(j.hard) ? j.hard.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4) : [],
    need: String(j.need || '').trim(),
  };
}
