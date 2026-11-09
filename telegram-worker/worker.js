// AlfaClass → Telegram bot (Cloudflare Worker, free plan)
//
// What it does:
//   POST /webhook   Telegram calls this. A member sends /start  -> saved as subscriber (/stop removes).
//   POST /publish   The website calls this after a post is saved -> sent to the channel + all subscribers.
//   POST /delete    The website calls this after a post is deleted -> removed from Telegram too.
//   GET  /register  Open once in the browser to connect the bot to this Worker.
//
// Needed settings (Cloudflare dashboard -> your Worker -> Settings):
//   Secret   BOT_TOKEN       token from @BotFather
//   Secret   WEBHOOK_SECRET  any password made of letters/numbers/_/- (for example: AlfaClass2026bot)
//   Variable CHANNEL_ID      channel username like @alfaclass_lectures (or the numeric id -100...)
//   KV binding named KV      (Storage & Databases -> KV -> create a namespace, then bind it as "KV")

const PROJECT_ID = 'alfaclass-120e3';                 // Firebase project id
const SITE_URL = 'https://broksil.github.io/AlfaClass/';
const MAX_CALLS = 30;  // Telegram calls per run (free plan allows 50 outgoing requests per run)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://broksil.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/webhook' && req.method === 'POST') return await webhook(req, env);
      if (url.pathname === '/register' && req.method === 'GET') return await register(url, env);
      if (url.pathname === '/publish' && req.method === 'POST') return reply(await publish(req, env), 200, cors);
      if (url.pathname === '/delete' && req.method === 'POST') return reply(await remove(req, env), 200, cors);
      return reply({ ok: true, name: 'alfaclass-bot' }, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status, cors);
      console.error('worker error', e && e.message);
      return reply({ error: 'internal_error' }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── Telegram API ─────────────────────────

async function tg(env, st, method, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let j;
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      j = await r.json();
    } catch (e) {
      return { ok: false, error_code: 0, description: 'network_error' };
    }
    if (j.ok) return j;
    const wait = j.error_code === 429 ? (j.parameters && j.parameters.retry_after) || 1 : 0;
    if (wait && wait <= 5 && st.retries < 3) { st.retries++; await sleep(wait * 1000); continue; }
    return j;
  }
  return { ok: false, error_code: 429, description: 'rate_limited' };
}

// the person blocked the bot / deleted the account / chat does not exist anymore
const isGone = (j) =>
  j && !j.ok && (j.error_code === 403 || (j.error_code === 400 && /chat not found/i.test(j.description || '')));

// ───────────────────────── Webhook (/start, /stop) ─────────────────────────

async function webhook(req, env) {
  if (env.WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const u = await req.json().catch(() => ({}));
  const st = { retries: 0 };

  const m = u.message;
  if (m && m.chat && m.chat.type === 'private') {
    const cmd = String(m.text || '').trim().split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/start') {
      await env.KV.put(`sub:${m.chat.id}`, '1');
      await tg(env, st, 'sendMessage', {
        chat_id: m.chat.id,
        text: '✅ تم تفعيل الإشعارات. راح توصلك التحاضير الجديدة هنا مباشرة.\nلإيقافها أرسل /stop',
      });
    } else if (cmd === '/stop') {
      await env.KV.delete(`sub:${m.chat.id}`);
      await tg(env, st, 'sendMessage', {
        chat_id: m.chat.id,
        text: '⏹️ تم إيقاف الإشعارات. لتفعيلها مرة ثانية أرسل /start',
      });
    }
  }

  const mc = u.my_chat_member;
  if (mc && mc.chat && mc.chat.type === 'private') {
    const status = mc.new_chat_member && mc.new_chat_member.status;
    if (status === 'kicked' || status === 'left') await env.KV.delete(`sub:${mc.chat.id}`);
  }
  return new Response('ok');
}

async function register(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const st = { retries: 0 };
  const j = await tg(env, st, 'setWebhook', {
    url: `${url.origin}/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'my_chat_member'],
  });
  return new Response(JSON.stringify(j, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

// ───────────────────────── Reading the post from Firestore ─────────────────────────
// The site sends only the post id + the signed-in user's token. The post content is read
// from Firestore itself (so nobody can broadcast arbitrary text through this Worker).

async function fetchPost(postId, idToken) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/${postId}`,
    { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} }
  );
  if (r.status === 404) return { status: 404 };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, error: (j.error && j.error.status) || 'firestore_error' };
  return { status: 200, data: decodeFields(j.fields || {}) };
}

