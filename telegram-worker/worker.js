// ══════════════════════════════════════════════════════════════════════════════
//  AlfaClass — Cloudflare Worker (النسخة الاحترافية الشاملة والمضمونة)
//  بوت تلكرام + بث شامل موثوق للمشتركين والكروبات والقنوات + نشر مجدول
// ══════════════════════════════════════════════════════════════════════════════

// ── ثوابت المشروع ──────────────────────────────────────────────────────────
const PROJECT_ID = 'alfaclass-120e3';
const SITE_URL   = 'https://broksil.github.io/AlfaClass/';
const BOT_LINK   = 'http://t.me/AlfaaClassbot/ALFA';
const BATCH_SIZE = 15; // عدد المشتركين في كل دفعة (آمن لحدود Cloudflare Subrequests)

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
      if (url.pathname === '/edit'     && req.method === 'POST') return reply(await editPost(req, env), 200, cors);
      if (url.pathname === '/delete'   && req.method === 'POST') return reply(await remove(req, env), 200, cors);
      if (url.pathname === '/sync-scheduled') {
        const targetDate = url.searchParams.get('date');
        const res = await syncScheduledTomorrowMessage(env, targetDate);
        return reply(res, 200, cors);
      }

      // فحص وإرسال تحاضير الغد (تلقائياً أو يدوياً)
      if (url.pathname === '/check-scheduled' || url.pathname === '/trigger-scheduled') {
        const force = url.searchParams.get('force') === '1' || url.pathname === '/trigger-scheduled';
        const res = await checkAndSendTomorrowPreps(env, { force });
        // إذا كان اليوم خميس، نتحقق أيضاً من كليشة الأسبوع القادم كضمان إضافي
        const baghdad = getBaghdadInfo();
        if (baghdad.todayDayOfWeek === 4) {
          checkAndSendWeeklySchedule(env, { force }).catch(() => {});
        }
        return reply(res, 200, cors);
      }

      // فحص وإرسال كليشة تحاضير وإمتحانات الأسبوع القادم (ليلة كل خميس)
      if (url.pathname === '/check-weekly' || url.pathname === '/trigger-weekly') {
        const force = url.searchParams.get('force') === '1' || url.pathname === '/trigger-weekly';
        const res = await checkAndSendWeeklySchedule(env, { force });
        return reply(res, 200, cors);
      }

      // فحص محتوى KV (للتشخيص فقط)
      if (url.pathname === '/kv-debug' && req.method === 'GET') {
        if (!env.KV) return reply({ ok: false, error: 'no_kv' }, 200, cors);
        const result = {};
        // قراءة مفاتيح weekly_msg
        try {
          const list = await env.KV.list({ prefix: 'weekly_msg:' });
          result.weekly_msg_keys = list.keys.map(k => k.name);
          for (const k of list.keys) {
            const val = await env.KV.get(k.name);
            result[k.name] = val ? JSON.parse(val) : null;
          }
        } catch(e) { result.weekly_error = e.message; }
        // قراءة مفاتيح scheduled_msg
        try {
          const list2 = await env.KV.list({ prefix: 'scheduled_msg:' });
          result.scheduled_msg_keys = list2.keys.map(k => k.name);
          for (const k of list2.keys) {
            const val = await env.KV.get(k.name);
            result[k.name] = val ? JSON.parse(val) : null;
          }
        } catch(e) { result.scheduled_error = e.message; }
        return reply(result, 200, cors);
      }

      // مزامنة يدوية لكليشة أسبوع محدد (للتجربة والإصلاح)
      if (url.pathname === '/sync-weekly') {
        const dayId = url.searchParams.get('dayId') || '';
        const res = await syncScheduledWeeklyMessage(env, dayId);
        return reply(res, 200, cors);
      }

      // مزامنة يدوية لرسالة تحاضير الغد (للتجربة والإصلاح)
      if (url.pathname === '/sync-tomorrow') {
        const date = url.searchParams.get('date') || '';
        const res = await syncScheduledTomorrowMessage(env, date);
        return reply(res, 200, cors);
      }

      // فحص الحالة وعدد المشتركين (GET / أو /status)
      if (url.pathname === '/' || url.pathname === '/status') {
        const subs = await listSubs(env);
        const baghdad = getBaghdadInfo();
        const targetDate = baghdad.primaryTarget.dateStr;
        const sentKey = `scheduled_sent:${targetDate}`;
        const alreadySent = env.KV ? await env.KV.get(sentKey) : null;

        const nextWeekDays = getNextAcademicWeekDays(baghdad.year, baghdad.month, baghdad.day, baghdad.todayDayOfWeek);
        const weeklyKey = nextWeekDays[0] ? `weekly_sent:${nextWeekDays[0].dateStr}` : null;
        const weeklyAlreadySent = (env.KV && weeklyKey) ? await env.KV.get(weeklyKey) : null;

        return reply({
          ok: true,
          name: 'alfaclass-bot',
          subscribers_count: subs.length,
          channel_configured: !!env.CHANNEL_ID,
          baghdad_time: `${baghdad.currentHour}:${String(baghdad.currentMinute).padStart(2, '0')}`,
          target_date: targetDate,
          target_label: baghdad.primaryTarget.dateLabel,
          scheduled_sent: !!alreadySent,
          is_thursday: baghdad.todayDayOfWeek === 4,
          next_week_start: nextWeekDays[0] ? nextWeekDays[0].dateStr : null,
          weekly_scheduled_sent: !!weeklyAlreadySent,
        }, 200, cors);
      }

      return reply({ ok: true, name: 'alfaclass-bot' }, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status, cors);
      console.error('[Worker Fatal Error]:', e && (e.stack || e.message));
      return reply({ error: e.message || 'internal_error' }, 500, cors);
    }
  },

  // النشر المجدول التلقائي (Cron Trigger — يعمل في الساعة 18:00 UTC = 21:00 بتوقيت بغداد)
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const baghdad = getBaghdadInfo();
      // ليلة كل خميس (اليوم 4) بـ 9:00 مساءً: إرسال كليشة تحاضير وإمتحانات الأسبوع القادم
      if (baghdad.todayDayOfWeek === 4) {
        const weeklyRes = await checkAndSendWeeklySchedule(env, { isCron: true }).catch((e) => {
          console.error('[WeeklyCron] خطأ في إرسال جدول الأسبوع:', e.message);
          return null;
        });
        // إذا لم تتوفر تحاضير للأسبوع القادم بالكامل، نفحص تحاضير اليوم القادم كاحتياط
        if (!weeklyRes || !weeklyRes.sent) {
          await checkAndSendTomorrowPreps(env, { isCron: true }).catch((e) => {
            console.error('[DailyCron] خطأ في إرسال التحاضير اليومية:', e.message);
          });
        }
      } else {
        // في بقية أيام الأسبوع: إرسال التحاضير اليومية لليوم الدراسي القادم
        await checkAndSendTomorrowPreps(env, { isCron: true }).catch((e) => {
          console.error('[DailyCron] خطأ في إرسال التحاضير اليومية:', e.message);
        });
      }
    })());
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

// تهريب حروف HTML لتنسيق تلكرام المعتمد (& و < و >) لمنع انهيار التنسيق
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

