const CACHE_NAME = 'alfaclass-v18';
const DYNAMIC_CACHE = 'alfaclass-images-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './icon.svg'
];

// تنصيب Service Worker وتخزين الملفات الأساسية
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache).catch(() => {}))
  );
});

// تنظيف الملفات القديمة من الكاش عند تحديث Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// تخزين/إرجاع الصور بأسلوب Cache First
function cacheFirstImage(req) {
  return caches.match(req).then(cachedRes => {
    if (cachedRes) return cachedRes; // إرجاع الصورة من الكاش إذا كانت موجودة
    return fetch(req).then(fetchRes => {
      return caches.open(DYNAMIC_CACHE).then(cache => {
        cache.put(req, fetchRes.clone()); // حفظ نسخة من الصورة الجديدة
        return fetchRes;
      });
    }).catch(() => {
      // صورة فارغة بدلاً من خطأ TypeError
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    });
  });
}

// جلب الملفات: الصور Cache First، وملفات التطبيق Stale-While-Revalidate (سريعة + تحديث بالخلفية)
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // لا نتدخل في طلبات الرفع (POST/PUT)

  const url = new URL(req.url);

  // الصور (بما فيها صور Cloudinary) → Cache First
  if (req.destination === 'image' || url.hostname.indexOf('res.cloudinary.com') !== -1) {
    event.respondWith(cacheFirstImage(req));
    return;
  }

  // الطلبات الخارجية (Firebase / Fonts / APIs) → تُترك للشبكة بدون تدخل
  if (url.origin !== self.location.origin) return;

  // ملفات التطبيق الأساسية → Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || network; // الإرجاع الفوري من الكاش إن وُجد، مع التحديث في الخلفية
    })
  );
});