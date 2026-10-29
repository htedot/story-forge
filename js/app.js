import { chat, streamChat, listModels, pickModel, testConnection } from './api.js';
import * as S_ from './store.js';
import * as P from './prompt.js';
import { AXES, AXIS_BY_ID, probeMessages, parseProbe, estimateLevel, brief, describe, PROBE_MATERIAL, analyzeMessages, parseAnalyze, imitateMessages, parsePassages, reviseMessages, parseRules, rulesToText, ESSAY_MATERIAL } from './style-engine.js';

const $app = document.getElementById('app');

const S = {
  ready: false,
  settings: null,
  stories: [],
  styles: [],
  story: null,
  style: null,
  view: 'shelf',
  stack: [],
  tab: 'set',
  cardId: '',
  sessionId: '',
  chapterId: '',
  input: '',
  busy: false,
  err: '',
  live: '',
  toast: '',
  sheet: '',
  models: [],
  testMsg: '',
  testing: false,
  forge: null,
  chap: null,
  sesCards: false,
  editIdx: -1,
  editText: '',
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chars = (s) => String(s || '').replace(/\s+/g, '').length;
const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n || 0));
const hueOf = (id) => {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 360;
  return h;
};

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

function toast(msg) {
  S.toast = msg;
  render();
  setTimeout(() => {
    if (S.toast === msg) {
      S.toast = '';
      render();
    }
  }, 2200);
}

function push(view) {
  S.stack.push(S.view);
  S.view = view;
  render();
}

function back() {
  S.view = S.stack.pop() || 'shelf';
  render();
}

/* ---------------- 启动 ---------------- */

async function boot() {
  S.settings = S_.loadSettings();
  applyTheme(S.settings.theme);
  S.models = (S.settings.models || []).slice();
  S.stories = await S_.listStories();
  S.styles = await S_.listStyles();
  await ensureDemo();
  const cur = S_.loadCurrentId();
  if (cur && S.stories.some((s) => s.id === cur)) await openStory(cur, { silent: true });
  S.ready = true;
  render();
}

function applyTheme(name) {
  const t = THEMES.some((x) => x.id === name) ? name : 'aurora';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  const bar = { aurora: '#F7F5F2', ink: '#0e1118', plain: '#ffffff', mint: '#f2f9f7', sakura: '#fff5f7', midnight: '#0b0f1a' };
  if (meta) meta.setAttribute('content', bar[t] || '#F7F5F2');
}

async function ensureDemo() {
  if (localStorage.getItem('sf_demo_v1') === '1') return;
  localStorage.setItem('sf_demo_v1', '1');
  if (S.stories.some((s) => (s.title || '').startsWith('演示'))) return;
  const st = S_.demoStory();
  await S_.putStory(st);
  S.stories = await S_.listStories();
}

async function openStory(id, opt = {}) {
  S.story = await S_.getStory(id);
  if (!S.story) return;
  S.story.pendingSuggestions = S.story.pendingSuggestions || [];
  S.style = S.story.styleId ? await S_.getStyle(S.story.styleId) : null;
  S_.saveCurrentId(id);
  if (!opt.silent) {
    S.view = 'book';
    S.tab = 'set';
    S.stack = ['shelf'];
  }
  render();
}

async function save() {
  if (!S.story) return;
  await S_.putStory(S.story);
}

/* ---------------- 渲染 ---------------- */

