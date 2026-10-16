/* =============================================================
   AlfaClass — Service Worker (Zero Maintenance)
   الاستراتيجية: Stale-While-Revalidate
   ─────────────────────────────────────────────────────────────
   • يعرض الملف فوراً من الكاش (سرعة فورية للطالب)
   • ويجلب نسخة طازجة من السيرفر في الخلفية لتحديث الكاش
     لتصبح جاهزة لزيارة الطالب القادمة
   • لا توجد أرقام إصدارات (Versions) في أي مكان — باستثناء ترقية CACHE_NAME عند الحاجة:
      الاسم ثابت والمحتوى يتجدد تلقائيا في كل زيارة (يحتاج تحميلين فقط)
      => رفع تحديث جديد لا يحتاج تعديلا هنا — إلا لتغيير CACHE_NAME إجبارا لتحديث شامل يسقط الكاش القديم
   ============================================================= */

// [ترقية 2026-10-16] إجبار تحديث شامل: الاسم القديم 'alfaclass-core'
// سيُحذف في activate لأنه لم يعد في KEEP_CACHES — يفضي كاش index.html القديم
const CACHE_NAME = 'alfaclass-core-v2';
const KEEP_CACHES = [CACHE_NAME, 'downloaded-files']; // كاش تنزيلات الملفات لا يُحذف
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './icon.svg'
];

// ── التنصيب: تجهيز الملفات الأساسية مباشرة من السيرفر (تجاوز كاش HTTP) ──
self.addEventListener('install', event => {
  self.skipWaiting(); // تفعيل فوري دون انتظار إغلاق كل التبويبات
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(CORE_ASSETS.map(url =>
        fetch(new Request(url, { cache: 'no-cache' }))
          .then(res => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => {}) // فشل ملف واحد لا يمنع تنصيب Service Worker
      ))
    )
  );
});

// ── التفعيل: حذف كاشات الإصدارات القديمة المرقّمة (v1 … v46) مرة واحدة ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !KEEP_CACHES.includes(key)).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // سيطرة فورية على الصفحات المفتوحة
  );
});

// ── الاستراتيجية الأساسية: Stale-While-Revalidate ──
function staleWhileRevalidate(event) {
  const req = event.request;
  const cacheP = caches.open(CACHE_NAME);
  const cachedP = cacheP.then(cache => cache.match(req)).catch(() => null);

  // التحديث في الخلفية: نسخة طازجة من السيرفر (تجاوز كاش HTTP) ثم تخزينها
  const revalidateP = Promise.all([cacheP, fetch(req, { cache: 'no-cache' })])
    .then(([cache, res]) => {
      if (res && res.ok) {
        return cache.put(req, res.clone())
          .catch(() => {})
          .then(() => res);
      }
      return res;
    })
    .catch(() => null);

  // نضمن بقاء المتصفح حياً حتى يكتمل التحديث في الخلفية
  event.waitUntil(revalidateP);

  // الإرجاع: الكاش أولاً (فوري)، وإلا الشبكة، وإلا صفحة أوفلاين للصفحات
  return cachedP.then(cached => {
    if (cached) return cached;
    return revalidateP.then(res => res || offlineResponse(req));
  });
}

// جلب الصفحة الرئيسية من الشبكة أولاً (دائماً جديدة)، مع الكاش كبديل أوفلاين
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res || offlineResponse(req);
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return offlineResponse(req);
  }
}

// صفحة أوفلاين مصغّرة عند انقطاع الإنترنت وعدم وجود نسخة مخزنة
function offlineResponse(req) {
  if (req.mode === 'navigate' || req.destination === 'document') {
    return new Response(
      '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>ألفاكلاس</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:40px;background:#080818;color:#f0f0ff">' +
      '<h1>أنت غير متصل بالإنترنت</h1><p>تحقق من اتصالك ثم أعد المحاولة.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response('', { status: 503 });
}

// ── اعتراض الطلبات ──
self.addEventListener('fetch', event => {
  const req = event.request;

  // طلبات الرفع/التعديل (POST/PUT…) لا تُاعتبر
  if (req.method !== 'GET') return;

  // الطلبات النطاقات الخارجية (Firebase / Cloudinary / Fonts / APIs) → للشبكة مباشرة
  const scopeOrigin = new URL(self.registration.scope).origin;
  if (new URL(req.url).origin !== scopeOrigin) return;

  // نحترم الطلبات التي طلب التطبيق عدم كاشها (تنزيلات الملفات / Range / no-store)
  if (req.cache === 'no-store' || req.cache === 'only-if-cached' || req.headers.has('range')) return;

  // الصفحة الرئيسية (مستند index.html) تُجلب دائماً من الشبكة أولاً لضمان روابط ومحتوى جديد،
  // مع الكاش كبديل عند انقطاع الإنترنت. باقي الملفات تتبع استراتيجية Stale-While-Revalidate.
  const url = req.url;
  const isDoc = req.mode === 'navigate' || req.destination === 'document';
  const isIndex = isDoc && (url.endsWith('index.html') || url.endsWith('/'));

  if (isIndex) {
    event.respondWith(networkFirst(req));
    return;
  }

  // كل الطلبات الأخرى → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(event));
});

// ═══════════════ دمج إشعارات Firebase (FCM) ═══════════════
// هذا الملف هو الـ Service Worker الوحيد الآن: كاش + إشعارات معاً
// (دُمج فيه ملف firebase-messaging-sw.js القديم — لا تسجيل ثانٍ ولا تعارض)
try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js'
  );
  firebase.initializeApp({
    apiKey: 'AIzaSyDrT10AouY-MAtS4Brt-1fPpPt4YoT8spc',
    authDomain: 'alfaclass-120e3.firebaseapp.com',
    projectId: 'alfaclass-120e3',
    messagingSenderId: '548886375389',
    appId: '1:548886375389:web:a49c2a446981cd2836e434'
  });

  // استقبال الإشعارات عندما يكون التطبيق في الخلفية
  firebase.messaging().onBackgroundMessage(function (payload) {
    const n = (payload && payload.notification) || {};
    self.registration.showNotification(n.title || 'ألفاكلاس', {
      body: n.body || '',
      icon: 'صور/ألفاكلاس.png',
      data: payload && payload.data // يحمل البيانات الإضافية مثل dayId للتوجه المباشر
    });
  });
} catch (e) {
  // تعذّر تحميل مكتبات فايربيس (إنترنت ضعيف/محجوب): الكاش والاستراتيجية تبقى تعمل
  console.warn('FCM غير جاهز داخل Service Worker:', e && e.message);
}

// النقر على الإشعار → تركيز التطبيق المفتوح أو فتحه على اليوم المطلوب
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const dayId = event.notification.data && event.notification.data.dayId;
  if (!dayId) return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // إذا كان التطبيق مفتوحاً في تبويبة أخرى: ركّزه وأرسل يوم النقر إليه
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', dayId: dayId });
          return client.focus();
        }
      }
      // إذا كان التطبيق مغلقاً تماماً: افتحه على نطاق الموقع كاملاً مع اليوم
      // (تصحيح عن الملف القديم '/#day-' الذي كان يفتح جذر النطاق بدل /AlfaClass/)
      if (clients.openWindow) {
        return clients.openWindow(self.registration.scope + '#day-' + dayId);
      }
    })
  );
});
