importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyDrT10AouY-MAtS4Brt-1fPpPt4YoT8spc",
  authDomain: "alfaclass-120e3.firebaseapp.com",
  projectId: "alfaclass-120e3",
  messagingSenderId: "548886375389",
  appId: "1:548886375389:web:a49c2a446981cd2836e434"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// استقبال الإشعارات عندما يكون التطبيق في الخلفية
messaging.onBackgroundMessage(function(payload) {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: 'صور/ألفاكلاس.png',
    data: payload.data // يحمل البيانات الإضافية مثل dayId للتوجه المباشر
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// التعامل مع النقر على الإشعار عندما يكون التطبيق في الخلفية
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.notification.data && event.notification.data.dayId) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(windowClients => {
        // إذا كان التطبيق مفتوحاً في تبويبة أخرى، قم بالتركيز عليه وإرسال أمر
        for (let i = 0; i < windowClients.length; i++) {
          let client = windowClients[i];
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', dayId: event.notification.data.dayId });
            return client.focus();
          }
        }
        // إذا كان التطبيق مغلقاً تماماً، قم بفتحه وتمرير اليوم في الرابط
        if (clients.openWindow) {
          return clients.openWindow('/#day-' + event.notification.data.dayId);
        }
      })
    );
  }
});