function render() {
  if (!S.ready) {
    $app.innerHTML = '<div class="boot">打开中…</div>';
    return;
  }
  let html = '';
  const v = S.view;
  if (v === 'shelf') html = viewShelf();
  else if (v === 'styles') html = viewStyles();
  else if (v === 'forge') html = viewForge();
  else if (v === 'settings') html = viewSettings();
  else if (v === 'book') html = viewBook();
  else if (v === 'card') html = viewCard();
  else if (v === 'session') html = viewSession();
  else if (v === 'seslist') html = viewSessionList();
  else if (v === 'sesview') html = viewSessionRead();
  else if (v === 'chapter') html = viewChapter();

  $app.innerHTML = html + sheetHtml() + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '');
  afterRender();
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

    ${list.length ? `<div class="seclabel">书架</div><div class="grid">${list.map(bookCard).join('')}</div>` : emptyShelf()}
  </div>`;
}

function emptyShelf() {
  return `<div class="empty">
    <div class="big">还没有书</div>
    <p>开一本新的，先放几张设定卡，再去演。</p>
  </div>`;
}

function bookCard(s) {
  const h = hueOf(s.id);
  const words = (s.chapters || []).reduce((a, c) => a + chars(c.body), 0);
  return `<button class="book" style="--h:${h}" data-act="open" data-id="${s.id}">
    <div class="spine"></div>
    <div class="bk-body">
      <b>${esc(s.title)}</b>
      <span>${(s.cards || []).length} 张设定 · ${(s.chapters || []).length} 章</span>
      <span class="dim">${fmt(words)} 字</span>
    </div>
  </button>`;
}

/* ---------------- 文风 ---------------- */

function viewStyles() {
  return `<div class="wrap">
    ${topbar('文风')}
    <button class="btn primary wide" data-act="forge-start">提取一份新文风</button>
    ${S.styles.length ? `<div class="list">${S.styles.map(styleRow).join('')}</div>` : '<div class="empty"><div class="big">还没有文风</div><p>做一次提取：AI 出四段，你从最差排到最好。</p></div>'}
  </div>`;
}

function styleRow(w) {
  return `<div class="item">
    <div class="grow"><b>${esc(w.name)}</b><span class="dim">${esc(describe(w))}</span></div>
    <button class="ico sm" data-act="style-del" data-id="${w.id}">×</button>
  </div>`;
}

/* ---------------- 文风提取 ---------------- */

function quickbar(curModel) {
  const model = curModel || S.settings.model;
  const list = (S.settings.models || []).length ? S.settings.models : [model].filter(Boolean);
  return `<div class="quickbar">
    <select class="qsel" data-act="inline-model">
      ${list.map((m) => `<option ${m === model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select>
    <select class="qsel" data-act="inline-effort">
      ${EFFORTS.map((e) => `<option value="${e.id}" ${(S.settings.effort || 'off') === e.id ? 'selected' : ''}>推理·${e.name}</option>`).join('')}
    </select>
  </div>`;
}

function viewForge() {
  const f = S.forge;
  if (!f) return '';
  const STEPS = ['写一段', '看规则', '让它写', '排个序', '存下来'];
  const idx = { essay: 1, rules: 2, imitate: 3, rank: 4, done: 5 }[f.stage] || 1;
  const hasRules = !!String(f.rules || '').trim();
  const canLock = !f.busy && hasRules && f.stage !== 'done';

  const stepsBar = `<div class="fsteps">${STEPS.map((t, i) => {
    const n = i + 1;
    return `<i class="${n < idx ? 'ok' : n === idx ? 'on' : ''}">${t}</i>`;
  }).join('')}</div>`;

  const head = `<header class="topbar">
    <button class="ico" data-act="back">‹</button>
    <div class="bt"><b>提取我的文风</b><span>${STEPS[idx - 1]} · 第 ${idx} 步</span></div>
    ${canLock ? '<button class="ico" data-act="forge-done">敲定</button>' : '<span class="ico-sp"></span>'}
  </header>`;

  let body = '';

  if (f.stage === 'essay') {
    body = `
    <div class="panel">
      <div class="seclabel">先写一小段</div>
      <div class="dim">不用完整，不用讲究。写你平时会写的那样，三五句就够。</div>
      <div class="matbox"><span>就写这个</span>${esc(ESSAY_MATERIAL)}</div>
      <textarea id="essay" rows="8" placeholder="从这一句往下写，写到你自然停下来为止。">${esc(f.essay || '')}</textarea>
    </div>
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-skip">跳过去，我自己写规则</button>
      <button class="btn primary" data-act="forge-analyze" ${f.busy ? 'disabled' : ''}>让它看</button>
    </div>
    ${f.busy ? '<div class="dim center pad">正在读你写的那一段…</div>' : ''}`;
  }

  if (f.stage === 'rules') {
    body = `
    ${f.read && f.read.length ? `<div class="panel readbox">
      <div class="seclabel">它读到的</div>
      ${f.read.map((r) => `<p>${esc(r)}</p>`).join('')}
    </div>` : ''}
    <div class="panel">
      <div class="seclabel">写作规则${f.round > 1 ? ` · 第 ${f.round} 版` : ''}</div>
      <div class="dim">这几条可以直接改。以后写小说，叙述就按这几条来。</div>
      <textarea id="forge-rules" rows="11">${esc(f.rules || '')}</textarea>
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-back-essay">回去重写那段</button>
      <button class="btn primary" data-act="forge-imitate" ${f.busy ? 'disabled' : ''}>让它照这个写四段</button>
    </div>`;
  }

  if (f.stage === 'imitate') {
    body = `
    <div class="panel">
      <div class="seclabel">它照规则写的四段</div>
      <div class="dim">同一个材料，四种写法。等下你要把它们从最差排到最好。</div>
      ${f.busy ? `<div class="live" id="live">${esc(f.live || '')}</div>` : ''}
      ${!f.busy && f.passages.length ? f.passages.map((p, i) => `<div class="passage"><b>${i + 1}</b><p>${esc(p)}</p></div>`).join('') : ''}
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-back-rules">规则不对，回去改</button>
      <button class="btn primary" data-act="forge-to-rank" ${f.busy || f.passages.length < 3 ? 'disabled' : ''}>排一下序</button>
    </div>`;
  }

  if (f.stage === 'rank') {
    body = `
    <div class="panel">
      <div class="seclabel">从最差排到最好</div>
      <div class="dim">依次点四段。第一下＝最差，第四下＝最好。点错了再点一下取消。</div>
      ${f.passages.map((p, i) => {
        const pos = f.order.indexOf(i);
        return `<div class="pickcard ${pos >= 0 ? 'picked' : ''}" data-act="rank-pick" data-id="${i}">
          <b>${i + 1}</b>
          ${pos >= 0 ? `<em>${pos + 1}</em>` : ''}
          <p>${esc(p)}</p>
        </div>`;
      }).join('')}
      <input class="field" id="forge-note" value="${esc(f.note || '')}" placeholder="还有话说就写一句：哪里最不像你">
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-to-imitate">再写四段</button>
      <button class="btn primary" data-act="forge-revise" ${f.busy || f.order.length < 4 ? 'disabled' : ''}>按这个改规则</button>
    </div>`;
  }

  if (f.stage === 'done') {
    body = `
    <div class="panel">
      <div class="seclabel">存下来</div>
      <input class="field" id="style-name" value="${esc(f.name || '我的文风')}" placeholder="给这份文风起个名字">
      <textarea id="forge-rules" rows="11">${esc(f.rules || '')}</textarea>
      <div class="dim">以后写小说，叙述就按这几条来。随时能回来再改一轮。</div>
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <div class="row-btns">
      <button class="btn ghost" data-act="forge-to-imitate">再来一轮</button>
      <button class="btn primary" data-act="forge-save">存下来</button>
    </div>`;
  }

  return `<div class="wrap">
    ${head}
    ${quickbar(S.settings.model)}
    ${stepsBar}
    ${body}
  </div>`;
}

/* ---------------- 设置 ---------------- */

function viewSettings() {
  const st = S.settings;
  return `<div class="wrap">
    ${topbar('设置')}

    <div class="panel">
      <div class="seclabel">皮肤</div>
      <div class="dim">换一套配色，立刻生效。</div>
      <div class="themes">
        ${THEMES.map(
          (t) =>
            `<button class="themecard ${(st.theme || 'aurora') === t.id ? 'on' : ''}" data-act="theme" data-id="${t.id}">
              <span class="swatch" style="background:${t.sw}"></span>
              <span class="tmeta">
                <span class="tname">${t.name}</span>
                <span class="tdesc">${t.desc}</span>
              </span>
              <span class="tick">✓</span>
            </button>`
        ).join('')}
      </div>
    </div>

    <div class="panel">
      <label class="lbl">接口地址</label>
      <input class="field" id="set-base" value="${esc(st.baseUrl)}" placeholder="https://api.deepseek.com/v1">
      <label class="lbl">密钥</label>
      <input class="field" id="set-key" type="password" value="${esc(st.apiKey)}" placeholder="sk-...">
      <div class="row-btns">
        <button class="btn" data-act="test">测一下</button>
        <button class="btn" data-act="import" ${S.testing ? 'disabled' : ''}>${S.testing ? '读取中…' : '读取模型'}</button>
      </div>
      ${S.testMsg ? `<div class="hint">${esc(S.testMsg)}</div>` : ''}
    </div>

    <div class="panel">
      <div class="seclabel">可用模型（可多选，写时能切换）</div>
      ${S.models.length ? S.models.map((m) => `<label class="chk"><input type="checkbox" data-act="model" value="${esc(m)}" ${(st.models || []).includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('') : '<div class="dim">还没有读取。填好地址和密钥后点「读取模型」。</div>'}
      <label class="lbl">默认模型</label>
      <select class="field" id="set-model">${(st.models || []).map((m) => `<option ${m === st.model ? 'selected' : ''}>${esc(m)}</option>`).join('') || `<option>${esc(st.model)}</option>`}</select>
      <label class="lbl">推理等级</label>
      <select class="field" id="set-effort">
        ${EFFORTS.map((e) => `<option value="${e.id}" ${(st.effort || 'off') === e.id ? 'selected' : ''}>${e.name}——${e.desc}</option>`).join('')}
      </select>
      <div class="dim">开得越高，模型想得越久，也越慢越贵。写小说一般不用开。</div>
    </div>

    <button class="btn primary wide" data-act="save-settings">保存</button>
  </div>`;
}

/* ---------------- 书工作台 ---------------- */

function viewBook() {
  const s = S.story;
  if (!s) return '<div class="empty">书没打开</div>';
  const tabs = [
    ['set', '设定'],
    ['time', '时间轴'],
    ['write', '创作'],
    ['book', '成书'],
  ];
  let body = '';
  if (S.tab === 'set') body = tabSet(s);
  else if (S.tab === 'time') body = tabTime(s);
  else if (S.tab === 'write') body = tabWrite(s);
  else body = tabBook(s);

  return `<div class="wrap studio">
    <header class="topbar book-top">
      <button class="ico" data-act="shelf">‹</button>
      <div class="bt"><b>${esc(s.title)}</b><span>${esc(S.style ? S.style.name : '未选文风')} · ${esc(s.model || S.settings.model)}</span></div>
      <button class="ico" data-act="book-menu">⋯</button>
    </header>
    <nav class="tabs">${tabs.map(([k, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${n}</button>`).join('')}</nav>
    <div class="tabbody">${body}</div>
  </div>`;
}

function tabSet(s) {
  const groups = [
    ['background', '背景设定'],
    ['world', '世界观'],
    ['outline', '大纲'],
    ['character', '角色'],
  ];
  const sug = (s.pendingSuggestions || []).length
    ? `<div class="panel warn">
        <div class="seclabel">演绎提出的改动</div>
        ${s.pendingSuggestions.map((g) => `<div class="sug"><div class="grow"><b>${esc(g.title || '未命名')}</b><span class="dim">${esc(String(g.body || '').slice(0, 40))}…</span></div><button class="btn sm" data-act="sug-ok" data-id="${g.id}">用</button><button class="ico sm" data-act="sug-no" data-id="${g.id}">×</button></div>`).join('')}
      </div>`
    : '';

  const sec = (kind, name) => {
    const cards = (s.cards || []).filter((c) => c.kind === kind);
    return `<div class="seclabel">${name}</div>
      ${cards.map(cardRow).join('')}
      <button class="add" data-act="newcard" data-kind="${kind}">＋ 加一张${name}</button>`;
  };

  return sug + groups.map(([k, n]) => sec(k, n)).join('');
}

function cardRow(c) {
  const n = sessionsOfCard(c.id).length;
  const hasDraft = (S.story.sessions || []).some((m) => m.cardId === c.id && m.status === 'draft');
  return `<div class="cardrow">
    <button class="grow left" data-act="card" data-id="${c.id}">
      <b>${esc(c.title)}${n ? `<span class="tag">${n} 场</span>` : ''}</b>
      <span class="dim">${esc(String(c.body || '').replace(/\s+/g, ' ').slice(0, 46) || '还没写内容')}</span>
    </button>
    <button class="btn sm ${hasDraft ? 'on' : ''}" data-act="play" data-id="${c.id}">演绎</button>
  </div>`;
}

function tabTime(s) {
  const items = (s.timeline || []).slice().sort((a, b) => a.order - b.order);
  if (!items.length) {
    return `<div class="empty"><div class="big">时间轴还是空的</div><p>去「设定」里点一张卡的「演绎」，演完确认，事件就会落到这里。</p></div>`;
  }
  const pend = items.filter((i) => i.status === 'pending').length;
  return `${pend ? `<div class="panel warn"><div class="row-btns"><span class="grow">${pend} 条还没确认</span><button class="btn sm" data-act="confirm-all">全部确认</button></div></div>` : ''}
  <div class="timeline">${items.map(timeRow).join('')}</div>`;
}

function timeRow(t) {
  return `<div class="trow ${t.status}">
    <div class="twhen">${esc(t.at || '—')}</div>
    <div class="tbody">
      <b>${esc(t.title || '未命名事件')}</b>
      <p>${esc(t.detail || '')}</p>
      <div class="tact">
        <button class="lnk" data-act="tedit" data-id="${t.id}">改</button>
        ${t.status === 'pending' ? `<button class="lnk ok" data-act="tconfirm" data-id="${t.id}">确认</button>` : ''}
        <button class="lnk danger" data-act="tdel" data-id="${t.id}">删</button>
      </div>
    </div>
  </div>`;
}

function tabWrite(s) {
  const chs = s.chapters || [];
  const st = staleCount();
  return `<button class="btn primary wide" data-act="newchapter">写一章</button>
  ${st ? `<div class="panel warn"><div class="row-btns"><span class="grow">${st} 章引用的设定或事件改过，建议重写</span></div></div>` : ''}
  <div class="seclabel">草稿与成书</div>
  ${chs.length
    ? chs.map((c) => `<button class="chaprow" data-act="openchap" data-id="${c.id}">
        <span class="no">第 ${c.no || '?'} 章</span>
        <b>${esc(c.title || '未命名')}${c.stale ? '<span class="tag warn">设定已变</span>' : ''}</b>
        <span class="dim">${chars(c.body)} 字 · ${c.status === 'final' ? '已入书' : '草稿'}</span>
      </button>`).join('')
    : '<div class="dim">还没有章节。</div>'}`;
}

function tabBook(s) {
  const finals = (s.chapters || []).filter((c) => c.status === 'final');
  if (!finals.length) return `<div class="empty"><div class="big">成书还是空的</div><p>写完一章，审核通过后点「入书」。</p></div>`;
  return `<div class="bookread">${finals
    .sort((a, b) => a.no - b.no)
    .map((c) => `<section><h2>第 ${c.no} 章　${esc(c.title)}</h2>${String(c.body || '')
      .split(/\n+/)
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join('')}</section>`)
    .join('')}</div>`;
}

/* ---------------- 联动：谁依赖了这张卡 / 这条事件 ---------------- */

function markStaleFromCard(c) {
  const hitSessions = [];
  (S.story.sessions || []).forEach((m) => {
    if (m.cardId === c.id) {
      m.stale = true;
      hitSessions.push(m.id);
    }
  });
  (S.story.timeline || []).forEach((t) => {
    if (t.cardId === c.id) t.stale = true;
  });
  (S.story.chapters || []).forEach((h) => {
    const usesItem = (h.pickedIds || []).some((id) => {
      const t = (S.story.timeline || []).find((x) => x.id === id);
      return t && t.cardId === c.id;
    });
    const usesSess = (h.sourceSessions || []).some((sid) => hitSessions.includes(sid));
    if (usesItem || usesSess) h.stale = true;
  });
}

function markStaleFromItem(itemId) {
  (S.story.chapters || []).forEach((h) => {
    if ((h.pickedIds || []).includes(itemId)) h.stale = true;
  });
}

function sessionsOfCard(cardId) {
  return (S.story.sessions || []).filter((m) => m.cardId === cardId && (m.messages || []).length);
}

function staleCount() {
  return (S.story.chapters || []).filter((h) => h.stale).length;
}

/* ---------------- 卡片编辑 ---------------- */

function viewCard() {
  const c = (S.story.cards || []).find((x) => x.id === S.cardId);
  if (!c) return '<div class="empty">卡片没了</div>';
  const kind = S_.KIND_BY_ID[c.kind] || { name: '设定' };
  const sess = sessionsOfCard(c.id);
  return `<div class="wrap">
    ${topbar(kind.name + ' · 第 ' + (c.rev || 1) + ' 版', `<button class="ico" data-act="card-del" data-id="${c.id}">×</button>`)}
    <input class="field titlefield" id="card-title" value="${esc(c.title)}" placeholder="标题">
    <textarea class="field big" id="card-body" placeholder="写点什么…">${esc(c.body || '')}</textarea>
    <div class="hint">改这张卡会让在它之上演过的场、和引用这些场的章被标成「设定已变」，不会自动删掉。</div>
    ${
      sess.length
        ? `<button class="cardrow" data-act="seslist" data-id="${c.id}">
            <span class="grow left"><b>演绎记录</b><span class="dim">${sess.length} 场，可以翻回去看当时怎么演的</span></span>
            <span class="chev">›</span>
          </button>`
        : ''
    }
    <div class="row-btns">
      <button class="btn" data-act="back">返回</button>
      <button class="btn primary" data-act="card-save">存</button>
    </div>
  </div>`;
}

/* ---------------- 演绎记录（只读回看） ---------------- */

function viewSessionList() {
  const c = (S.story.cards || []).find((x) => x.id === S.cardId);
  const list = sessionsOfCard(S.cardId).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return `<div class="wrap">
    ${topbar('演绎记录 · ' + (c ? c.title : ''))}
    ${list.length
      ? list
          .map((m) => {
            const n = m.messages.filter((x) => x.role === 'user').length;
            const t = m.messages.find((x) => x.role === 'ai');
            return `<button class="trow" data-act="sesview" data-id="${m.id}">
              <div class="twhen">${esc(new Date(m.savedAt || Date.now()).toLocaleDateString('zh-CN'))}</div>
              <div class="tbody">
                <b>${esc(String(t ? t.content : '').replace(/\s+/g, ' ').slice(0, 24) || '（空场）')}</b>
                <p>${n} 拍 · ${m.status === 'done' ? '已收' : '未收'}${m.stale ? ' · 设定已变' : ''}${m.orphan ? ' · 原卡已删' : ''}</p>
              </div>
            </button>`;
          })
          .join('')
      : '<div class="empty"><div class="big">还没有演绎记录</div></div>'}
  </div>`;
}

function viewSessionRead() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess) return '<div class="empty">记录没了</div>';
  const card = (S.story.cards || []).find((c) => c.id === sess.cardId);
  const msgs = sess.messages
    .map((m) =>
      m.role === 'user'
        ? `<div class="me"><div class="bubble">${esc(m.content)}</div></div>`
        : `<div class="ai">${String(m.content || '')
            .split(/\n+/)
            .filter(Boolean)
            .map((p) => `<p>${esc(p)}</p>`)
            .join('')}</div>`
    )
    .join('');
  return `<div class="wrap session">
    <header class="topbar">
      <button class="ico" data-act="sesview-exit">‹</button>
      <div class="bt"><b>${esc(card ? card.title : '（原卡已删）')}</b><span>只读回看</span></div>
      <span class="ico ghost"></span>
    </header>
    ${sess.stale ? '<div class="panel warn">这张卡后来改过，当时演的是旧设定。</div>' : ''}
    <div class="stream">${msgs}</div>
  </div>`;
}

/* ---------------- 演绎 ---------------- */

function viewSession() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess) return '<div class="empty">会话没了</div>';
  const card = (S.story.cards || []).find((c) => c.id === sess.cardId);
  if (!card) return '<div class="empty">这张卡被删了</div>';
  const kind = S_.KIND_BY_ID[card.kind] || { name: '设定' };

  const msgs = sess.messages
    .map((m) =>
      m.role === 'user'
        ? `<div class="me"><div class="bubble">${esc(m.content)}</div></div>`
        : `<div class="ai">${String(m.content || '')
            .split(/\n+/)
            .filter(Boolean)
            .map((p) => `<p>${esc(p)}</p>`)
            .join('')}</div>`
    )
    .join('');

  const cards = S.story.cards || [];
  const peek = S.sesCards
    ? `<div class="cardpeek">${
        cards.length
          ? cards
              .map(
                (c) =>
                  `<div class="peekrow"><b>${esc(c.title)}</b><span>${esc(String(c.body || '').slice(0, 70) || '（空卡）')}</span></div>`
              )
              .join('')
          : '<div class="dim">这本还没有设定卡。</div>'
      }</div>`
    : '';

  const canUndo = sess.messages.length > 0;
  const curModel = S.story.model || S.settings.model;
  const qb = quickbar(curModel);

  const lastAi = [...sess.messages].reverse().find((m) => m.role === 'assistant');
  const opts = !S.busy && lastAi && Array.isArray(lastAi.options) ? lastAi.options : [];
  const optsHtml = opts.length
    ? `<div class="opts">${opts
        .map(
          (o, i) =>
            `<button class="opt" data-act="opt-pick" data-i="${i}"><b>${i + 1}</b><span>${esc(o)}</span></button>`
        )
        .join('')}</div>`
    : '';

  return `<div class="wrap session">
    <header class="topbar">
      <button class="ico" data-act="session-exit">‹</button>
      <div class="bt"><b>${esc(card.title)}</b><span>${esc(kind.name)} · 第 ${sess.messages.filter((m) => m.role === 'user').length + 1} 拍</span></div>
      <button class="ico" data-act="session-close">收</button>
    </header>
    ${qb}
    ${sess.stale ? '<div class="panel warn">这张卡的设定后来改过，这一场是按旧设定演的。</div>' : ''}
    ${peek}
    <div class="stream" id="stream">
      ${msgs}
      ${S.live ? `<div class="ai live">${String(P.splitOut(S.live).body)
              .split(/\n+/)
              .filter(Boolean)
              .map((p) => `<p>${esc(p)}</p>`)
              .join('')}</div>` : ''}
      ${S.busy && !S.live ? '<div class="ai typing">…</div>' : ''}
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    </div>
    <div class="sestools">
      <button class="toolbtn" data-act="ses-undo" ${canUndo && !S.busy ? '' : 'disabled'}>回退一步</button>
      <button class="toolbtn" data-act="ses-regen" ${canUndo && !S.busy ? '' : 'disabled'}>重写这段</button>
      <button class="toolbtn ${S.sesCards ? 'on' : ''}" data-act="ses-cards">看设定</button>
    </div>
    ${optsHtml}
    <div class="composer">
      <textarea id="say" rows="1" placeholder="我做了什么、说了什么…">${esc(S.input)}</textarea>
      <button class="send" data-act="send" ${S.busy ? 'disabled' : ''}>发</button>
    </div>
  </div>`;
}

/* ---------------- 创作 ---------------- */

function viewChapter() {
  const c = S.chap;
  if (!c) return '';
  const s = S.story;

  if (c.mode === 'pick') {
    const items = (s.timeline || []).filter((t) => t.status === 'confirmed').sort((a, b) => a.order - b.order);
    if (!items.length) {
      return `<div class="wrap">${topbar('写一章')}
        <div class="empty"><div class="big">时间轴上还没有确认过的事件</div><p>先演一章，确认后回来写。</p></div></div>`;
    }
    const picked = items.filter((t) => c.picked.has(t.id));
    return `<div class="wrap">
      ${topbar('写一章')}
      <div class="panel tight">
        <div class="seclabel">这一章截取哪些事</div>
        <div class="dim">从时间轴上挑；按顺序排，连着的会自动连起来。</div>
      </div>
      <div class="list">${items
        .map(
          (t) => `<label class="pickrow ${c.picked.has(t.id) ? 'on' : ''}">
        <input type="checkbox" data-act="chap-pick" data-id="${t.id}" ${c.picked.has(t.id) ? 'checked' : ''}>
        <span class="grow"><b>${esc(t.title)}</b><span class="dim">${esc(t.at || '')} · ${esc(String(t.detail || '').slice(0, 30))}</span></span>
      </label>`
        )
        .join('')}</div>

      <div class="panel">
        <div class="seclabel">视角</div>
        <div class="seg">${P.POV_MODES.map((m) => `<button class="segb ${c.pov.mode === m.id ? 'on' : ''}" data-act="pov" data-mode="${m.id}">${m.name}</button>`).join('')}</div>
        ${c.pov.mode === 'first' || c.pov.mode === 'omni'
          ? `<div class="chks">${(s.cards || []).filter((x) => x.kind === 'character').map((x) => `<label class="chk"><input type="checkbox" data-act="pov-who" value="${x.id}" ${c.pov.who.includes(x.id) ? 'checked' : ''}><span>${esc(x.title)}</span></label>`).join('')}</div>`
          : ''}
      </div>

      <div class="hint">已选 ${picked.length} 条${picked.length ? `，从「${picked[0].at || '开头'}」到「${picked[picked.length - 1].at || '结尾'}」` : ''}</div>
      <button class="btn primary wide" data-act="chap-gen" ${picked.length && !S.busy ? '' : 'disabled'}>${S.busy ? '写着…' : '生成这一章'}</button>
    </div>`;
  }

  const ch = (s.chapters || []).find((x) => x.id === S.chapterId) || {};
  const paras = String(ch.body || S.live || '')
    .split(/\n+/)
    .filter(Boolean);
  const isFinal = ch.status === 'final';
  const hasHist = (ch.history || []).length > 0;
  return `<div class="wrap">
    ${topbar(`第 ${ch.no || '?'} 章`, `<button class="ico" data-act="chap-del">×</button>`)}
    ${ch.stale ? '<div class="panel warn">这一章写完以后，它引用的设定或事件改过了。重写会按新设定写；你现在这稿会存进「上一稿」，不会丢。</div>' : ''}
    <div class="stream"><div class="prose">${paras
      .map((p, i) => `<p class="pe" data-act="pedit" data-i="${i}">${esc(p)}</p>`)
      .join('')}</div></div>
    <div class="hint">点任意一段可以直接改。</div>
    <div class="row-btns">
      <button class="btn" data-act="chap-regen" ${S.busy ? 'disabled' : ''}>${hasHist ? '重写' : '重写'}</button>
      ${
        isFinal
          ? `<button class="btn" data-act="chap-withdraw" ${S.busy ? 'disabled' : ''}>撤回</button>`
          : `<button class="btn primary" data-act="chap-final" ${S.busy ? 'disabled' : ''}>入书</button>`
      }
    </div>
    ${hasHist ? `<button class="lnk wide" data-act="chap-restore">换回上一稿</button>` : ''}
  </div>`;
}

/* ---------------- 抽屉 ---------------- */

function sheetHtml() {
  if (S.sheet === 'newbook') return sheetNewBook();
  if (S.sheet === 'menu') return sheetMenu();
  if (S.sheet === 'sesend') return sheetSessionEnd();
  if (S.sheet === 'para') return sheetPara();
  return '';
}

function sheetPara() {
  return `<div class="mask" data-act="sheet-close"><div class="sheet" data-stop>
    <div class="handle"></div>
    <div class="seclabel">改这一段</div>
    <textarea class="field area" id="para-text" rows="9">${esc(S.editText)}</textarea>
    <div class="row-btns"><button class="btn" data-act="sheet-close">算了</button><button class="btn primary" data-act="para-save">改好</button></div>
  </div></div>`;
}

function sheetNewBook() {
  return `<div class="mask" data-act="sheet-close"><div class="sheet" data-stop>
    <div class="handle"></div>
    <div class="seclabel">开一本新书</div>
    <input class="field" id="nb-title" placeholder="书名（可以留空，之后改）">
    <div class="seclabel">用哪份文风</div>
    ${S.styles.length ? S.styles.map((w) => `<label class="chk"><input type="radio" name="nbstyle" value="${w.id}" ${w.id === (S.styles[0] || {}).id ? 'checked' : ''}><span>${esc(w.name)}</span></label>`).join('') : '<div class="dim">还没有文风，先跳过也行。</div>'}
    <div class="row-btns"><button class="btn" data-act="sheet-close">算了</button><button class="btn primary" data-act="do-newbook">开</button></div>
  </div></div>`;
}

function sheetMenu() {
  return `<div class="mask" data-act="sheet-close"><div class="sheet" data-stop>
    <div class="handle"></div>
    <button class="menu-item" data-act="rename-book">改书名</button>
    <button class="menu-item" data-act="chg-style">换文风</button>
    <button class="menu-item" data-act="export">导出全文</button>
    <button class="menu-item danger" data-act="del-book">删掉这本书</button>
    <button class="menu-item" data-act="sheet-close">取消</button>
  </div></div>`;
}

function sheetSessionEnd() {
  return `<div class="mask" data-act="sheet-close"><div class="sheet" data-stop>
    <div class="handle"></div>
    <div class="seclabel">收这一章</div>
    <p class="dim">我会把这场演绎整理成事实，交给你确认后进时间轴。</p>
    <div class="row-btns"><button class="btn" data-act="sheet-close">再演会儿</button><button class="btn primary" data-act="do-close-session" ${S.busy ? 'disabled' : ''}>整理</button></div>
  </div></div>`;
}

/* ---------------- 交互 ---------------- */

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (e.target.closest('[data-stop]') && !el.closest('button')) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  try {
    switch (act) {
      case 'back':
        return back();
      case 'shelf':
        S.story = null;
        S.style = null;
        S.stack = [];
        S.view = 'shelf';
        return render();
      case 'go':
        return push(el.dataset.to);
      case 'newbook':
        S.sheet = 'newbook';
        return render();
      case 'sheet-close':
        S.sheet = '';
        return render();
      case 'do-newbook': {
        const t = (document.getElementById('nb-title') || {}).value || '';
        const pick = document.querySelector('input[name=nbstyle]:checked');
        const st = S_.newStory({ title: t.trim() || '未命名', styleId: pick ? pick.value : '' });
        await S_.putStory(st);
        S.stories = await S_.listStories();
        S.sheet = '';
        await openStory(st.id);
        return;
      }
      case 'open':
        return openStory(id);
      case 'tab':
        S.tab = el.dataset.tab;
        return render();
      case 'card':
        S.cardId = id;
        return push('card');
      case 'newcard': {
        S.story.cards.push(S_.newCard(el.dataset.kind));
        await save();
        return render();
      }
      case 'card-save': {
        const c = S.story.cards.find((x) => x.id === S.cardId);
        const title = document.getElementById('card-title').value.trim() || '未命名';
        const body = document.getElementById('card-body').value;
        const changed = title !== c.title || body !== c.body;
        c.title = title;
        c.body = body;
        c.updatedAt = Date.now();
        if (changed) {
          c.rev = (c.rev || 1) + 1;
          markStaleFromCard(c);
        }
        await save();
        const n = changed ? staleCount() : 0;
        back();
        if (n) toast(`${n} 章引用了旧设定，已标出来`);
        return;
      }
      case 'card-del': {
        const c = S.story.cards.find((x) => x.id === S.cardId);
        const rel = (S.story.sessions || []).filter((m) => m.cardId === c.id).length;
        const msg = rel ? `删掉「${c.title}」？\n它有 ${rel} 场演绎记录，会一起标成无主张（不会真的删掉记录）。` : `删掉「${c.title}」？`;
        if (!confirm(msg)) return;
        S.story.cards = S.story.cards.filter((x) => x.id !== c.id);
        (S.story.sessions || []).forEach((m) => {
          if (m.cardId === c.id) {
            m.orphan = true;
            m.stale = true;
          }
        });
        (S.story.timeline || []).forEach((t) => {
          if (t.cardId === c.id) t.orphan = true;
        });
        S.story.pendingSuggestions = (S.story.pendingSuggestions || []).filter((g) => g.cardId !== c.id);
        await save();
        return back();
      }
      case 'play': {
        let sess = (S.story.sessions || []).find((m) => m.cardId === id && m.status === 'draft');
        if (!sess) {
          sess = S_.newSession(id);
          S.story.sessions.push(sess);
          await save();
        }
        S.sessionId = sess.id;
        return push('session');
      }
      case 'session-exit':
        S.story.sessions.forEach((m) => {
          if (m.id === S.sessionId && m.messages.length) m.status = 'draft';
        });
        await save();
        return back();
      case 'session-close':
        S.sheet = 'sesend';
        return render();
      case 'do-close-session':
        return closeSession();
      case 'send':
        return sendTurn();
      case 'ses-undo':
        return undoSession();
      case 'ses-regen':
        return regenSession();
      case 'opt-pick': {
        const s0 = (S.story.sessions || []).find((m) => m.id === S.sessionId);
        const a = s0 ? [...s0.messages].reverse().find((m) => m.role === 'assistant') : null;
        const t = a && Array.isArray(a.options) ? a.options[Number(el.dataset.i)] : '';
        if (t) sendTurn(t);
        return;
      }
      case 'ses-cards':
        S.sesCards = !S.sesCards;
        return render();
      case 'pedit':
        S.editIdx = Number(el.dataset.i);
        S.editText = el.textContent;
        S.sheet = 'para';
        return render();
      case 'para-save': {
        const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
        if (ch) {
          const t = document.getElementById('para-text').value.trim();
          const parts = String(ch.body || '')
            .split(/\n+/)
            .filter(Boolean);
          if (S.editIdx >= 0 && S.editIdx < parts.length) {
            if (t) parts[S.editIdx] = t;
            else parts.splice(S.editIdx, 1);
            ch.body = parts.join('\n\n');
            await save();
          }
        }
        S.sheet = '';
        return render();
      }
      case 'export':
        S.sheet = '';
        render();
        return exportTxt();
      case 'tconfirm':
        return confirmItem(id);
      case 'confirm-all':
        S.story.timeline.forEach((t) => (t.status = 'confirmed'));
        await save();
        return render();
      case 'tdel':
        S.story.timeline = S.story.timeline.filter((t) => t.id !== id);
        markStaleFromItem(id);
        await save();
        return render();
      case 'tedit':
        return editTimeline(id);
      case 'sug-ok':
        return applySuggestion(id);
      case 'sug-no':
        S.story.pendingSuggestions = (S.story.pendingSuggestions || []).filter((g) => g.id !== id);
        await save();
        return render();
      case 'newchapter':
        S.chap = { mode: 'pick', picked: new Set(), pov: { mode: 'third', who: [] } };
        S.chapterId = '';
        return push('chapter');
      case 'chap-pick': {
        if (el.checked) S.chap.picked.add(el.dataset.id);
        else S.chap.picked.delete(el.dataset.id);
        return render();
      }
      case 'pov':
        S.chap.pov.mode = el.dataset.mode;
        if (S.chap.pov.mode === 'third') S.chap.pov.who = [];
        return render();
      case 'pov-who':
        if (el.checked) S.chap.pov.who.push(el.value);
        else S.chap.pov.who = S.chap.pov.who.filter((x) => x !== el.value);
        return render();
      case 'chap-gen':
        return genChapter();
      case 'openchap':
        S.chapterId = id;
        S.chap = { mode: 'read' };
        return push('chapter');
      case 'chap-final':
        return finalizeChapter();
      case 'chap-withdraw':
        return withdrawChapter();
      case 'chap-del':
        return deleteChapter();
      case 'chap-restore':
        return restoreChapter();
      case 'chap-regen':
        return regenChapter();
      case 'seslist':
        S.cardId = id;
        return push('seslist');
      case 'sesview':
        S.sessionId = id;
        S.readonly = true;
        return push('sesview');
      case 'sesview-exit':
        S.readonly = false;
        return back();
      case 'forge-start':
        return startForge();
      case 'forge-analyze':
        return forgeAnalyze();
      case 'forge-skip':
        S.forge.stage = 'rules';
        S.forge.read = [];
        return render();
      case 'forge-back-essay':
        S.forge.stage = 'essay';
        return render();
      case 'forge-back-rules':
        S.forge.stage = 'rules';
        return render();
      case 'forge-imitate':
        return forgeImitate();
      case 'forge-to-imitate':
        return forgeImitate();
      case 'forge-to-rank':
        if (S.forge.passages.length < 3) return;
        S.forge.stage = 'rank';
        S.forge.order = [];
        return render();
      case 'rank-pick': {
        const idx = Number(id);
        const pos = S.forge.order.indexOf(idx);
        if (pos >= 0) S.forge.order.splice(pos, 1);
        else if (S.forge.order.length < 4) S.forge.order.push(idx);
        return render();
      }
      case 'forge-revise':
        return forgeRevise();
      case 'forge-done':
        return forgeDone();
      case 'forge-save':
        return saveForge();
      case 'style-del':
        await S_.deleteStyle(id);
        S.styles = await S_.listStyles();
        return render();
      case 'test':
        return doTest();
      case 'import':
        return doImport();
      case 'theme':
        S.settings.theme = el.dataset.id;
        S_.saveSettings(S.settings);
        applyTheme(S.settings.theme);
        return render();
      case 'save-settings':
        return saveSettings();
      case 'book-menu':
        S.sheet = 'menu';
        return render();
      case 'rename-book': {
        const t = prompt('书名', S.story.title);
        if (t != null && t.trim()) {
          S.story.title = t.trim();
          await save();
        }
        S.sheet = '';
        return render();
      }
      case 'chg-style': {
        if (!S.styles.length) {
          S.sheet = '';
          toast('还没有文风');
          return;
        }
        const names = S.styles.map((w, i) => `${i + 1}. ${w.name}`).join('\n');
        const n = prompt('换哪份文风（填序号）\n' + names, '1');
        const i = parseInt(n, 10) - 1;
        if (i >= 0 && i < S.styles.length) {
          S.story.styleId = S.styles[i].id;
          S.style = S.styles[i];
          await save();
        }
        S.sheet = '';
        return render();
      }
      case 'del-book':
        if (confirm('删掉《' + S.story.title + '》？删了就找不回来。')) {
          await S_.deleteStory(S.story.id);
          S.stories = await S_.listStories();
          S.story = null;
          S.sheet = '';
          S.view = 'shelf';
          S.stack = [];
        }
        return render();
      default:
        return;
    }
  } catch (err) {
    S.err = err.message || String(err);
    render();
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'say') S.input = e.target.value;
});

