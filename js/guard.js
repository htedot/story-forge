// 三查：矛盾 / 信息差 / 推进；顺带把这一拍沉淀成事实与「谁知道什么」
// 一次调用做完，失败不阻塞——校验是护栏，不是闸门。

export const ISSUE_KINDS = {
  contradiction: '矛盾',
  leak: '信息差',
  static: '没推进',
};

const SYS = `你是这本小说的校读。读刚写出来的这一段正文，做三件事，然后只输出一个 JSON。

【查三样】
1. contradiction 矛盾：人名、时间、地点、生死、已经成立的事实，有没有被推翻。
2. leak 信息差：有没有哪个角色说出了他此刻还不可能知道的事。这是最要命的一类。
3. static 没推进：这一拍有没有产生变化——有人移动、有东西易手、有信息翻转、或关系的温度变了。一样都没有就是没推进。

【同时抽两样】
- facts：这一段里新确立了哪些事实（一句话一条，只写确定发生的事，不要写心理活动）。
- knows：这一段里谁知道了什么（人名 → 他知道的事）。
- done：这一场「还差的那件事」有没有了结。

只输出 JSON，不要解释，不要代码块。格式：
{"issues":[{"kind":"contradiction|leak|static","quote":"原文里的一句话","why":"为什么算问题"}],"facts":["..."],"knows":{"人名":["知道的"]},"done":false}

没有问题就输出 {"issues":[], ...}。宁可漏报，不要误报。`;

export function guardMessages(story, text) {
  const c = story && story.corpus ? story.corpus : { hard: [], people: [], facts: [] };
  const hard = (c.hard || []).map((h) => '- ' + h.text).join('\n');
  const people = (c.people || [])
    .map((p) => `- ${p.name}：此刻知道 ${(p.knows || []).slice(-6).join('；') || '（未记录）'}`)
    .join('\n');
  const facts = (c.facts || [])
    .filter((f) => f.state !== 'dead')
    .slice(-20)
    .map((f) => '- ' + f.text)
    .join('\n');
  const user = [
    hard ? '【什么不可能】\n' + hard : '',
    people ? '【人物此刻知道什么】\n' + people : '',
    facts ? '【已经成立的事实】\n' + facts : '',
    '【刚写的这一段】\n' + String(text || '').trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYS },
    { role: 'user', content: user },
  ];
}

function pickArray(x) {
  return Array.isArray(x) ? x : [];
}

export function parseGuard(raw) {
  const empty = { ok: true, issues: [], facts: [], knows: {}, done: false };
  let t = String(raw || '').trim();
  if (!t) return empty;
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return empty;
  let j;
  try {
    j = JSON.parse(t.slice(a, b + 1));
  } catch (e) {
    return empty;
  }
  const issues = pickArray(j.issues)
    .filter((x) => x && ISSUE_KINDS[x.kind])
    .slice(0, 4)
    .map((x) => ({ kind: x.kind, quote: String(x.quote || '').trim(), why: String(x.why || '').trim() }));
  const facts = pickArray(j.facts)
    .map((x) => String(x || '').trim())
    .filter((x) => x.length >= 2)
    .slice(0, 6);
  const knows = {};
  if (j.knows && typeof j.knows === 'object') {
    for (const [k, v] of Object.entries(j.knows)) {
      const list = pickArray(v).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
      if (list.length) knows[String(k)] = list;
    }
  }
  return { ok: issues.length === 0, issues, facts, knows, done: !!j.done };
}

// 把问题写成给模型看的一段话，用于「重写一次」
export function rewriteHint(issues) {
  if (!issues || !issues.length) return '';
  return (
    '刚才那一版有三个问题，重写一遍：\n' +
    issues
      .map((i) => `- ${ISSUE_KINDS[i.kind] || i.kind}：${i.why || ''}${i.quote ? `（原句：${i.quote}）` : ''}`)
      .join('\n')
  );
}
