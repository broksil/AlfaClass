// ══════════════════════════════════════════════════════════════════════════════
//  AlfaClass — Cloudflare Worker (النسخة الاحترافية الشاملة والمضمونة)
//  بوت تلكرام + بث شامل موثوق للمشتركين والكروبات والقنوات + نشر مجدول
// ══════════════════════════════════════════════════════════════════════════════

// ── ثوابت المشروع ──────────────────────────────────────────────────────────
const PROJECT_ID = 'alfaclass-120e3';
const SITE_URL   = 'https://broksil.github.io/AlfaClass/';
const MAX_CALLS  = 30; // أقصى عدد طلبات لتلكرام في كل دفعة تشغيل

// أسماء أيام الأسبوع بالعربية
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// ══════════════════════════════════════════════════════════════════════════════
//  نقطة دخول الـ Worker (معالجة الطلبات + Cron)
// ══════════════════════════════════════════════════════════════════════════════
export default {

  async fetch(req, env) {
    const url = new URL(req.url);

    // ── معالجة CORS الشاملة (تسمح بالاتصال من أي دومين أو محلياً) ──
    const reqOrigin = req.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin':  reqOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age':       '86400',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/webhook'  && req.method === 'POST') return await webhook(req, env);
      if (url.pathname === '/register' && req.method === 'GET')  return await register(url, env);
      if (url.pathname === '/tg-auth'  && req.method === 'POST') return reply(await tgAuth(req, env), 200, cors);
      if (url.pathname === '/user-profile' && req.method === 'GET') return reply(await getUserProfile(url, env), 200, cors);
      if (url.pathname === '/verified-users' && req.method === 'GET') return reply(await getVerifiedUsers(env), 200, cors);
      if (url.pathname === '/publish'  && req.method === 'POST') return reply(await publish(req, env), 200, cors);
      if (url.pathname === '/delete'   && req.method === 'POST') return reply(await remove(req, env), 200, cors);

      // فحص وإرسال تحاضير الغد (تلقائياً أو يدوياً)
      if (url.pathname === '/check-scheduled' || url.pathname === '/trigger-scheduled') {
        const force = url.searchParams.get('force') === '1' || url.pathname === '/trigger-scheduled';
        const res = await checkAndSendTomorrowPreps(env, { force });
        return reply(res, 200, cors);
      }

      // فحص الحالة وعدد المشتركين (GET /)
      if (url.pathname === '/' || url.pathname === '/status') {
        const subs = await listSubs(env);
        const baghdad = getBaghdadInfo();
        const sentKey = `scheduled_sent:${baghdad.tomorrowStr}`;
        const alreadySent = env.KV ? await env.KV.get(sentKey) : null;

        return reply({
          ok: true,
          name: 'alfaclass-bot',
          subscribers_count: subs.length,
          channel_configured: !!env.CHANNEL_ID,
          baghdad_time: `${baghdad.currentHour}:${String(baghdad.baghdadNow.getUTCMinutes()).padStart(2, '0')}`,
          tomorrow_target: baghdad.tomorrowStr,
          tomorrow_scheduled_sent: !!alreadySent,
        }, 200, cors);
      }

      return reply({ ok: true, name: 'alfaclass-bot' }, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status, cors);
      console.error('[Worker Fatal Error]:', e && (e.stack || e.message));
      return reply({ error: e.message || 'internal_error' }, 500, cors);
    }
  },

  // النشر المجدول التلقائي (Cron Trigger)
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAndSendTomorrowPreps(env, { isCron: true }));
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  أدوات مساعدة
// ══════════════════════════════════════════════════════════════════════════════

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

// تهريب حروف HTML لتنسيق تلكرام المعتمد فقط (& و < و >)
// ملاحظة مهمة: تلكرام لا يدعم &quot; في parse_mode: HTML، لذا لا نغيّر علامات الاقتباس!
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

// ══════════════════════════════════════════════════════════════════════════════
//  Telegram Bot API Helper (مع معالجة ذكية للأخطاء)
// ══════════════════════════════════════════════════════════════════════════════

async function tg(env, st, method, body) {
  if (!env.BOT_TOKEN) {
    console.error('[tg] خطأ: BOT_TOKEN غير موجود بإعدادات الـ Worker!');
    return { ok: false, error_code: 500, description: 'BOT_TOKEN_missing' };
  }

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
      return { ok: false, error_code: 0, description: 'network_error: ' + (e && e.message) };
    }

    if (j.ok) return j;

    // إذا كان الخطأ بسبب مشاكل تنسيق HTML، أعد المحاولة فوراً كنص عادي بدون parse_mode
    if (body.parse_mode && j.description && /can't parse entities|unsupported start tag/i.test(j.description)) {
      console.warn('[tg] خطأ تنسيق HTML، جاري الإرسال كنص عادي:', j.description);
      const fallbackBody = { ...body };
      delete fallbackBody.parse_mode;
      // إزالة وسوم HTML من النص
      if (fallbackBody.text) {
        fallbackBody.text = fallbackBody.text.replace(/<[^>]+>/g, '');
      }
      if (fallbackBody.caption) {
        fallbackBody.caption = fallbackBody.caption.replace(/<[^>]+>/g, '');
      }
      try {
        const rFallback = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(fallbackBody),
        });
        const jFallback = await rFallback.json();
        if (jFallback.ok) return jFallback;
      } catch (e2) {}
    }

    // الانتظار عند تجاوز المعدل (Rate Limit - 429)
    const wait = j.error_code === 429 ? ((j.parameters && j.parameters.retry_after) || 1) : 0;
    if (wait && wait <= 5 && st && st.retries < 3) {
      st.retries++;
      await sleep(wait * 1000);
      continue;
    }

    return j;
  }
  return { ok: false, error_code: 429, description: 'rate_limited' };
}