$app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'inline-model') {
    if (S.story) {
      S.story.model = el.value;
      save();
    }
    toast('换成 ' + el.value);
  } else if (el.dataset.act === 'inline-effort') {
    S.settings.effort = el.value;
    S_.saveSettings(S.settings);
    const nm = (EFFORTS.find((x) => x.id === el.value) || {}).name || el.value;
    toast('推理等级：' + nm);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.key !== 'Enter' || e.shiftKey) return;
  const id = e.target && e.target.id;
  if (S.view === 'session' && id === 'say') {
    e.preventDefault();
    sendTurn();
  }
});

/* ---------------- 演绎逻辑 ---------------- */

async function sendTurn(text) {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess || S.busy) return;
  const content = (text != null ? text : S.input).trim();
  if (!content) return;
  const card = S.story.cards.find((c) => c.id === sess.cardId);

  S.input = '';
  S.busy = true;
  S.err = '';
  S.live = '';
  sess.messages.push({ role: 'user', content });
  render();

  try {
    const msgs = [
      { role: 'system', content: P.sessionSystem(S.story, card, S.style) },
      ...sess.messages.slice(-24).map((m) => ({ role: m.role, content: m.content })),
    ];
    const full = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: msgs,
      maxTokens: 800,
      temperature: 1.0,
      onDelta: (d, acc) => {
        S.live = acc;
        paintLive();
      },
    });
    S.live = '';
    const parsed = P.splitOut(full);
    sess.messages.push({ role: 'assistant', content: parsed.body.trim(), options: parsed.options });
    sess.savedAt = Date.now();
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

