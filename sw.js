const CACHE_NAME = 'alfaclass-v2';
const DYNAMIC_CACHE = 'alfaclass-images-v1';
const urlsToCache = [
  './',
  './index.html',
  './صور/ألفاكلاس.png'
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
    // التعامل مع باقي الملفات الأساسية
    event.respondWith(
      caches.match(req).then(response => {
        return response || fetch(req).catch(() => new Response('Offline', { status: 503 }));
      })
    );
  }
});