// هل تم حظر البوت أو حذف المحادثة؟
const isGone = (j) =>
  j && !j.ok && (
    j.error_code === 403 ||
    (j.error_code === 400 && /chat not found|bot was blocked|user is deactivated|bot was kicked/i.test(j.description || ''))
  );

// ══════════════════════════════════════════════════════════════════════════════
//  Webhook: استقبال التحديثات من تلكرام والاشتراك التلقائي للكروبات والقنوات
// ══════════════════════════════════════════════════════════════════════════════

async function webhook(req, env) {
  if (env.WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const u  = await req.json().catch(() => ({}));
  const st = { retries: 0 };

  // ── 1) الاشتراك التلقائي بمجرد إضافة البوت إلى قناة أو كروب ──
  // عندما يُضاف البوت كمسؤول أو عضو في أي كروب أو قناة، يُحفظ المعرّف فوراً في KV
  const mc = u.my_chat_member;
  if (mc && mc.chat && env.KV) {
    const chatId = mc.chat.id;
    const newStatus = mc.new_chat_member && mc.new_chat_member.status;

    if (newStatus === 'administrator' || newStatus === 'member') {
      await env.KV.put(`sub:${chatId}`, '1');
      console.log(`[Webhook] تم اشتراك ${mc.chat.type} تلقائياً: ${chatId} (${mc.chat.title || ''})`);

      // إرسال رسالة تأكيد للكروب إذا كانت مجموعة
      if (mc.chat.type === 'group' || mc.chat.type === 'supergroup') {
        await tg(env, st, 'sendMessage', {
          chat_id: chatId,
          text: '✅ <b>ألفاكلاس</b>\nتم تفعيل إشعارات التحاضير والبلاغات لهذه المجموعة تلقائياً! 📚',
          parse_mode: 'HTML',
        });
      }
    } else if (newStatus === 'kicked' || newStatus === 'left') {
      await env.KV.delete(`sub:${chatId}`);
      console.log(`[Webhook] تم إيقاف الاشتراك عند مغادرة البوت: ${chatId}`);
    }
  }

  // ── 2) معالجة الرسائل العادية ورسائل القنوات (Channel Posts) ──
  const m = u.message || u.channel_post;
  if (m && m.chat && env.KV) {
    const chatId  = m.chat.id;
    const rawText = String(m.text || '').trim();
    const cmd     = rawText.split(/[\s@]/)[0].toLowerCase();

    // كلمات التشغيل: /start أو /تشغيل أو /تفعيل أو تشغيل أو تفعيل
    const isStartCmd =
      cmd === '/start' || cmd === '/تشغيل' || cmd === '/تفعيل' ||
      rawText === 'تشغيل' || rawText === 'تفعيل';

    // كلمات الإيقاف: /stop أو /ايقاف أو /إيقاف أو إيقاف أو تعطيل
    const isStopCmd =
      cmd === '/stop' || cmd === '/ايقاف' || cmd === '/إيقاف' ||
      rawText === 'إيقاف' || rawText === 'ايقاف' || rawText === 'تعطيل';

    if (isStartCmd) {
      await env.KV.put(`sub:${chatId}`, '1');
      console.log(`[Webhook] تم تفعيل الاشتراك للدردشة: ${chatId}`);

      if (m.chat.type === 'private') {
        await tg(env, st, 'sendMessage', {
          chat_id:    chatId,
          parse_mode: 'HTML',
          text: (
            '✅ <b>تم تفعيل الإشعارات بنجاح!</b>\n\n' +
            'ستصلك التحاضير والبلاغات الجديدة هنا فور نشرها بالموقع.\n' +
            'لإيقافها في أي وقت أرسل /stop\n\n' +
            'اضغط الزر أدناه لفتح ألفاكلاس بحسابك 👇'
          ),
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 فتح ألفاكلاس', web_app: { url: SITE_URL } },
            ]],
          },
        });
      } else {
        await tg(env, st, 'sendMessage', {
          chat_id:    chatId,
          parse_mode: 'HTML',
          text: '✅ <b>ألفاكلاس</b> — تم تفعيل الإشعارات لهذه المحادثة بنجاح.',
        });
      }
    } else if (isStopCmd) {
      await env.KV.delete(`sub:${chatId}`);
      await tg(env, st, 'sendMessage', {
        chat_id:    chatId,
        parse_mode: 'HTML',
        text: '⏹️ تم إيقاف الإشعارات. لتفعيلها مجدداً أرسل /start أو /تشغيل',
      });
    }
  }

  return new Response('ok');
}

