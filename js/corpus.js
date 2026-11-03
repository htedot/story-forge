// 正文主干：段落 / 场 / 事实 / 义务 / 人物 / 硬约束
// 原则：正文是事实，其余都是它的索引；每条事实都记出处，段落作废则事实失效。

const uid = (p = 'x') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

export function blankCorpus() {
  return { hard: [], people: [], facts: [], obligations: [], paragraphs: [], scenes: [] };
}

export function normalizeCorpus(story) {
  const c = story.corpus || (story.corpus = blankCorpus());
  for (const k of ['hard', 'people', 'facts', 'obligations', 'paragraphs', 'scenes']) {
    if (!Array.isArray(c[k])) c[k] = [];
  }
  if (!c.scenes.length) {
    c.scenes.push({ id: uid('sc'), ord: 1, title: '', obligationId: '', closedAt: 0, at: Date.now() });
  }
  return c;
}

export const corpusOf = (story) => normalizeCorpus(story);

export const curScene = (story) => {
  const c = normalizeCorpus(story);
  const open = c.scenes.filter((s) => !s.closedAt);
  return open.length ? open[open.length - 1] : c.scenes[c.scenes.length - 1];
};

export const liveParagraphs = (story) =>
  normalizeCorpus(story).paragraphs.filter((p) => !p.folded);

export const liveFacts = (story) => normalizeCorpus(story).facts.filter((f) => f.state !== 'dead');

export const openObligation = (story) => {
  const c = normalizeCorpus(story);
  const sc = curScene(story);
  if (sc && sc.obligationId) {
    const o = c.obligations.find((x) => x.id === sc.obligationId && x.state === 'open');
    if (o) return o;
  }
  return c.obligations.find((o) => o.state === 'open') || null;
};

export function wordCount(story) {
  return liveParagraphs(story).reduce((n, p) => n + String(p.text || '').replace(/\s/g, '').length, 0);
}

/* ---------------- 写 ---------------- */

export function addScene(story, { title = '', obligationId = '' } = {}) {
  const c = normalizeCorpus(story);
  const sc = {
    id: uid('sc'),
    ord: c.scenes.length + 1,
    title,
    obligationId,
    closedAt: 0,
    at: Date.now(),
  };
  c.scenes.push(sc);
  return sc;
}

export function openScene(story, obligationId) {
  const c = normalizeCorpus(story);
  const sc = curScene(story);
  if (sc && !sc.closedAt) {
    if (obligationId) sc.obligationId = obligationId;
    return sc;
  }
  return addScene(story, { obligationId });
}

export function closeScene(story, reason = 'done') {
  const sc = curScene(story);
  if (sc && !sc.closedAt) {
    sc.closedAt = Date.now();
    sc.reason = reason;
  }
  return sc;
}

export function appendParagraph(story, { text, speaker = 'ai', status = 'ok', note = '' }) {
  const c = normalizeCorpus(story);
  const sc = curScene(story) || addScene(story);
  const p = {
    id: uid('p'),
    sceneId: sc.id,
    speaker,
    text: String(text || '').trim(),
    status, // ok | violation | assumed
    note,
    folded: false,
    at: Date.now(),
  };
  if (p.text) c.paragraphs.push(p);
  story.updatedAt = Date.now();
  return p;
}

// 从某一段开始重来：这一段之后全部折叠作废，出自它们的「事实」一并失效
export function rollbackFrom(story, paragraphId) {
  const c = normalizeCorpus(story);
  const idx = c.paragraphs.findIndex((p) => p.id === paragraphId);
  if (idx < 0) return 0;
  const dead = [];
  for (let i = idx; i < c.paragraphs.length; i += 1) {
    const p = c.paragraphs[i];
    if (!p.folded) {
      p.folded = true;
      dead.push(p.id);
    }
  }
  const deadSet = new Set(dead);
  c.facts.forEach((f) => {
    if (deadSet.has(f.fromParagraph)) f.state = 'dead';
  });
  // 场也回到那一段所属的场
  const target = c.paragraphs[idx];
  if (target) {
    c.scenes.forEach((s) => {
      if (s.ord > (c.scenes.find((x) => x.id === target.sceneId) || s).ord) {
        s.closedAt = s.closedAt || Date.now();
      }
    });
  }
  story.updatedAt = Date.now();
  return dead.length;
}

/* ---------------- 沉淀 ---------------- */

export function addFact(story, text, fromParagraph) {
  const t = String(text || '').trim();
  if (!t) return null;
  const c = normalizeCorpus(story);
  const dup = c.facts.find((f) => f.state !== 'dead' && f.text === t);
  if (dup) return dup;
  const f = { id: uid('f'), text: t, fromParagraph: fromParagraph || '', state: 'live', at: Date.now() };
  c.facts.push(f);
  return f;
}

export function addPerson(story, p) {
  const c = normalizeCorpus(story);
  const person = {
    id: uid('n'),
    name: (p && p.name) || '未命名',
    want: (p && p.want) || '',
    secret: (p && p.secret) || '',
    voice: (p && p.voice) || '',
    knows: [],
    from: (p && p.from) || 'user',
  };
  c.people.push(person);
  return person;
}

