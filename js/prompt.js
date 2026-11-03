// 提示词：五种卡各一套演绎，加收束、成章、生成设定。
import { CARD_KINDS, cardsOf, cardText, eventsOf, worldOf, outlineOf } from './store.js';

export const OUT_MARK = '<<<';

export function splitOut(raw) {
  const text = String(raw || '');
  const i = text.indexOf(OUT_MARK);
  if (i < 0) {
    return { body: text.replace(/<<\s*$/, '').trim(), options: [] };
  }
  const body = text.slice(0, i).trim();
  const rest = text.slice(i + OUT_MARK.length);
  const options = rest
    .split('\n')
    .map((s) => s.trim().replace(/^[-–—*·•‣∙0-9.、)）\s]+/, '').trim())
    .filter((s) => s.length >= 2)
    .slice(0, 3);
  return { body, options };
}

/* ---------------- 底稿 ---------------- */

function styleBlock(brief) {
  const b = String(brief || '').trim();
  if (!b) return '';
  return `\n【叙述的写法】\n${b}\n（这是作者自己的写法，叙述必须照着来；它高于下面任何一条关于「怎么写」的建议。）`;
}

function worldBlock(story) {
  const w = worldOf(story);
  const t = cardText(w);
  return t ? `【世界观】\n${t}` : '【世界观】\n（还没写。）';
}

function outlineBlock(story) {
  const o = outlineOf(story);
  const t = cardText(o);
  const evs = eventsOf(story);
  const evText = evs.length
    ? evs.map((e, i) => `${i + 1}. ${e.when ? e.when + '｜' : ''}${e.title || e.summary || ''}`).join('\n')
    : '（还没有事件。）';
  return `【大纲】\n${t || '（还没写。）'}\n\n【已有的事件链】\n${evText}`;
}