// ── تسجيل الـ Webhook (يُفتح مرة واحدة بالمتصفح) ─────────────────────────
async function register(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden (مفتاح التحقق غير صحيح)', { status: 403 });
  }
  const st = { retries: 0 };

  // تسجيل الـ Webhook مع السماح برسائل القنوات والكروبات والأعضاء
  const j = await tg(env, st, 'setWebhook', {
    url:             `${url.origin}/webhook`,
    secret_token:    env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'channel_post', 'my_chat_member'],
  });

  const menu = await tg(env, st, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'فتح ألفاكلاس', web_app: { url: SITE_URL } },
  });

  return new Response(JSON.stringify({ webhook: j, menu_button: menu }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  Google Service Account & Firestore REST API (Admin Access)
// ══════════════════════════════════════════════════════════════════════════════

const FS                 = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
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
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64uStr(JSON.stringify(claims));
  const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

let gTok = null;
async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (gTok && gTok.exp > now + 60) return gTok.token;
  const sa = getSA(env);
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

const S    = (v) => ({ stringValue: String(v == null ? '' : v) });
const B    = (v) => ({ booleanValue: !!v });
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

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
  if (await fsHas(token, 'username',         'EQUAL',          name)) return true;
  if (await fsHas(token, 'previousUsername',  'EQUAL',          name)) return true;
  if (await fsHas(token, 'takenUsernames',    'ARRAY_CONTAINS', name)) return true;
  return false;
}

// ── تسجيل الدخول التلقائي من ميني آب ──
async function tgAuth(req, env) {
  const { initData } = await req.json().catch(() => ({}));
  if (typeof initData !== 'string' || !initData || initData.length > 4000) throw new HttpError(400, 'bad_init_data');
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
      username:       S(username),
      fullName:       S(fullName),
      shift:          S(''),
      section:        S(''),
      role:           S('student'),
      uid:            S(uid),
      createdAt:      { timestampValue: new Date().toISOString() },
      userId:         { integerValue: uid },
      emailPrefix:    S(username),
      perms:          { mapValue: { fields: {
        prep:     B(false), report:  B(false), material: B(false),
        comment:  B(false), enquiry: B(false), support:  B(false),
        verify:   B(false), profile: B(true),  vote:     B(false),
      } } },
      takenUsernames: { arrayValue: { values: [S(username)] } },
      photoURL:       S(photo),
      tgId:           { integerValue: uid },
      tgUsername:     S(u.username || ''),
      authProvider:   S('telegram'),
    };
    const r = await fetch(`${FS}/users/${uid}?currentDocument.exists=false`, {
      method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields }),
    });
    if (r.ok) {
      created = true;
      if (u.allows_write_to_pm && env.KV) await env.KV.put(`sub:${id}`, '1').catch(() => {});
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

  const photoToUse = photo || d.photoURL || '';
  if (!created && photo && photo !== d.photoURL) {
    await fetch(`${FS}/users/${uid}?updateMask.fieldPaths=photoURL`, {
      method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields: { photoURL: S(photo) } }),
    }).catch(() => {});
  }

  return {
    customToken:  await firebaseCustomToken(env, uid),
    username:     d.username,
    fullName:     d.fullName || d.username,
    userId:       id,
    photoURL:     photoToUse,
    authProvider: 'telegram',
    created,
  };
}

