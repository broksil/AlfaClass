// ══════════════════════════════════════════════════════════════════════════════
//  AlfaClass — Cloudflare Worker
//  بوت تلكرام + بث شامل + نشر مجدول تلقائي
// ══════════════════════════════════════════════════════════════════════════════

const PROJECT_ID = 'alfaclass-120e3';
const SITE_URL   = 'https://broksil.github.io/AlfaClass/';
const MAX_CALLS  = 30; // أقصى طلبات تلكرام لكل تشغيل

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export default {
  async fetch(req, env) {
    const url  = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || 'https://broksil.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/webhook'  && req.method === 'POST') return await webhook(req, env);
      if (url.pathname === '/register' && req.method === 'GET')  return await register(url, env);
      if (url.pathname === '/tg-auth'  && req.method === 'POST') return reply(await tgAuth(req, env), 200, cors);
      if (url.pathname === '/publish'  && req.method === 'POST') return reply(await publish(req, env), 200, cors);
      if (url.pathname === '/delete'   && req.method === 'POST') return reply(await remove(req, env), 200, cors);
      return reply({ ok: true, name: 'alfaclass-bot' }, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status, cors);
      console.error('[Worker] خطأ غير متوقع:', e && e.message);
      return reply({ error: 'internal_error' }, 500, cors);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduledPublish(env));
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

async function tg(env, st, method, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let j;
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
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

const isGone = (j) =>
  j && !j.ok && (j.error_code === 403 || (j.error_code === 400 && /chat not found/i.test(j.description || '')));

async function webhook(req, env) {
  if (env.WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const u  = await req.json().catch(() => ({}));
  const st = { retries: 0 };
  const m  = u.message;

  if (m && m.chat) {
    const chatType = m.chat.type;
    const rawCmd   = String(m.text || '').trim().split(/[\s@]/)[0].toLowerCase();

    if (rawCmd === '/start' || rawCmd === '/تشغيل') {
      await env.KV.put(`sub:${m.chat.id}`, '1');

      if (chatType === 'private') {
        await tg(env, st, 'sendMessage', {
          chat_id:    m.chat.id,
          parse_mode: 'HTML',
          text: (
            '✅ <b>تم تفعيل الإشعارات!</b>\n\n' +
            'راح توصلك التحاضير الجديدة هنا مباشرة.\n' +
            'لإيقافها أرسل /stop\n\n' +
            'اضغط الزر تحت لفتح ألفاكلاس بحسابك 👇'
          ),
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 فتح ألفاكلاس', web_app: { url: SITE_URL } },
            ]],
          },
        });
      } else {
        await tg(env, st, 'sendMessage', {
          chat_id:    m.chat.id,
          parse_mode: 'HTML',
          text: '✅ <b>ألفاكلاس</b> — تم تفعيل الإشعارات لهذه المجموعة.',
        });
      }
    } else if (rawCmd === '/stop') {
      await env.KV.delete(`sub:${m.chat.id}`);
      await tg(env, st, 'sendMessage', {
        chat_id:    m.chat.id,
        parse_mode: 'HTML',
        text: '⏹️ تم إيقاف الإشعارات. لتفعيلها مرة ثانية أرسل /start',
      });
    }
  }

  const mc = u.my_chat_member;
  if (mc && mc.chat) {
    const newStatus = mc.new_chat_member && mc.new_chat_member.status;
    if (newStatus === 'kicked' || newStatus === 'left') {
      await env.KV.delete(`sub:${mc.chat.id}`);
    }
  }

  return new Response('ok');
}

