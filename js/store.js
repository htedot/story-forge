// 本地存储：IndexedDB 存书与文风；localStorage 存设置与当前书。

import { normalizeCorpus } from './corpus.js';

const DB_NAME = 'storyforge';
const DB_VERSION = 3;

// 五种卡。single 表示一部书只能有一张。
export const CARD_KINDS = {
  world: {
    name: '世界观',
    single: true,
    hint: '这个世界怎么运作、谁在什么位置、现在是什么局面。',
    sections: ['世界规则', '地理与社会', '势力', '当下局势'],
  },
  outline: {
    name: '大纲',
    single: true,
    hint: '主干和场面走向。事件是它的组成单元，会投影到时间轴上。',
    sections: ['主干', '分场要点'],
  },
  narrative: {
    name: '叙事形式',
    single: false,
    hint: '一本书可以有几套讲法：视角、时态、声音、体例。写章节时挑一套。',
    sections: ['视角与距离', '时态与人称', '声音层次', '体例'],
  },
  setting: {
    name: '设定',
    single: false,
    hint: '一条具体的设定：一个制度、一个地方、一件东西、一条规矩。',
    sections: ['是什么', '怎么运作', '代价与限制', '牵扯到谁'],
  },
  character: {
    name: '角色',
    single: false,
    hint: '一个人：他是谁、要什么、不肯说什么、怎么说话。',
    sections: ['是谁', '想要什么', '不肯说的', '说话方式'],
  },
};

export const KIND_ORDER = ['world', 'outline', 'narrative', 'setting', 'character'];

const uid = (p = 'x') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

export function newCard(kind, title) {
  const def = CARD_KINDS[kind] || CARD_KINDS.setting;
  const card = {
    id: uid('c'),
    kind: CARD_KINDS[kind] ? kind : 'setting',
    title: title || def.name,
    sections: def.sections.map((label) => ({ label, text: '' })),
    at: Date.now(),
  };
  if (card.kind === 'outline') card.events = [];
  return card;
}

export function newEvent(title, when, summary) {
  return { id: uid('e'), title: title || '', when: when || '', summary: summary || '', done: false };
}

export function newStory(title) {
  const now = Date.now();
  return {
    id: uid('s'),
    title: title || '未命名',
    createdAt: now,
    updatedAt: now,
    styleId: '',
    cards: [newCard('world'), newCard('outline')],
    sessions: [],
    patches: [],
    chapters: [],
  };
}

export function newSession(cardId, cardKind) {
  return { id: uid('t'), cardId, cardKind, at: Date.now(), msgs: [], options: [], closed: false, patchId: '' };
}

export function newChapter() {
  return { id: uid('h'), title: '', eventIds: [], narrativeId: '', body: '', status: 'draft', at: Date.now(), history: [] };
}

/* ---------------- 查询辅助 ---------------- */

export const cardsOf = (story, kind) => (story.cards || []).filter((c) => c.kind === kind);
export const cardById = (story, id) => (story.cards || []).find((c) => c.id === id) || null;
export const outlineOf = (story) => cardsOf(story, 'outline')[0] || null;
export const worldOf = (story) => cardsOf(story, 'world')[0] || null;
export const eventsOf = (story) => {
  const o = outlineOf(story);
  return o && Array.isArray(o.events) ? o.events : [];
};
export const sessOf = (story, id) => (story.sessions || []).find((s) => s.id === id) || null;

export function cardText(card) {
  if (!card) return '';
  if (Array.isArray(card.sections)) {
    return card.sections.map((s) => (s.text || '').trim() ? `${s.label}：${s.text.trim()}` : '').filter(Boolean).join('\n');
  }
  return String(card.text || '');
}

export function addCard(story, kind, title) {
  const def = CARD_KINDS[kind] || CARD_KINDS.setting;
  if (def.single && cardsOf(story, kind).length >= 1) return cardsOf(story, kind)[0];
  const card = newCard(kind, title);
  story.cards.push(card);
  story.updatedAt = Date.now();
  return card;
}

export function removeCard(story, id) {
  const card = cardById(story, id);
  if (!card) return;
  if (CARD_KINDS[card.kind] && CARD_KINDS[card.kind].single) return; // 单例卡不给删
  story.cards = story.cards.filter((c) => c.id !== id);
  story.sessions = (story.sessions || []).filter((s) => s.cardId !== id);
  story.chapters = (story.chapters || []).filter((h) => h.narrativeId !== id);
  story.updatedAt = Date.now();
}

/* ---------------- 旧数据兼容 ---------------- */

function blankStory() {
  return newStory('未命名');
}