// ── استعلام موثوق عن بيانات المستخدم (يدعم حسابات تلكرام والحسابات العادية) ──
async function getUserProfile(url, env) {
  const id = (url.searchParams.get('id') || url.searchParams.get('userId') || '').trim();
  if (!id) throw new HttpError(400, 'id_required');
  const token = await googleToken(env);
  
  // 1) محاولة القراءة المباشرة من مسار المستند /users/${id}
  let cur = await fsGetUser(token, id);
  
  // 2) إذا لم يوجد، نبحث بحقل userId
  if (cur.status === 404 && /^\d+$/.test(id)) {
    const qRes = await fetch(`${FS}:runQuery`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'userId' },
              op: 'EQUAL',
              value: { integerValue: id }
            }
          },
          limit: 1
        }
      })
    }).catch(() => null);
    if (qRes && qRes.ok) {
      const rows = await qRes.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0 && rows[0].document) {
        cur = { status: 200, data: decodeFields(rows[0].document.fields || {}) };
      }
    }
  }

  // 3) إذا لم يوجد، نبحث بحقل username
  if (cur.status === 404) {
    const qU = await fetch(`${FS}:runQuery`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'username' },
              op: 'EQUAL',
              value: { stringValue: id.toLowerCase() }
            }
          },
          limit: 1
        }
      })
    }).catch(() => null);
    if (qU && qU.ok) {
      const rows = await qU.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0 && rows[0].document) {
        cur = { status: 200, data: decodeFields(rows[0].document.fields || {}) };
      }
    }
  }

  // إذا وجدنا المستند في فايربيس
  if (cur.status === 200) {
    const d = cur.data;
    let photo = d.photoURL || '';
    const tgId = d.tgId || (/^\d{8,12}$/.test(id) ? id : null);
    
    // إذا كان حساب تلكرام وتنقصه الصورة، نحاول جلبها من Telegram Bot API
    if (!photo && tgId && env.BOT_TOKEN) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getUserProfilePhotos?user_id=${tgId}&limit=1`);
        const tgJson = await tgRes.json().catch(() => ({}));
        if (tgJson.ok && tgJson.result && tgJson.result.photos && tgJson.result.photos[0] && tgJson.result.photos[0][0]) {
          const fileId = tgJson.result.photos[0][0].file_id;
          const fRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
          const fJson = await fRes.json().catch(() => ({}));
          if (fJson.ok && fJson.result && fJson.result.file_path) {
            photo = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fJson.result.file_path}`;
            // حفظ الصورة في Firestore لتقليل استهلاك Telegram API مستقبلاً
            fetch(`${FS}/users/${d.uid || id}?updateMask.fieldPaths=photoURL`, {
              method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields: { photoURL: S(photo) } }),
            }).catch(() => {});
          }
        }
      } catch (e) {}
    }

    return {
      ok: true,
      user: {
        userId: d.userId || d.tgId || id,
        username: d.username || d.tgUsername || '',
        fullName: d.fullName || d.username || ('عضو #' + id),
        photoURL: photo,
        authProvider: d.authProvider || (d.tgId ? 'telegram' : 'local'),
        role: d.role || 'student',
        shift: d.shift || '',
        section: d.section || ''
      }
    };
  }

  // إذا لم نجد مستند في Firestore لكن المعرف رقمي تلكرام محتمل
  if (/^\d{8,12}$/.test(id) && env.BOT_TOKEN) {
    try {
      const chatRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChat?chat_id=${id}`);
      const chatJson = await chatRes.json().catch(() => ({}));
      if (chatJson.ok && chatJson.result) {
        const c = chatJson.result;
        const fn = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || ('طالب تلكرام #' + id);
        return {
          ok: true,
          user: {
            userId: id,
            username: c.username || '',
            fullName: fn,
            photoURL: '',
            authProvider: 'telegram',
            role: 'student'
          }
        };
      }
    } catch (e) {}
  }

  throw new HttpError(404, 'user_not_found');
}

// ── جلب قائمة معرّفات الموثقين بصلاحية Admin لتفادي أي قيود حماية على فايربيس ──
async function getVerifiedUsers(env) {
  const token = await googleToken(env);
  const qRes = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'perms.verify' },
            op: 'EQUAL',
            value: { booleanValue: true }
          }
        }
      }
    })
  }).catch(() => null);

  const ids = [];
  if (qRes && qRes.ok) {
    const rows = await qRes.json().catch(() => []);
    if (Array.isArray(rows)) {
      rows.forEach(r => {
        if (r.document) {
          const docId = r.document.name.split('/').pop();
          if (docId) ids.push(docId);
          const fields = decodeFields(r.document.fields || {});
          if (fields.userId != null) ids.push(String(fields.userId));
          if (fields.username) ids.push(String(fields.username).toLowerCase());
          if (fields.tgId != null) ids.push(String(fields.tgId));
          if (fields.fullName) ids.push(String(fields.fullName));
        }
      });
    }
  }
  return { ok: true, ids: [...new Set(ids)] };
}

// ── قراءة المنشور من Firestore بصلاحيات موثوقة (Admin Token أولاً لتفادي أي رفض) ──
async function fetchPost(postId, idToken, coll = 'posts', env = null) {
  // 1) استخدام حساب الخدمة Admin مباشرة إذا كان متوفراً (يضمن قراءة البيانات 100%)
  if (env && env.FIREBASE_SA) {
    try {
      const adminToken = await googleToken(env);
      const r = await fetch(`${FS}/${coll}/${postId}`, { headers: auth(adminToken) });
      if (r.status === 200) {
        const j = await r.json().catch(() => ({}));
        return { status: 200, data: decodeFields(j.fields || {}) };
      }
      if (r.status === 404) return { status: 404 };
    } catch (e) {
      console.warn('[fetchPost] فشل القراءة بصلاحيات Admin، جاري تجربة توكن العميل:', e.message);
    }
  }

  // 2) احتياطي: القراءة بتوكن المستخدم
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const r = await fetch(`${FS}/${coll}/${postId}`, { headers });
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

// ══════════════════════════════════════════════════════════════════════════════
//  تنسيق رسائل تلكرام (HTML) — مطابقة تامة للأسطر والتباعد والنماذج المطلوبة
// ══════════════════════════════════════════════════════════════════════════════

function arabicDateFromDayId(dayId) {
  if (typeof dayId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayId)) {
    const d   = new Date(dayId + 'T00:00:00Z');
    const day = AR_DAYS[d.getUTCDay()];
    return `${day} ${d.getUTCDate()} / ${d.getUTCMonth() + 1}`;
  }
  const now = new Date();
  return `${AR_DAYS[now.getUTCDay()]} ${now.getUTCDate()} / ${now.getUTCMonth() + 1}`;
}

// ── القسم الأول: التحاضير اليومية ──
// النمط:
// يوم الثلاثاء 6 / 5 عدنا (تسطير)
// [سطر فارغ]
// 📚 فاينل — الخطر
// [سطر فارغ]
// الملاحظات (اقتباس)
// ألفاكلاس (مباشرة تحت الاقتباس بدون سطر فارغ، رابط للمنشور)
function buildPrepMessage(p, postId) {
  const postUrl = `${SITE_URL}#post-${postId}`;
  const dateStr = arabicDateFromDayId(p.dayId || p.date || '');

  const type    = esc(String(p.type    || '').trim().slice(0, 60));
  const subject = esc(String(p.subject || p.title || '').trim().slice(0, 100));
  const note    = esc(String(p.note    || '').trim().slice(0, 800));

  let itemTitle = '';
  if (type && subject) {
    itemTitle = `${type} — ${subject}`;
  } else {
    itemTitle = type || subject || 'تحضير';
  }

  const parts = [];
  parts.push(`<u>يوم ${dateStr} عدنا</u>`);
  parts.push(`📚 ${itemTitle}`);

  if (note) {
    parts.push(`<blockquote>${note}</blockquote>\n<a href="${esc(postUrl)}">ألفاكلاس</a>`);
  } else {
    parts.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);
  }

  return parts.join('\n\n');
}