async function register(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const st = { retries: 0 };
  const j  = await tg(env, st, 'setWebhook', {
    url:             `${url.origin}/webhook`,
    secret_token:    env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'my_chat_member'],
  });
  const menu = await tg(env, st, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'فتح ألفاكلاس', web_app: { url: SITE_URL } },
  });
  return new Response(JSON.stringify({ webhook: j, menu_button: menu }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const FS              = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const RESERVED_USERNAMES = new Set(['baqer','admin','owner','root','mod','moderator','support','alfaclass','alfa','telegram','system']);
const INIT_DATA_MAX_AGE  = 86400;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64uStr = (str) => b64u(enc.encode(str));

async function hmacSha256(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function verifyInitData(initData, botToken) {
  const p    = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check  = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmacSha256(enc.encode('WebAppData'), botToken);
  const sig    = hex(await hmacSha256(secret, check));
  if (!sameText(sig, hash)) return null;
  const authDate = Number(p.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE) return null;
  let user;
  try { user = JSON.parse(p.get('user')); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return user;
}

function getSA(env) {
  try {
    const sa = JSON.parse(env.FIREBASE_SA);
    if (sa && sa.client_email && sa.private_key) return sa;
  } catch {}
  throw new HttpError(500, 'FIREBASE_SA_missing');
}

async function signJwt(sa, claims) {
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw  = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key  = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64uStr(JSON.stringify(claims));
  const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

let gTok = null;
async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (gTok && gTok.exp > now + 60) return gTok.token;
  const sa        = getSA(env);
  const assertion = await signJwt(sa, {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('[googleToken] فشل:', r.status, j.error);
    throw new HttpError(500, 'google_token_failed');
  }
  gTok = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600) };
  return gTok.token;
}

async function firebaseCustomToken(env, uid) {
  const sa  = getSA(env);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(sa, {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  });
}

const S    = (v)  => ({ stringValue: String(v == null ? '' : v) });
const B    = (v)  => ({ booleanValue: !!v });
const auth = (t)  => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function fsGetUser(token, id) {
  const r = await fetch(`${FS}/users/${id}`, { headers: auth(token) });
  if (r.status === 404) return { status: 404 };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status };
  return { status: 200, data: decodeFields(j.fields || {}) };
}

async function fsHas(token, field, op, value) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      structuredQuery: {
        from:  [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } } },
        limit: 1,
      },
    }),
  });
  const j = await r.json().catch(() => []);
  if (!r.ok) throw new HttpError(500, 'firestore_query_failed');
  return Array.isArray(j) && j.some((x) => x && x.document);
}

async function usernameTaken(token, name) {
  if (RESERVED_USERNAMES.has(name)) return true;
  if (await fsHas(token, 'username',        'EQUAL',          name)) return true;
  if (await fsHas(token, 'previousUsername',  'EQUAL',          name)) return true;
  if (await fsHas(token, 'takenUsernames',    'ARRAY_CONTAINS',  name)) return true;
  return false;
}

async function tgAuth(req, env) {
  const { initData } = await req.json().catch(() => ({}));
  if (typeof initData !== 'string' || !initData || initData.length > 4000) {
    throw new HttpError(400, 'bad_init_data');
  }
  if (!env.BOT_TOKEN) throw new HttpError(500, 'BOT_TOKEN_missing');

  const u = await verifyInitData(initData, env.BOT_TOKEN);
  if (!u) throw new HttpError(401, 'invalid_init_data');
  if (u.is_bot) throw new HttpError(403, 'bots_not_allowed');

  const id    = u.id;
  const uid   = String(id);
  const token = await googleToken(env);
  const photo = isHttp(u.photo_url) ? u.photo_url : '';

  let cur = await fsGetUser(token, uid);
  if (cur.status !== 200 && cur.status !== 404) throw new HttpError(500, 'firestore_error');

  let created = false;
  if (cur.status === 404) {
    const want     = String(u.username || '').toLowerCase();
    let   username = 'user_' + id;
    if (/^[a-z0-9_]{3,30}$/.test(want) && /[a-z]/.test(want) && !(await usernameTaken(token, want))) {
      username = want;
    }
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim().slice(0, 60) || username;
    const fields   = {
      username:      S(username),
      fullName:      S(fullName),
      shift:         S(''),
      section:       S(''),
      role:          S('student'),
      uid:           S(uid),
      createdAt:     { timestampValue: new Date().toISOString() },
      userId:        { integerValue: uid },
      emailPrefix:   S(username),
      perms:         { mapValue: { fields: {
        prep:     B(false), report:  B(false), material: B(false),
        comment:  B(false), enquiry: B(false), support:  B(false),
        verify:   B(false), profile: B(true),  vote:     B(false),
      } } },
      takenUsernames: { arrayValue: { values: [S(username)] } },
      photoURL:      S(photo),
      tgId:          { integerValue: uid },
      tgUsername:    S(u.username || ''),
      authProvider:  S('telegram'),
    };
    const r = await fetch(`${FS}/users/${uid}?currentDocument.exists=false`, {
      method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields }),
    });
    if (r.ok) {
      created = true;
      if (u.allows_write_to_pm && env.KV) {
        await env.KV.put(`sub:${id}`, '1').catch(() => {});
      }
    } else if (r.status === 409 || r.status === 412) {
      cur = await fsGetUser(token, uid);
    } else {
      throw new HttpError(500, 'create_failed');
    }
    if (created) cur = { status: 200, data: { username, fullName } };
  }

  if (cur.status !== 200) throw new HttpError(500, 'firestore_error');
  const d = cur.data;

  if (!created && (d.authProvider !== 'telegram' || Number(d.tgId) !== id)) {
    throw new HttpError(409, 'id_conflict');
  }

  if (!created && !d.photoURL && photo) {
    await fetch(`${FS}/users/${uid}?updateMask.fieldPaths=photoURL`, {
      method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields: { photoURL: S(photo) } }),
    }).catch(() => {});
  }

  return {
    customToken: await firebaseCustomToken(env, uid),
    username:    d.username,
    fullName:    d.fullName || d.username,
    userId:      id,
    created,
  };
}

