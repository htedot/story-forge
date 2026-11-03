import { chat, streamChat, listModels, pickModel, testConnection } from './api.js';
import * as S_ from './store.js';
import * as P from './prompt.js';
import * as E from './style-engine.js';

const $app = document.getElementById('app');

/* ---------------- 出错看得见 ---------------- */
window.__sfError = (where, err) => {
  const msg = `${where}：${(err && (err.stack || err.message)) || err}`;
  window.__sfLastError = msg;
  try {
    const box = document.getElementById('fatal');
    if (box) {
      box.textContent = msg;
      box.classList.add('on');
    }
  } catch (e) {}
};
window.addEventListener('error', (e) => window.__sfError('脚本出错', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => window.__sfError('异步出错', e.reason));

const S = {
  ready: false,
  settings: null,
  stories: [],
  styles: [],
  story: null,
  style: null,
  view: 'shelf',
  stack: [],
  cardId: '',
  sessionId: '',
  chapterId: '',
  patchId: '',
  input: '',
  busy: false,
  err: '',
  live: '',
  toast: '',
  sheet: '',
  models: [],
  testing: false,
  testMsg: '',
  forge: null,
  picks: {},
  suggest: null,
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chars = (s) => String(s || '').replace(/\s+/g, '').length;
const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n || 0));

const EFFORTS = [
  { id: 'off', name: '关', desc: '不发这个参数，最快' },
  { id: 'low', name: '低', desc: '想一点点' },
  { id: 'medium', name: '中', desc: '多想一想' },
  { id: 'high', name: '高', desc: '想很久，最慢' },
];

const THEMES = [
  { id: 'aurora', name: '粉蓝', desc: '默认。浅色底，粉紫到蓝的渐变。', sw: 'linear-gradient(135deg,#ff375f,#c34dff,#0a84ff)' },
  { id: 'ink', name: '墨蓝', desc: '深色。夜里看，眼睛不累。', sw: 'linear-gradient(135deg,#1b2740,#8ab4f8)' },
  { id: 'plain', name: '素白', desc: '极简。只有黑白灰，像一页纸。', sw: 'linear-gradient(135deg,#ffffff,#1d1d1f)' },
  { id: 'mint', name: '薄荷', desc: '浅绿。安静，适合长时间写。', sw: 'linear-gradient(135deg,#dff4ef,#12a594)' },
  { id: 'sakura', name: '樱', desc: '浅粉。暖一点，不刺眼。', sw: 'linear-gradient(135deg,#ffe3ec,#e0447c)' },
  { id: 'midnight', name: '夜读', desc: '深紫。最暗的一套。', sw: 'linear-gradient(135deg,#1e1b3a,#a78bfa)' },
];

function applyTheme(id) {
  const t = THEMES.some((x) => x.id === id) ? id : 'aurora';
  try {
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* 非浏览器环境（自检脚本）忽略 */
  }
}

function toast(msg) {
  S.toast = msg;
  render();
  setTimeout(() => {
    if (S.toast === msg) {
      S.toast = '';
      render();
    }
  }, 2400);
}

const push = (view) => {
  S.stack.push(S.view);
  S.view = view;
  render();
};
const back = () => {
  S.view = S.stack.pop() || 'shelf';
  render();
};
const go = (view) => {
  S.view = view;
  render();
};

/* ---------------- 启动 ---------------- */

async function boot() {
  S.settings = S_.loadSettings();
  applyTheme(S.settings.theme);
  S.models = (S.settings.models || []).slice();
  S.stories = await S_.listStories();
  S.styles = await S_.listStyles();
  S.ready = true;
  render();
}

async function openStory(id) {
  const st = await S_.getStory(id);
  if (!st) return;
  S.story = st;
  S.style = st.styleId ? (await S_.getStyle(st.styleId)) || null : null;
  S_.saveCurrentId(id);
  S.stack = ['shelf'];
  S.view = 'book';
  render();
}

async function save() {
  if (!S.story) return;
  await S_.putStory(S.story);
  S.stories = await S_.listStories();
}

const card = () => S_.cardById(S.story, S.cardId);
const session = () => S_.sessOf(S.story, S.sessionId);
const storyChars = () => (S.story.chapters || []).reduce((n, h) => n + chars(h.body), 0);

/* ---------------- 渲染 ---------------- */

function render() {
  if (!S.ready) {
    $app.innerHTML = '<div class="boot">打开中…</div>';
    return;
  }
  let html = '';
  const v = S.view;
  if (v === 'shelf') html = viewShelf();
  else if (v === 'book') html = viewBook();
  else if (v === 'card') html = viewCard();
  else if (v === 'act') html = viewAct();
  else if (v === 'collect') html = viewCollect();
  else if (v === 'timeline') html = viewTimeline();
  else if (v === 'chapter') html = viewChapter();
  else if (v === 'suggest') html = viewSuggest();
  else if (v === 'styles') html = viewStyles();
  else if (v === 'forge') html = viewForge();
  else if (v === 'settings') html = viewSettings();

  $app.innerHTML =
    html +
    (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '') +
    '<div id="fatal"></div>';
  const fatal = document.getElementById('fatal');
  if (fatal && window.__sfLastError) {
    fatal.textContent = window.__sfLastError;
    fatal.classList.add('on');
  }
}

function topbar(title, right = '', left = 'back') {
  return `<header class="topbar">
    <button class="ico" data-act="${left}">${left === 'back' ? '‹' : '⌂'}</button>
    <h1>${esc(title)}</h1>
    <div class="right">${right}</div>
  </header>`;
}

/* ---------------- 书架 ---------------- */

