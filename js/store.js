// 存储：设置走 localStorage，书和文风走 IndexedDB。
// 数据只在这台设备上，不上传任何地方。

const DB_NAME = 'storyforge';
const DB_VERSION = 2;
const S_STORY = 'stories';
const S_STYLE = 'styles';
const LS_SETTINGS = 'storyforge.settings';
const LS_CURRENT = 'storyforge.current';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_STORY)) db.createObjectStore(S_STORY, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S_STYLE)) db.createObjectStore(S_STYLE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打不开本地数据库'));
  });
  return dbPromise;
}

function tx(name, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, mode);
        const store = t.objectStore(name);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function getAll(name) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(name, 'readonly').objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

function getOne(name, id) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(name, 'readonly').objectStore(name).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
}

export const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------------- 卡片 ---------------- */

export const CARD_KINDS = [
  { kind: 'background', name: '背景设定', hint: '年代、地方、社会状况', pov: '史书视角' },
  { kind: 'world', name: '世界观', hint: '规则、势力、禁忌', pov: '上帝视角' },
  { kind: 'outline', name: '大纲', hint: '这部书大致要发生什么', pov: '导演视角' },
  { kind: 'character', name: '角色', hint: '想要什么、怕什么、怎么说话', pov: '本人视角' },
];

export const KIND_BY_ID = Object.fromEntries(CARD_KINDS.map((k) => [k.kind, k]));

export function newCard(kind = 'character', seed = {}) {
  return Object.assign(
    {
      id: uid('c'),
      kind,
      title: kind === 'character' ? '新角色' : KIND_BY_ID[kind].name,
      body: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    seed
  );
}

/* ---------------- 书 ---------------- */

export function newStory(seed = {}) {
  const now = Date.now();
  return Object.assign(
    {
      id: uid('s'),
      title: '未命名',
      createdAt: now,
      updatedAt: now,
      styleId: '',
      model: '',
      cards: [
        newCard('background', { title: '背景设定' }),
        newCard('character', { title: '主角' }),
      ],
      timeline: [],
      sessions: [],
      chapters: [],
      notes: '',
    },
    seed
  );
}

export function newTimelineItem(seed = {}) {
  return Object.assign(
    {
      id: uid('t'),
      at: '',
      title: '',
      detail: '',
      cardId: '',
      sessionId: '',
      status: 'pending',
      order: 0,
    },
    seed
  );
}

export function newSession(cardId, seed = {}) {
  return Object.assign(
    {
      id: uid('m'),
      cardId,
      title: '',
      messages: [],
      status: 'draft',
      savedAt: Date.now(),
      result: null,
    },
    seed
  );
}

export function newChapter(seed = {}) {
  return Object.assign(
    {
      id: uid('h'),
      no: 0,
      title: '',
      body: '',
      pov: { mode: 'third', who: [] },
      span: { from: '', to: '' },
      pickedIds: [],
      status: 'draft',
      createdAt: Date.now(),
    },
    seed
  );
}

// 兼容旧数据
function normalizeStory(s) {
  if (!s) return s;
  if (!Array.isArray(s.cards)) {
    s.cards = [];
    if (s.setup) {
      if (s.setup.premise) s.cards.push(newCard('background', { title: '背景设定', body: s.setup.premise }));
      if (s.setup.world) s.cards.push(newCard('world', { title: '世界观', body: s.setup.world }));
      if (s.setup.characters) s.cards.push(newCard('character', { title: '人物', body: s.setup.characters }));
      if (s.setup.outline) s.cards.push(newCard('outline', { title: '大纲', body: s.setup.outline }));
    }
  }
  if (!Array.isArray(s.timeline)) s.timeline = [];
  if (!Array.isArray(s.sessions)) s.sessions = [];
  if (!Array.isArray(s.chapters)) s.chapters = [];
  if (typeof s.notes !== 'string') s.notes = '';
  return s;
}

export async function putStory(story) {
  story.updatedAt = Date.now();
  await tx(S_STORY, 'readwrite', (s) => s.put(story));
  return story;
}

export function getStory(id) {
  return getOne(S_STORY, id).then(normalizeStory);
}

export function listStories() {
  return getAll(S_STORY).then((arr) => arr.map(normalizeStory).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
}

export function deleteStory(id) {
  return tx(S_STORY, 'readwrite', (s) => s.delete(id));
}

/* ---------------- 文风 ---------------- */

export function newStyle(seed = {}) {
  return Object.assign(
    {
      id: uid('w'),
      name: '未命名文风',
      createdAt: Date.now(),
      axes: {},
      notes: [],
      rounds: [],
      chat: [],
      text: '',
    },
    seed
  );
}

export async function putStyle(style) {
  await tx(S_STYLE, 'readwrite', (s) => s.put(style));
  return style;
}

export const getStyle = (id) => getOne(S_STYLE, id);
export const listStyles = () => getAll(S_STYLE).then((a) => a.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)));
export const deleteStyle = (id) => tx(S_STYLE, 'readwrite', (s) => s.delete(id));

/* ---------------- 设置 ---------------- */

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  models: [],
  temperature: 1.0,
  theme: 'aurora',
  effort: 'off',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

export const loadCurrentId = () => localStorage.getItem(LS_CURRENT) || '';
export const saveCurrentId = (id) => localStorage.setItem(LS_CURRENT, id || '');

/* ---------------- 演示书 ---------------- */

export function demoStory() {
  const st = newStory({ title: '演示 · 最后一班地铁', model: '' });
  st.cards = [
    newCard('background', {
      title: '背景设定',
      body: '这座城市，二〇二六年冬。地铁三号线末班车 23:47 发车，终点站只有两个出口，B 口常年不开。\n姐姐周意失踪的第四十一天。警方下的结论是自行离开，卷宗里最后一句话是「未见外力介入」。\n我在夜班护士这个行当里干了七年，两个月前辞了。',
    }),
    newCard('world', {
      title: '世界观',
      body: '没有超自然，一切都能用人事解释。\n只有一条当地习惯：末班车上没人看手机。乘务员说那是因为车过江隧道时会断网，久了就成了规矩。\n谁在末班车上掏出手机，会被全车厢的人看。',
    }),
    newCard('outline', {
      title: '大纲',
      body: '第一场：末班车，我上车，看见林医生坐在第三节。\n第二场：他说三件事，每件都缺一半。\n第三场：车到终点，站台上有人等我。\n四场之内演完。这本不出现任何超自然解释，所有线索必须能落回人事。',
    }),
    newCard('character', {
      title: '周叙（主角）',
      body: '三十四岁。周意的弟弟。辞职以后靠接零活过。\n想要：拿到姐姐失踪那晚的监控。\n怕：被人当成疯子。\n说话：短，不解释，不求助。别人一问，他反问你一句。\n他不会当场崩溃，他会去查。',
    }),
    newCard('character', {
      title: '林医生',
      body: '五十二岁，周意科室的主任。\n明面上想要：把这件事体面地翻过去。\n不肯说：那天晚上他到底在不在车上。\n底线：不能丢现在这个位置。\n说话：客气，回避，每句话留半句。不会直接撒谎，只会绕。',
    }),
  ];
  st.timeline = [
    newTimelineItem({
      title: '末班车上，林医生说他「还记得你姐」',
      at: '23:47',
      detail: '他没有解释为什么会在这一班车上，说完就转过去看窗外。',
      status: 'pending',
      order: 0,
    }),
  ];
  return st;
}