function paintLive() {
  const box = document.getElementById('stream');
  if (!box) return;
  let el = box.querySelector('.live');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ai live';
    const typing = box.querySelector('.typing');
    if (typing) typing.remove();
    box.appendChild(el);
  }
  el.innerHTML = String(P.splitOut(S.live).body)
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
  box.scrollTop = box.scrollHeight;
}

async function firstTurn() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess || sess.messages.length) return;
  const card = S.story.cards.find((c) => c.id === sess.cardId);
  S.busy = true;
  render();
  try {
    const full = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: [
        { role: 'system', content: P.sessionSystem(S.story, card, S.style) },
        { role: 'user', content: '开始。' },
      ],
      maxTokens: 600,
      onDelta: (d, acc) => {
        S.live = acc;
        paintLive();
      },
    });
    S.live = '';
    const parsed = P.splitOut(full);
    sess.messages.push({ role: 'assistant', content: parsed.body.trim(), options: parsed.options });
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

async function undoSession() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess || S.busy || !sess.messages.length) return;
  sess.messages.pop();
  if (sess.messages.length && sess.messages[sess.messages.length - 1].role === 'user') sess.messages.pop();
  S.err = '';
  S.live = '';
  await save();
  if (!sess.messages.length) return firstTurn();
  render();
}

