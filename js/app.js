// 我的故事 — 打开一本书就是正文
import * as S_ from './store.js';
import * as C from './corpus.js';
import * as G from './guard.js';
import * as E from './entry.js';
import * as F from './style-engine.js';
import { chat, streamChat, listModels, pickModel, testConnection } from './api.js';

/* ---------------- 基础设施 ---------------- */

const $app = document.getElementById('app');

window.__sfError = (where, err) => {
  const msg = (err && (err.stack || err.message)) || String(err);
  window.__sfLastError = where + '：' + msg;
  const el = document.getElementById('fatal');
  if (el) el.textContent = where + '：' + msg;
  console.error(where, err);
};
window.addEventListener('error', (e) => window.__sfError('页面出错', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => window.__sfError('未处理的异步错误', e.reason));

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const chars = (s) => String(s || '').replace(/\s/g, '').length;

const S = {
  ready: false,
  settings: null,
  stories: [],
  styles: [],
  story: null,
  style: null,
  view: 'shelf',
  stack: [],
  input: '',
  busy: false,
  err: '',
  live: '',
  drawer: '',
  menu: '',
  entry: null,
  forge: null,
  settings_msg: '',
  testMsg: '',
  models: [],
  chapter: '',
};

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 1800);
}

async function boot() {
  S.settings = S_.loadSettings();
  S.styles = await S_.listStyles().catch(() => []);
  S.stories = await S_.listStories().catch(() => []);
  const id = S_.loadCurrentId();
  if (id) {
    const st = await S_.getStory(id).catch(() => null);
    if (st) {
      S.story = S_.normalizeStory(st);
      S.style = S.styles.find((x) => x.id === S.story.styleId) || null;
      S.view = 'book';
    }
  }
  S.ready = true;
  render();
}

async function save() {
  if (!S.story) return;
  S.story.updatedAt = Date.now();
  await S_.putStory(S.story);
  S_.saveCurrentId(S.story.id);
}

const styleBrief = () => (S.style ? F.brief(S.style) : '');

/* ---------------- 渲染 ---------------- */

function render() {
  let html = '';
  try {
    if (!S.ready) html = '<div class="boot">打开中…</div>';
    else if (S.view === 'shelf') html = viewShelf();
    else if (S.view === 'book') html = viewBook();
    else if (S.view === 'entry') html = viewEntry();
    else if (S.view === 'forge') html = viewForge();
    else if (S.view === 'styles') html = viewStyles();
    else if (S.view === 'settings') html = viewSettings();
    else if (S.view === 'chapter') html = viewChapter();
    else html = viewShelf();
  } catch (e) {
    window.__sfError('渲染 ' + S.view, e);
    html = `<div class="wrap"><p class="err">这一页画不出来：${esc((e && e.message) || e)}</p></div>`;
  }
  $app.innerHTML = html + '<div id="fatal"></div><div id="toast"></div>';
  const inp = document.getElementById('say');
  if (inp && S.input) inp.value = S.input;
  if (S.story && S.view === 'book') {
    const p = document.getElementById('prose');
    if (p && !S.keepScroll) p.scrollTop = p.scrollHeight;
  }
  S.keepScroll = false;
}

function back() {
  S.story = null;
  S.view = 'shelf';
  S_.saveCurrentId('');
  render();
}

/* ---------------- 书架 ---------------- */

function viewShelf() {
  const rows = S.stories
    .map(
      (s) => `<button class="rowline" data-act="opentile" data-id="${esc(s.id)}">
        <b>${esc(s.title || '未命名')}</b>
        <span>${(s.corpus && s.corpus.paragraphs ? s.corpus.paragraphs.filter((p) => !p.folded).length : 0)} 段</span>
      </button>`
    )
    .join('');
  return `<div class="wrap">
    <header class="simple"><h1>我的故事</h1></header>
    <div class="shelfbody">
      ${rows || '<p class="dim">还没有书。</p>'}
    </div>
    <div class="row-btns">
      <button class="btn primary wide" data-act="entry-start">写一本新的</button>
    </div>
    <div class="row-btns">
      <button class="btn ghost" data-act="go-styles">文风 ${S.styles.length}</button>
      <button class="btn ghost" data-act="go-settings">设置</button>
    </div>
  </div>`;
}

/* ---------------- 正文（主屏） ---------------- */