function decodeFields(f) {
  const o = {};
  for (const k of Object.keys(f)) o[k] = decodeValue(f[k]);
  return o;
}
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

// ───────────────────────── Building the Telegram message ─────────────────────────

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function buildSpec(p) {
  const images = (Array.isArray(p.images) ? p.images : []).filter(isHttp).slice(0, 10);
  const files = (Array.isArray(p.files) ? p.files : []).filter((f) => f && isHttp(f.url));
  const title = [p.type, p.subject].filter(Boolean).map((x) => esc(String(x).slice(0, 150))).join(' — ');

  const make = (noteLimit) => {
    const parts = [];
    if (title) parts.push(`<b>📚 ${title}</b>`);
    if (p.note) parts.push(esc(String(p.note).slice(0, noteLimit)));
    for (const f of files) parts.push(`📎 <a href="${esc(f.url)}">${esc(f.name || 'ملف')}</a>`);
    if (isHttp(p.voiceUrl)) parts.push(`🎤 <a href="${esc(p.voiceUrl)}">تسجيل صوتي</a>`);
    if (p.poll) parts.push('📊 فيه استفتاء، شارك من الموقع');
    parts.push(`🔗 <a href="${SITE_URL}">فتح الموقع</a>`);
    if (p.author) parts.push(`✍️ ${esc(p.author)}`);
    return parts.join('\n\n');
  };

  let noteLimit = 2500;
  let text = make(noteLimit);
  while (text.length > 3500 && noteLimit > 100) { noteLimit = Math.floor(noteLimit / 2); text = make(noteLimit); }

  // photo captions are limited to 1024 characters
  const captionFits = text.length <= 1024;
  const caption = captionFits ? text : (title ? `<b>📚 ${title}</b>` : '📚');
  const needsText = images.length === 0 || !captionFits;
  const cpr = images.length > 0 && !captionFits ? 2 : 1; // Telegram calls per person

  return { text, caption, images, needsText, cpr };
}

// Sends one post to one chat. Returns the ids of the messages that were created.
async function sendToChat(env, st, chatId, spec, textOnly) {
  const ids = [];
  let imgFailed = false;
  let gone = false;
  const imgs = textOnly ? [] : spec.images;

  if (imgs.length === 1) {
    const r = await tg(env, st, 'sendPhoto', { chat_id: chatId, photo: imgs[0], caption: spec.caption, parse_mode: 'HTML' });
    if (r.ok) ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else imgFailed = true;
  } else if (imgs.length > 1) {
    const media = imgs.map((u, i) => (i === 0 ? { type: 'photo', media: u, caption: spec.caption, parse_mode: 'HTML' } : { type: 'photo', media: u }));
    const r = await tg(env, st, 'sendMediaGroup', { chat_id: chatId, media });
    if (r.ok) r.result.forEach((m) => ids.push(m.message_id));
    else if (isGone(r)) gone = true;
    else imgFailed = true;
  }

  if (!gone && (spec.needsText || textOnly || imgFailed)) {
    let text = spec.text;
    // images that Telegram could not fetch (for example too large): send them as links instead
    if (imgFailed || (textOnly && spec.images.length)) {
      text += '\n\n' + spec.images.map((u, i) => `🖼️ <a href="${esc(u)}">صورة ${i + 1}</a>`).join('\n');
    }
    const r = await tg(env, st, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (r.ok) ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else if (!ids.length) return { ids, gone, imgFailed, error: r.description || 'send_failed' };
  }
  return { ids, gone, imgFailed };
}

// ───────────────────────── Publish (in batches) ─────────────────────────
// The free plan allows ~50 outgoing requests per run, so people are served in batches.
// The website keeps calling /publish with the "next" value until "done" is true.

function checkPostId(postId) {
  if (typeof postId !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(postId)) throw new HttpError(400, 'bad_post_id');
}

async function listSubs(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix: 'sub:', cursor });
    r.keys.forEach((k) => out.push(Number(k.name.slice(4))));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