async function regenSession() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  if (!sess || S.busy) return;
  if (!sess.messages.length) return firstTurn();
  if (sess.messages[sess.messages.length - 1].role === 'assistant') sess.messages.pop();
  if (!sess.messages.length) return firstTurn();
  const card = S.story.cards.find((c) => c.id === sess.cardId);
  S.busy = true;
  S.err = '';
  S.live = '';
  render();
  try {
    const msgs = [
      { role: 'system', content: P.sessionSystem(S.story, card, S.style) },
      ...sess.messages.slice(-24).map((m) => ({ role: m.role, content: m.content })),
    ];
    const full = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: msgs,
      maxTokens: 800,
      temperature: 1.05,
      onDelta: (d, acc) => {
        S.live = acc;
        paintLive();
      },
    });
    S.live = '';
    const parsed = P.splitOut(full);
    sess.messages.push({ role: 'assistant', content: parsed.body.trim(), options: parsed.options });
    sess.savedAt = Date.now();
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

async function exportTxt() {
  const s = S.story;
  if (!s) return;
  const lines = [`《${s.title || '我的故事'}》`, ''];
  const chs = (s.chapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (chs.length) {
    chs.forEach((c, i) => {
      lines.push(`第 ${i + 1} 章　${c.title || ''}`.trim(), '', String(c.body || ''), '');
    });
  } else {
    lines.push('（还没有成文的章节，这里先导出演绎记录）', '');
    (s.sessions || []).forEach((m) => {
      if (!m.messages || !m.messages.length) return;
      const card = (s.cards || []).find((c) => c.id === m.cardId);
      lines.push(`— ${card ? card.title : '一场演绎'} —`, '');
      m.messages.forEach((x) => lines.push(x.role === 'user' ? `我：${x.content}` : x.content, ''));
    });
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {}
  try {
    if (navigator.share && navigator.canShare) {
      const file = new File([text], `${s.title || '我的故事'}.txt`, { type: 'text/plain' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: s.title || '我的故事' });
        return;
      }
    }
  } catch (_) {}
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.title || '我的故事'}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出（也复制进剪贴板了）');
}