function viewBook() {
  const st = S.story;
  if (!st) return viewShelf();
  const ps = C.liveParagraphs(st);
  const ob = C.openObligation(st);
  const need = ob ? ob.text : '';
  const body = ps
    .map((p) => {
      const cls = p.speaker === 'me' ? 'me' : p.status === 'violation' ? 'bad' : p.status === 'assumed' ? 'guess' : '';
      return `<p class="${cls}" data-para="${esc(p.id)}">${esc(p.text)}</p>`;
    })
    .join('');
  const live = S.live ? `<p class="live" id="live">${esc(S.live)}</p>` : '<p class="live" id="live"></p>';
  const menu = S.menu ? drawerMenu(S.menu) : '';
  const drawer = S.drawer ? drawerHTML() : '';
  return `<div class="book">
    <header class="bookhead">
      <button class="icon" data-act="back" title="书架">‹</button>
      <span class="bname">${esc(st.title)}</span>
      <button class="icon" data-act="drawer" data-id="people" title="人物">人</button>
      <button class="icon" data-act="drawer" data-id="facts" title="事实">实</button>
      <button class="icon" data-act="more" title="更多">⋯</button>
    </header>
    ${need ? `<div class="need">这一场还差：${esc(need)}</div>` : ''}
    <div class="prose" id="prose">${body || '<p class="dim">从这里开始写。</p>'}${live}</div>
    <footer class="composer">
      <input id="say" class="say" placeholder="我这一下……" value="${esc(S.input)}" autocomplete="off">
      <button class="btn primary saybtn" data-act="say" ${S.busy ? 'disabled' : ''}>${S.busy ? '…' : '写'}</button>
    </footer>
    <div class="wc">${C.wordCount(st)} 字</div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    ${drawer}${menu}
  </div>`;
}

function drawerMenu(id) {
  return `<div class="mask" data-act="menu-close">
    <div class="sheet" data-stop="1">
      <button class="sheetbtn" data-act="para-rewrite" data-id="${esc(id)}">重写这一段</button>
      <button class="sheetbtn" data-act="para-from" data-id="${esc(id)}">从这里重新来</button>
      <button class="sheetbtn" data-act="para-notmine" data-id="${esc(id)}">这段不像我写的</button>
      <button class="sheetbtn ghost" data-act="menu-close">取消</button>
    </div>
  </div>`;
}

function drawerHTML() {
  const st = S.story;
  const c = C.corpusOf(st);
  const tab = S.drawer;
  let body = '';
  if (tab === 'people') {
    body = c.people.length
      ? c.people
          .map(
            (p) => `<div class="drow"><b>${esc(p.name)}</b>
        <div class="dim">要：${esc(p.want || '—')}</div>
        <div class="dim">不肯说：${esc(p.secret || '—')}</div>
        <div class="dim">说话：${esc(p.voice || '—')}</div>
        ${(p.knows || []).length ? `<div class="dim">知道：${esc((p.knows || []).join('；'))}</div>` : ''}
      </div>`
          )
          .join('')
      : '<p class="dim">还没有人物。</p>';
  } else if (tab === 'facts') {
    const fs = C.liveFacts(st);
    body = fs.length ? fs.map((f) => `<div class="drow"><span>${esc(f.text)}</span></div>`).join('') : '<p class="dim">还没有成立的事实。</p>';
  } else if (tab === 'hard') {
    body =
      (c.hard.length ? c.hard.map((h) => `<div class="drow"><span>${esc(h.text)}</span><button class="icon" data-act="hard-del" data-id="${esc(h.id)}">×</button></div>`).join('') : '<p class="dim">还没有约束。</p>') +
      `<div class="drow"><input class="field" id="hard-new" placeholder="这里什么不可能发生"><button class="btn ghost" data-act="hard-add">加</button></div>`;
  } else if (tab === 'oblig') {
    body =
      (c.obligations.length
        ? c.obligations
            .map(
              (o) =>
                `<div class="drow"><span class="${o.state === 'open' ? '' : 'dim'}">${o.kind === 'must' ? '【必经】' : ''}${esc(o.text)}</span>${
                  o.state === 'open' ? `<button class="icon" data-act="ob-done" data-id="${esc(o.id)}">✓</button>` : '<span class="dim">已了</span>'
                }</div>`
            )
            .join('')
        : '<p class="dim">还没有义务。</p>') +
      `<div class="drow"><input class="field" id="ob-new" placeholder="这一场还差什么"><button class="btn ghost" data-act="ob-add">加</button></div>`;
  } else {
    body = `<div class="drow"><input class="field" id="book-title" value="${esc(st.title)}"><button class="btn ghost" data-act="rename">改名</button></div>
      <div class="drow"><button class="btn ghost wide" data-act="go-chapter">看整本</button></div>
      <div class="drow"><button class="btn ghost wide" data-act="export">导出 txt</button></div>
      <div class="drow"><button class="btn ghost wide" data-act="go-forge">文风</button></div>
      <div class="drow"><button class="btn ghost wide" data-act="go-settings">设置</button></div>`;
  }
  return `<div class="mask" data-act="drawer-close">
    <aside class="drawer" data-stop="1">
      <div class="dtabs">
        ${['people', 'facts', 'hard', 'oblig', 'more']
          .map((k) => `<button class="dtab ${tab === k ? 'on' : ''}" data-act="drawer" data-id="${k}">${
            { people: '人物', facts: '事实', hard: '约束', oblig: '义务', more: '更多' }[k]
          }</button>`)
          .join('')}
      </div>
      <div class="dbody">${body}</div>
    </aside>
  </div>`;
}