async function fetchPost(postId, idToken, coll = 'posts') {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const r       = await fetch(
    `${FS}/${coll}/${postId}`,
    { headers },
  );
  if (r.status === 404) return { status: 404 };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, error: (j.error && j.error.status) || 'firestore_error' };
  return { status: 200, data: decodeFields(j.fields || {}) };
}

async function fetchPostAdmin(postId, coll, env) {
  const token = await googleToken(env);
  const r     = await fetch(`${FS}/${coll}/${postId}`, { headers: auth(token) });
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
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue'       in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

const esc     = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isHttp  = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function arabicDateFromDayId(dayId) {
  if (typeof dayId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayId)) {
    const d   = new Date(dayId + 'T00:00:00Z');
    const day = AR_DAYS[d.getUTCDay()];
    return `${day} ${d.getUTCDate()} / ${d.getUTCMonth() + 1}`;
  }
  const now = new Date();
  return `${AR_DAYS[now.getUTCDay()]} ${now.getUTCDate()} / ${now.getUTCMonth() + 1}`;
}

function buildPrepMessage(p, postId) {
  const postUrl = `${SITE_URL}#post-${postId}`;
  const dateStr = arabicDateFromDayId(p.dayId || p.date || '');

  const subject = esc(String(p.subject || p.title || '').slice(0, 100));
  const type    = esc(String(p.type    || '').slice(0, 60));
  const note    = esc(String(p.note    || '').slice(0, 800));

  const lines = [];
  lines.push(`<u>يوم ${esc(dateStr)} عدنا</u>`);
  if (subject || type) lines.push(`📚 ${subject}${subject && type ? ' — ' : ''}${type}`);
  if (note)            lines.push(`<blockquote>" ${note} "</blockquote>`);
  lines.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);

  return lines.join('\n');
}

function buildReportMessage(p, postId) {
  const postUrl = `${SITE_URL}#report-${postId}`;
  const title   = esc(String(p.title  || p.subject || '').slice(0, 150));
  const body    = esc(String(p.body   || p.note    || '').slice(0, 800));

  const lines = [];
  lines.push(`<u>📢 ${title}</u>`);
  if (body) lines.push(`<blockquote>" ${body} "</blockquote>`);
  lines.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);

  return lines.join('\n');
}

