const CACHE_NAME = 'alfaclass-v2';
const DYNAMIC_CACHE = 'alfaclass-images-v1';
const urlsToCache = [
  './',
  './index.html',
  './صور/ألفاكلاس.png',
  './صور/غلاف موقع.png'
];

// تنصيب Service Worker وتخزين الملفات الأساسية
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
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
    })
  );
});

// جلب الملفات من الكاش مع تخزين الصور ديناميكياً للعمل بدون إنترنت
self.addEventListener('fetch', event => {
  const req = event.request;

  // إذا كان الطلب لصورة (مثل صور المنشورات من Cloudinary)
  if (req.destination === 'image' || req.url.includes('res.cloudinary.com')) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        if (cachedRes) return cachedRes; // إرجاع الصورة من الكاش إذا كانت موجودة
        
        return fetch(req).then(fetchRes => {
          return caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(req, fetchRes.clone()); // حفظ نسخة من الصورة الجديدة في الكاش
            return fetchRes;
          });
        }).catch(() => {
          // إرجاع صورة فارغة بدلاً من إحداث خطأ TypeError في المتصفح
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        });
      })
    );
  } else {
    // التعامل مع باقي الملفات الأساسية باستراتيجية (Network First) لضمان حصول المستخدم على التحديثات
    event.respondWith(
      fetch(req).then(fetchRes => {
        // حفظ نسخة في الكاش فقط إذا كان الطلب من نوع GET لمنع أخطاء الرفع
        if (req.method === 'GET') {
          const resClone = fetchRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
        }
        return fetchRes;
      }).catch(() => {
        return caches.match(req).then(response => {
          return response || new Response('Offline', { status: 503 });
        });
      })
    );
  }
});