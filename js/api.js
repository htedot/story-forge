// 兼容 OpenAI 格式的接口适配。浏览器直连，不经过任何中转。
// DeepSeek / Moonshot / DashScope / SiliconFlow 实测都允许跨域直连。

function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('还没有填接口地址');
  return b + path;
}

function httpError(status, body) {
  const hint =
    status === 401 ? '密钥不对，或者已经失效。'
    : status === 402 ? '账户余额不足。'
    : status === 403 ? '这个密钥没有调用权限。'
    : status === 404 ? '接口地址填错了，应该以 /v1 结尾。'
    : status === 429 ? '调得太快了，等一下再试。'
    : status >= 500 ? '对方服务出问题了，等一会儿再试。'
    : '';
  const detail = body ? `｜${String(body).slice(0, 200)}` : '';
  const err = new Error(hint ? `${hint}（HTTP ${status}）${detail}` : `请求失败（HTTP ${status}）${detail}`);
  err.status = status;
  return err;
}

async function post(url, apiKey, payload, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('返回的不是 JSON：' + text.slice(0, 200));
  }
}

function readContent(data, model) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const finish = choice?.finish_reason;
    const err = new Error(
      finish === 'length'
        ? `模型在写完之前就被截断了（${model || '当前模型'}）。如果反复这样，多半是这个模型把额度花在了「思考」上——去设置里换成 deepseek-chat 这类非推理模型。`
        : '模型返回了空内容，再试一次。'
    );
    err.truncated = finish === 'length';
    err.empty = true;
    throw err;
  }
  return content;
}

export async function chat({
  baseUrl,
  apiKey,
  model,
  messages,
  json = true,
  maxTokens = 1200,
  temperature = 1.0,
  effort = 'off',
  signal,
}) {
  if (!apiKey) throw new Error('还没有填密钥');
  const url = joinUrl(baseUrl, '/chat/completions');
  const eff = effortFields(effort);

  const build = (useJson, mt, withEffort) => {
    const payload = {
      model: model || 'deepseek-chat',
      messages,
      max_tokens: mt,
      temperature,
      stream: false,
      ...(withEffort ? eff : {}),
    };
    if (useJson) payload.response_format = { type: 'json_object' };
    return payload;
  };

  const send = async (useJson, mt, withEffort) =>
    readContent(await post(url, apiKey, build(useJson, mt, withEffort), signal), model);

  try {
    return await send(json, maxTokens, true);
  } catch (first) {
    let e = first;
    const can = !signal?.aborted;
    // 有的服务不认 response_format 或推理参数，会直接 400。逐层退掉再试。
    if (e && e.status === 400 && can) {
      const attempts = [];
      if (json) attempts.push([false, true]);
      attempts.push([json, false]);
      if (json) attempts.push([false, false]);
      for (const [j, ef] of attempts) {
        try {
          return await send(j, maxTokens, ef);
        } catch (e2) {
          e = e2;
          if (!e || e.status !== 400) break;
        }
      }
    }
    // 被截断、或者返回空：放宽额度并去掉推理参数再试一次。
    // 推理模型会把 max_tokens 烧在思考上，最后 content 是空的，这是最常见的失败。
    if (e && (e.truncated || e.empty) && can) {
      const bigger = Math.min(Math.max(maxTokens * 3, 3000), 8000);
      if (bigger > maxTokens) {
        try {
          return await send(false, bigger, false);
        } catch (e2) {
          if (e2 && e2.empty) {
            throw new Error('模型连着两次一个字都没返回。再点一次试试；如果一直是空的，去设置里换一个模型。');
          }
          throw e2;
        }
      }
    }
    throw e;
  }
}

// 推理等级 → 请求字段。off 表示什么都不发（最省、最快）。
function effortFields(effort) {
  if (!effort || effort === 'off') return {};
  return { reasoning_effort: effort };
}

// 流式。边写边出字，是全篇体感的关键。
async function streamOnce({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens = 900,
  temperature = 1.0,
  effort = 'off',
  signal,
  onDelta,
}) {
  if (!apiKey) throw new Error('还没有填密钥');
  const url = joinUrl(baseUrl, '/chat/completions');

  const open = (withEffort) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(withEffort ? effortFields(effort) : {}),
      }),
      signal,
    });

  let res = await open(true);
  if (res.status === 400) {
    // 推理参数不被接受，退掉再来
    res = await open(false);
  }

  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  if (!res.body) throw new Error('这个接口没有返回流，换个地址或者模型试试。');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let thinking = '';
  let finish = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      const ch0 = j?.choices?.[0];
      if (ch0?.finish_reason) finish = ch0.finish_reason;
      const rc = ch0?.delta?.reasoning_content;
      if (typeof rc === 'string' && rc) thinking += rc;
      const d = ch0?.delta?.content;
      if (typeof d === 'string' && d) {
        full += d;
        if (onDelta) onDelta(d, full);
      }
    }
  }

  return { text: full, thinking, finish };
}