function buildClassroomMessage(p, postId) {
  const targetUrl = isHttp(p.classroomUrl || p.link)
    ? (p.classroomUrl || p.link)
    : `${SITE_URL}#post-${postId}`;

  const subject = esc(String(p.subject  || p.title   || '').slice(0, 100));
  const grade   = esc(String(p.grade    || p.level   || '').slice(0, 60));
  const study   = esc(String(p.study    || '').slice(0, 60));
  const group   = esc(String(p.group    || '').slice(0, 30));
  const details = esc(String(p.note     || p.body || p.details || '').slice(0, 800));
  const teacher = esc(String(p.author   || p.teacher  || '').slice(0, 60));

  const lines = [];
  if (subject) lines.push(`📚 ${subject}`);
  const gradeInfo = [grade, study, group].filter(Boolean).join(' / ');
  if (gradeInfo)  lines.push(gradeInfo);
  if (details)    lines.push(`<blockquote>" ${details} "</blockquote>`);
  if (teacher)    lines.push(`👩🏫 ${teacher}`);
  lines.push(`<a href="${esc(targetUrl)}">انقر على التفاصيل</a>`);

  return lines.join('\n');
}

function buildSpec(p, kind, postId) {
  const images = (Array.isArray(p.images) ? p.images : []).filter(isHttp).slice(0, 10);
  const files  = (Array.isArray(p.files)  ? p.files  : []).filter((f) => f && isHttp(f.url));

  let text;
  if        (kind === 'classroom') text = buildClassroomMessage(p, postId || '');
  else if (kind === 'report')    text = buildReportMessage(p, postId || '');
  else                           text = buildPrepMessage(p, postId || '');

  const extras = [];
  for (const f of files)       extras.push(`📎 <a href="${esc(f.url)}">${esc(f.name || 'ملف')}</a>`);
  if (isHttp(p.voiceUrl))      extras.push(`🎤 <a href="${esc(p.voiceUrl)}">تسجيل صوتي</a>`);
  if (p.poll)                  extras.push('📊 فيه استفتاء، شارك من الموقع');
  if (extras.length) text += '\n' + extras.join('\n');

  if (text.length > 3800) text = text.slice(0, 3800) + '…';

  const captionFits = text.length <= 1024;
  const caption     = captionFits ? text : (text.split('\n')[0] || '📚');
  const needsText   = images.length === 0 || !captionFits;
  const cpr         = images.length > 0 && !captionFits ? 2 : 1;

  return { text, caption, images, needsText, cpr };
}