async function publish(req, env) {
  const { postId, idToken, offset } = await req.json().catch(() => ({}));
  checkPostId(postId);
  const off = Number(offset) || 0;
  const st = { retries: 0 };
  const jobKey = `job:${postId}`;
  const day = 86400;

  let job = await env.KV.get(jobKey, 'json');

  if (!job) {
    if (off !== 0) throw new HttpError(400, 'unknown_job');
    if (await env.KV.get(`pub:${postId}`)) return { done: true, already: true };

    const got = await fetchPost(postId, idToken);
    if (got.status === 404) throw new HttpError(404, 'post_not_found');
    if (got.status !== 200) throw new HttpError(got.status, got.error || 'firestore_error');

    const spec = buildSpec(got.data);
    const subs = await listSubs(env);
    job = { spec, subs, bs: Math.max(1, Math.floor(MAX_CALLS / spec.cpr)), next: 0, channelDone: false, textOnly: false, done: false };
    await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: day });
    await env.KV.put(`pub:${postId}`, '1', { expirationTtl: 30 * day });
  }

  if (job.done) return { done: true, already: true };

  // 1) the channel (once)
  if (!job.channelDone) {
    if (!env.CHANNEL_ID) throw new HttpError(500, 'CHANNEL_ID_missing');
    const res = await sendToChat(env, st, env.CHANNEL_ID, job.spec, false);
    if (!res.ids.length) throw new HttpError(502, 'channel_send_failed: ' + (res.error || 'unknown'));
    await env.KV.put(`msgs:${postId}:ch`, JSON.stringify([[env.CHANNEL_ID, res.ids]]), { expirationTtl: 30 * day });
    job.channelDone = true;
    job.textOnly = res.imgFailed;
    await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: day });
  }

  // 2) the members (one batch per call)
  if (off !== job.next) return { done: false, next: job.next, total: job.subs.length };

  const batch = job.subs.slice(off, off + job.bs);
  const sent = [];
  const gone = [];
  for (let i = 0; i < batch.length; i += 10) {
    const group = batch.slice(i, i + 10);
    const results = await Promise.all(group.map((chatId) => sendToChat(env, st, chatId, job.spec, job.textOnly)));
    results.forEach((r, k) => {
      if (r.ids.length) sent.push([group[k], r.ids]);
      if (r.gone) gone.push(group[k]);
    });
    if (i + 10 < batch.length) await sleep(400); // stay under Telegram's ~30 messages/second
  }

  const batchNo = Math.floor(off / job.bs);
  await env.KV.put(`msgs:${postId}:${batchNo}`, JSON.stringify(sent), { expirationTtl: 30 * day });
  for (const id of gone.slice(0, 5)) await env.KV.delete(`sub:${id}`); // people who blocked the bot

  job.next = off + job.bs;
  job.done = job.next >= job.subs.length;
  await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: day });
  return { done: job.done, next: job.next, total: job.subs.length };
}

// ───────────────────────── Delete (in steps) ─────────────────────────
// Telegram messages are deleted ONLY after the post is really gone from Firestore.

async function remove(req, env) {
  const { postId, idToken, offset } = await req.json().catch(() => ({}));
  checkPostId(postId);
  const step = Number(offset) || 0;
  const st = { retries: 0 };

  const got = await fetchPost(postId, idToken);
  if (got.status === 200) throw new HttpError(409, 'post_still_exists');
  if (got.status !== 404) throw new HttpError(got.status, got.error || 'firestore_error');

  if (step === 0) await env.KV.delete(`job:${postId}`);

  const key = step === 0 ? `msgs:${postId}:ch` : `msgs:${postId}:${step - 1}`;
  const rec = await env.KV.get(key, 'json');
  if (!rec) return step === 0 ? { done: false, next: 1 } : { done: true };

  for (let i = 0; i < rec.length; i += 10) {
    const group = rec.slice(i, i + 10);
    await Promise.all(group.map(([chatId, ids]) => tg(env, st, 'deleteMessages', { chat_id: chatId, message_ids: ids })));
    if (i + 10 < rec.length) await sleep(400);
  }
  await env.KV.delete(key);
  return { done: false, next: step + 1 };
}