/**
 * 流式。边写边出字，是全篇体感的关键。
 * 空返回是这类接口最常见的坑：推理模型会把 max_tokens 全烧在思考上，
 * 正文一个字都不剩。所以这里三层兜底：原样来一次 → 加额度去掉推理参数 →
 * 退回非流式，只要拿到字就不让用户看到报错。
 */
export async function streamChat(opts) {
  const { baseUrl, apiKey, model, messages, maxTokens = 900, temperature = 1.0, effort = 'off', signal, onDelta } = opts;

  const first = await streamOnce(opts);
  if (String(first.text || '').trim()) return first.text;

  const bigger = Math.min(Math.max(maxTokens * 2, 2400), 8000);
  const second = await streamOnce({ ...opts, maxTokens: bigger, effort: 'off', onDelta: null });
  if (String(second.text || '').trim()) {
    if (onDelta) onDelta(second.text, second.text);
    return second.text;
  }

  if (!signal?.aborted) {
    const plain = await chat({
      baseUrl,
      apiKey,
      model,
      messages,
      json: false,
      maxTokens: bigger,
      temperature,
      effort: 'off',
      signal,
    });
    if (String(plain || '').trim()) {
      if (onDelta) onDelta(plain, plain);
      return plain;
    }
  }

  if (second.thinking || first.thinking) {
    throw new Error(
      `模型这次只输出了思考过程，正文是空的（${model || '当前模型'}）。把推理等级调成「关」，或者换 deepseek-chat 这类非推理模型。`
    );
  }
  if (second.finish === 'length' || first.finish === 'length') {
    throw new Error(`写一半额度就用完了（${model || '当前模型'}）。把推理等级调成「关」再试，或者换一个更省额度的模型。`);
  }
  throw new Error('模型这次一个字都没返回。再点一次试试；如果一直是空的，去设置里换一个模型，或者把推理等级调成「关」。');
}

export async function listModels(baseUrl, apiKey) {
  if (!apiKey) throw new Error('还没有填密钥');
  const res = await fetch(joinUrl(baseUrl, '/models'), { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const data = await res.json().catch(() => null);
  return (data?.data || []).map((m) => m.id).filter(Boolean);
}

// 从模型列表里挑一个能写小说的。
// 先按接口地址猜（DeepSeek 就优先 deepseek-chat），再按常见的写作模型排，
// 最后兜底取第一个不像向量/语音/画图的。
export function pickModel(models, baseUrl = '') {
  const list = (models || []).filter((m) => typeof m === 'string' && m);
  if (!list.length) return '';

  const prefs = [];
  if (/deepseek/i.test(baseUrl) || list.some((m) => /^deepseek/i.test(m))) prefs.push('deepseek-chat');
  prefs.push(
    'deepseek-chat',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini',
    'qwen-plus',
    'qwen-max',
    'glm-4-plus',
    'glm-4',
    'moonshot-v1-32k',
    'moonshot-v1-8k',
    'yi-large',
    'hunyuan-turbo',
    'doubao-pro-32k'
  );

  const bad = /embed|rerank|whisper|tts|speech|moderation|dall|image|vision-free|audio|video/i;

  for (const p of prefs) {
    const hit = list.find((m) => m === p || m.startsWith(p));
    if (hit) return hit;
  }

  const usable = list.filter((m) => !bad.test(m));
  const chat = usable.find((m) => /chat|instruct|-it$|turbo|plus|pro/i.test(m));
  return chat || usable[0] || list[0];
}

export async function testConnection({ baseUrl, apiKey, model }) {
  if (!apiKey) throw new Error('还没有填密钥');

  // 优先查模型列表；有的服务没有这个端点，就退回一次极小的真实调用。
  try {
    return { ok: true, models: await listModels(baseUrl, apiKey), via: 'models' };
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const content = await chat({
    baseUrl,
    apiKey,
    model,
    messages: [{ role: 'user', content: '只回复两个字：通了' }],
    json: false,
    maxTokens: 16,
    temperature: 0,
  });
  return { ok: true, models: [], via: 'chat', sample: content.trim().slice(0, 20) };
}