// ── القسم الثاني: البلاغات العامة ──
// النمط:
// <u>📣  تجربه</u> (عنوان البلاغ مسطر)
// [سطر فارغ]
// التفاصيل (اقتباس)
// ألفاكلاس (مباشرة تحت الاقتباس، رابط المنشور)
function buildReportMessage(p, postId) {
  const postUrl = `${SITE_URL}#report-${postId}`;
  const title   = esc(String(p.title || p.subject || 'بلاغ').trim().slice(0, 150));
  const body    = esc(String(p.body  || p.note    || '').trim().slice(0, 800));

  const parts = [];
  parts.push(`<u>📣  ${title}</u>`);

  if (body) {
    parts.push(`<blockquote>${body}</blockquote>\n<a href="${esc(postUrl)}">ألفاكلاس</a>`);
  } else {
    parts.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);
  }

  return parts.join('\n\n');
}

// ── القسم الثالث: بلاغات الأساتذة / كلاس روم ──
// النمط:
// 📚 المحاسبة الحكومية
// المرحلة الثانية / مسائي - أ - (رمز)
// [سطر فارغ]
// التفاصيل (اقتباس)
// [سطر فارغ]
// 🧑🏻‍🏫 بتول يونس (اسم الأستاذ)
// [سطر فارغ]
// انقر على التفاصيل (رابط الكلاس روم للمنشور)
function buildClassroomMessage(p, postId) {
  const targetUrl = isHttp(p.classroomUrl || p.detailsLink || p.link)
    ? (p.classroomUrl || p.detailsLink || p.link)
    : `${SITE_URL}#post-${postId}`;

  const subject = esc(String(p.subject || p.subjectName || p.title || '').trim().slice(0, 100));
  const grade   = esc(String(p.grade   || p.stage       || p.level || '').trim().slice(0, 60));
  const study   = esc(String(p.study   || '').trim().slice(0, 60));
  const group   = esc(String(p.group   || p.section     || '').trim().slice(0, 30));
  const code    = esc(String(p.code    || '').trim().slice(0, 30));
  const details = esc(String(p.note    || p.messageContent || p.body || p.details || '').trim().slice(0, 800));
  const teacher = esc(String(p.author  || p.teacherName || p.teacher || '').trim().slice(0, 60));

  // سطر المادة + سطر المرحلة مباشرة تحته بدون سطر فارغ
  const headerLines = [];
  if (subject) headerLines.push(`📚 ${subject}`);

  const infoParts = [];
  if (grade) infoParts.push(grade);
  if (study) infoParts.push(study);
  if (group) infoParts.push(group.startsWith('-') ? group : `- ${group} -`);
  if (code)  infoParts.push(`(${code})`);

  const gradeInfo = infoParts.join(' / ');
  if (gradeInfo) headerLines.push(gradeInfo);

  const sections = [];
  sections.push(headerLines.join('\n'));

  if (details) {
    sections.push(`<blockquote>${details}</blockquote>`);
  }

  if (teacher) {
    sections.push(`🧑🏻‍🏫 ${teacher}`);
  }

  sections.push(`<a href="${esc(targetUrl)}">انقر على التفاصيل</a>`);

  return sections.join('\n\n');
}

// بناء مواصفات المنشور كاملة
function buildSpec(p, kind, postId) {
  const images = (Array.isArray(p.images) ? p.images : []).filter(isHttp).slice(0, 10);
  const files  = (Array.isArray(p.files)  ? p.files  : []).filter((f) => f && isHttp(f.url));

  let text;
  if      (kind === 'classroom') text = buildClassroomMessage(p, postId || '');
  else if (kind === 'report')    text = buildReportMessage(p, postId || '');
  else                           text = buildPrepMessage(p, postId || '');

  // إضافة المرفقات إن وجدت
  const extras = [];
  for (const f of files)  extras.push(`📎 <a href="${esc(f.url)}">${esc(f.name || 'ملف')}</a>`);
  if (isHttp(p.voiceUrl)) extras.push(`🎤 <a href="${esc(p.voiceUrl)}">تسجيل صوتي</a>`);
  if (p.poll)             extras.push('📊 فيه استفتاء، شارك من الموقع');
  if (extras.length)      text += '\n\n' + extras.join('\n');

  if (text.length > 3800) text = text.slice(0, 3800) + '…';

  const captionFits = text.length <= 1024;
  const caption     = captionFits ? text : (text.split('\n')[0] || '📚');
  const needsText   = images.length === 0 || !captionFits;
  const cpr         = images.length > 0 && !captionFits ? 2 : 1;

  return { text, caption, images, needsText, cpr };
}

// ══════════════════════════════════════════════════════════════════════════════
//  إرسال الرسالة إلى محادثة واحدة (قناة، كروب، أو مستخدم خاص)
// ══════════════════════════════════════════════════════════════════════════════