async function closeSession() {
  const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
  const card = S.story.cards.find((c) => c.id === sess.cardId);
  if (!sess.messages.length) {
    S.sheet = '';
    return render();
  }
  S.busy = true;
  S.sheet = '';
  render();
  try {
    const raw = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: P.timelineMessages(S.story, sess, card),
      json: true,
      maxTokens: 1500,
    });
    const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const base = S.story.timeline.length;
    (data.events || []).forEach((ev, i) => {
      S.story.timeline.push(
        S_.newTimelineItem({
          at: ev.at || '',
          title: ev.title || '',
          detail: ev.detail || '',
          cardId: card.id,
          sessionId: sess.id,
          status: 'pending',
          order: base + i,
        })
      );
    });
    (data.suggestions || []).forEach((g) => {
      S.story.pendingSuggestions = S.story.pendingSuggestions || [];
      S.story.pendingSuggestions.push({ id: S_.uid('g'), cardId: g.cardId, title: g.title || '', body: g.body || '', action: g.action || 'replace' });
    });
    sess.result = data.summary || '';
    sess.status = 'done';
    await save();
    S.view = 'book';
    S.tab = 'time';
    toast(`落了 ${(data.events || []).length} 条事件，等你确认`);
  } catch (err) {
    S.err = err.message || String(err);
    render();
  } finally {
    S.busy = false;
    render();
  }
}