function othersBlock(story, exceptId) {
  const list = (story.cards || []).filter((c) => c.id !== exceptId && (c.kind === 'setting' || c.kind === 'character'));
  if (!list.length) return '';
  const body = list
    .map((c) => {
      const t = cardText(c);
      return t ? `· ${CARD_KINDS[c.kind].name}《${c.title}》\n${t}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return body ? `\n【其它已经定下的东西】\n${body}\n` : '';
}

/* ---------------- 五种演绎 ---------------- */

const BASE = `你在为一部小说做推演。你不是代笔，你是这个世界的推演引擎：你负责让事情真的往前发生，作者负责决定往哪走。

三条铁律：
一，不给作者台阶。他做什么，世界就有相应的反弹；不要因为他想做就让事情顺利。
二，不解释意义。不写「这意味着」「这说明了」，不总结，不升华。
三，具体。地名、时间、价钱、人数、谁说了哪句话。抽象的词一律换成看得见的东西。`;

const HOW = {
  world: `【这一场演的是世界本身】
不出现主角，不写「我」。用推演的口气：某个决定做下去之后，这个地区会怎样，哪一批人先受损，三个月后表面看起来是什么样子。

每一拍落地一个可以被后人记载的事实：一条法令、一次涨价、一场械斗、一批人离城、一个新出现的行当。不写心情，写后果。

作者在这一场里做的是：注入压力、选择走向、决定哪条支线值得长出来。`,

  setting: `【这一场演的是这一条设定】
把它推到底：什么时候它不灵、什么条件下它反噬、谁靠它活着、谁被它排除在外。

不出现主角。用具体的例子演，不要复述设定本身——设定卡上已经写过的，不要再说一遍。你要演出它还没有被写出来的那一面。`,

  character: `【这一场演的是这个人】
用第一人称「我」，就是这个角色。他不知道自己在一部小说里，他有自己想说和不想说的事。

他的「不肯说的」那一条，是这一场里最不该被轻易说出口的东西。你可以让他绕开、让他用别的话代替、让他忽然生气——但不要让他直接坦白。

作者在这一场里：以他的身份做决定，或者导着他走。`,

  outline: `【这一场演的是剧情怎么走】
作者在这里做的是决策，不是表演。一次只摆一个岔路口：现在走到这里，往前有几种走法，各自的代价是什么。

写成具体场面，不要写成方案列表——让人看见它发生，而不是读到它被安排。每一拍结束时，这一拍本身应该能成为大纲里的一个事件（有时间、有地点、有事、有谁付出代价）。`,

  narrative: `【这一场演的是「这么讲会是什么样」】
不推进剧情。拿同一段材料，用这套叙事形式写出来，让作者看见效果。

每次只换一个变量：视角拉远一点、时态换成回忆、声音加一层、体例变成书信。然后写一小段示范。

写完之后，另起一行，用一句话说清这套讲法的代价——读者因此会知道什么、不会知道什么。`,
};

export function cardSystem(story, card, styleBrief) {
  const def = CARD_KINDS[card.kind] || CARD_KINDS.setting;
  return `${BASE}

【这本书】《${story.title}》

${worldBlock(story)}

${outlineBlock(story)}
${othersBlock(story, card.id)}
【这一张卡】${def.name}《${card.title}》
${cardText(card) || '（还是空的。）'}

${HOW[card.kind] || HOW.setting}${styleBlock(styleBrief)}

【输出格式】
先写正文。正文写完，另起一行只写 ${OUT_MARK}
然后在后面写三行：每行是作者接下来可以做的选择，8–18 字，不要编号，不要解释。`;
}

export function turnMessages(story, card, session, styleBrief) {
  const msgs = [{ role: 'system', content: cardSystem(story, card, styleBrief) }];
  for (const m of session.msgs || []) {
    if (m.role === 'me') msgs.push({ role: 'user', content: m.text });
    else msgs.push({ role: 'assistant', content: m.text });
  }
  if (!session.msgs || !session.msgs.length) {
    msgs.push({ role: 'user', content: '开始。直接写第一拍，不要写「好的」，不要写标题。' });
  }
  return msgs;
}

/* ---------------- 收束 ---------------- */

export function collectMessages(story, card, session) {
  const labels = card.sections.map((s) => s.label);
  const transcript = (session.msgs || [])
    .map((m) => (m.role === 'me' ? `作者：${m.text}` : `推演：${m.text}`))
    .join('\n\n');

  const head = `下面是一场演绎的全部记录。现在要把它收进设定卡《${card.title}》。

只写这一场真正改变了的部分。没被这场演绎碰到的区块，原样返回它现在的内容，不要改写、不要润色。

输出格式：每个小标题一行，以 ## 开头，标题必须和下面给的一字不差；标题下面直接写这一块的完整新内容（整块替换，不是追加）。不要写解释。

${labels.map((l) => `## ${l}`).join('\n')}`;

  if (card.kind === 'outline') {
    return [
      { role: 'system', content: '你把一场演绎整理回小说的大纲。只做整理，不新增演绎里没有发生的事。' },
      {
        role: 'user',
        content: `${head}\n\n另外在这之后，用 ## 事件 开头，一行一个新增或改变的事件，格式：\n- 时间｜事件一句话｜谁付出什么代价\n没有新事件就写 ## 事件 然后下一行写「无」。\n\n【这一场演绎】\n${transcript}\n\n【这张卡现在的内容】\n${cardText(card) || '（空）'}`,
      },
    ];
  }

  return [
    { role: 'system', content: '你把一场演绎整理回设定卡。只做整理，不新增演绎里没有发生的事。' },
    {
      role: 'user',
      content: `${head}\n\n【这一场演绎】\n${transcript}\n\n【这张卡现在的内容】\n${cardText(card) || '（空）'}`,
    },
  ];
}