async function sendToChat(env, st, chatId, spec, textOnly) {
  const ids       = [];
  let   imgFailed = false;
  let   gone      = false;
  const imgs      = textOnly ? [] : spec.images;

  // 1) إرسال صورة فردية
  if (imgs.length === 1) {
    const r = await tg(env, st, 'sendPhoto', {
      chat_id:    chatId,
      photo:      imgs[0],
      caption:    spec.caption,
      parse_mode: 'HTML',
    });
    if (r.ok) ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else imgFailed = true;

  // 2) إرسال مجموعة صور (MediaGroup)
  } else if (imgs.length > 1) {
    const media = imgs.map((u, i) => i === 0
      ? { type: 'photo', media: u, caption: spec.caption, parse_mode: 'HTML' }
      : { type: 'photo', media: u }
    );
    const r = await tg(env, st, 'sendMediaGroup', { chat_id: chatId, media });
    if (r.ok) r.result.forEach((m) => ids.push(m.message_id));
    else if (isGone(r)) gone = true;
    else imgFailed = true;
  }

  // 3) إرسال النص (إذا لم توجد صور أو كانت الصورة تتطلب نصاً منفصلاً أو فشلت الصورة)
  if (!gone && (spec.needsText || textOnly || imgFailed)) {
    let text = spec.text;
    if (imgFailed || (textOnly && spec.images.length)) {
      text += '\n\n' + spec.images
        .map((u, i) => `🖼️ <a href="${esc(u)}">صورة ${i + 1}</a>`)
        .join('\n');
    }
    const r = await tg(env, st, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    if (r.ok) ids.push(r.result.message_id);
    else if (isGone(r)) gone = true;
    else if (!ids.length) return { ids, gone, imgFailed, error: r.description || 'send_failed' };
  }

  return { ids, gone, imgFailed };
}

// ══════════════════════════════════════════════════════════════════════════════
//  قائمة المشتركين (Private + Groups + Channels)
// ══════════════════════════════════════════════════════════════════════════════

function checkPostId(postId) {
  if (typeof postId !== 'string' || !/^[A-Za-z0-9_\-]{6,50}$/.test(postId)) {
    throw new HttpError(400, 'bad_post_id');
  }
}

// جلب جميع المشتركين (يدعم المعرفات الرقمية السالبة للكروبات والموجبة للأفراد)
async function listSubs(env) {
  if (!env.KV) {
    console.warn('[listSubs] تنبيه: الـ KV غير مربوط بالـ Worker!');
    return [];
  }
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix: 'sub:', cursor });
    if (!r || !r.keys) break;
    for (const k of r.keys) {
      const raw = k.name.slice(4).trim();
      if (!raw) continue;
      // إذا كان معرّفاً رقمياً (مثل -100xxx للكروبات والقنوات أو xxx للخاص)
      const val = /^-?\d+$/.test(raw) ? Number(raw) : raw;
      if (val) out.push(val);
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
//  البث الشامل (Publish) — مضمون ولا يتوقف عند خطأ القناة
// ══════════════════════════════════════════════════════════════════════════════

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

  let job = env.KV ? await env.KV.get(jobKey, 'json') : null;

  // تهيئة مهمة النشر عند البداية
  if (!job) {
    // جلب بيانات المنشور من Firestore مع تمرير env للأدمن
    const got = await fetchPost(postId, idToken, coll, env);
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

    if (env.KV) {
      await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: DAY });
    }
  }

  if (job.done) return { done: true, already: true };

  // ── 1) إرسال للقناة الرئيسية (إن وجدت ولا نوقف البث إذا فشلت!) ──
  if (!job.channelDone) {
    if (env.CHANNEL_ID) {
      try {
        console.log(`[Publish] جاري الإرسال للقناة الرئيسية: ${env.CHANNEL_ID}`);
        const res = await sendToChat(env, st, env.CHANNEL_ID, job.spec, false);
        if (res.ids.length && env.KV) {
          await env.KV.put(`msgs:${kid}:ch`, JSON.stringify([[env.CHANNEL_ID, res.ids]]), { expirationTtl: 30 * DAY });
          job.textOnly = res.imgFailed;
          console.log('[Publish] تم الإرسال للقناة الرئيسية بنجاح.');
        } else {
          console.warn('[Publish] تعذر الإرسال للقناة الرئيسية:', res.error || 'unknown');
        }
      } catch (err) {
        console.error('[Publish] استثناء أثناء إرسال القناة:', err && err.message);
      }
    } else {
      console.log('[Publish] CHANNEL_ID غير معرّف، تم تجاوز القناة الرئيسية والانتقال للمشتركين.');
    }
    job.channelDone = true;
    if (env.KV) await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: DAY });
  }

  // ── 2) إرسال للمشتركين والكروبات والقنوات على دفعات ──
  if (off !== job.next) {
    return { done: false, next: job.next, total: job.subs.length };
  }

  const batch = job.subs.slice(off, off + job.bs);
  const sent  = [];
  const gone  = [];

  for (let i = 0; i < batch.length; i += 10) {
    const group   = batch.slice(i, i + 10);
    const results = await Promise.all(
      group.map((chatId) => sendToChat(env, st, chatId, job.spec, job.textOnly))
    );
    results.forEach((r, k) => {
      if (r.ids.length) sent.push([group[k], r.ids]);
      if (r.gone)       gone.push(group[k]);
    });
    if (i + 10 < batch.length) await sleep(400);
  }

  const batchNo = Math.floor(off / job.bs);
  if (env.KV) {
    await env.KV.put(`msgs:${kid}:${batchNo}`, JSON.stringify(sent), { expirationTtl: 30 * DAY });
    // إزالة الحسابات التي حظرت البوت
    for (const id of gone.slice(0, 5)) {
      await env.KV.delete(`sub:${id}`);
    }
  }

  job.next = off + job.bs;
  job.done = job.next >= job.subs.length;

  if (env.KV) {
    await env.KV.put(jobKey, JSON.stringify(job), { expirationTtl: DAY });
    if (job.done) {
      await env.KV.put(`pub:${kid}`, '1', { expirationTtl: 30 * DAY });
      // إذا كان النشر بعد 9:00 مساءً، تأكد من إرسال رسالة تحاضير الغد المجمعة إن لم تكن قد أُرسلت
      checkAndSendTomorrowPreps(env).catch(() => {});
    }
  }

  return { done: job.done, next: job.next, total: job.subs.length };
}