async function confirmItem(id) {
  const t = S.story.timeline.find((x) => x.id === id);
  if (t) t.status = 'confirmed';
  await save();
  render();
}

function editTimeline(id) {
  const t = S.story.timeline.find((x) => x.id === id);
  const at = prompt('时间', t.at || '');
  if (at == null) return;
  const title = prompt('标题', t.title || '');
  if (title == null) return;
  const detail = prompt('发生了什么', t.detail || '');
  if (detail == null) return;
  const changed = at !== t.at || title !== t.title || detail !== t.detail;
  t.at = at;
  t.title = title;
  t.detail = detail;
  if (changed) markStaleFromItem(t.id);
  save().then(render);
  if (changed && staleCount()) toast(`${staleCount()} 章引用了这条，已标出来`);
}

async function applySuggestion(id) {
  const g = (S.story.pendingSuggestions || []).find((x) => x.id === id);
  if (g) {
    const c = (S.story.cards || []).find((x) => x.id === g.cardId);
    if (c) {
      if (g.action === 'append') c.body = (c.body || '') + '\n' + (g.body || '');
      else c.body = g.body || c.body;
    }
  }
  S.story.pendingSuggestions = (S.story.pendingSuggestions || []).filter((x) => x.id !== id);
  await save();
  render();
}

/* ---------------- 创作 ---------------- */

// 这一章用到的演绎原文（同一场只取一次）
function transcriptsFor(items) {
  const seen = new Set();
  const out = [];
  items.forEach((t) => {
    if (!t.sessionId || seen.has(t.sessionId)) return;
    seen.add(t.sessionId);
    const sess = (S.story.sessions || []).find((m) => m.id === t.sessionId);
    if (!sess) return;
    const card = S.story.cards.find((c) => c.id === sess.cardId);
    out.push(P.sessionTranscript(sess, card ? card.title : ''));
  });
  return { list: out, ids: Array.from(seen) };
}

// 上一章结尾，保持接续
function prevTailFor(ch) {
  const prev = (S.story.chapters || [])
    .filter((x) => x.id !== ch.id && (x.no || 0) < (ch.no || 0) && (x.body || '').trim())
    .sort((a, b) => (b.no || 0) - (a.no || 0))[0];
  return prev ? P.tailOf(prev.body) : '';
}

function revSnapshot() {
  const o = {};
  (S.story.cards || []).forEach((c) => (o[c.id] = c.rev || 1));
  return o;
}

async function genChapter() {
  const c = S.chap;
  const items = S.story.timeline
    .filter((t) => c.picked.has(t.id))
    .sort((a, b) => a.order - b.order);
  if (!items.length) return;
  const span = { from: items[0].at || '', to: items[items.length - 1].at || '' };
  S.busy = true;
  S.live = '';
  S.err = '';
  render();
  try {
    const tr = transcriptsFor(items);
    const ch = S_.newChapter({
      no: (S.story.chapters || []).length + 1,
      title: items[0].title || '未命名',
      span,
      pickedIds: items.map((t) => t.id),
      sourceSessions: tr.ids,
      baseRevs: revSnapshot(),
      pov: { ...c.pov, who: c.pov.who.slice() },
      status: 'draft',
    });
    S.story.chapters.push(ch);
    S.chapterId = ch.id;
    S.chap = { mode: 'read' };
    render();

    const full = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: P.chapterMessages(S.story, items, ch.pov, S.style, span, {
        transcripts: tr.list,
        prevTail: prevTailFor(ch),
      }),
      maxTokens: 4000,
      temperature: 1.0,
      onDelta: (d, acc) => {
        S.live = acc;
        const box = document.querySelector('.prose');
        if (box) {
          box.innerHTML = String(acc)
            .split(/\n+/)
            .filter(Boolean)
            .map((p) => `<p>${esc(p)}</p>`)
            .join('');
        }
      },
    });
    ch.body = full;
    S.live = '';
    await save();
    S.view = 'chapter';
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

async function regenChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch) return;
  const items = S.story.timeline.filter((t) => ch.pickedIds.includes(t.id)).sort((a, b) => a.order - b.order);
  const tr = transcriptsFor(items);
  S.busy = true;
  render();
  try {
    const full = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.story.model || S.settings.model,
      effort: S.settings.effort,
      messages: P.chapterMessages(S.story, items, ch.pov, S.style, ch.span, {
        transcripts: tr.list,
        prevTail: prevTailFor(ch),
      }),
      maxTokens: 4000,
      onDelta: (d, acc) => {
        S.live = acc;
        const box = document.querySelector('.prose');
        if (box) {
          box.innerHTML = String(acc)
            .split(/\n+/)
            .filter(Boolean)
            .map((p) => `<p>${esc(p)}</p>`)
            .join('');
        }
      },
    });
    if (ch.body) {
      ch.history = [{ body: ch.body, at: Date.now() }, ...(ch.history || [])].slice(0, 3);
    }
    ch.body = full;
    ch.stale = false;
    S.live = '';
    await save();
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    S.busy = false;
    render();
  }
}

