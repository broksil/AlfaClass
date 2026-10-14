/* =============================================================
   AlfaClass — Service Worker (Zero Maintenance)
   الاستراتيجية: Stale-While-Revalidate
   ─────────────────────────────────────────────────────────────
   • يعرض الملف فوراً من الكاش (سرعة فورية للطالب)
   • ويجلب نسخة طازجة من السيرفر في الخلفية لتحديث الكاش
     لتصبح جاهزة لزيارة الطالب القادمة
   • لا توجد أرقام إصدارات (Versions) في أي مكان:
     اسم الكاش ثابت، والمحتوى يتجدد تلقائياً في كل زيارة
     => رفع تحديث جديد للموقع لا يتطلب أي تعديل في هذا الملف
   ============================================================= */

const CACHE_NAME = 'alfaclass-core'; // اسم ثابت للأبد — لا يُغيَّر عند رفع تحديث
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

  // الطلبات الخارجية (Firebase / Cloudinary / Fonts / APIs) → للشبكة مباشرة
  if (new URL(req.url).origin !== self.location.origin) return;

  // نحترم الطلبات التي طلب التطبيق عدم كاشها (تنزيلات الملفات / Range / no-store)
  if (req.cache === 'no-store' || req.cache === 'only-if-cached' || req.headers.has('range')) return;

  // كل الطلبات الأخرى → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(event));
});