/* ---------------- 启动向导 ---------------- */

function viewEntry() {
  const e = S.entry || (S.entry = { step: 1, pack: '', entry: '', answer: '', dislike: '', extraHard: '', busy: false, err: '' });
  const pack = E.packById(e.pack);
  if (e.step === 1) {
    return `<div class="wrap">
      <header class="simple"><button class="icon" data-act="go-shelf">‹</button><h1>写什么题材</h1></header>
      <p class="dim">不确定也没关系，先挑一个最像的。</p>
      <div class="packs">${E.PACKS.map(
        (p) => `<button class="pack" data-act="entry-pack" data-id="${p.id}"><b>${p.name}</b><span>${p.hint}</span></button>`
      ).join('')}</div>
    </div>`;
  }
  if (e.step === 2) {
    return `<div class="wrap">
      <header class="simple"><button class="icon" data-act="entry-back">‹</button><h1>${pack.name}</h1></header>
      <p class="dim">这些是这个世界里不可能发生的事。有不一样的可以改。</p>
      <ul class="hardlist">${pack.hard.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <input class="field" id="entry-hard" placeholder="要补一条不同意的？可以留空" value="${esc(e.extraHard)}">
      <div class="row-btns"><button class="btn primary wide" data-act="entry-next">下一步</button></div>
    </div>`;
  }
  if (e.step === 3) {
    return `<div class="wrap">
      <header class="simple"><button class="icon" data-act="entry-back">‹</button><h1>从哪儿开始</h1></header>
      <p class="dim">哪个答得上来就答哪个，一个就够。</p>
      ${E.ENTRIES.map(
        (x) => `<div class="entryone">
          <button class="btn ghost wide ${e.entry === x.id ? 'on' : ''}" data-act="entry-pick" data-id="${x.id}">${x.label}</button>
          ${e.entry === x.id ? `<p class="ask">${x.ask}</p><textarea class="field" id="entry-answer" rows="3" placeholder="${esc(x.placeholder)}">${esc(e.answer)}</textarea>` : ''}
        </div>`
      ).join('')}
      <p class="ask">还有一句（可以不填）：这个题材里你最受不了什么？</p>
      <input class="field" id="entry-dislike" placeholder="例：最受不了主角一开局就无敌" value="${esc(e.dislike)}">
      <div class="row-btns"><button class="btn primary wide" data-act="entry-go" ${e.busy ? 'disabled' : ''}>${e.busy ? '正在起头…' : '开始写'}</button></div>
      ${e.err ? `<div class="err">${esc(e.err)}</div>` : ''}
    </div>`;
  }
  return '';
}