async function sendToChat(env, st, chatId, spec, textOnly) {
  const ids      = [];
  let   imgFailed = false;
  let   gone      = false;
  const imgs     = textOnly ? [] : spec.images;

  if (imgs.length === 1) {
    const r = await tg(env, st, 'sendPhoto', {
      chat_id:    chatId,
      photo:      imgs[0],
      caption:    spec.caption,
      parse_mode: 'HTML',
    });
    if (r.ok)      ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else        imgFailed = true;

  } else if (imgs.length > 1) {
    const media = imgs.map((u, i) => i === 0
      ? { type: 'photo', media: u, caption: spec.caption, parse_mode: 'HTML' }
      : { type: 'photo', media: u }
    );
    const r = await tg(env, st, 'sendMediaGroup', { chat_id: chatId, media });
    if (r.ok)      r.result.forEach((m) => ids.push(m.message_id));
    else if (isGone(r)) gone = true;
    else        imgFailed = true;
  }

  if (!gone && (spec.needsText || textOnly || imgFailed)) {
    let text = spec.text;
    if (imgFailed || (textOnly && spec.images.length)) {
      text += '\n\n' + spec.images
        .map((u, i) => `🖼️ <a href="${esc(u)}">صورة ${i + 1}</a>`)
        .join('\n');
    }
    const r = await tg(env, st, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (r.ok)           ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else if (!ids.length) return { ids, gone, imgFailed, error: r.description || 'send_failed' };
  }

  return { ids, gone, imgFailed };
}

function checkPostId(postId) {
  if (typeof postId !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(postId)) {
    throw new HttpError(400, 'bad_post_id');
  }
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
  const { postId, idToken, offset, kind } = await req.json().catch(() => ({}));
  checkPostId(postId);

  const isReport = kind === 'report' || kind === 'classroom';
  const coll     = isReport ? 'reports' : 'posts';
  const kid      = isReport ? 'R' + postId : postId;
  const off      = Number(offset) || 0;
  const st       = { retries: 0 };
  const jobKey   = `job:${kid}`;
  const DAY      = 86400;

  let job = await env.KV.get(jobKey, 'json');

  if (!job) {
    if (off !== 0) throw new HttpError(400, 'unknown_job');
    if (await env.KV.get(`pub:${kid}`)) return { done: true, already: true };

    const got = await fetchPost(postId, idToken, coll);
    if (got.status === 404) throw new HttpError(404, 'post_not_found');
    if (got.status !== 200) throw new HttpError(got.status, got.error || 'firestore_error');

    const spec = buildSpec(got.data, kind, postId);
    const subs = await listSubs(env);

    job = {
      spec,
      subs,
      bs:          Math.max(1, Math.floor(MAX_CALLS / spec.cpr)),
      next:        0,
      channelDone: false,
      textOnly:    false,
      done:        false,
    };
    await env.KV.put(jobKey,         JSON.stringify(job), { expirationTtl: DAY });
    await env.KV.put(`pub:${kid}`, '1',                   { expirationTtl: 30 * DAY });
  }

  if (job.done) return { done: true, already: true };

  if (!job.channelDone) {
    if (!env.CHANNEL_ID) throw new HttpError(500, 'CHANNEL_ID_missing');
    const res = await sendToChat(env, st, env.CHANNEL_ID, job.spec, false);
    if (!res.ids.length) {
      throw new HttpError(502, 'channel_send_failed: ' + (res.error || 'unknown'));
    }
    await env.KV.put(
      `msgs:${kid}:ch`,
      JSON.stringify([[env.CHANNEL_ID, res.ids]]),
      { expirationTtl: 30 * DAY },
    );
    job.channelDone = true;
    job.textOnly    = res.imgFailed;
    await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: DAY });
  }

  if (off !== job.next) return { done: false, next: job.next, total: job.subs.length };

  const batch = job.subs.slice(off, off + job.bs);
  const sent  = [];
  const gone  = [];

  for (let i = 0; i < batch.length; i += 10) {
    const group   = batch.slice(i, i + 10);
    const results = await Promise.all(
      group.map((chatId) => sendToChat(env, st, chatId, job.spec, job.textOnly)),
    );
    results.forEach((r, k) => {
      if (r.ids.length) sent.push([group[k], r.ids]);
      if (r.gone)      gone.push(group[k]);
    });
    if (i + 10 < batch.length) await sleep(400);
  }

  const batchNo = Math.floor(off / job.bs);
  await env.KV.put(`msgs:${kid}:${batchNo}`, JSON.stringify(sent), { expirationTtl: 30 * DAY });

  for (const id of gone.slice(0, 5)) await env.KV.delete(`sub:${id}`);

  job.next = off + job.bs;
  job.done = job.next >= job.subs.length;
  await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: DAY });

  return { done: job.done, next: job.next, total: job.subs.length };
}

async function remove(req, env) {
  const { postId, offset, kind } = await req.json().catch(() => ({}));
  checkPostId(postId);

  const isReport = kind === 'report' || kind === 'classroom';
  const coll     = isReport ? 'reports' : 'posts';
  const kid      = isReport ? 'R' + postId : postId;
  const step     = Number(offset) || 0;
  const st       = { retries: 0 };

  const got = await fetchPostAdmin(postId, coll, env);
  if (got.status === 200) throw new HttpError(409, 'post_still_exists');
  if (got.status !== 404) throw new HttpError(got.status, got.error || 'firestore_error');

  if (step === 0) await env.KV.delete(`job:${kid}`);

  const key = step === 0 ? `msgs:${kid}:ch` : `msgs:${kid}:${step - 1}`;
  const rec = await env.KV.get(key, 'json');
  if (!rec) return step === 0 ? { done: false, next: 1 } : { done: true };

  for (let i = 0; i < rec.length; i += 10) {
    const group = rec.slice(i, i + 10);
    await Promise.all(
      group.map(([chatId, ids]) => tg(env, st, 'deleteMessages', { chat_id: chatId, message_ids: ids })),
    );
    if (i + 10 < rec.length) await sleep(400);
  }
  await env.KV.delete(key);
  return { done: false, next: step + 1 };
}