export function parseCollect(raw, card) {
  const text = String(raw || '').replace(/\r/g, '');
  const lines = text.split('\n');
  const sections = [];
  let cur = null;
  let inEvents = false;

  for (const line of lines) {
    const m = /^\s*##\s*(.+?)\s*$/.exec(line);
    if (m) {
      const label = m[1].trim();
      if (label === '事件') {
        inEvents = true;
        cur = null;
        continue;
      }
      inEvents = false;
      const hit = card.sections.find((s) => s.label === label);
      if (hit) {
        cur = { label: hit.label, text: '' };
        sections.push(cur);
      } else {
        cur = null;
      }
      continue;
    }
    if (inEvents) continue;
    if (cur) cur.text += line + '\n';
  }

  const events = [];
  const evPart = text.split(/^\s*##\s*事件\s*$/m)[1];
  if (evPart) {
    for (const line of evPart.split('\n')) {
      const s = line.trim();
      if (!s || s === '无') continue;
      const body = s.replace(/^[-–—*·•]\s*/, '').trim();
      if (!body) continue;
      const parts = body.split(/[｜|]/).map((x) => x.trim());
      events.push({ when: parts[0] || '', title: parts[1] || parts[0] || '', summary: parts[1] || '', cost: parts[2] || '' });
    }
  }

  return {
    sections: sections.map((s) => ({ label: s.label, text: s.text.trim() })),
    events,
  };
}

/* ---------------- 成章 ---------------- */

export function chapterMessages(story, picked, narrativeCard, styleBrief) {
  const evText = picked.length
    ? picked
        .map((e, i) => `${i + 1}. ${e.when ? e.when + '｜' : ''}${e.title}${e.summary && e.summary !== e.title ? '：' + e.summary : ''}${e.cost ? '（代价：' + e.cost + '）' : ''}`)
        .join('\n')
    : '（这一段里没有事件，靠上下文推。）';

  const cast = cardsOf(story, 'character')
    .map((c) => {
      const t = cardText(c);
      return t ? `《${c.title}》\n${t}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const narr = narrativeCard ? cardText(narrativeCard) : '';

  return [
    {
      role: 'system',
      content: `${BASE}

【这本书】《${story.title}》

${worldBlock(story)}${styleBlock(styleBrief)}

【怎么写这一章】
- 骨架是下面这几件事。它们必须都出现在正文里，但不要按顺序报菜名——按它们之间的因果排。
- 世界观决定这些事为什么只能这样发生；凡是世界观里没有的规则，不要发明。
- 角色的动机和说话方式决定他做什么、说什么；不要让他做设定里不会做的事。
- ${narr ? '叙事形式已经给定，严格遵守：' + narr : '叙事形式由你定，但全书要一致。'}
- 直接出小说正文。不要标题，不要章节序号，不要解释，不要写「本章」。`,
    },
    {
      role: 'user',
      content: `【这一段的事件】\n${evText}\n\n【在场的人】\n${cast || '（还没有角色卡。）'}\n\n写这一章。`,
    },
  ];
}

/* ---------------- 生成新设定 ---------------- */

export function suggestMessages(story) {
  const all = (story.cards || [])
    .filter((c) => c.kind !== 'outline')
    .map((c) => ({ c, t: cardText(c) }))
    .filter((x) => x.t);
  const body = all.map((x) => `【${(CARD_KINDS[x.c.kind] || {}).name || '设定'}《${x.c.title}》】\n${x.t}`).join('\n\n');

  return [
    {
      role: 'system',
      content: `你读一遍这部小说现有的设定，找出还没被写、但一旦写清就会让故事更有张力的东西。

规则：
- 只提还没有的。已经写过的不要重提。
- 每条都要具体到能直接用：有人名、有机制、有代价。
- kind 只能是 setting 或 character。
- 最多 4 条。少于 2 条也行，宁缺毋滥。

输出格式（严格照做，每条之间空一行）：
### kind|标题
内容

不要写解释，不要写前言后语。`,
    },
    { role: 'user', content: `【这部小说现在有的东西】\n${body || '（几乎是空的。）'}\n\n给出新设定。` },
  ];
}

export function parseSuggest(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const out = [];
  const blocks = text.split(/^\s*###\s*/m).slice(1);
  for (const b of blocks) {
    const nl = b.indexOf('\n');
    const head = (nl < 0 ? b : b.slice(0, nl)).trim();
    const body = (nl < 0 ? '' : b.slice(nl + 1)).trim();
    const m = /^(\w+)\s*[|｜]\s*(.+)$/.exec(head);
    const kind = m ? m[1].trim() : 'setting';
    const title = (m ? m[2] : head).trim();
    if (!title || !body) continue;
    out.push({ kind: kind === 'character' ? 'character' : 'setting', title, text: body });
  }
  return out;
}