async function entryGo() {
  const e = S.entry;
  e.answer = (document.getElementById('entry-answer') || {}).value || '';
  e.dislike = (document.getElementById('entry-dislike') || {}).value || '';
  if (!e.entry) {
    e.err = '先挑一个：一个画面 / 一个处境 / 一个人。';
    render();
    return;
  }
  if (!String(e.answer).trim()) {
    e.err = '填一句就行，不用完整。';
    render();
    return;
  }
  e.busy = true;
  e.err = '';
  render();
  try {
    const raw = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      messages: E.seedMessages({ packId: e.pack, entryId: e.entry, answer: e.answer, dislike: e.dislike, extraHard: e.extraHard }),
      json: true,
      maxTokens: 1200,
      effort: S.settings.effort,
    });
    const seed = E.parseSeed(raw);
    if (!seed) throw new Error('这次没写出开头，再点一次。');
    const st = S_.newStory(seed.title);
    st.entry = { pack: e.pack, entry: e.entry };
    C.normalizeCorpus(st);
    seed.hard.forEach((h) => C.addHard(st, h, 'pack'));
    C.addPerson(st, { ...seed.person, from: 'seed' });
    if (seed.need) {
      const ob = C.addObligation(st, seed.need, 'todo');
      const sc = C.curScene(st);
      if (sc) sc.obligationId = ob.id;
    }
    C.appendParagraph(st, { text: seed.opening, speaker: 'ai' });
    S.stories.unshift(st);
    await S_.putStory(st);
    S.story = st;
    S.style = S.styles.find((x) => x.id === st.styleId) || null;
    S.entry = null;
    S.view = 'book';
    S_.saveCurrentId(st.id);
  } catch (err) {
    e.err = (err && err.message) || '出错了';
  }
  e.busy = false;
  render();
}

/* ---------------- 写作流水线 ---------------- */

async function check(text) {
  try {
    const raw = await chat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      messages: G.guardMessages(S.story, text),
      json: true,
      maxTokens: 700,
      effort: 'off',
    });
    return G.parseGuard(raw);
  } catch (e) {
    return { ok: true, issues: [], facts: [], knows: {}, done: false, skipped: true };
  }
}

function paintLive() {
  const el = document.getElementById('live');
  if (el) el.textContent = S.live;
  const box = document.getElementById('prose');
  if (box) box.scrollTop = box.scrollHeight;
}

function applySediment(v, paragraphId) {
  (v.facts || []).forEach((f) => C.addFact(S.story, f, paragraphId));
  Object.entries(v.knows || {}).forEach(([name, list]) => list.forEach((k) => C.addKnows(S.story, name, k)));
  if (v.done) {
    const ob = C.openObligation(S.story);
    if (ob) C.settleObligation(S.story, ob.id, 'done');
    C.closeScene(S.story, 'done');
    C.addScene(S.story, {});
  }
}

async function actSend(text) {
  const t = String(text || '').trim();
  if (!t || S.busy || !S.story) return;
  if (!S.settings.apiKey) {
    S.err = '还没有填密钥，去设置里填一下。';
    render();
    return;
  }
  S.busy = true;
  S.err = '';
  S.live = '';
  C.appendParagraph(S.story, { text: t, speaker: 'me' });
  render();
  try {
    const brief = styleBrief();
    let out = await streamChat({
      baseUrl: S.settings.baseUrl,
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      messages: [{ role: 'system', content: C.trunkSystem(S.story, brief) }, ...C.trunkMessages(S.story, t, brief)],
      maxTokens: 900,
      effort: S.settings.effort,
      onDelta: (d) => {
        S.live += d;
        paintLive();
      },
    });
    let v = await check(out);
    if (v.issues.length) {
      S.live = '';
      S.keepScroll = false;
      render();
      try {
        out = await streamChat({
          baseUrl: S.settings.baseUrl,
          apiKey: S.settings.apiKey,
          model: S.settings.model,
          messages: [
            { role: 'system', content: C.trunkSystem(S.story, brief) },
            ...C.trunkMessages(S.story, t, brief),
            { role: 'user', content: G.rewriteHint(v.issues) },
          ],
          maxTokens: 900,
          effort: S.settings.effort,
          onDelta: (d) => {
            S.live += d;
            paintLive();
          },
        });
        v = await check(out);
      } catch (e) {
        /* 重写失败就落第一版 */
      }
    }
    const p = C.appendParagraph(S.story, {
      text: out,
      speaker: 'ai',
      status: v.issues.length ? 'violation' : 'ok',
      note: v.issues.map((i) => G.ISSUE_KINDS[i.kind]).join(' / '),
    });
    applySediment(v, p.id);
    await save();
  } catch (e) {
    S.err = (e && e.message) || '这一段没写出来';
  }
  S.busy = false;
  S.live = '';
  render();
}