// ══════════════════════════════════════════════════════════════════════════════
//  حذف المنشور من تلكرام (Delete)
// ══════════════════════════════════════════════════════════════════════════════

async function remove(req, env) {
  const { postId, offset, kind } = await req.json().catch(() => ({}));
  checkPostId(postId);

  const isReport = kind === 'report' || kind === 'classroom';
  const kid      = isReport ? 'R' + postId : postId;
  const step     = Number(offset) || 0;
  const st       = { retries: 0 };

  if (step === 0 && env.KV) await env.KV.delete(`job:${kid}`);

  const key = step === 0 ? `msgs:${kid}:ch` : `msgs:${kid}:${step - 1}`;
  const rec = env.KV ? await env.KV.get(key, 'json') : null;
  if (!rec) return step === 0 ? { done: false, next: 1 } : { done: true };

  for (let i = 0; i < rec.length; i += 10) {
    const group = rec.slice(i, i + 10);
    await Promise.all(
      group.map(([chatId, ids]) => tg(env, st, 'deleteMessages', { chat_id: chatId, message_ids: ids }))
    );
    if (i + 10 < rec.length) await sleep(400);
  }

  if (env.KV) await env.KV.delete(key);
  return { done: false, next: step + 1 };
}

// ══════════════════════════════════════════════════════════════════════════════
//  حساب توقيت بغداد وتاريخ الغد
// ══════════════════════════════════════════════════════════════════════════════

function getBaghdadInfo() {
  // توقيت بغداد = UTC + 3 ساعات (ثابت على مدار السنة بدون توقيت صيفي)
  const baghdadNow  = new Date(Date.now() + (3 * 3600 * 1000));
  const currentHour = baghdadNow.getUTCHours(); // من 0 إلى 23

  // تاريخ الغد بتوقيت بغداد
  const tomorrow    = new Date(baghdadNow.getTime() + (24 * 3600 * 1000));
  const y           = tomorrow.getUTCFullYear();
  const m           = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const d           = String(tomorrow.getUTCDate()).padStart(2, '0');
  const tomorrowStr = `${y}-${m}-${d}`;
  const dateLabel   = `${AR_DAYS[tomorrow.getUTCDay()]} ${tomorrow.getUTCDate()} / ${tomorrow.getUTCMonth() + 1}`;

  return { baghdadNow, currentHour, tomorrowStr, dateLabel, tomorrowDayOfWeek: tomorrow.getUTCDay() };
}

// ── جلب تحاضير يوم محدد من Firestore ──
async function fetchPrepsForDay(token, dayId) {
  // 1) استعلام بحقل dayId (المعتمد بالموقع)
  const queryBody = {
    structuredQuery: {
      from:  [{ collectionId: 'posts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'dayId' },
          op:    'EQUAL',
          value: { stringValue: dayId },
        },
      },
      limit: 50,
    },
  };

  const r = await fetch(`${FS}:runQuery`, {
    method:  'POST',
    headers: auth(token),
    body:    JSON.stringify(queryBody),
  });
  const results = await r.json().catch(() => []);

  let preps = Array.isArray(results)
    ? results.filter((x) => x && x.document && x.document.fields).map((x) => decodeFields(x.document.fields))
    : [];

  // 2) احتياطي: إذا لم يجد بحقل dayId، يفحص حقل date
  if (!preps.length) {
    const fallbackQuery = {
      structuredQuery: {
        from:  [{ collectionId: 'posts' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'date' },
            op:    'EQUAL',
            value: { stringValue: dayId },
          },
        },
        limit: 50,
      },
    };
    const r2 = await fetch(`${FS}:runQuery`, {
      method:  'POST',
      headers: auth(token),
      body:    JSON.stringify(fallbackQuery),
    });
    const results2 = await r2.json().catch(() => []);
    if (Array.isArray(results2)) {
      preps = results2.filter((x) => x && x.document && x.document.fields).map((x) => decodeFields(x.document.fields));
    }
  }

  // ترتيب التحاضير محلياً حسب اسم المادة
  preps.sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), 'ar'));
  return preps;
}

// ══════════════════════════════════════════════════════════════════════════════
//  التحقق الذكي والإرسال المجدول لتحاضير الغد
//  - يتحقق هل أُرسلت الرسالة سابقاً لليوم المطلوب؟ إذا أُرسلت يتخطى (إلا إذا force=true)
//  - إذا لم تُرسل ووجد تحاضير: يرسلها فوراً للقناة والمشتركين ويحفظ علامة الإرسال في KV
// ══════════════════════════════════════════════════════════════════════════════