function viewShelf() {
  const list = S.stories;
  return `
  <div class="wrap">
    <header class="brand">
      <div class="logo">写</div>
      <div><b>我的故事</b><span>${list.length} 本 · ${S.styles.length} 份文风</span></div>
    </header>
    <div class="row-btns">
      <button class="btn primary" data-act="newbook">开一本新书</button>
      <button class="btn" data-act="go" data-to="styles">文风 ${S.styles.length}</button>
      <button class="btn" data-act="go" data-to="settings">设置</button>
    </div>
    ${list.length
      ? `<div class="seclabel">书架</div><div class="grid">${list.map(bookTile).join('')}</div>`
      : '<div class="empty"><div class="big">还没有书</div><p>开一本新的，先放几张设定卡。</p></div>'}
  </div>`;
}

function bookTile(s) {
  const w = (s.chapters || []).reduce((n, h) => n + chars(h.body), 0);
  return `<div class="tile" data-act="openbook" data-id="${s.id}">
    <b>${esc(s.title)}</b>
    <span>${(s.cards || []).length} 张卡 · ${fmt(w)} 字</span>
  </div>`;
}

/* ---------------- 书内：卡片墙 ---------------- */

function viewBook() {
  const st = S.story;
  return `
  ${topbar(st.title, `<button class="ico" data-act="book-menu">⋯</button>`, 'shelf')}
  <div class="wrap">
    <div class="row-btns">
      <button class="btn ghost" data-act="go" data-to="timeline">时间轴 · ${S_.eventsOf(st).length}</button>
      <button class="btn ghost" data-act="go" data-to="chapters">章节 · ${(st.chapters || []).length}</button>
      <button class="btn ghost" data-act="suggest-open">让 AI 提设定</button>
    </div>
    ${S_.KIND_ORDER.map((k) => groupOf(k)).join('')}
    <div class="dim center pad">共 ${fmt(storyChars())} 字</div>
  </div>`;
}

function groupOf(kind) {
  const def = S_.CARD_KINDS[kind];
  const list = S_.cardsOf(S.story, kind);
  const rows = list.map((c) => cardRow(c)).join('');
  const add = def.single ? '' : `<button class="lnk" data-act="addcard" data-kind="${kind}">＋ 加一张</button>`;
  return `<div class="cwgroup">
    <div class="cwhead"><b>${def.name}</b>${add}</div>
    <div class="dim">${def.hint}</div>
    <div class="cwlist">${rows || '<div class="dim">还没写。</div>'}</div>
  </div>`;
}

function cardRow(c) {
  const preview = S_.cardText(c).replace(/\n/g, ' ').slice(0, 46);
  const n = (c.kind === 'outline' && Array.isArray(c.events)) ? ` · ${c.events.length} 个事件` : '';
  return `<div class="ccard" data-act="opencard" data-id="${c.id}">
    <b>${esc(c.title)}</b>
    <span>${esc(preview || '（空）')}${n}</span>
  </div>`;
}

/* ---------------- 卡详情 ---------------- */

function viewCard() {
  const c = card();
  if (!c) {
    go('book');
    return '';
  }
  const def = S_.CARD_KINDS[c.kind];
  const patches = (S.story.patches || []).filter((p) => p.cardId === c.id && p.applied && !p.undone);
  return `${topbar(c.title, c.kind === 'world' || c.kind === 'outline' ? '' : `<button class="ico" data-act="card-del">删</button>`)}
  <div class="wrap">
    <div class="panel">
      <div class="seclabel">标题</div>
      <input class="field" id="card-title" value="${esc(c.title)}">
      <div class="dim">${def.name} · 演完一场记得点「收束」，把结果写回这张卡。</div>
    </div>
    ${c.sections.map((s, i) => `
    <div class="panel">
      <div class="seclabel">${esc(s.label)}</div>
      <textarea class="field" rows="4" data-card="${c.id}" data-sec="${i}">${esc(s.text)}</textarea>
    </div>`).join('')}
    ${c.kind === 'outline' ? eventEditor(c) : ''}
    <div class="row-btns">
      <button class="btn primary" data-act="startact" ${S.busy ? 'disabled' : ''}>演绎这张卡</button>
      ${patches.length ? `<button class="btn ghost" data-act="card-hist">收束记录 ${patches.length}</button>` : ''}
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
  </div>`;
}

function eventEditor(c) {
  const rows = (c.events || [])
    .map((e, i) => `<div class="evitem">
      <input class="f-when" value="${esc(e.when)}" data-ev="${e.id}" data-k="when" placeholder="时间">
      <input class="f-title" value="${esc(e.title)}" data-ev="${e.id}" data-k="title" placeholder="发生了什么">
      <input class="f-cost" value="${esc(e.summary)}" data-ev="${e.id}" data-k="summary" placeholder="谁付出代价">
      <button class="ico" data-act="ev-del" data-id="${e.id}">×</button>
    </div>`)
    .join('');
  return `<div class="panel">
    <div class="seclabel">事件链</div>
    <div class="dim">事件是大纲的一环，会按顺序投影到时间轴上。</div>
    ${rows || '<div class="dim">还没有事件。演绎大纲或直接加。</div>'}
    <button class="lnk" data-act="ev-add">＋ 加一个事件</button>
  </div>`;
}

/* ---------------- 演绎 ---------------- */