async function rewriteParagraph(id) {
  const st = S.story;
  const ps = C.liveParagraphs(st);
  const idx = ps.findIndex((p) => p.id === id);
  if (idx < 0) return;
  // 找到这一段之前最近的一句「我」
  let mine = '';
  for (let i = idx; i >= 0; i -= 1) {
    if (ps[i].speaker === 'me') {
      mine = ps[i].text;
      break;
    }
  }
  const target = ps[idx];
  const from = target.speaker === 'me' ? target.id : target.id;
  C.rollbackFrom(st, from);
  if (target.speaker === 'me') {
    S.busy = false;
    render();
    await actSend(mine);
  } else {
    render();
    await actSend(mine || '接着写');
  }
}

/* ---------------- 文风 / 设置 / 章节 ---------------- */

function viewStyles() {
  const rows = S.styles
    .map((w) => `<button class="rowline" data-act="style-open" data-id="${esc(w.id)}"><b>${esc(w.name)}</b><span>${esc(F.describe(w))}</span></button>`)
    .join('');
  return `<div class="wrap">
    <header class="simple"><button class="icon" data-act="go-shelf">‹</button><h1>文风</h1></header>
    ${rows || '<p class="dim">还没有文风。</p>'}
    <div class="row-btns"><button class="btn primary wide" data-act="forge-start">提取一份新文风</button></div>
  </div>`;
}