export function normalizeStory(raw) {
  if (!raw) return blankStory();
  const story = Object.assign(blankStory(), raw);
  story.cards = Array.isArray(raw.cards) ? raw.cards : [];
  story.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  story.patches = Array.isArray(raw.patches) ? raw.patches : [];
  story.chapters = Array.isArray(raw.chapters) ? raw.chapters : [];

  const migrated = [];
  let outlineEvents = [];
  for (const c of story.cards) {
    if (!c || typeof c !== 'object') continue;
    let kind = c.kind === 'background' ? 'setting' : c.kind;
    if (!CARD_KINDS[kind]) kind = 'setting';
    if (Array.isArray(c.sections) && c.sections.length) {
      migrated.push({ id: c.id || uid('c'), kind, title: c.title || CARD_KINDS[kind].name, sections: c.sections, at: c.at || Date.now(), events: Array.isArray(c.events) ? c.events : (kind === 'outline' ? [] : undefined) });
    } else {
      const text = c.detail || c.text || c.body || '';
      migrated.push({
        id: c.id || uid('c'),
        kind,
        title: c.title || CARD_KINDS[kind].name,
        sections: CARD_KINDS[kind].sections.map((label, i) => ({ label, text: i === 0 ? String(text) : '' })),
        at: c.at || Date.now(),
        events: kind === 'outline' ? (Array.isArray(c.events) ? c.events : []) : undefined,
      });
    }
  }

  // 旧时间轴里的条目并进大纲的事件链
  if (Array.isArray(raw.timeline)) {
    outlineEvents = raw.timeline
      .filter((it) => it && (it.title || it.summary || it.text))
      .map((it) => ({ id: it.id || uid('e'), title: it.title || '', when: it.when || '', summary: it.summary || it.text || '', done: !!it.done }));
  }

  story.cards = migrated;

  // 单例卡必须存在
  for (const kind of ['world', 'outline']) {
    if (!cardsOf(story, kind).length) story.cards.unshift(newCard(kind));
  }
  const ol = outlineOf(story);
  if (!Array.isArray(ol.events)) ol.events = [];
  if (outlineEvents.length) ol.events = ol.events.concat(outlineEvents);

  story.sessions = story.sessions.map((s) => ({
    id: s.id || uid('t'),
    cardId: s.cardId || '',
    cardKind: s.cardKind || (cardById(story, s.cardId) || {}).kind || 'setting',
    at: s.at || Date.now(),
    msgs: Array.isArray(s.msgs) ? s.msgs : [],
    options: Array.isArray(s.options) ? s.options : [],
    closed: !!s.closed,
    patchId: s.patchId || '',
  }));

  story.chapters = story.chapters.map((h) => ({
    id: h.id || uid('h'),
    title: h.title || '',
    eventIds: Array.isArray(h.eventIds) ? h.eventIds : (Array.isArray(h.picks) ? h.picks : []),
    narrativeId: h.narrativeId || '',
    body: h.body || '',
    status: h.status || 'draft',
    at: h.at || Date.now(),
    history: Array.isArray(h.history) ? h.history : [],
  }));

  // 正文主干（段落/场/事实/义务/人物/硬约束）
  normalizeCorpus(story);

  return story;
}

/* ---------------- IndexedDB ---------------- */

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('stories')) d.createObjectStore('stories', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('styles')) d.createObjectStore('styles', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode) {
  return db().then((d) => d.transaction(store, mode).objectStore(store));
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listStories() {
  const s = await tx('stories', 'readonly');
  const all = await wrap(s.getAll());
  return (all || []).map(normalizeStory).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getStory(id) {
  const s = await tx('stories', 'readonly');
  const raw = await wrap(s.get(id));
  return raw ? normalizeStory(raw) : null;
}

export async function putStory(story) {
  story.updatedAt = Date.now();
  const s = await tx('stories', 'readwrite');
  await wrap(s.put(story));
  return story;
}

export async function deleteStory(id) {
  const s = await tx('stories', 'readwrite');
  await wrap(s.delete(id));
}

export async function listStyles() {
  const s = await tx('styles', 'readonly');
  const all = await wrap(s.getAll());
  return (all || []).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function getStyle(id) {
  const s = await tx('styles', 'readonly');
  return (await wrap(s.get(id))) || null;
}

export async function putStyle(style) {
  const s = await tx('styles', 'readwrite');
  await wrap(s.put(style));
  return style;
}

export async function deleteStyle(id) {
  const s = await tx('styles', 'readwrite');
  await wrap(s.delete(id));
}

export function newStyle(extra) {
  return Object.assign({ id: uid('w'), name: '我的文风', rules: '', at: Date.now() }, extra || {});
}

/* ---------------- 设置 ---------------- */

const SET_KEY = 'sf_settings_v1';
const CUR_KEY = 'sf_current_v1';
// v3 换了键名，老用户的设置还躺在旧键里——读不到就成「密钥丢了」
const LEGACY_SET_KEY = 'storyforge.settings';
const LEGACY_CUR_KEY = 'storyforge.current';

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  models: [],
  effort: 'off',
  theme: 'aurora',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw != null) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw) || {});
    // 新键不存在 → 试着从旧键迁移（只迁一次，写成新键）
    const old = localStorage.getItem(LEGACY_SET_KEY);
    if (old != null) {
      const merged = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(old) || {});
      localStorage.setItem(SET_KEY, JSON.stringify(merged));
      return merged;
    }
    return Object.assign({}, DEFAULT_SETTINGS);
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

export function saveSettings(patch) {
  const next = Object.assign(loadSettings(), patch || {});
  localStorage.setItem(SET_KEY, JSON.stringify(next));
  return next;
}

export function loadCurrentId() {
  const v = localStorage.getItem(CUR_KEY);
  if (v != null) return v || '';
  const old = localStorage.getItem(LEGACY_CUR_KEY);
  if (old) {
    localStorage.setItem(CUR_KEY, old);
    return old;
  }
  return '';
}

export const saveCurrentId = (id) => localStorage.setItem(CUR_KEY, id || '');