// ══════════════════════════════════════════════════════════════════════════════
//  Telegram Bot API Helper (مع معالجة ذكية للأخطاء وإعادة المحاولة)
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
    if (j.description && /can't parse entities|unsupported start tag/i.test(j.description)) {
      console.warn('[tg] خطأ تنسيق HTML، جاري الإرسال كنص عادي:', j.description);
      const fallbackBody = JSON.parse(JSON.stringify(body));
      delete fallbackBody.parse_mode;

      if (fallbackBody.text) {
        fallbackBody.text = fallbackBody.text.replace(/<[^>]+>/g, '');
      }
      if (fallbackBody.caption) {
        fallbackBody.caption = fallbackBody.caption.replace(/<[^>]+>/g, '');
      }
      if (Array.isArray(fallbackBody.media)) {
        fallbackBody.media.forEach(m => {
          delete m.parse_mode;
          if (m.caption) m.caption = m.caption.replace(/<[^>]+>/g, '');
        });
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
    if (wait && wait <= 3 && st && st.retries < 3) {
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
    (j.error_code === 400 && /chat not found|bot was blocked|user is deactivated|bot was kicked|chat_id is empty/i.test(j.description || ''))
  );

// دالة حذف رسائل آمنة تدعم الحذف الجماعي مع Fallback فردي مضمون
async function deleteChatMessages(env, st, chatId, ids) {
  if (!ids || !ids.length) return;
  const r = await tg(env, st, 'deleteMessages', { chat_id: chatId, message_ids: ids });
  if (r && r.ok) return;

  for (const mid of ids) {
    if (mid) await tg(env, st, 'deleteMessage', { chat_id: chatId, message_id: mid }).catch(() => {});
  }
}

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
  const mc = u.my_chat_member;
  if (mc && mc.chat && env.KV) {
    const chatId = mc.chat.id;
    const newStatus = mc.new_chat_member && mc.new_chat_member.status;

    if (newStatus === 'administrator' || newStatus === 'member') {
      await env.KV.put(`sub:${chatId}`, '1');
      console.log(`[Webhook] تم اشتراك ${mc.chat.type} تلقائياً: ${chatId} (${mc.chat.title || ''})`);

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
  let photo = isHttp(u.photo_url) ? u.photo_url : '';

  let tgBio = '';
  try {
    const chatRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChat?chat_id=${id}`);
    const chatJson = await chatRes.json().catch(() => ({}));
    if (chatJson.ok && chatJson.result && chatJson.result.bio) {
      tgBio = String(chatJson.result.bio).trim().slice(0, 200);
    }
  } catch (e) {}

  if (!photo && env.BOT_TOKEN) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getUserProfilePhotos?user_id=${id}&limit=1`);
      const tgJson = await tgRes.json().catch(() => ({}));
      if (tgJson.ok && tgJson.result && tgJson.result.photos && tgJson.result.photos[0] && tgJson.result.photos[0][0]) {
        const fileId = tgJson.result.photos[0][0].file_id;
        const fRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fJson = await fRes.json().catch(() => ({}));
        if (fJson.ok && fJson.result && fJson.result.file_path) {
          photo = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fJson.result.file_path}`;
        }
      }
    } catch (e) {}
  }

  let cur = await fsGetUser(token, uid);
  if (cur.status !== 200 && cur.status !== 404) throw new HttpError(500, 'firestore_error');

  if (cur.status === 200 && cur.data && cur.data.deleteForced) {
    await fetch(`${FS}/users/${uid}`, { method: 'DELETE', headers: auth(token) }).catch(() => {});
    cur = { status: 404 };
  }

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
      bio:            S(tgBio),
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
    if (created) cur = { status: 200, data: { username, fullName, bio: tgBio, photoURL: photo } };
  }

  if (cur.status !== 200) throw new HttpError(500, 'firestore_error');
  const d = cur.data;

  if (!created) {
    const updates = {};
    if (d.authProvider !== 'telegram') updates.authProvider = S('telegram');
    if (Number(d.tgId) !== id) updates.tgId = { integerValue: uid };
    if (u.username && !d.tgUsername) updates.tgUsername = S(u.username);
    if (Object.keys(updates).length > 0) {
      const mask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');
      await fetch(`${FS}/users/${uid}?${mask}`, {
        method: 'PATCH', headers: auth(token), body: JSON.stringify({ fields: updates }),
      }).catch(() => {});
    }
  }

  const photoToUse = d.photoURL || photo || '';

  return {
    customToken:  await firebaseCustomToken(env, uid),
    username:     d.username || ('user_' + id),
    fullName:     d.fullName || d.username || ('طالب تلكرام #' + id),
    userId:       id,
    photoURL:     photoToUse,
    bio:          d.bio || '',
    authProvider: 'telegram',
    created,
  };
}

// ── استعلام موثوق عن بيانات المستخدم ──
async function getUserProfile(url, env) {
  const id = (url.searchParams.get('id') || url.searchParams.get('userId') || '').trim();
  if (!id) throw new HttpError(400, 'id_required');
  const token = await googleToken(env);
  
  let cur = await fsGetUser(token, id);
  
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

  if (cur.status === 200) {
    const d = cur.data;
    let photo = d.photoURL || '';
    const tgId = d.tgId || (/^\d{8,12}$/.test(id) ? id : null);
    
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

// ── جلب قائمة معرّفات الموثقين ──
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

// ── قراءة المنشور من Firestore مع البحث الذكي التلقائي عبر المجموعات (posts / reports / class_announcements) ──
async function fetchPost(postId, idToken, preferredColl = null, env = null) {
  const collsToTry = [];
  if (preferredColl) collsToTry.push(preferredColl);
  collsToTry.push('posts', 'reports', 'class_announcements');
  const uniqueColls = [...new Set(collsToTry)];

  let adminToken = null;
  if (env && env.FIREBASE_SA) {
    try {
      adminToken = await googleToken(env);
    } catch (e) {
      console.warn('[fetchPost] فشل استخراج adminToken:', e.message);
    }
  }

  for (const c of uniqueColls) {
    // 1) محاولة القراءة بصلاحيات Admin (تتجاوز أي قيود حماية وتضمن قراءة 100%)
    if (adminToken) {
      try {
        const r = await fetch(`${FS}/${c}/${postId}`, { headers: auth(adminToken) });
        if (r.status === 200) {
          const j = await r.json().catch(() => ({}));
          return { status: 200, data: decodeFields(j.fields || {}), coll: c };
        }
      } catch (e) {}
    }

    // 2) احتياطي: القراءة بتوكن المستخدم
    if (idToken) {
      try {
        const r = await fetch(`${FS}/${c}/${postId}`, { headers: { Authorization: `Bearer ${idToken}` } });
        if (r.status === 200) {
          const j = await r.json().catch(() => ({}));
          return { status: 200, data: decodeFields(j.fields || {}), coll: c };
        }
      } catch (e) {}
    }

    // 3) احتياطي عام: القراءة المباشرة من Firestore REST API (إذا كانت القواعد تسمح بالقراءة العامة)
    try {
      const r = await fetch(`${FS}/${c}/${postId}`);
      if (r.status === 200) {
        const j = await r.json().catch(() => ({}));
        return { status: 200, data: decodeFields(j.fields || {}), coll: c };
      }
    } catch (e) {}
  }

  return { status: 404 };
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
//  تنسيق رسائل تلكرام (HTML) — مطابقة تامة للنماذج المطلوبة
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
    parts.push(`<blockquote>${note}</blockquote>`);
  }
  parts.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);

  return parts.join('\n\n');
}

// ── القسم الثاني: البلاغات العامة (مضمونة ومطابقة لنمط SETUP-AR) ──
function buildReportMessage(p, postId) {
  const postUrl = `${SITE_URL}#report-${postId}`;
  const title   = esc(String(p.title || p.subject || 'بلاغ').trim().slice(0, 150));
  const body    = esc(String(p.body  || p.note    || '').trim().slice(0, 1500));

  const parts = [];
  parts.push(`<u>📢  ${title}</u>`);

  if (body) {
    parts.push(`<blockquote>${body}</blockquote>`);
  }
  parts.push(`<a href="${esc(postUrl)}">ألفاكلاس</a>`);

  return parts.join('\n\n');
}

// ── القسم الثالث: بلاغات الأساتذة / كلاس روم ──
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
  const defaultIcon = kind === 'report' ? '📢' : (kind === 'classroom' ? '🧑🏻‍🏫' : '📚');
  const caption     = captionFits ? text : (text.split('\n')[0] || defaultIcon);
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
//  تعديل رسالة مرسلة مسبقاً (Edit-or-Replace الذكي والآمن)
// ══════════════════════════════════════════════════════════════════════════════

async function editChatMessage(env, st, chatId, ids, spec) {
  if (!Array.isArray(ids) || !ids.length) {
    return await sendToChat(env, st, chatId, spec, false);
  }

  // 1) إذا كانت الرسالة نصية فقط والجديد أيضاً نص فقط
  if (ids.length === 1 && (!spec.images || spec.images.length === 0)) {
    try {
      const res = await tg(env, st, 'editMessageText', {
        chat_id:    chatId,
        message_id: ids[0],
        text:       spec.text,
        parse_mode: 'HTML',
      });
      if (res.ok) return { ids, ok: true };
      if (String(res.description || '').includes('message is not modified')) return { ids, ok: true };
    } catch (e) {}
  }

  // 2) إذا كانت الرسالة صورة واحدة والجديد أيضاً صورة واحدة والـ caption مناسب
  if (ids.length === 1 && spec.images && spec.images.length === 1 && spec.captionFits) {
    try {
      const res = await tg(env, st, 'editMessageCaption', {
        chat_id:    chatId,
        message_id: ids[0],
        caption:    spec.caption,
        parse_mode: 'HTML',
      });
      if (res.ok) return { ids, ok: true };
      if (String(res.description || '').includes('message is not modified')) return { ids, ok: true };
    } catch (e) {}
  }

  // 3) في حال تغيّر نوع الوسائط أو فشل التعديل المباشر: حذف القديم وإرسال الجديد (Fallback مضمون)
  try {
    await deleteChatMessages(env, st, chatId, ids);
  } catch (e) {}
  return await sendToChat(env, st, chatId, spec, false);
}

// ══════════════════════════════════════════════════════════════════════════════
//  قائمة المشتركين (Private + Groups + Channels)
// ══════════════════════════════════════════════════════════════════════════════

function checkPostId(postId) {
  if (typeof postId !== 'string' || !/^[A-Za-z0-9_\-]{4,60}$/.test(postId)) {
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
      out.push(raw);
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return [...new Set(out)];
}

// ══════════════════════════════════════════════════════════════════════════════
//  البث الشامل (Publish) — يدعم الدفعات الآمنة مع القناة والمشتركين
// ══════════════════════════════════════════════════════════════════════════════

async function publish(req, env) {
  const body = await req.json().catch(() => ({}));
  const { postId, idToken, data } = body;
  let kind = body.kind;
  const offset = Number(body.offset) || 0;

  checkPostId(postId);

  // تحديد المجموعة المفضلة أولاً
  let prefColl = null;
  if (kind === 'report') prefColl = 'reports';
  else if (kind === 'classroom') prefColl = 'class_announcements';
  else if (kind === 'post') prefColl = 'posts';

  // جلب بيانات المنشور من Firestore مع البحث الذكي التلقائي أو الاعتماد على البيانات المرسلة مباشرة
  let got = await fetchPost(postId, idToken, prefColl, env);
  if (got.status !== 200 && data && typeof data === 'object') {
    got = { status: 200, data, coll: prefColl || 'reports' };
  }
  if (got.status === 404) throw new HttpError(404, 'post_not_found');
  if (got.status !== 200) throw new HttpError(got.status, got.error || 'firestore_error');

  // الاستنتاج التلقائي لنوع المنشور إذا لم يُحدد أو كان غير متطابق
  if (!kind || (got.coll === 'reports' && kind !== 'report') || (got.coll === 'class_announcements' && kind !== 'classroom')) {
    if (got.coll === 'reports') kind = 'report';
    else if (got.coll === 'class_announcements') kind = 'classroom';
    else kind = 'post';
  }

  const isReport = kind === 'report' || kind === 'classroom';
  const kid      = isReport ? 'R' + postId : postId;
  const st       = { retries: 0 };
  const DAY      = 86400;

  const spec = buildSpec(got.data, kind, postId);
  const subs = await listSubs(env);
  let textOnly = false;

  // 1) في أول دفعة (offset === 0): إرسال للقناة الرئيسية فوراً
  if (offset === 0 && env.CHANNEL_ID) {
    try {
      console.log(`[Publish] جاري الإرسال للقناة الرئيسية: ${env.CHANNEL_ID}`);
      const res = await sendToChat(env, st, env.CHANNEL_ID, spec, false);
      if (res.ids && res.ids.length && env.KV) {
        const chData = JSON.stringify([[env.CHANNEL_ID, res.ids]]);
        await env.KV.put(`msgs:${kid}:ch`, chData, { expirationTtl: 30 * DAY });
        await env.KV.put(`msgs:${postId}:ch`, chData, { expirationTtl: 30 * DAY });
        textOnly = res.imgFailed;
        console.log('[Publish] تم الإرسال للقناة الرئيسية بنجاح.');
      } else {
        console.warn('[Publish] تعذر الإرسال للقناة الرئيسية:', res.error || 'unknown');
      }
    } catch (err) {
      console.error('[Publish] استثناء أثناء إرسال القناة:', err && err.message);
    }
  }

  // 2) إرسال لمجموعة المشتركين المحددة بالدفعة الحالية (BATCH_SIZE = 15)
  const currentBatch = subs.slice(offset, offset + BATCH_SIZE);
  const sent = [];
  const gone = [];

  for (let i = 0; i < currentBatch.length; i += 5) {
    const chunk = currentBatch.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map((chatId) => sendToChat(env, st, chatId, spec, textOnly))
    );
    results.forEach((r, idx) => {
      if (r.ids && r.ids.length) sent.push([chunk[idx], r.ids]);
      if (r.gone) gone.push(chunk[idx]);
    });
  }

  const batchIndex = Math.floor(offset / BATCH_SIZE);
  const isDone = (offset + BATCH_SIZE) >= subs.length;

  if (env.KV) {
    if (sent.length) {
      const sentData = JSON.stringify(sent);
      await env.KV.put(`msgs:${kid}:${batchIndex}`, sentData, { expirationTtl: 30 * DAY });
      await env.KV.put(`msgs:${postId}:${batchIndex}`, sentData, { expirationTtl: 30 * DAY });
    }
    for (const badId of gone.slice(0, 5)) {
      await env.KV.delete(`sub:${badId}`).catch(() => {});
    }

    if (isDone) {
      await env.KV.put(`pub:${kid}`, '1', { expirationTtl: 30 * DAY });
      await env.KV.put(`pub:${postId}`, '1', { expirationTtl: 30 * DAY });
      await env.KV.delete(`job:${kid}`).catch(() => {});
      await env.KV.delete(`job:${postId}`).catch(() => {});
      checkAndSendTomorrowPreps(env).catch(() => {});
      const targetDayId = got.data && (got.data.dayId || got.data.date);
      // await ضروري — Cloudflare Worker يقتل العمليات الخلفية بعد إرسال الرد
      await Promise.allSettled([
        syncScheduledTomorrowMessage(env, targetDayId || null),
        syncScheduledWeeklyMessage(env, targetDayId || null),
      ]);
    }
  }

  return {
    done: isDone,
    next: offset + BATCH_SIZE,
    total: subs.length,
    sent_in_batch: sent.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  تعديل المنشور في تلكرام (Live Edit) — للقناة وللمشتركين بدفعات
// ══════════════════════════════════════════════════════════════════════════════

async function editPost(req, env) {
  const body = await req.json().catch(() => ({}));
  const { postId, idToken, data } = body;
  let kind = body.kind;
  const offset = Number(body.offset) || 0;

  checkPostId(postId);

  let prefColl = null;
  if (kind === 'report') prefColl = 'reports';
  else if (kind === 'classroom') prefColl = 'class_announcements';
  else if (kind === 'post') prefColl = 'posts';

  let got = await fetchPost(postId, idToken, prefColl, env);
  if (got.status !== 200 && data && typeof data === 'object') {
    got = { status: 200, data, coll: prefColl || 'reports' };
  }
  if (got.status === 404) throw new HttpError(404, 'post_not_found');
  if (got.status !== 200) throw new HttpError(got.status, got.error || 'firestore_error');

  if (!kind || (got.coll === 'reports' && kind !== 'report') || (got.coll === 'class_announcements' && kind !== 'classroom')) {
    if (got.coll === 'reports') kind = 'report';
    else if (got.coll === 'class_announcements') kind = 'classroom';
    else kind = 'post';
  }

  const isReport = kind === 'report' || kind === 'classroom';
  const kid      = isReport ? 'R' + postId : postId;
  const st       = { retries: 0 };
  const DAY      = 86400;

  const spec = buildSpec(got.data, kind, postId);

  // 1) في أول دفعة (offset === 0): تعديل رسالة القناة الرئيسية
  if (offset === 0 && env.CHANNEL_ID) {
    const chKey = `msgs:${kid}:ch`;
    let chRec = env.KV ? await env.KV.get(chKey, 'json') : null;
    if (!chRec) chRec = env.KV ? await env.KV.get(`msgs:${postId}:ch`, 'json') : null;

    if (chRec && Array.isArray(chRec) && chRec.length) {
      const [chatId, ids] = chRec[0];
      const editRes = await editChatMessage(env, st, chatId, ids, spec);
      if (editRes && editRes.ids && editRes.ids.length && env.KV) {
        const newChData = JSON.stringify([[chatId, editRes.ids]]);
        await env.KV.put(chKey, newChData, { expirationTtl: 30 * DAY });
        await env.KV.put(`msgs:${postId}:ch`, newChData, { expirationTtl: 30 * DAY });
      }
    } else {
      const res = await sendToChat(env, st, env.CHANNEL_ID, spec, false);
      if (res.ids && res.ids.length && env.KV) {
        const chData = JSON.stringify([[env.CHANNEL_ID, res.ids]]);
        await env.KV.put(chKey, chData, { expirationTtl: 30 * DAY });
        await env.KV.put(`msgs:${postId}:ch`, chData, { expirationTtl: 30 * DAY });
      }
    }
  }

  // 2) تعديل رسائل المشتركين بالدفعة الحالية
  const batchIndex = Math.floor(offset / BATCH_SIZE);
  const bKey = `msgs:${kid}:${batchIndex}`;
  let bRec = env.KV ? await env.KV.get(bKey, 'json') : null;
  if (!bRec) bRec = env.KV ? await env.KV.get(`msgs:${postId}:${batchIndex}`, 'json') : null;

  if (bRec && Array.isArray(bRec) && bRec.length) {
    const updatedBatch = [];
    for (let i = 0; i < bRec.length; i += 5) {
      const chunk = bRec.slice(i, i + 5);
      const results = await Promise.all(
        chunk.map(([chatId, ids]) => editChatMessage(env, st, chatId, ids, spec))
      );
      results.forEach((r, idx) => {
        if (r && r.ids && r.ids.length) updatedBatch.push([chunk[idx][0], r.ids]);
      });
    }
    if (updatedBatch.length && env.KV) {
      const bData = JSON.stringify(updatedBatch);
      await env.KV.put(bKey, bData, { expirationTtl: 30 * DAY });
      await env.KV.put(`msgs:${postId}:${batchIndex}`, bData, { expirationTtl: 30 * DAY });
    }
  }

  const subs = await listSubs(env);
  const isDone = (offset + BATCH_SIZE) >= subs.length;

  // 3) عند اكتمال تعديل المنشور: تحديث الرسالة المجمعة (تحاضير الغد والجدول الأسبوعي) فوراً
  // ملاحظة مهمة: await ضروري — Cloudflare Worker يقتل العمليات الخلفية بعد إرسال الرد
  if (isDone) {
    const dayId = got.data && (got.data.dayId || got.data.date);
    await Promise.allSettled([
      syncScheduledTomorrowMessage(env, dayId || null),
      syncScheduledWeeklyMessage(env, dayId || null),
    ]);
  }

  return {
    done: isDone,
    next: offset + BATCH_SIZE,
    total: subs.length,
    edited: true,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  حذف المنشور من تلكرام (Delete) — مضمون 100% مع دعم fallback والحذف الفردي
// ══════════════════════════════════════════════════════════════════════════════

async function remove(req, env) {
  const body = await req.json().catch(() => ({}));
  const { postId, kind, dayId } = body;
  checkPostId(postId);

  const isReport = kind === 'report' || kind === 'classroom';
  const kid      = isReport ? 'R' + postId : postId;
  const st       = { retries: 0 };

  const keysToCheck = [...new Set([kid, postId, 'R' + postId])];

  if (env.KV) {
    for (const k of keysToCheck) {
      await env.KV.delete(`job:${k}`).catch(() => {});
      await env.KV.delete(`pub:${k}`).catch(() => {});
    }
  }

  // 1) حذف رسائل القناة الرئيسية
  for (const k of keysToCheck) {
    const chKey = `msgs:${k}:ch`;
    const chRec = env.KV ? await env.KV.get(chKey, 'json') : null;
    if (chRec && Array.isArray(chRec)) {
      for (const [chatId, ids] of chRec) {
        await deleteChatMessages(env, st, chatId, ids);
      }
      if (env.KV) await env.KV.delete(chKey).catch(() => {});
    }
  }

  // 2) حذف رسائل المشتركين والكروبات من كل الدفعات المخزنة
  if (env.KV) {
    for (let batchNo = 0; batchNo < 50; batchNo++) {
      let foundAny = false;
      for (const k of keysToCheck) {
        const bKey = `msgs:${k}:${batchNo}`;
        const rec = await env.KV.get(bKey, 'json');
        if (rec && Array.isArray(rec) && rec.length) {
          foundAny = true;
          for (let i = 0; i < rec.length; i += 5) {
            const chunk = rec.slice(i, i + 5);
            await Promise.all(
              chunk.map(([chatId, ids]) => deleteChatMessages(env, st, chatId, ids))
            );
          }
          await env.KV.delete(bKey).catch(() => {});
        }
      }
      if (!foundAny && batchNo > 2) break;
    }
  }

  // 3) تحديث الرسائل المجمعة (تحاضير الغد / جدول الأسبوع) لإزالة المنشور المحذوف فوراً
  // ملاحظة مهمة: يجب استخدام await وليس fire-and-forget لأن Cloudflare Worker يُنهي
  // العمليات الخلفية فور إرسال الرد — await يضمن اكتمال التحديث قبل الإجابة
  await Promise.allSettled([
    syncScheduledTomorrowMessage(env, dayId),
    syncScheduledWeeklyMessage(env, dayId),
  ]);

  return { done: true, ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
//  حساب توقيت بغداد وتاريخ الغد والأيام الدراسية القادمة بدقة 100%
// ══════════════════════════════════════════════════════════════════════════════

function getBaghdadInfo() {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts = dtf.formatToParts(now);
  let y = 0, m = 0, d = 0, currentHour = 0, currentMinute = 0;
  for (const p of parts) {
    if (p.type === 'year') y = parseInt(p.value, 10);
    if (p.type === 'month') m = parseInt(p.value, 10);
    if (p.type === 'day') d = parseInt(p.value, 10);
    if (p.type === 'hour') currentHour = parseInt(p.value, 10);
    if (p.type === 'minute') currentMinute = parseInt(p.value, 10);
  }

  const baghdadToday = new Date(Date.UTC(y, m - 1, d));
  const todayDayOfWeek = baghdadToday.getUTCDay(); // 0=الأحد ... 4=الخميس ... 5=الجمعة ... 6=السبت

  function makeDateInfo(offset) {
    const dt = new Date(Date.UTC(y, m - 1, d + offset));
    const ty = dt.getUTCFullYear();
    const tm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const td = String(dt.getUTCDate()).padStart(2, '0');
    const dow = dt.getUTCDay();
    const dateStr = `${ty}-${tm}-${td}`;
    const dateLabel = `${AR_DAYS[dow]} ${dt.getUTCDate()} / ${dt.getUTCMonth() + 1}`;
    return { dateStr, dateLabel, dayOfWeek: dow, offset };
  }

  // حساب يوم الغد بدقة حصراً (بدون أي رجوع لليوم السابق):
  // في الأيام العادية: الغد هو دائماً (+1)
  // في ليلة الخميس: الجمعة عطلة رسمية، فيكون اليوم الدراسي التالي هو السبت (+2)
  // في ليلة الجمعة: الغد هو السبت (+1)
  let targetOffset = 1;
  if (todayDayOfWeek === 4) {
    targetOffset = 2; // السبت (لأن الجمعة عطلة)
  }

  const tomorrowTarget = makeDateInfo(targetOffset);

  return {
    baghdadNow: now,
    year: y,
    month: m,
    day: d,
    todayDayOfWeek,
    currentHour,
    currentMinute,
    tomorrowTarget,
    primaryTarget: tomorrowTarget,
  };
}

// ── حساب أيام الأسبوع الدراسي القادم (السبت إلى الخميس) ──
function getNextAcademicWeekDays(y, m, d, dow) {
  if (y === undefined) {
    const info = getBaghdadInfo();
    y = info.year; m = info.month; d = info.day; dow = info.todayDayOfWeek;
  }
  let daysToSat = (6 - dow + 7) % 7;
  if (daysToSat === 0) daysToSat = 7; // إذا كان اليوم سبتاً، يبدأ الأسبوع القادم بعد 7 أيام
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + daysToSat + i));
    if (dt.getUTCDay() === 5) continue; // تخطي الجمعة (عطلة رسمية)
    const ty = dt.getUTCFullYear();
    const tm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const td = String(dt.getUTCDate()).padStart(2, '0');
    days.push({
      dateStr: `${ty}-${tm}-${td}`,
      dayNum: dt.getUTCDate(),
      monthNum: dt.getUTCMonth() + 1,
      dayOfWeek: dt.getUTCDay(),
    });
  }
  return days;
}

// ── إيجاد تاريخ السبت لأي أسبوع دراسي يحتوي على التاريخ المحدد ──
function getWeekStartForDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun .. 6=Sat
  const daysSinceSat = (dow + 1) % 7;
  const satDt = new Date(Date.UTC(y, m - 1, d - daysSinceSat));
  const sy = satDt.getUTCFullYear();
  const sm = String(satDt.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(satDt.getUTCDate()).padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

// ── توليد أيام الأسبوع الدراسي (السبت إلى الخميس) لسبت محدد ──
function getAcademicWeekDaysForStart(satDateStr) {
  if (!satDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(satDateStr)) return [];
  const [y, m, d] = satDateStr.split('-').map(Number);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    if (dt.getUTCDay() === 5) continue; // تخطي الجمعة
    const ty = dt.getUTCFullYear();
    const tm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const td = String(dt.getUTCDate()).padStart(2, '0');
    days.push({
      dateStr: `${ty}-${tm}-${td}`,
      dayNum: dt.getUTCDate(),
      monthNum: dt.getUTCMonth() + 1,
      dayOfWeek: dt.getUTCDay(),
    });
  }
  return days;
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

  let preps = [];
  try {
    const r = await fetch(`${FS}:runQuery`, {
      method:  'POST',
      headers: auth(token),
      body:    JSON.stringify(queryBody),
    });
    const results = await r.json().catch(() => []);
    if (Array.isArray(results)) {
      preps = results
        .filter((x) => x && x.document && x.document.fields)
        .map((x) => decodeFields(x.document.fields));
    }
  } catch (err) {
    console.warn('[fetchPrepsForDay] خطأ في استعلام dayId:', err.message);
  }

  // 2) احتياطي: فحص حقل date إذا لم يُعثر على تحاضير
  if (!preps.length) {
    try {
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
        preps = results2
          .filter((x) => x && x.document && x.document.fields)
          .map((x) => decodeFields(x.document.fields));
      }
    } catch (err2) {}
  }

  preps.sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), 'ar'));
  return preps;
}

// ══════════════════════════════════════════════════════════════════════════════
//  التحقق الذكي والإرسال المجدول لتحاضير الغد
// ══════════════════════════════════════════════════════════════════════════════

async function checkAndSendTomorrowPreps(env, options = {}) {
  const force  = !!options.force;
  const isCron = !!options.isCron;
  const info   = getBaghdadInfo();
  const target = info.tomorrowTarget;

  console.log(`[ScheduledCheck] وقت بغداد: ${info.currentHour}:${String(info.currentMinute).padStart(2, '0')} | تاريخ الغد: ${target.dateStr} (${target.dateLabel}) | force: ${force}`);

  if (!force && !isCron) {
    const isEveningTime = info.currentHour >= 20 || info.currentHour <= 5;
    if (!isEveningTime) {
      return {
        ok:           true,
        sent:         false,
        reason:       'not_evening_yet',
        current_hour: info.currentHour,
        message:      'موعد إرسال تحاضير الغد المجدولة يبدأ مساءً بتوقيت بغداد',
      };
    }
  }

  // التحقق: هل أُرسلت رسالة تحاضير الغد لهذا التاريخ سابقاً؟
  const sentKey = `scheduled_sent:${target.dateStr}`;
  const alreadySent = env.KV ? await env.KV.get(sentKey) : null;
  if (alreadySent && !force) {
    console.log(`[ScheduledCheck] تم إرسال تحاضير الغد (${target.dateStr}) سابقاً، تم التخطي.`);
    return {
      ok:           true,
      sent:         false,
      already_sent: true,
      target_date:  target.dateStr,
      date_label:   target.dateLabel,
      message:      'تم إرسال رسالة تحاضير الغد سابقاً لهذا اليوم بنجاح',
    };
  }

  let token;
  try {
    token = await googleToken(env);
  } catch (err) {
    console.error('[ScheduledCheck] فشل جلب توكن Firebase:', err.message);
    return { ok: false, error: 'google_token_failed: ' + err.message };
  }

  // البحث حصراً عن تحاضير يوم الغد فقط (دون أي رجوع لليوم السابق أبداً)
  const preps = await fetchPrepsForDay(token, target.dateStr);

  if (!preps || !preps.length) {
    console.log(`[ScheduledCheck] لا توجد تحاضير مسجلة ليوم الغد (${target.dateStr}). تم الإلغاء وعدم الإرسال.`);
    return {
      ok:          true,
      sent:        false,
      reason:      'no_preps_found',
      target_date: target.dateStr,
      date_label:  target.dateLabel,
      message:     `لا توجد تحاضير مسجلة ليوم الغد (${target.dateStr}). لن يتم إرسال أي رسالة لليوم السابق.`,
    };
  }

  const scheduledText = buildTomorrowScheduledText(preps, target.dateLabel);

  const st = { retries: 0 };
  let channelSuccess = false;

  if (env.CHANNEL_ID) {
    try {
      const chRes = await tg(env, st, 'sendMessage', {
        chat_id:    env.CHANNEL_ID,
        text:       scheduledText,
        parse_mode: 'HTML',
      });
      channelSuccess = chRes.ok;
      if (chRes.ok && chRes.result && chRes.result.message_id && env.KV) {
        await env.KV.put(`scheduled_msg:${target.dateStr}`, JSON.stringify({
          channelId: env.CHANNEL_ID,
          msgId:     chRes.result.message_id,
          dateStr:   target.dateStr,
          dateLabel: target.dateLabel,
          sentAt:    Date.now(),
        }), { expirationTtl: 86400 * 2 });
      }
      console.log(`[ScheduledCheck] إرسال للقناة ${env.CHANNEL_ID}:`, chRes.ok ? '✅' : chRes.description);
    } catch (e) {
      console.warn('[ScheduledCheck] خطأ إرسال القناة:', e.message);
    }
  }

  const subs = await listSubs(env);
  console.log(`[ScheduledCheck] جاري الإرسال لـ ${subs.length} مشترك/كروب/قناة...`);

  let sentCount = 0;
  const targetSubs = subs.slice(0, 40);

  for (let i = 0; i < targetSubs.length; i += 5) {
    const chunk = targetSubs.slice(i, i + 5);
    await Promise.all(chunk.map((chatId) =>
      tg(env, st, 'sendMessage', {
        chat_id:    chatId,
        text:       scheduledText,
        parse_mode: 'HTML',
      }).then(async (res) => {
        if (res.ok) sentCount++;
        if (isGone(res) && env.KV) {
          await env.KV.delete(`sub:${chatId}`).catch(() => {});
        }
      }).catch(() => {})
    ));
  }

  // حفظ علامة الإرسال في KV لمدة 48 ساعة حتى لا تتكرر
  if (env.KV) {
    await env.KV.put(sentKey, '1', { expirationTtl: 86400 * 2 });
  }

  console.log(`[ScheduledCheck] ✅ تم الإرسال بنجاح! ${preps.length} تحضير تم إرساله لـ ${sentCount} مشترك.`);

  return {
    ok:               true,
    sent:             true,
    target_date:      target.dateStr,
    date_label:       target.dateLabel,
    preps_count:      preps.length,
    subscribers_sent: sentCount,
    channel_success:  channelSuccess,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  النشر المجدول الأسبوعي (ليلة كل خميس الساعة 9:00 مساءً بتوقيت بغداد)
//  تحاضير وإمتحانات الإسبوع القادم بالنمط المطلوب تماماً
// ══════════════════════════════════════════════════════════════════════════════

async function checkAndSendWeeklySchedule(env, options = {}) {
  const force  = !!options.force;
  const isCron = !!options.isCron;
  const info   = getBaghdadInfo();

  console.log(`[WeeklySchedule] وقت بغداد: ${info.currentHour}:${String(info.currentMinute).padStart(2, '0')} | اليوم: ${AR_DAYS[info.todayDayOfWeek]} (${info.todayDayOfWeek}) | force: ${force}`);

  // التحقق: إذا لم يكن طلباً إجبارياً، نتأكد أن اليوم هو الخميس والساعة بعد 8:30 مساءً (20:30+) أو فجراً
  if (!force && !isCron) {
    if (info.todayDayOfWeek !== 4) {
      return {
        ok: false,
        sent: false,
        reason: 'not_thursday',
        message: 'النشر المجدول الأسبوعي مخصص لليلة كل خميس فقط (أو أرسل force=1 لتجربته الآن)',
      };
    }
    const isEvening = info.currentHour >= 20 || info.currentHour <= 4;
    if (!isEvening) {
      return {
        ok: false,
        sent: false,
        reason: 'not_evening_yet',
        message: 'موعد إرسال كليشة الأسبوع القادم يبدأ من الساعة 9:00 مساءً بتوقيت بغداد',
      };
    }
  }

  // حساب أيام الأسبوع الدراسي القادم (السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس)
  const nextWeekDays = getNextAcademicWeekDays(info.year, info.month, info.day, info.todayDayOfWeek);
  const weekStartKey = nextWeekDays[0] ? nextWeekDays[0].dateStr : 'week';
  const sentKey = `weekly_sent:${weekStartKey}`;

  // منع التكرار خلال نفس الأسبوع إلا عند الإجبار (force)
  const alreadySent = env.KV ? await env.KV.get(sentKey) : null;
  if (alreadySent && !force) {
    console.log(`[WeeklySchedule] تم إرسال كليشة الأسبوع (${weekStartKey}) سابقاً.`);
    return {
      ok: true,
      sent: false,
      already_sent: true,
      week_start: weekStartKey,
      message: 'تم إرسال كليشة الأسبوع القادم مسبقاً لهذا الأسبوع بنجاح',
    };
  }

  // جلب توكن الأدمن من Firebase Service Account
  let token;
  try {
    token = await googleToken(env);
  } catch (err) {
    console.error('[WeeklySchedule] فشل جلب توكن Firebase:', err.message);
    return { ok: false, error: 'google_token_failed: ' + err.message };
  }

  // جلب التحاضير لكل يوم من أيام الأسبوع القادم
  const allWeekDays = [];
  let totalPrepsCount = 0;

  for (const day of nextWeekDays) {
    const preps = await fetchPrepsForDay(token, day.dateStr);
    const count = (preps && preps.length) || 0;
    totalPrepsCount += count;
    allWeekDays.push({ day, preps: preps || [], count });
  }

  // إذا لم تكن هناك أي تحاضير مسجلة في الأسبوع بالكامل
  if (totalPrepsCount === 0 && !force) {
    console.log('[WeeklySchedule] لا توجد تحاضير مسجلة للأسبوع القادم حتى الآن.');
    return {
      ok: true,
      sent: false,
      reason: 'no_preps_next_week',
      week_start: weekStartKey,
      message: 'لا توجد تحاضير أو امتحانات مسجلة للأسبوع القادم حتى الآن.',
    };
  }

  // تحديد الأيام المعروضة: الأيام الدراسية (الأحد إلى الخميس)، ويوم السبت يُعرض إذا كانت فيه تحاضير أو طُلب الإجبار
  const scheduleDays = allWeekDays.filter(item => {
    if (item.day.dayOfWeek === 6) {
      return item.count > 0; // السبت يُعرض فقط إن كان فيه تحضير
    }
    return true; // بقية الأيام (الأحد إلى الخميس) تُعرض دائماً
  });

  const weeklyMessage = buildWeeklyScheduleText(scheduleDays);

  const st = { retries: 0 };
  let channelSuccess = false;

  // 1) إرسال للقناة الرئيسية
  if (env.CHANNEL_ID) {
    try {
      const chRes = await tg(env, st, 'sendMessage', {
        chat_id:    env.CHANNEL_ID,
        text:       weeklyMessage,
        parse_mode: 'HTML',
      });
      channelSuccess = chRes.ok;
      if (chRes.ok && chRes.result && chRes.result.message_id && env.KV) {
        await env.KV.put(`weekly_msg:${weekStartKey}`, JSON.stringify({
          channelId: env.CHANNEL_ID,
          msgId:     chRes.result.message_id,
          weekStart: weekStartKey,
          sentAt:    Date.now(),
        }), { expirationTtl: 86400 * 7 });
      }
      console.log(`[WeeklySchedule] إرسال للقناة ${env.CHANNEL_ID}:`, chRes.ok ? '✅' : chRes.description);
    } catch (e) {
      console.warn('[WeeklySchedule] خطأ إرسال القناة:', e.message);
    }
  }

  // 2) إرسال لجميع المشتركين والكروبات في KV
  const subs = await listSubs(env);
  const targetSubs = subs.slice(0, 40);
  let sentCount = 0;

  for (let i = 0; i < targetSubs.length; i += 5) {
    const chunk = targetSubs.slice(i, i + 5);
    await Promise.all(chunk.map((chatId) =>
      tg(env, st, 'sendMessage', {
        chat_id:    chatId,
        text:       weeklyMessage,
        parse_mode: 'HTML',
      }).then(async (res) => {
        if (res.ok) sentCount++;
        if (isGone(res) && env.KV) {
          await env.KV.delete(`sub:${chatId}`).catch(() => {});
        }
      }).catch(() => {})
    ));
  }

  // حفظ علامة الإرسال في KV لمدة 6 أيام حتى لا تتكرر
  if (env.KV) {
    await env.KV.put(sentKey, '1', { expirationTtl: 86400 * 6 });
  }

  console.log(`[WeeklySchedule] ✅ تم إرسال جدول الأسبوع القادم بنجاح! ${totalPrepsCount} تحضير لـ ${sentCount} مشترك.`);

  return {
    ok:               true,
    sent:             true,
    week_start:       weekStartKey,
    days_count:       scheduleDays.length,
    preps_count:      totalPrepsCount,
    subscribers_sent: sentCount,
    channel_success:  channelSuccess,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  بناء نصوص الرسائل المجدولة والتحديث المباشر Live Sync
// ══════════════════════════════════════════════════════════════════════════════

function buildTomorrowScheduledText(preps, dateLabel) {
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
  messageBlocks.push(`<u>تحاضير يوم غد ${dateLabel} عندنا</u>`);
  if (prepItems.length) {
    messageBlocks.push(prepItems.join('\n\n'));
  }
  messageBlocks.push(`<a href="${esc(BOT_LINK)}">الفاكلاس</a>`);

  let scheduledText = messageBlocks.join('\n\n');
  if (scheduledText.length > 3800) scheduledText = scheduledText.slice(0, 3800) + '…';
  return scheduledText;
}

function buildWeeklyScheduleText(scheduleDays) {
  const blocks = [];
  blocks.push('<u>تحاضير وإمتحانات الإسبوع القادم :</u>');

  for (const item of scheduleDays) {
    const dayName = AR_DAYS[item.day.dayOfWeek];
    const dayLabel = `• ${dayName} ${item.day.dayNum} / ${item.day.monthNum}`;
    const dayLines = [`<blockquote>${dayLabel}</blockquote>`];

    if (item.preps && item.preps.length > 0) {
      const dayItems = [];
      for (const p of item.preps) {
        const subject = esc(String(p.subject || p.title || '').trim().slice(0, 100));
        const type    = esc(String(p.type    || '').trim().slice(0, 60));
        const note    = esc(String(p.note    || '').trim().slice(0, 800));

        let itemTitle = '';
        if (type && subject) {
          itemTitle = `${type} — ${subject}`;
        } else {
          itemTitle = type || subject || 'تحضير';
        }

        const noteText = note || itemTitle;
        dayItems.push(`<tg-spoiler>-</tg-spoiler>  📚 ${itemTitle} :\n[ ${noteText} ]`);
      }
      dayLines.push(dayItems.join('\n\n'));
    } else {
      dayLines.push('<tg-spoiler>-</tg-spoiler> لا يوجد تحضير حالياً');
    }

    blocks.push(dayLines.join('\n'));
  }

  blocks.push(`<a href="${esc(BOT_LINK)}">الفاكلاس</a>`);

  let weeklyMessage = blocks.join('\n\n').trim();
  if (weeklyMessage.length > 3900) weeklyMessage = weeklyMessage.slice(0, 3900) + '…';
  return weeklyMessage;
}

async function syncScheduledTomorrowMessage(env, targetDate) {
  if (!env.KV) return { ok: false, error: 'no_kv' };

  const info = getBaghdadInfo();
  let dateStr = targetDate || info.tomorrowTarget.dateStr;

  // ── البحث عن المفتاح في KV ──
  let raw = await env.KV.get(`scheduled_msg:${dateStr}`);

  // إذا ما وُجد المفتاح بالتاريخ المحدد: نبحث في جميع مفاتيح scheduled_msg الموجودة
  if (!raw && targetDate) {
    try {
      const allKeys = await env.KV.list({ prefix: 'scheduled_msg:' });
      if (allKeys && allKeys.keys && allKeys.keys.length > 0) {
        for (const k of allKeys.keys) {
          const kDate = k.name.replace('scheduled_msg:', '');
          if (kDate === targetDate) {
            raw = await env.KV.get(k.name);
            dateStr = kDate;
            console.log(`[LiveSync] وُجد مفتاح تحاضير الغد عبر البحث الشامل: ${k.name}`);
            break;
          }
        }
      }
    } catch(e) {
      console.warn('[syncScheduledTomorrowMessage] خطأ في البحث الشامل:', e.message);
    }
  }

  if (!raw) {
    console.log(`[LiveSync] لا توجد رسالة تحاضير الغد محفوظة للتاريخ: ${dateStr}`);
    return { ok: true, synced: false, reason: 'not_sent_yet', searched_date: dateStr };
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'invalid_saved_json' };
  }

  if (!saved || !saved.channelId || !saved.msgId) {
    return { ok: false, error: 'missing_message_coords' };
  }

  let token;
  try {
    token = await googleToken(env);
  } catch (err) {
    return { ok: false, error: 'google_token_failed: ' + err.message };
  }

  const preps = await fetchPrepsForDay(token, dateStr);
  const st = { retries: 0 };

  // إذا تم حذف جميع تحاضير الغد: نحذف الرسالة المجدولة من القناة تلقائياً
  if (!preps || !preps.length) {
    try {
      await tg(env, st, 'deleteMessage', {
        chat_id:    saved.channelId,
        message_id: saved.msgId,
      });
      await env.KV.delete(`scheduled_msg:${dateStr}`);
      console.log(`[LiveSync] تم حذف رسالة تحاضير الغد المجدولة (${dateStr}) لأن جميع التحاضير حُذفت.`);
      return { ok: true, synced: true, action: 'deleted_empty_msg' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // إذا لا زالت هناك تحاضير: نقوم بتحديث الرسالة القائمة عبر editMessageText
  const dateLabel = saved.dateLabel || arabicDateFromDayId(dateStr);
  const newText = buildTomorrowScheduledText(preps, dateLabel);

  try {
    const res = await tg(env, st, 'editMessageText', {
      chat_id:    saved.channelId,
      message_id: saved.msgId,
      text:       newText,
      parse_mode: 'HTML',
    });
    if (res.ok || String(res.description || '').includes('message is not modified')) {
      console.log(`[LiveSync] تم تحديث رسالة تحاضير الغد المجدولة بنجاح (${dateStr}).`);
      return { ok: true, synced: true, message_id: saved.msgId };
    }
    return { ok: false, error: res.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function syncScheduledWeeklyMessage(env, targetDayId) {
  if (!env.KV) return { ok: false, error: 'no_kv' };

  let weekStartKey = '';
  let weekDays = [];

  // ── 1) إذا تم تمرير dayId: نحسب السبت الخاص بأسبوعه ──
  if (targetDayId) {
    weekStartKey = getWeekStartForDate(targetDayId);
    if (weekStartKey) {
      weekDays = getAcademicWeekDaysForStart(weekStartKey);
    }
  }

  // ── 2) إذا لم يتم تحديد تاريخ: نستخدم الأسبوع الدراسي القادم ──
  if (!weekStartKey || !weekDays.length) {
    weekDays = getNextAcademicWeekDays();
    weekStartKey = weekDays[0]?.dateStr || '';
  }

  if (!weekStartKey) return { ok: true, synced: false, reason: 'no_week_start' };

  // ── 3) البحث عن المفتاح في KV — مع Fallback ذكي لجميع المفاتيح المحفوظة ──
  let raw = await env.KV.get(`weekly_msg:${weekStartKey}`);

  // إذا ما وُجد المفتاح بالحساب المباشر، نبحث في جميع مفاتيح weekly_msg الموجودة
  if (!raw) {
    try {
      const allKeys = await env.KV.list({ prefix: 'weekly_msg:' });
      if (allKeys && allKeys.keys && allKeys.keys.length > 0) {
        // نبحث عن أقرب مفتاح لتاريخ التحضير
        for (const k of allKeys.keys) {
          const kDate = k.name.replace('weekly_msg:', '');
          // إذا كان dayId بين هذا السبت والخميس القادم (6 أيام)
          if (targetDayId && kDate <= targetDayId) {
            const kDays = getAcademicWeekDaysForStart(kDate);
            const found = kDays.some(d => d.dateStr === targetDayId);
            if (found) {
              weekStartKey = kDate;
              weekDays = kDays;
              raw = await env.KV.get(k.name);
              console.log(`[LiveSync] وُجد مفتاح كليشة بديل: ${k.name}`);
              break;
            }
          }
        }
      }
    } catch(e) {
      console.warn('[syncScheduledWeeklyMessage] خطأ في البحث الشامل:', e.message);
    }
  }

  if (!raw) {
    console.log(`[LiveSync] لا توجد كليشة أسبوع محفوظة للمفتاح: weekly_msg:${weekStartKey}`);
    return { ok: true, synced: false, reason: 'not_sent_yet', searched_key: weekStartKey };
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'invalid_saved_json' };
  }

  if (!saved || !saved.channelId || !saved.msgId) {
    return { ok: false, error: 'missing_message_coords' };
  }

  let token;
  try {
    token = await googleToken(env);
  } catch (err) {
    return { ok: false, error: 'google_token_failed: ' + err.message };
  }

  const allWeekDays = [];
  let totalPrepsCount = 0;

  for (const day of weekDays) {
    const preps = await fetchPrepsForDay(token, day.dateStr);
    const count = (preps && preps.length) || 0;
    totalPrepsCount += count;
    allWeekDays.push({ day, preps: preps || [], count });
  }

  const st = { retries: 0 };

  if (totalPrepsCount === 0) {
    try {
      await tg(env, st, 'deleteMessage', {
        chat_id:    saved.channelId,
        message_id: saved.msgId,
      });
      await env.KV.delete(`weekly_msg:${weekStartKey}`);
      console.log(`[LiveSync] تم حذف كليشة الأسبوع (${weekStartKey}) لأن جميع التحاضير حُذفت.`);
      return { ok: true, synced: true, action: 'deleted_empty_msg' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const scheduleDays = allWeekDays.filter(item => {
    if (item.day.dayOfWeek === 6) return item.count > 0;
    return true;
  });

  const newWeeklyText = buildWeeklyScheduleText(scheduleDays);

  try {
    const res = await tg(env, st, 'editMessageText', {
      chat_id:    saved.channelId,
      message_id: saved.msgId,
      text:       newWeeklyText,
      parse_mode: 'HTML',
    });
    if (res.ok || String(res.description || '').includes('message is not modified')) {
      console.log(`[LiveSync] تم تحديث كليشة الأسبوع القادم بنجاح (${weekStartKey}).`);
      return { ok: true, synced: true, message_id: saved.msgId };
    }
    return { ok: false, error: res.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