function viewAct() {
  const c = card();
  const ss = session();
  if (!c || !ss) {
    go('book');
    return '';
  }
  const def = S_.CARD_KINDS[c.kind];
  const head = {
    world: '演世界。不出现主角。',
    setting: '演这条设定被推到底会怎样。',
    character: '演这个人。以他的「我」来说话。',
    outline: '演剧情走向，一次一个岔路口。',
    narrative: '演这套讲法写出来是什么效果。',
  }[c.kind];

  const msgs = (ss.msgs || [])
    .map((m) => (m.role === 'me'
      ? `<div class="msg me">${esc(m.text)}</div>`
      : `<div class="msg gm">${esc(m.text)}</div>`))
    .join('');

  return `${topbar(c.title, `<button class="ico" data-act="collect" ${S.busy || !(ss.msgs || []).length ? 'disabled' : ''}>收束</button>`)}
  <div class="wrap">
    <div class="dim">${esc(head)}</div>
    <div class="msgs">
      ${msgs}
      ${S.busy ? `<div class="msg gm live" id="live">${esc(S.live)}</div>` : ''}
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    ${!S.busy && (ss.options || []).length
      ? `<div class="opts">${ss.options.map((o) => `<button class="opt" data-act="act-say" data-t="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : ''}
    <div class="composer">
      <textarea class="field" id="say" rows="2" placeholder="${(ss.msgs || []).length ? '你要做什么、说什么' : '点这里让它起头，或者直接写第一句'}">${esc(S.input)}</textarea>
      <div class="row-btns">
        <button class="btn ghost" data-act="act-say" data-t="" ${S.busy ? 'disabled' : ''}>${(ss.msgs || []).length ? '照我说的' : '让它起头'}</button>
      </div>
    </div>
  </div>`;
}

async function actSend(text) {
  const c = card();
  const ss = session();
  if (!c || !ss || S.busy) return;
  const t = String(text || '').trim();
  if (t) ss.msgs.push({ role: 'me', text: t });
  S.input = '';
  S.err = '';
  S.busy = true;
  S.live = '';
  render();
  try {
    const out = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: P.turnMessages(S.story, c, ss, S.style ? E.brief(S.style) : ''),
      maxTokens: 1800,
      temperature: 0.9,
      onDelta: (d, full) => {
        S.live = full;
        const el = document.getElementById('live');
        if (el) el.textContent = full;
      },
    });
    const { body, options } = P.splitOut(out);
    if (!body) throw new Error('模型这次没写正文。再点一次。');
    ss.msgs.push({ role: 'gm', text: body });
    ss.options = options;
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    S.live = '';
    render();
  }
}

/* ---------------- 收束 ---------------- */

async function startCollect() {
  const c = card();
  const ss = session();
  if (!c || !ss || S.busy) return;
  S.busy = true;
  S.err = '';
  render();
  try {
    const raw = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: P.collectMessages(S.story, c, ss),
      maxTokens: 2400,
    });
    const got = P.parseCollect(raw, c);
    if (!got.sections.length) throw new Error('没读懂整理结果，再点一次。');
    const changes = got.sections
      .map((s, i) => {
        const cur = c.sections.find((x) => x.label === s.label);
        return { label: s.label, before: cur ? cur.text : '', after: s.text };
      })
      .filter((x) => x.after !== x.before);
    const patch = {
      id: 'p' + Date.now().toString(36),
      cardId: c.id,
      sessionId: ss.id,
      at: Date.now(),
      changes,
      events: got.events || [],
      applied: false,
      undone: false,
    };
    S.story.patches.push(patch);
    const draftSession = S.story.sessions.find((x) => x.id === ss.id);
    if (draftSession) draftSession.closed = true;
    S.patchId = patch.id;
    await save();
    go('collect');
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

function viewCollect() {
  const patch = (S.story.patches || []).find((p) => p.id === S.patchId);
  const c = card();
  if (!patch || !c) {
    go('card');
    return '';
  }
  return `${topbar('收束进《' + c.title + '》')}
  <div class="wrap">
    <div class="dim">确认之后才会写进这张卡，写错了可以撤销。</div>
    ${patch.changes.length
      ? patch.changes.map((ch) => `<div class="panel">
          <div class="seclabel">${esc(ch.label)}</div>
          ${ch.before ? `<div class="diff old"><span>原来</span><p>${esc(ch.before)}</p></div>` : ''}
          <div class="diff new"><span>${ch.before ? '改为' : '新增'}</span><p>${esc(ch.after)}</p></div>
        </div>`).join('')
      : '<div class="panel"><div class="dim">这一场没有改动这张卡的正文。</div></div>'}
    ${patch.events.length
      ? `<div class="panel"><div class="seclabel">新事件 ${patch.events.length} 个</div>
        ${patch.events.map((e) => `<div class="evread">${esc([e.when, e.title, e.cost].filter(Boolean).join('｜'))}</div>`).join('')}
      </div>`
      : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="collect-drop">不要了</button>
      <button class="btn primary" data-act="collect-ok">确认写进卡里</button>
    </div>
  </div>`;
}

async function applyCollect() {
  const patch = (S.story.patches || []).find((p) => p.id === S.patchId);
  const c = card();
  if (!patch || !c) return;
  for (const ch of patch.changes) {
    const sec = c.sections.find((s) => s.label === ch.label);
    if (sec) sec.text = ch.after;
  }
  if (c.kind === 'outline' && patch.events && patch.events.length) {
    c.events = c.events || [];
    for (const e of patch.events) {
      c.events.push(S_.newEvent(e.title, e.when, e.cost || e.summary || ''));
    }
  }
  patch.applied = true;
  await save();
  S.patchId = '';
  toast('已写进卡里');
  go('card');
}

async function undoPatch(id) {
  const patch = (S.story.patches || []).find((p) => p.id === id);
  const c = card();
  if (!patch || !c || patch.undone) return;
  for (const ch of patch.changes) {
    const sec = c.sections.find((s) => s.label === ch.label);
    if (sec) sec.text = ch.before;
  }
  patch.undone = true;
  await save();
  toast('已撤销这次收束');
  render();
}

/* ---------------- 时间轴 ---------------- */