async function checkAndSendTomorrowPreps(env, options = {}) {
  const force  = !!options.force;
  const isCron = !!options.isCron;
  const info   = getBaghdadInfo();
  const sentKey = `scheduled_sent:${info.tomorrowStr}`;

  console.log(`[ScheduledCheck] وقت بغداد: ${info.currentHour}:${String(info.baghdadNow.getUTCMinutes()).padStart(2, '0')} | تاريخ الغد: ${info.tomorrowStr} | force: ${force}`);

  // إذا لم يكن طلباً إجبارياً ولم يكن كرون: نتحقق أن الوقت بعد 9:00 مساءً (الساعة 21 فأكثر أو الفجر حتى 5)
  if (!force && !isCron) {
    const isEveningTime = info.currentHour >= 21 || info.currentHour <= 4;
    if (!isEveningTime) {
      return {
        ok:           true,
        sent:         false,
        reason:       'not_evening_yet',
        current_hour: info.currentHour,
        message:      'موعد إرسال تحاضير الغد يبدأ من الساعة 9:00 مساءً بتوقيت بغداد',
      };
    }
  }

  // التحقق: هل أُرسلت الرسالة سابقاً ليوم الغد؟
  const alreadySent = env.KV ? await env.KV.get(sentKey) : null;
  if (alreadySent && !force) {
    console.log(`[ScheduledCheck] تم إرسال تحاضير الغد سابقاً (${info.tomorrowStr})، تم التخطي.`);
    return {
      ok:           true,
      sent:         false,
      already_sent: true,
      target_date:  info.tomorrowStr,
      message:      'تم إرسال رسالة تحاضير الغد سابقاً لهذا اليوم بنجاح',
    };
  }

  // جلب توكن الأدمن من Firebase Service Account
  let token;
  try {
    token = await googleToken(env);
  } catch (err) {
    console.error('[ScheduledCheck] فشل جلب توكن Firebase:', err.message);
    return { ok: false, error: 'google_token_failed: ' + err.message };
  }

  // جلب تحاضير الغد
  const preps = await fetchPrepsForDay(token, info.tomorrowStr);

  if (!preps.length) {
    console.log(`[ScheduledCheck] لا توجد تحاضير مسجلة ليوم الغد (${info.tomorrowStr}). لن يتم الإرسال حتى تتوفر تحاضير.`);
    return {
      ok:          true,
      sent:        false,
      reason:      'no_preps_found',
      target_date: info.tomorrowStr,
      date_label:  info.dateLabel,
      message:     `لا توجد تحاضير مسجلة ليوم الغد (${info.tomorrowStr}) حتى الآن. سيتم الإرسال فور تسجيل أول تحضير بعد الساعة 9:00 مساءً.`,
    };
  }

  // ── صياغة رسالة المجدول بالترتيب الدقيق للأسطر والتباعد ──
  // <u>تحاضير يوم غد الثلاثاء 5 / 6 عدنا</u>
  // [سطر فارغ]
  // 📚 تقرير — الحكومية
  // ملاحظات (اقتباس)
  // [سطر فارغ]
  // 📚 ميد — المحاسبة المتوسطة
  // ملاحظات (اقتباس)
  // [سطر فارغ]
  // ألفاكلاس (رابط)
  const prepItems = [];

  for (const p of preps) {
    const type    = esc(String(p.type    || '').trim().slice(0, 60));
    const subject = esc(String(p.subject || p.title || '').trim().slice(0, 100));
    const note    = esc(String(p.note    || '').trim().slice(0, 400));

    let itemTitle = '';
    if (type && subject) {
      itemTitle = `${type} — ${subject}`;
    } else {
      itemTitle = type || subject || 'تحضير';
    }

    if (note) {
      prepItems.push(`📚 ${itemTitle}\n<blockquote>${note}</blockquote>`);
    } else {
      prepItems.push(`📚 ${itemTitle}`);
    }
  }

  const messageBlocks = [];
  messageBlocks.push(`<u>تحاضير يوم غد ${info.dateLabel} عدنا</u>`);
  if (prepItems.length) {
    messageBlocks.push(prepItems.join('\n\n'));
  }
  messageBlocks.push(`<a href="${esc(SITE_URL)}">ألفاكلاس</a>`);

  let scheduledText = messageBlocks.join('\n\n');
  if (scheduledText.length > 3800) scheduledText = scheduledText.slice(0, 3800) + '…';

  const st = { retries: 0 };
  let channelSuccess = false;

  // 1) إرسال للقناة الرئيسية
  if (env.CHANNEL_ID) {
    try {
      const chRes = await tg(env, st, 'sendMessage', {
        chat_id:    env.CHANNEL_ID,
        text:       scheduledText,
        parse_mode: 'HTML',
      });
      channelSuccess = chRes.ok;
      console.log(`[ScheduledCheck] إرسال للقناة ${env.CHANNEL_ID}:`, chRes.ok ? '✅' : chRes.description);
    } catch (e) {
      console.warn('[ScheduledCheck] خطأ إرسال القناة:', e.message);
    }
  }

  // 2) إرسال لجميع المشتركين والكروبات والقنوات في KV
  const subs = await listSubs(env);
  console.log(`[ScheduledCheck] جاري الإرسال لـ ${subs.length} مشترك/كروب/قناة...`);

  let sentCount = 0;
  for (let i = 0; i < subs.length; i += 10) {
    const group = subs.slice(i, i + 10);
    await Promise.all(group.map((chatId) =>
      tg(env, st, 'sendMessage', {
        chat_id:    chatId,
        text:       scheduledText,
        parse_mode: 'HTML',
      }).then(async (res) => {
        if (res.ok) sentCount++;
        if (isGone(res) && env.KV) {
          await env.KV.delete(`sub:${chatId}`);
        }
      }).catch(() => {})
    ));
    if (i + 10 < subs.length) await sleep(400);
  }

  // حفظ علامة الإرسال في KV لمدة 48 ساعة حتى لا تتكرر
  if (env.KV) {
    await env.KV.put(sentKey, '1', { expirationTtl: 86400 * 2 });
  }

  console.log(`[ScheduledCheck] ✅ تم الإرسال بنجاح! ${preps.length} تحضير تم إرساله لـ ${sentCount} مشترك.`);

  return {
    ok:               true,
    sent:             true,
    target_date:      info.tomorrowStr,
    date_label:       info.dateLabel,
    preps_count:      preps.length,
    subscribers_sent: sentCount,
    channel_success:  channelSuccess,
  };
}