function viewSettings() {
  const s = S.settings;
  const models = (s.models || []).map((m) => `<label class="chk"><input type="checkbox" data-model="${esc(m)}" ${m === s.model ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('');
  return `<div class="wrap">
    <header class="simple"><button class="icon" data-act="go-shelf">‹</button><h1>设置</h1></header>
    <div class="panel">
      <div class="seclabel">接口</div>
      <input class="field" id="set-base" value="${esc(s.baseUrl)}">
      <input class="field" id="set-key" type="password" placeholder="密钥" value="${esc(s.apiKey)}">
      <div class="row-btns"><button class="btn ghost" data-act="test">测一下</button><button class="btn ghost" data-act="loadmodels">读取模型</button></div>
      <div class="dim">${esc(S.testMsg || '')}</div>
    </div>
    <div class="panel">
      <div class="seclabel">可用模型</div>
      ${models || '<p class="dim">先读取模型。</p>'}
      <div class="seclabel">推理等级</div>
      <select class="field" id="set-effort">
        <option value="off" ${s.effort === 'off' ? 'selected' : ''}>关 —— 不发这个参数，最快</option>
        <option value="low" ${s.effort === 'low' ? 'selected' : ''}>低</option>
        <option value="medium" ${s.effort === 'medium' ? 'selected' : ''}>中</option>
        <option value="high" ${s.effort === 'high' ? 'selected' : ''}>高</option>
      </select>
    </div>
    <div class="row-btns"><button class="btn primary wide" data-act="save-settings">保存</button></div>
  </div>`;
}

function viewChapter() {
  const st = S.story;
  const ps = C.liveParagraphs(st);
  return `<div class="wrap">
    <header class="simple"><button class="icon" data-act="back-book">‹</button><h1>${esc(st.title)}</h1></header>
    <div class="prose read">${ps.map((p) => `<p>${esc(p.text)}</p>`).join('') || '<p class="dim">还没有正文。</p>'}</div>
    <div class="row-btns"><button class="btn ghost wide" data-act="export">导出 txt</button></div>
  </div>`;
}

/* ---------------- 事件 ---------------- */

function handler(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const stop = e.target.closest('[data-stop]');
  if (act === 'drawer-close' || act === 'menu-close') {
    if (stop && e.target.closest('[data-stop]') && !e.target.closest('[data-act="drawer-close"],[data-act="menu-close"]')) return;
  }
  switch (act) {
    case 'back':
      S_.saveCurrentId('');
      S.view = 'shelf';
      S.story = null;
      return render();
    case 'go-shelf':
      S.view = 'shelf';
      return render();
    case 'back-book':
      S.view = 'book';
      return render();
    case 'opentile':
      return openTile(id);
    case 'drawer':
      S.drawer = S.drawer === id ? '' : id;
      return render();
    case 'drawer-close':
      S.drawer = '';
      return render();
    case 'menu':
      S.menu = id || '';
      return render();
    case 'menu-close':
      S.menu = '';
      return render();
    case 'say':
      return doSay();
    case 'entry-start':
      S.entry = { step: 1, pack: '', entry: '', answer: '', dislike: '', extraHard: '', busy: false, err: '' };
      S.view = 'entry';
      return render();
    case 'entry-pack':
      S.entry.pack = id;
      S.entry.step = 2;
      return render();
    case 'entry-back':
      S.entry.step = Math.max(1, S.entry.step - 1);
      return render();
    case 'entry-next':
      S.entry.extraHard = (document.getElementById('entry-hard') || {}).value || '';
      S.entry.step = 3;
      return render();
    case 'entry-pick':
      S.entry.entry = id;
      S.entry.answer = '';
      return render();
    case 'entry-go':
      return entryGo();
    case 'go-styles':
      S.view = 'styles';
      return render();
    case 'go-settings':
      S.view = 'settings';
      S.testMsg = '';
      return render();
    case 'go-chapter':
      S.drawer = '';
      S.view = 'chapter';
      return render();
    case 'go-forge':
      S.drawer = '';
      S.view = 'forge';
      return render();
    case 'para-rewrite':
      S.menu = '';
      return rewriteParagraph(id);
    case 'para-from':
      S.menu = '';
      C.rollbackFrom(S.story, id);
      save();
      return render();
    case 'para-notmine':
      S.menu = '';
      toast('记下了：这一段不算你的。');
      return render();
    case 'rename': {
      const v = (document.getElementById('book-title') || {}).value || '';
      if (v.trim()) S.story.title = v.trim();
      save();
      return render();
    }
    case 'hard-add': {
      const v = (document.getElementById('hard-new') || {}).value || '';
      if (v.trim()) C.addHard(S.story, v);
      save();
      return render();
    }
    case 'hard-del':
      S.story.corpus.hard = C.corpusOf(S.story).hard.filter((h) => h.id !== id);
      save();
      return render();
    case 'ob-add': {
      const v = (document.getElementById('ob-new') || {}).value || '';
      if (v.trim()) C.addObligation(S.story, v);
      save();
      return render();
    }
    case 'ob-done':
      C.settleObligation(S.story, id, 'done');
      save();
      return render();
    case 'export':
      return exportTxt();
    case 'test':
      return doTest();
    case 'loadmodels':
      return doLoadModels();
    case 'save-settings':
      return doSaveSettings();
    case 'forge-start':
      S.view = 'forge';
      return startForge();
    case 'style-open': {
      S.style = S.styles.find((x) => x.id === id) || null;
      if (S.story) {
        S.story.styleId = S.style ? S.style.id : '';
        save();
      }
      toast(S.style ? '用上这份文风了' : '取消了文风');
      return render();
    }
    default:
      return undefined;
  }
}

async function openTile(id) {
  const st = await S_.getStory(id);
  if (!st) return;
  S.story = S_.normalizeStory(st);
  S.style = S.styles.find((x) => x.id === S.story.styleId) || null;
  S.view = 'book';
  S_.saveCurrentId(S.story.id);
  render();
}

function doSay() {
  const el = document.getElementById('say');
  const v = el ? el.value : S.input;
  S.input = '';
  if (!String(v || '').trim()) return undefined;
  return actSend(v);
}

async function doTest() {
  doSaveSettings(true);
  S.testMsg = '正在连…';
  render();
  try {
    const r = await testConnection(S.settings);
    S.testMsg = r;
  } catch (e) {
    S.testMsg = (e && e.message) || '连不上';
  }
  render();
}

async function doLoadModels() {
  doSaveSettings(true);
  S.testMsg = '正在读取…';
  render();
  try {
    const list = await listModels(S.settings.baseUrl, S.settings.apiKey);
    S.settings = S_.saveSettings({ models: list, model: pickModel(list, S.settings.baseUrl) });
    S.testMsg = `读到 ${list.length} 个模型。`;
  } catch (e) {
    S.testMsg = (e && e.message) || '读不到';
  }
  render();
}

function doSaveSettings(quiet) {
  const base = document.getElementById('set-base');
  const key = document.getElementById('set-key');
  const eff = document.getElementById('set-effort');
  const patch = {};
  if (base) patch.baseUrl = base.value.trim() || S.settings.baseUrl;
  if (key) patch.apiKey = key.value.trim() || S.settings.apiKey;
  if (eff) patch.effort = eff.value;
  S.settings = S_.saveSettings(patch);
  if (!quiet) {
    S.testMsg = '存好了。';
    render();
  }
}

function exportTxt() {
  const ps = C.liveParagraphs(S.story);
  const txt = S.story.title + '\n\n' + ps.map((p) => p.text).join('\n\n');
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.story.title || '小说') + '.txt';
  a.click();
  toast('导出好了');
}

/* ---------------- 文风提取（五步，原样保留） ---------------- */

function startForge() {
  S.forge = { stage: 'essay', essay: '', read: [], rules: '', passages: [], order: [], note: '', name: '我的文风', busy: false, live: '', progress: '' };
  S.err = '';
  S.view = 'forge';
  render();
}

const val = (id, dflt) => {
  const el = document.getElementById(id);
  return el ? el.value : dflt;
};

function viewForge() {
  const f = S.forge;
  if (!f) return viewStyles();
  const steps = ['写一段', '看规则', '让它写', '排个序', '存下来'];
  const bar = `<div class="fsteps">${steps.map((s, i) => `<span class="${(f.stage === ['essay', 'rules', 'imitate', 'rank', 'done'][i]) ? 'on' : ''}">${s}</span>`).join('')}</div>`;
  let body = '';
  if (f.stage === 'essay') {
    body = `<div class="panel">
      <div class="seclabel">先写一小段</div>
      <div class="dim">不用完整，不用讲究。写你平时会写的那样，三五句就够。</div>
      <div class="matbox"><div class="dim">就写这个</div><div>${esc(F.ESSAY_MATERIAL)}</div></div>
      <textarea class="field" id="essay" rows="9" placeholder="从这一句往下写，写到你自然停下来为止。">${esc(f.essay || '')}</textarea>
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="forge-skip">跳过去</button><button class="btn primary" data-act="forge-analyze" ${f.busy ? 'disabled' : ''}>让它看</button></div>`;
  } else if (f.stage === 'rules') {
    body = `<div class="panel">
      <div class="seclabel">它读到的</div>
      ${(f.read || []).map((x) => `<p class="dim">— ${esc(x)}</p>`).join('')}
      <div class="seclabel">写作规则</div>
      <div class="dim">这几条可以直接改。以后写小说，叙述就按这几条来。</div>
      <textarea class="field" id="forge-rules" rows="11">${esc(f.rules || '')}</textarea>
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="forge-back-essay">回去重写</button><button class="btn primary" data-act="forge-imitate" ${f.busy ? 'disabled' : ''}>让它照这个写四段</button></div>`;
  } else if (f.stage === 'imitate') {
    body = `<div class="panel">
      <div class="seclabel">它照规则写的四段</div>
      <div class="dim">同一个材料，四种写法。等下你要把它们从最差排到最好。</div>
      ${f.busy ? `<div class="dim">${esc(f.progress || '正在写…')}</div><div class="live" id="live">${esc(f.live || '')}</div>` : ''}
      ${!f.busy && f.passages.length ? f.passages.map((p, i) => `<div class="passage"><b>${i + 1}</b><p>${esc(p)}</p></div>`).join('') : ''}
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="forge-back-rules">规则不对，回去改</button><button class="btn primary" data-act="forge-to-rank" ${f.busy || f.passages.length < 3 ? 'disabled' : ''}>排一下序</button></div>`;
  } else if (f.stage === 'rank') {
    const sum = f.order.map((i) => i + 1).join(' → ');
    body = `<div class="panel">
      <div class="seclabel">从最差排到最好</div>
      <div class="dim">依次点四段。第一下＝最差，第四下＝最好。点错了再点一下取消。</div>
      ${f.order.length ? `<div class="ordersum">你排的：${esc(sum)}（${f.order.length}/4）</div>` : ''}
      ${f.passages.map((p, i) => {
        const pos = f.order.indexOf(i);
        return `<div class="pickcard ${pos >= 0 ? 'picked' : ''}" data-act="rank-pick" data-id="${i}">
          <b>${i + 1}</b>${pos >= 0 ? `<em>${pos + 1}</em>` : ''}<p>${esc(p)}</p></div>`;
      }).join('')}
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="forge-to-imitate">再写四段</button><button class="btn primary" data-act="forge-revise" ${f.busy || f.order.length < 4 ? 'disabled' : ''}>按这个改规则</button></div>`;
  } else {
    body = `<div class="panel">
      <div class="seclabel">存成一份文风</div>
      <input class="field" id="forge-name" value="${esc(f.name)}">
      <textarea class="field" id="forge-final" rows="12">${esc(f.rules || '')}</textarea>
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="forge-to-rank">回去再排一次</button><button class="btn primary" data-act="forge-done">存成一份文风</button></div>`;
  }
  return `<div class="wrap"><header class="simple"><button class="icon" data-act="go-shelf">‹</button><h1>提取我的文风</h1></header>${bar}${body}${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}</div>`;
}

async function forgeAnalyze() {
  const f = S.forge;
  if (!f || f.busy) return;
  f.essay = val('essay', f.essay);
  if (String(f.essay).trim().length < 30) {
    S.err = '再写几句，至少三十个字。写你平时会写的那样就行，不用完整。';
    return render();
  }
  S.err = '';
  f.busy = true;
  render();
  try {
    const raw = await chat({ baseUrl: S.settings.baseUrl, apiKey: S.settings.apiKey, model: S.settings.model, messages: F.analyzeMessages(f.essay), json: false, maxTokens: 1200 });
    const got = F.parseAnalyze(raw);
    f.read = got.read;
    f.rules = got.text || F.rulesToText(got.rules);
    f.stage = 'rules';
  } catch (e) {
    S.err = (e && e.message) || '没读出来';
  }
  f.busy = false;
  render();
}

async function forgeImitate() {
  const f = S.forge;
  if (!f || f.busy) return;
  f.rules = val('forge-rules', f.rules);
  f.busy = true;
  f.passages = [];
  f.progress = '正在写第 1 / 4 段…';
  f.stage = 'imitate';
  render();
  try {
    for (let i = 0; i < 4; i += 1) {
      f.progress = `正在写第 ${i + 1} / 4 段…`;
      f.live = '';
      render();
      try {
        const p = await chat({ baseUrl: S.settings.baseUrl, apiKey: S.settings.apiKey, model: S.settings.model, messages: F.imitateOneMessages(f.rules, F.ESSAY_MATERIAL, i), json: false, maxTokens: 1200 });
        const t = String(p || '').trim();
        if (t) f.passages.push(t);
      } catch (e) {
        /* 单段失败不毁全部 */
      }
    }
    if (f.passages.length < 3) S.err = '有几段没写出来。再点一次，或者把规则改短一点。';
  } catch (e) {
    S.err = (e && e.message) || '没写出来';
  }
  f.busy = false;
  f.progress = '';
  render();
}

async function forgeRevise() {
  const f = S.forge;
  if (!f || f.busy) return;
  f.busy = true;
  render();
  try {
    const raw = await chat({ baseUrl: S.settings.baseUrl, apiKey: S.settings.apiKey, model: S.settings.model, messages: F.reviseMessages(f.rules, f.passages, f.order, f.note), json: false, maxTokens: 1200 });
    const next = F.cleanRules(raw);
    if (next) f.rules = next;
    f.stage = 'done';
  } catch (e) {
    S.err = (e && e.message) || '没改成';
  }
  f.busy = false;
  render();
}

async function forgeDone() {
  const f = S.forge;
  const name = (val('forge-name', f.name) || '我的文风').trim();
  const text = val('forge-final', f.rules) || '';
  const st = S_.newStyle({ name, text });
  st.text = text;
  await S_.putStyle(st);
  S.styles = await S_.listStyles();
  S.forge = null;
  S.view = 'styles';
  render();
}

/* ---------------- 起 ---------------- */

$app.addEventListener('click', (e) => {
  try {
    const r = handler(e);
    if (r && r.catch) r.catch((err) => window.__sfError('点击出错', err));
  } catch (err) {
    window.__sfError('点击出错', err);
  }
});

$app.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'say') S.input = e.target.value;
});

$app.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'say' && e.key === 'Enter') {
    e.preventDefault();
    const v = e.target.value;
    e.target.value = '';
    S.input = '';
    actSend(v);
  }
});

$app.addEventListener('pointerdown', (e) => {
  const p = e.target.closest('[data-para]');
  if (!p) return;
  clearTimeout(longPress._t);
  longPress._t = setTimeout(() => {
    S.menu = p.dataset.para;
    render();
  }, 520);
});
$app.addEventListener('pointerup', () => clearTimeout(longPress._t));
$app.addEventListener('pointercancel', () => clearTimeout(longPress._t));
const longPress = { _t: 0 };

boot().catch((e) => window.__sfError('启动', e));