export function personByName(story, name) {
  const c = normalizeCorpus(story);
  const n = String(name || '').trim();
  if (!n) return null;
  return c.people.find((x) => x.name === n) || c.people.find((x) => n.includes(x.name) || x.name.includes(n)) || null;
}

export function addKnows(story, name, fact) {
  const p = personByName(story, name);
  if (!p) return false;
  const t = String(fact || '').trim();
  if (!t) return false;
  if (!Array.isArray(p.knows)) p.knows = [];
  if (!p.knows.includes(t)) p.knows.push(t);
  return true;
}

export function addHard(story, text, from = 'user') {
  const t = String(text || '').trim();
  if (!t) return null;
  const c = normalizeCorpus(story);
  const dup = c.hard.find((h) => h.text === t);
  if (dup) return dup;
  const h = { id: uid('h'), text: t, from, at: Date.now() };
  c.hard.push(h);
  return h;
}

export function addObligation(story, text, kind = 'todo') {
  const t = String(text || '').trim();
  if (!t) return null;
  const c = normalizeCorpus(story);
  const o = { id: uid('o'), text: t, kind: kind === 'must' ? 'must' : 'todo', state: 'open', at: Date.now() };
  c.obligations.push(o);
  return o;
}

export function settleObligation(story, id, state = 'done') {
  const c = normalizeCorpus(story);
  const o = c.obligations.find((x) => x.id === id);
  if (!o) return null;
  o.state = state === 'failed' ? 'failed' : 'done';
  o.settledAt = Date.now();
  return o;
}

/* ---------------- 上下文：只取该取的六类 ---------------- */

function tail(list, n) {
  return list.slice(Math.max(0, list.length - n));
}

export function buildContext(story, { recent = 6 } = {}) {
  const c = normalizeCorpus(story);
  const sc = curScene(story);
  const ob = openObligation(story);
  const ps = liveParagraphs(story);
  return {
    hard: c.hard.map((h) => h.text),
    need: ob ? ob.text : '',
    people: c.people.map((p) => ({ name: p.name, want: p.want, secret: p.secret, voice: p.voice, knows: p.knows || [] })),
    facts: liveFacts(story).slice(-24).map((f) => f.text),
    recent: tail(ps, recent).map((p) => p.text),
    scene: sc ? { ord: sc.ord, title: sc.title } : null,
  };
}

/* ---------------- 提示词 ---------------- */

const RULES = `你是这本小说的执笔者。只写正文，不要解说、不要标注、不要总结、不要替作者做决定。

【硬规则】
- 第一人称「我」，直接落进小说正文。
- 这一拍必须有东西变化：有人移动、有东西易手、有信息翻转、或关系的温度变了。一样都没有就重写。
- 只能写人物已经知道的事。他不知道的东西，不能从他嘴里说出来。
- 不违背「什么不可能」清单。
- 不写「我明白了」「我意识到」这类解说式的收束。

【怎么写】
- 长短跟着动作走：紧张处短，其余可以长。
- 不比喻，或者只打一个准的。
- 情绪不命名，只写动作、说话、沉默的长度。
- 每段至少一个具体的物件或数字。
- 停在「该我说下一句」或「该我决定下一步」的地方。`;

export function trunkSystem(story, styleBrief = '') {
  const ctx = buildContext(story);
  const out = [RULES];
  if (ctx.hard.length) out.push('【这个世界里不可能的事】\n' + ctx.hard.map((h) => '- ' + h).join('\n'));
  if (ctx.need) out.push('【这一场还差】' + ctx.need);
  if (ctx.people.length) {
    out.push(
      '【在场的人】\n' +
        ctx.people
          .map((p) => {
            const bits = [`${p.name}`];
            if (p.want) bits.push(`要：${p.want}`);
            if (p.secret) bits.push(`不肯说：${p.secret}`);
            if (p.voice) bits.push(`说话：${p.voice}`);
            if (p.knows.length) bits.push(`此刻知道：${p.knows.slice(-6).join('；')}`);
            return '- ' + bits.join('｜');
          })
          .join('\n')
    );
  }
  if (ctx.facts.length) out.push('【已经成立的事实】\n' + ctx.facts.map((f) => '- ' + f).join('\n'));
  if (styleBrief) out.push('【写法】\n' + styleBrief);
  if (ctx.scene) out.push(`【现在是第 ${ctx.scene.ord} 场】`);
  return out.join('\n\n');
}

export function trunkMessages(story, choice, styleBrief = '') {
  const ctx = buildContext(story);
  const msgs = [];
  if (ctx.recent.length) {
    msgs.push({ role: 'user', content: '【前面已经写出来的】\n' + ctx.recent.join('\n\n') });
    msgs.push({ role: 'assistant', content: '知道了，接着写。' });
  }
  msgs.push({
    role: 'user',
    content: choice
      ? `我这一下是：${choice}\n\n接着写下去，把我这一下写进正文里。`
      : '从这里开始写，把我此刻的处境写出来。',
  });
  return msgs;
}