async function scheduledPublish(env) {
  try {
    console.log('[Scheduled] بدء النشر المجدول لتحاضير الغد...');

    const tomorrow    = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const dateLabel   = `${AR_DAYS[tomorrow.getUTCDay()]} ${tomorrow.getUTCDate()} / ${tomorrow.getUTCMonth() + 1}`;

    const token = await googleToken(env);

    const queryBody = {
      structuredQuery: {
        from:    [{ collectionId: 'posts' }],
        where:   {
          fieldFilter: {
            field: { fieldPath: 'dayId' },
            op:    'EQUAL',
            value: { stringValue: tomorrowStr },
          },
        },
        orderBy: [{ field: { fieldPath: 'subject' }, direction: 'ASCENDING' }],
        limit:   50,
      },
    };

    const r = await fetch(`${FS}:runQuery`, {
      method:  'POST',
      headers: auth(token),
      body:    JSON.stringify(queryBody),
    });
    const results = await r.json().catch(() => []);

    if (!Array.isArray(results)) {
      console.error('[Scheduled] فشل استعلام Firestore:', JSON.stringify(results));
      return;
    }

    const preps = results
      .filter((x) => x && x.document && x.document.fields)
      .map((x) => decodeFields(x.document.fields));

    if (!preps.length) {
      console.log(`[Scheduled] لا توجد تحاضير ليوم الغد (${tomorrowStr})`);
      return;
    }

    const lines = [];
    lines.push(`<u>تحاضير يوم غد ${esc(dateLabel)} عدنا</u>`);

    for (const p of preps) {
      const subject = esc(String(p.subject || p.title || '').slice(0, 100));
      const type    = esc(String(p.type    || '').slice(0, 60));
      const note    = esc(String(p.note    || '').slice(0, 300));

      if (subject || type) {
        lines.push(`\n📚 ${subject}${subject && type ? ' — ' : ''}${type}`);
      }
      if (note) {
        lines.push(`<blockquote>" ${note} "</blockquote>`);
      }
    }

    lines.push(`\n<a href="${esc(SITE_URL)}">ألفاكلاس</a>`);

    let scheduledText = lines.join('\n');
    if (scheduledText.length > 3800) scheduledText = scheduledText.slice(0, 3800) + '…';

    const st = { retries: 0 };

    if (env.CHANNEL_ID) {
      const ch = await tg(env, st, 'sendMessage', {
        chat_id:    env.CHANNEL_ID,
        text:       scheduledText,
        parse_mode: 'HTML',
      });
      console.log(`[Scheduled] القناة ${env.CHANNEL_ID}:`, ch.ok ? '✅ تم' : `❌ ${ch.description}`);
    }

    const subs = await listSubs(env);
    console.log(`[Scheduled] عدد المشتركين: ${subs.length}`);

    let failCount = 0;
    for (let i = 0; i < subs.length; i += 10) {
      const group = subs.slice(i, i + 10);
      const res   = await Promise.all(group.map((chatId) =>
        tg(env, st, 'sendMessage', {
          chat_id:    chatId,
          text:       scheduledText,
          parse_mode: 'HTML',
        }).then((j) => ({ chatId, ok: j.ok, gone: isGone(j) }))
          .catch(() => ({ chatId, ok: false, gone: false })),
      ));
      for (const item of res) {
        if (item.gone) {
          await env.KV.delete(`sub:${item.chatId}`);
          failCount++;
        }
      }
      if (i + 10 < subs.length) await sleep(400);
    }

    console.log(
      `[Scheduled] ✅ اكتمل — ${preps.length} تحضير | ${subs.length} مشترك | ${failCount} محذوف من KV`,
    );
  } catch (e) {
    console.error('[Scheduled] خطأ:', e && e.message);
  }
}