async function finalizeChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch || !ch.body) return;
  ch.status = 'final';
  ch.stale = false;
  await save();
  S.view = 'book';
  S.tab = 'write';
  toast('已入书');
  render();
}

async function withdrawChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch) return;
  ch.status = 'draft';
  await save();
  toast('已从成书里撤回，可以接着改');
  render();
}

async function deleteChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch) return;
  if (!confirm(`删掉第 ${ch.no} 章「${ch.title}」？\n删了就找不回来。`)) return;
  S.story.chapters = (S.story.chapters || []).filter((x) => x.id !== ch.id);
  await save();
  back();
}

async function restoreChapter() {
  const ch = (S.story.chapters || []).find((x) => x.id === S.chapterId);
  if (!ch || !(ch.history || []).length) return;
  const old = ch.history[0];
  ch.history = [{ body: ch.body, at: Date.now() }, ...ch.history.slice(1)].slice(0, 3);
  ch.body = old.body;
  await save();
  toast('已换回上一稿');
  render();
}

/* ---------------- 文风提取（实验法：随笔 → 规则 → 仿写 → 排序 → 改规则） ---------------- */

function startForge() {
  S.forge = {
    style: S_.newStyle({ name: '我的文风' }),
    stage: 'essay',
    essay: '',
    read: [],
    rules: '',
    passages: [],
    order: [],
    note: '',
    round: 1,
    busy: false,
    live: '',
    name: '我的文风',
  };
  S.err = '';
  S.input = '';
  S.stack = ['shelf', 'styles'];
  S.view = 'forge';
  render();
}

const gv = (id, fallback) => {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
};

function paintForgeLive(text) {
  const el = document.getElementById('live');
  if (el) el.textContent = text;
}

async function forgeAnalyze() {
  const f = S.forge;
  if (!f || f.busy) return;
  f.essay = gv('essay', f.essay);
  if (String(f.essay).trim().length < 30) {
    toast('再写几句，至少三十个字');
    return;
  }
  f.busy = true;
  S.err = '';
  render();
  try {
    const out = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: analyzeMessages(f.essay),
      json: false,
      maxTokens: 1800,
      temperature: 0.7,
    });
    const got = parseAnalyze(out);
    f.read = got.read;
    f.rules = rulesToText(got.rules);
    if (!String(f.rules).trim()) throw new Error('这次没拆出规则来，再试一次，或者跳过去自己写。');
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
  f.rules = gv('forge-rules', f.rules);
  if (!String(f.rules).trim()) {
    toast('规则是空的');
    return;
  }
  f.busy = true;
  f.live = '';
  f.passages = [];
  f.order = [];
  S.err = '';
  f.stage = 'imitate';
  render();
  try {
    const out = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: imitateMessages(f.rules, ESSAY_MATERIAL),
      maxTokens: 1800,
      temperature: 0.95,
      onDelta: (d, full) => {
        f.live = full;
        paintForgeLive(full);
      },
    });
    const ps = parsePassages(out);
    if (ps.length < 3) throw new Error('四段没写全，再点一次。');
    f.passages = ps;
    f.live = '';
  } catch (err) {
    S.err = err.message || String(err);
    f.stage = 'rules';
  } finally {
    f.busy = false;
    render();
  }
}

async function forgeRevise() {
  const f = S.forge;
  if (!f || f.busy) return;
  if (f.order.length < 4) {
    toast('四段都要点一下');
    return;
  }
  f.note = gv('forge-note', f.note);
  f.busy = true;
  S.err = '';
  render();
  try {
    const out = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      effort: S.settings.effort,
      messages: reviseMessages(f.rules, f.passages, f.order, f.note),
      json: false,
      maxTokens: 1800,
      temperature: 0.5,
    });
    const rules = parseRules(out);
    if (!rules.length) throw new Error('这次没改出东西。规则还是上一版，可以直接敲定，或者再排一轮。');
    f.rules = rulesToText(rules);
    f.round += 1;
    f.passages = [];
    f.order = [];
    f.stage = 'rules';
    toast('规则改好了，再让它写一轮');
  } catch (err) {
    S.err = err.message || String(err);
  } finally {
    f.busy = false;
    render();
  }
}

function forgeDone() {
  const f = S.forge;
  if (!f) return;
  f.rules = gv('forge-rules', f.rules);
  if (!String(f.rules).trim()) {
    toast('还没有规则');
    return;
  }
  f.style.text = String(f.rules).trim();
  f.stage = 'done';
  render();
}

async function saveForge() {
  const f = S.forge;
  if (!f) return;
  f.rules = gv('forge-rules', f.rules);
  if (!String(f.rules).trim()) {
    toast('规则是空的');
    return;
  }
  f.style.text = String(f.rules).trim();
  f.style.name = String(gv('style-name', f.name) || '我的文风').trim() || '我的文风';
  f.style.chat = [];
  await S_.putStyle(f.style);
  S.styles = await S_.listStyles();
  S.forge = null;
  S.view = 'styles';
  S.stack = ['shelf'];
  toast('文风存好了');
  render();
}

/* ---------------- 设置逻辑 ---------------- */

async function doTest() {
  readSettingsInputs();
  S.testing = true;
  S.testMsg = '';
  render();
  try {
    await testConnection({ baseUrl: S.settings.baseUrl, apiKey: S.settings.apiKey, model: S.settings.model });
    S.testMsg = '通了。';
  } catch (err) {
    S.testMsg = err.message || String(err);
  } finally {
    S.testing = false;
    render();
  }
}

async function doImport() {
  readSettingsInputs();
  S.testing = true;
  render();
  try {
    const list = await listModels(S.settings.baseUrl, S.settings.apiKey);
    S.models = list;
    S.settings.models = list;
    S.settings.model = pickModel(list, S.settings.baseUrl);
    S_.saveSettings(S.settings);
    S.testMsg = `读到 ${list.length} 个模型。`;
  } catch (err) {
    S.testMsg = err.message || String(err);
  } finally {
    S.testing = false;
    render();
  }
}

function readSettingsInputs() {
  const b = document.getElementById('set-base');
  const k = document.getElementById('set-key');
  if (b) S.settings.baseUrl = b.value.trim().replace(/\/+$/, '');
  if (k) S.settings.apiKey = k.value.trim();
}

function saveSettings() {
  readSettingsInputs();
  const m = document.getElementById('set-model');
  if (m) S.settings.model = m.value;
  const ef = document.getElementById('set-effort');
  if (ef) S.settings.effort = ef.value;
  const boxes = Array.from(document.querySelectorAll('input[data-act=model]:checked')).map((x) => x.value);
  if (boxes.length) S.settings.models = boxes;
  S_.saveSettings(S.settings);
  toast('存好了');
}

/* ---------------- 后处理 ---------------- */

function afterRender() {
  const stream = document.getElementById('stream');
  if (stream) stream.scrollTop = stream.scrollHeight;
  if (S.view === 'session') {
    const sess = (S.story.sessions || []).find((m) => m.id === S.sessionId);
    if (sess && !sess.messages.length && !S.busy && !S.err) setTimeout(firstTurn, 60);
  }
}

document.addEventListener('click', (e) => {
  const mask = e.target.closest('.mask');
  if (mask && !e.target.closest('.sheet')) {
    S.sheet = '';
    render();
  }
});

boot();