function viewTimeline() {
  const evs = S_.eventsOf(S.story);
  const picked = Object.keys(S.picks || {}).filter((k) => S.picks[k]);
  return `${topbar('时间轴')}
  <div class="wrap">
    <div class="dim">勾选连续的一段事件，然后写这一章。</div>
    ${evs.length
      ? `<div class="evlist">${evs.map((e, i) => `<label class="evrow ${S.picks[e.id] ? 'on' : ''}">
          <input type="checkbox" data-pick="${e.id}" ${S.picks[e.id] ? 'checked' : ''}>
          <em>${i + 1}</em>
          <div><b>${esc(e.when || '—')}</b><span>${esc(e.title)}${e.summary ? '｜' + esc(e.summary) : ''}</span></div>
        </label>`).join('')}</div>`
      : '<div class="empty"><div class="big">时间轴还是空的</div><p>去大纲里加事件，或者演一场大纲再收束。</p></div>'}
    <div class="row-btns">
      <button class="btn primary" data-act="chapter-from" ${picked.length ? '' : 'disabled'}>从选中的 ${picked.length} 个事件写一章</button>
    </div>
  </div>`;
}

/* ---------------- 章节 ---------------- */

function viewChapter() {
  const st = S.story;
  const id = S.chapterId;
  if (id === 'list') return viewChapterList();
  const ch = (st.chapters || []).find((x) => x.id === id);
  if (!ch) return viewChapterList();
  const narrs = S_.cardsOf(st, 'narrative');
  const evs = S_.eventsOf(st).filter((e) => (ch.eventIds || []).includes(e.id));
  return `${topbar(ch.title || '这一章')}
  <div class="wrap">
    <div class="panel">
      <div class="seclabel">题目</div>
      <input class="field" id="ch-title" value="${esc(ch.title)}">
      <div class="seclabel" style="margin-top:14px">叙事形式</div>
      ${narrs.length
        ? `<select class="field" id="ch-narr">${narrs.map((n) => `<option value="${n.id}" ${n.id === ch.narrativeId ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}<option value="" ${!ch.narrativeId ? 'selected' : ''}>（不指定）</option></select>`
        : '<div class="dim">还没有叙事形式卡。去书里加一张，写上视角、时态、声音、体例。</div>'}
      <div class="dim" style="margin-top:10px">骨架：${evs.length ? evs.map((e) => esc(e.title)).join(' → ') : '（没选事件）'}</div>
    </div>
    <div class="err">${S.err ? esc(S.err) : ''}</div>
    ${ch.body
      ? `<div class="panel"><div class="prose">${esc(ch.body)}</div></div><div class="dim center">${fmt(chars(ch.body))} 字</div>`
      : '<div class="panel"><div class="dim">还没写。</div></div>'}
    <div class="row-btns">
      <button class="btn primary" data-act="chapter-gen" ${S.busy ? 'disabled' : ''}>${ch.body ? '重写这一章' : '写这一章'}</button>
      ${ch.body ? '<button class="btn ghost" data-act="chapter-export">导出一份</button>' : ''}
    </div>
  </div>`;
}

function viewChapterList() {
  const list = S.story.chapters || [];
  return `${topbar('章节')}
  <div class="wrap">
    ${list.length
      ? `<div class="list">${list.map((h) => `<div class="row" data-act="open-chapter" data-id="${h.id}">
          <div class="t">${esc(h.title || '未命名')}</div>
          <div class="s">${fmt(chars(h.body))} 字 · ${(h.eventIds || []).length} 个事件</div>
        </div>`).join('')}</div>`
      : '<div class="empty"><div class="big">还没有章节</div><p>去时间轴勾一段事件，写第一章。</p></div>'}
  </div>`;
}

async function genChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch || S.busy) return;
  ch.title = (document.getElementById('ch-title') || {}).value || ch.title;
  const sel = document.getElementById('ch-narr');
  if (sel) ch.narrativeId = sel.value;
  if (!ch.title) ch.title = '第 ' + ((S.story.chapters || []).length + 1) + ' 章';
  const evs = S_.eventsOf(S.story).filter((e) => (ch.eventIds || []).includes(e.id));
  const narr = ch.narrativeId ? S_.cardById(S.story, ch.narrativeId) : null;
  S.busy = true;
  S.err = '';
  ch.history = ch.history || [];
  ch.history.push(ch.body || '');
  render();
  try {
    const out = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: P.chapterMessages(S.story, evs, narr, S.style ? E.brief(S.style) : ''),
      maxTokens: 4000,
    });
    const body = String(out || '').trim();
    if (!body) throw new Error('模型这次没写出来。再点一次。');
    ch.body = body;
    ch.status = 'draft';
    ch.at = Date.now();
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

/* ---------------- 生成设定 ---------------- */

function viewSuggest() {
  const list = S.suggest || [];
  return `${topbar('AI 提的设定')}
  <div class="wrap">
    ${S.busy ? '<div class="dim center pad">正在读你现有的设定…</div>' : ''}
    ${list.length
      ? list.map((s, i) => `<div class="panel">
          <div class="seclabel">${s.kind === 'character' ? '角色' : '设定'}</div>
          <input class="field" data-sg="${i}" data-k="title" value="${esc(s.title)}">
          <textarea class="field" rows="4" data-sg="${i}" data-k="text">${esc(s.text)}</textarea>
          <button class="lnk" data-act="sg-drop" data-i="${i}">不要这条</button>
        </div>`).join('')
      : (!S.busy ? '<div class="empty"><div class="big">还没有新设定</div><p>点下面的按钮，让它读一遍现有设定再提。</p></div>' : '')}
    <div class="row-btns">
      <button class="btn ghost" data-act="suggest-run" ${S.busy ? 'disabled' : ''}>${list.length ? '再提一批' : '开始提'}</button>
      ${list.length ? '<button class="btn primary" data-act="sg-take">收进书里</button>' : ''}
    </div>
  </div>`;
}

async function runSuggest() {
  S.busy = true;
  S.err = '';
  render();
  try {
    const out = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: P.suggestMessages(S.story),
      maxTokens: 1600,
    });
    const got = P.parseSuggest(out);
    if (!got.length) throw new Error('这次没提出可用的设定。再点一次。');
    S.suggest = got;
  } catch (err) {
    S.err = err.message || String(err);
    toast(err.message || String(err));
  } finally {
    S.busy = false;
    render();
  }
}

/* ---------------- 文风（实验法） ---------------- */

function viewStyles() {
  return `${topbar('文风')}
  <div class="wrap">
    <button class="btn primary wide" data-act="forge-start">提取一份新文风</button>
    ${S.styles.length
      ? `<div class="list">${S.styles.map((w) => `<div class="row" data-act="style-open" data-id="${w.id}">
          <div class="t">${esc(w.name)}</div>
          <div class="s">${esc(String(w.rules || '').split('\n').filter(Boolean).length)} 条规则</div>
        </div>`).join('')}</div>`
      : '<div class="empty"><div class="big">还没有文风</div><p>写一小段随笔，它读出你的写法，照着重写四段，你排个序就定下来。</p></div>'}
  </div>`;
}

function viewForge() {
  const f = S.forge;
  if (!f) {
    go('styles');
    return '';
  }
  const STEPS = ['写一段', '看规则', '让它写', '排个序', '存下来'];
  const idx = { essay: 1, rules: 2, imitate: 3, rank: 4, done: 5 }[f.stage] || 1;
  let body = '';

  if (f.stage === 'essay') {
    body = `<div class="panel">
      <div class="seclabel">先写一小段</div>
      <div class="dim">不用完整，不用讲究。写你平时会写的那样，三五句就够。</div>
      <div class="matbox"><span>就写这个</span>${esc(E.ESSAY_MATERIAL)}</div>
      <textarea class="field" id="essay" rows="8" placeholder="从这一句往下写，写到你自然停下来为止。">${esc(f.essay || '')}</textarea>
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-skip">跳过去</button>
      <button class="btn primary" data-act="forge-analyze" ${f.busy ? 'disabled' : ''}>让它看</button>
    </div>`;
  } else if (f.stage === 'rules') {
    body = `${f.read && f.read.length ? `<div class="panel readbox"><div class="seclabel">它读到的</div>${f.read.map((r) => `<p>${esc(r)}</p>`).join('')}</div>` : ''}
    <div class="panel">
      <div class="seclabel">写作规则${f.round > 1 ? ` · 第 ${f.round} 版` : ''}</div>
      <div class="dim">这几条可以直接改。以后写小说，叙述就按这几条来。</div>
      <textarea class="field" id="forge-rules" rows="11">${esc(f.rules || '')}</textarea>
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-back-essay">回去重写</button>
      <button class="btn primary" data-act="forge-imitate" ${f.busy ? 'disabled' : ''}>让它照这个写四段</button>
    </div>`;
  } else if (f.stage === 'imitate') {
    body = `<div class="panel">
      <div class="seclabel">它照规则写的四段</div>
      <div class="dim">同一个材料，四种写法。等下你要把它们从最差排到最好。</div>
      ${f.busy ? `<div class="dim pad">${esc(f.progress || '正在写…')}</div>` : ''}
      ${f.busy ? `<div class="live" id="live">${esc(f.live || '')}</div>` : ''}
      ${!f.busy && (f.passages || []).length ? f.passages.map((p, i) => `<div class="passage"><b>${i + 1}</b><p>${esc(p)}</p></div>`).join('') : ''}
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-back-rules">规则不对，回去改</button>
      <button class="btn primary" data-act="forge-to-rank" ${f.busy || (f.passages || []).length < 3 ? 'disabled' : ''}>排一下序</button>
    </div>`;
  } else if (f.stage === 'rank') {
    body = `<div class="panel">
      <div class="seclabel">从最差排到最好</div>
      <div class="dim">依次点四段。第一下＝最差，第四下＝最好。点错了再点一下取消。</div>
      ${(f.passages || []).map((p, i) => {
        const pos = (f.order || []).indexOf(i);
        return `<div class="pickcard ${pos >= 0 ? 'picked' : ''}" data-act="rank-pick" data-id="${i}">
          <b>${i + 1}</b>${pos >= 0 ? `<em>${pos + 1}</em>` : ''}<p>${esc(p)}</p></div>`;
      }).join('')}
      <div class="ordersum">${(f.order || []).length ? `你排的：${f.order.map((i) => i + 1).join(' → ')}　（${f.order.length}/4）` : '还没开始排。从你觉得最差的那段点起。'}</div>
    </div>
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-to-imitate">再写四段</button>
      <button class="btn primary" data-act="forge-revise" ${f.busy || (f.order || []).length < 4 ? 'disabled' : ''}>按这个改规则</button>
    </div>`;
  } else {
    body = `<div class="panel">
      <div class="seclabel">存下来</div>
      <div class="dim">这份文风以后写小说时用来管叙述那一层。</div>
      <input class="field" id="forge-name" value="${esc(f.name)}">
      <textarea class="field" id="forge-final" rows="12">${esc(f.rules || '')}</textarea>
    </div>
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-to-rank">回去再排一次</button>
      <button class="btn primary" data-act="forge-done">存成一份文风</button>
    </div>`;
  }

  return `${topbar('提取我的文风', '', 'back')}
  <div class="wrap">
    <div class="fsteps">${STEPS.map((s, i) => `<span class="${i + 1 === idx ? 'on' : ''}">${s}</span>`).join('')}</div>
    ${body}
  </div>`;
}

function startForge() {
  S.forge = {
    name: '我的文风',
    stage: 'essay',
    essay: '',
    read: [],
    rules: '',
    passages: [],
    order: [],
    round: 1,
    busy: false,
    live: '',
    progress: '',
  };
  S.err = '';
  push('forge');
}

async function forgeAnalyze() {
  const f = S.forge;
  if (!f || f.busy) return;
  const el = document.getElementById('essay');
  f.essay = el ? el.value : f.essay;
  if (String(f.essay).trim().length < 30) {
    S.err = '再写几句，至少三十个字。写你平时会写的那样就行，不用完整。';
    render();
    return;
  }
  f.busy = true;
  S.err = '';
  render();
  try {
    const got = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: E.analyzeMessages(f.essay),
      maxTokens: 1400,
    });
    const got2 = E.parseAnalyze(got);
    f.read = got2.read;
    f.rules = got2.text || E.rulesToText(got2.rules);
    if (!f.rules) throw new Error('没读出规则，再点一次。');
    f.stage = 'rules';
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    f.busy = false;
    render();
  }
}

async function forgeImitate() {
  const f = S.forge;
  if (!f || f.busy) return;
  const el = document.getElementById('forge-rules');
  f.rules = el ? el.value : f.rules;
  if (!String(f.rules).trim()) {
    S.err = '规则是空的。';
    render();
    return;
  }
  f.busy = true;
  f.passages = [];
  f.order = [];
  f.live = '';
  S.err = '';
  f.stage = 'imitate';
  render();
  try {
    for (let i = 0; i < 4; i += 1) {
      f.progress = `正在写第 ${i + 1} / 4 段…`;
      f.live = '';
      render();
      let got = '';
      try {
        got = await streamChat({
          baseUrl: S.settings.baseUrl,
          apiKey: S.settings.apiKey,
          model: S.settings.model,
          effort: S.settings.effort,
          messages: E.imitateOneMessages(f.rules, E.ESSAY_MATERIAL, i),
          maxTokens: 1200,
          temperature: 0.95,
          onDelta: (d, full) => {
            f.live = full;
            const box = document.getElementById('live');
            if (box) box.textContent = full;
          },
        });
      } catch (e1) {
        got = '';
      }
      const clean = String(got || '')
        .replace(/^\s*好的[，,。]?\s*/, '')
        .replace(/^\s*-{3,}\s*$/gm, '')
        .trim();
      if (clean.length >= 10) f.passages.push(clean);
      f.live = '';
    }
    if (f.passages.length < 3) throw new Error('有几段没写出来。再点一次，或者把规则改短一点。');
  } catch (err) {
    S.err = err.message || String(err);
    f.stage = 'rules';
  } finally {
    f.busy = false;
    f.progress = '';
    render();
  }
}

async function forgeRevise() {
  const f = S.forge;
  if (!f || f.busy || (f.order || []).length < 4) return;
  f.busy = true;
  S.err = '';
  render();
  try {
    const out = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: E.reviseMessages(f.rules, f.passages, f.order, ''),
      maxTokens: 1600,
    });
    const next = E.cleanRules(out);
    if (!next) throw new Error('这次没写出新规则，再点一次。');
    f.rules = next;
    f.round += 1;
    f.stage = 'done';
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    f.busy = false;
    render();
  }
}

async function forgeDone() {
  const f = S.forge;
  if (!f) return;
  const nameEl = document.getElementById('forge-name');
  const finalEl = document.getElementById('forge-final');
  const style = S_.newStyle({
    name: (nameEl && nameEl.value.trim()) || '我的文风',
    rules: (finalEl && finalEl.value) || f.rules || '',
    at: Date.now(),
  });
  await S_.putStyle(style);
  S.styles = await S_.listStyles();
  S.forge = null;
  toast('存好了');
  go('styles');
}

/* ---------------- 设置 ---------------- */

function viewSettings() {
  const st = S.settings;
  return `${topbar('设置')}
  <div class="wrap">
    <div class="panel">
      <div class="seclabel">皮肤</div>
      <div class="dim">换一套配色，立刻生效。</div>
      ${THEMES.map((t) => `<div class="skinrow" data-act="theme" data-id="${t.id}">
        <i style="background:${t.sw}"></i>
        <div><b>${t.name}</b><span>${t.desc}</span></div>
        ${st.theme === t.id ? '<em>✓</em>' : ''}
      </div>`).join('')}
    </div>
    <div class="panel">
      <div class="seclabel">接口</div>
      <input class="field" id="set-url" value="${esc(st.baseUrl)}" placeholder="https://api.deepseek.com/v1">
      <input class="field" id="set-key" type="password" value="${esc(st.apiKey)}" placeholder="密钥">
      <div class="row-btns">
        <button class="btn ghost" data-act="test" ${S.testing ? 'disabled' : ''}>测一下</button>
        <button class="btn ghost" data-act="loadmodels">读取模型</button>
      </div>
      ${S.testMsg ? `<div class="dim">${esc(S.testMsg)}</div>` : ''}
    </div>
    <div class="panel">
      <div class="seclabel">可用模型</div>
      ${(S.models || []).length
        ? S.models.map((m) => `<label class="chk"><input type="checkbox" data-model="${esc(m)}" ${(st.models || []).includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('')
        : '<div class="dim">先点上面的「读取模型」。</div>'}
      <div class="seclabel" style="margin-top:14px">默认模型</div>
      <input class="field" id="set-model" value="${esc(st.model)}" placeholder="deepseek-chat">
      <div class="seclabel" style="margin-top:14px">推理等级</div>
      <select class="field" id="set-effort">${EFFORTS.map((e) => `<option value="${e.id}" ${st.effort === e.id ? 'selected' : ''}>${e.name} — ${e.desc}</option>`).join('')}</select>
      <div class="dim">开得越高，模型想得越久，也越慢越贵。写小说一般不用开。</div>
    </div>
    <button class="btn primary wide" data-act="save-settings">保存</button>
  </div>`;
}

/* ---------------- 事件 ---------------- */

const val = (id, fallback) => {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
};

// 任何东西都变成一句人话：Error、接口返回的对象、字符串
function readable(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (x instanceof Error) return x.message || '出错了';
  if (typeof x === 'object') {
    if (Array.isArray(x.models)) return `连接正常，读到 ${x.models.length} 个模型。`;
    if (x.message) return String(x.message);
    if (x.error) return String((x.error && x.error.message) || x.error);
    try {
      return JSON.stringify(x);
    } catch (e) {
      return '出错了';
    }
  }
  return String(x);
}

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  try {
    switch (act) {
      case 'back':
        return back();
      case 'shelf':
        S.view = 'shelf';
        return render();
      case 'go':
        return go(el.dataset.to);
      case 'newbook': {
        const st = S_.newStory('新的一本');
        await S_.putStory(st);
        S.stories = await S_.listStories();
        await openStory(st.id);
        return;
      }
      case 'openbook':
        return openStory(id);
      case 'book-menu':
        return openBookMenu();
      case 'addcard': {
        const k = el.dataset.kind;
        const def = S_.CARD_KINDS[k];
        const c = S_.addCard(S.story, k, def.name);
        await save();
        S.cardId = c.id;
        return push('card');
      }
      case 'opencard':
        S.cardId = id;
        S.err = '';
        return push('card');
      case 'card-del': {
        if (!confirm('删掉这张卡？')) return;
        S_.removeCard(S.story, S.cardId);
        await save();
        return go('book');
      }
      case 'startact': {
        S.err = '';
        const c = card();
        const ss = S_.newSession(c.id, c.kind);
        S.story.sessions.unshift(ss);
        S.sessionId = ss.id;
        S.input = '';
        await save();
        return push('act');
      }
      case 'act-say': {
        const typed = el.dataset.t;
        return actSend(typed != null ? typed : val('say', S.input));
      }
      case 'collect':
        return startCollect();
      case 'collect-ok':
        return applyCollect();
      case 'collect-drop': {
        const patch = (S.story.patches || []).find((p) => p.id === S.patchId);
        if (patch) S.story.patches = S.story.patches.filter((p) => p.id !== patch.id);
        await save();
        S.patchId = '';
        return go('card');
      }
      case 'card-hist':
        return cardHistory();
      case 'ev-add': {
        const c = card();
        c.events = c.events || [];
        c.events.push(S_.newEvent('', '', ''));
        await save();
        return render();
      }
      case 'ev-del': {
        const c = card();
        c.events = (c.events || []).filter((x) => x.id !== id);
        await save();
        return render();
      }
      case 'suggest-open': {
        S.suggest = null;
        return push('suggest');
      }
      case 'suggest-run':
        return runSuggest();
      case 'sg-drop': {
        S.suggest = (S.suggest || []).filter((x, i) => i !== Number(el.dataset.i));
        return render();
      }
      case 'sg-take': {
        for (const s of S.suggest || []) {
          const c = S_.addCard(S.story, s.kind, s.title || '未命名');
          c.sections[0].text = s.text;
        }
        S.suggest = null;
        await save();
        toast('收进来了');
        return go('book');
      }
      case 'pick':
        return render();
      case 'chapter-from': {
        const picked = Object.keys(S.picks || {}).filter((k) => S.picks[k]);
        if (!picked.length) return toast('先勾几个事件');
        const ch = S_.newChapter();
        ch.eventIds = picked;
        S.story.chapters = S.story.chapters || [];
        S.story.chapters.push(ch);
        await save();
        S.chapterId = ch.id;
        return go('chapter');
      }
      case 'open-chapter':
        S.chapterId = id;
        return go('chapter');
      case 'chapter-gen':
        return genChapter();
      case 'chapter-export': {
        const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
        const blob = new Blob([`${ch.title}\n\n${ch.body}`], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${ch.title || '章节'}.txt`;
        a.click();
        return;
      }
      case 'style-open': {
        const w = (S.styles || []).find((x) => x.id === id);
        if (!w) return;
        S.forge = { name: w.name, stage: 'done', rules: w.rules, read: [], passages: [], order: [], round: 1, busy: false, live: '' };
        return push('forge');
      }
      case 'forge-start':
        return startForge();
      case 'forge-analyze':
        return forgeAnalyze();
      case 'forge-skip': {
        S.forge.stage = 'rules';
        S.forge.rules = S.forge.rules || '';
        return render();
      }
      case 'forge-back-essay':
        S.forge.stage = 'essay';
        return render();
      case 'forge-imitate':
        return forgeImitate();
      case 'forge-back-rules':
        S.forge.stage = 'rules';
        return render();
      case 'forge-to-rank':
        S.forge.stage = 'rank';
        return render();
      case 'forge-to-imitate':
        S.forge.stage = 'imitate';
        return render();
      case 'rank-pick': {
        const i = Number(id);
        const o = S.forge.order || (S.forge.order = []);
        const pos = o.indexOf(i);
        if (pos >= 0) o.splice(pos, 1);
        else if (o.length < 4) o.push(i);
        return render();
      }
      case 'forge-revise':
        return forgeRevise();
      case 'forge-done':
        return forgeDone();
      case 'theme':
        S.settings = S_.saveSettings({ theme: id });
        applyTheme(id);
        return render();
      case 'loadmodels': {
        const key = String(val('set-key', '') || '').trim() || S.settings.apiKey;
        S.settings = S_.saveSettings({ baseUrl: String(val('set-url', '') || S.settings.baseUrl).trim(), apiKey: key });
        try {
          const list = await listModels({ baseUrl: S.settings.baseUrl, apiKey: S.settings.apiKey });
          if (!list.length) {
            S.testMsg = '连接是通的，但这个地址没报出任何模型。可以直接用，模型名照手填。';
          } else {
            S.models = list;
            S.settings = S_.saveSettings({ models: list, model: pickModel(list, S.settings.baseUrl) });
            S.testMsg = `读到 ${list.length} 个模型。`;
          }
        } catch (err) {
          S.testMsg = readable(err);
        }
        return render();
      }
      case 'test': {
        const key = String(val('set-key', '') || '').trim() || S.settings.apiKey;
        S.settings = S_.saveSettings({
          baseUrl: String(val('set-url', '') || S.settings.baseUrl).trim(),
          apiKey: key,
          model: String(val('set-model', '') || S.settings.model).trim(),
        });
        S.testing = true;
        render();
        try {
          const r = await testConnection(S.settings);
          S.testMsg = readable(r);
        } catch (err) {
          S.testMsg = readable(err);
        }
        S.testing = false;
        return render();
      }
      case 'save-settings': {
        const models = Array.from(document.querySelectorAll('[data-model]'))
          .filter((x) => x.checked)
          .map((x) => x.dataset.model);
        S.settings = S_.saveSettings({
          baseUrl: val('set-url', S.settings.baseUrl),
          apiKey: val('set-key', S.settings.apiKey),
          model: val('set-model', S.settings.model),
          effort: val('set-effort', S.settings.effort),
          models,
        });
        toast('保存了');
        return back();
      }
      default:
        return;
    }
  } catch (err) {
    window.__sfError(`点击 ${act} 时出错`, err);
    S.err = err.message || String(err);
    render();
  }
});

$app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'say') S.input = t.value;
  const ev = t.closest('[data-ev]');
  if (ev && S.story) {
    const c = card();
    const item = ((c && c.events) || []).find((x) => x.id === ev.dataset.ev);
    if (item) item[ev.dataset.k] = t.value;
  }
  const sg = t.closest('[data-sg]');
  if (sg && S.suggest) {
    const i = Number(sg.dataset.sg);
    if (S.suggest[i]) S.suggest[i][sg.dataset.k] = t.value;
  }
});

$app.addEventListener('change', async (e) => {
  const t = e.target;
  const pk = t.closest('[data-pick]');
  if (pk) {
    S.picks[pk.dataset.pick] = t.checked;
    return render();
  }
  const sec = t.closest('[data-sec]');
  if (sec) {
    const c = S_.cardById(S.story, sec.dataset.card);
    const i = Number(sec.dataset.sec);
    if (c && c.sections[i]) {
      c.sections[i].text = t.value;
      await save();
    }
    return;
  }
  if (t.id === 'card-title') {
    const c = card();
    if (c) {
      c.title = t.value || c.title;
      await save();
    }
    return;
  }
  if (t.id === 'ch-title') {
    const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
    if (ch) {
      ch.title = t.value;
      await save();
    }
    return;
  }
  if (t.closest('[data-ev]')) {
    await save();
  }
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'say') {
    e.preventDefault();
    actSend(e.target.value);
  }
});

/* ---------------- 小交互 ---------------- */

function openBookMenu() {
  const st = S.story;
  S.sheet = `
  <div class="sheetbody">
    <div class="seclabel">这本书</div>
    <input class="field" id="book-title" value="${esc(st.title)}">
    <div class="seclabel" style="margin-top:14px">用哪份文风</div>
    <select class="field" id="book-style">
      <option value="">（不用文风）</option>
      ${S.styles.map((w) => `<option value="${w.id}" ${w.id === st.styleId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
    </select>
    <div class="row-btns">
      <button class="btn ghost" data-act="sheet-close">取消</button>
      <button class="btn primary" data-act="book-save">保存</button>
    </div>
  </div>`;
  render();
}

function cardHistory() {
  const c = card();
  const list = (S.story.patches || []).filter((p) => p.cardId === c.id && p.applied);
  S.sheet = `<div class="sheetbody">
    <div class="seclabel">收束记录</div>
    ${list.length
      ? list.map((p) => `<div class="row">
          <div class="t">${new Date(p.at).toLocaleString('zh-CN')}${p.undone ? '（已撤销）' : ''}</div>
          <div class="s">${p.changes.map((c2) => esc(c2.label)).join('、') || '无正文改动'}</div>
          ${p.undone ? '' : `<button class="lnk" data-act="patch-undo" data-id="${p.id}">撤销这次</button>`}
        </div>`).join('')
      : '<div class="dim">还没有收束过。</div>'}
    <button class="btn ghost wide" data-act="sheet-close">关掉</button>
  </div>`;
  render();
}

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'book-save') {
    S.story.title = val('book-title', S.story.title) || S.story.title;
    const sel = document.getElementById('book-style');
    S.story.styleId = sel ? sel.value : '';
    S.style = S.story.styleId ? (await S_.getStyle(S.story.styleId)) || null : null;
    await save();
    S.sheet = '';
    return render();
  }
  if (act === 'sheet-close') {
    S.sheet = '';
    return render();
  }
  if (act === 'patch-undo') {
    await undoPatch(el.dataset.id);
    S.sheet = '';
    return render();
  }
});

// 把 sheet 插进渲染结果
const _render = render;
render = function () {
  _render();
  if (S.sheet) {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = `<div class="sheet">${S.sheet}</div>`;
    mask.addEventListener('click', (ev) => {
      if (ev.target === mask) {
        S.sheet = '';
        render();
      }
    });
    $app.appendChild(mask);
  }
};

/* ---------------- 启动 ---------------- */
applyTheme(S_.loadSettings().theme);
boot().catch((err) => window.__sfError('启动失败', err));
