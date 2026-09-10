// firebase-messaging-sw.js

// Firebase kütüphanelerini SW içine import ediyoruz
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Projenizin config bilgilerini buraya koyun (sadece appId vs gerekiyor push alabilmesi için, api key vs)
// Uygulamanızın config nesnesini kullanabilirsiniz (kod içi fallback'te bulunan)
const firebaseConfig = {
  apiKey: "AIzaSyBYhgYrEdHagHmyj2R7QgywccHyYEBdX8I",
  authDomain: "redchat-7c1db.firebaseapp.com",
  projectId: "redchat-7c1db",
  storageBucket: "redchat-7c1db.firebasestorage.app",
  messagingSenderId: "544653180299",
  appId: "1:544653180299:web:b279e851cbe1a384b0c38e"
};

// LocalStorage'a SW içinden erişilemediği için indexDB kullanılabilir ama en basit yolla static config ile başlatalım
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Eğer payload.notification varsa, Firebase SDK bunu otomatik olarak gösterir.
  // Çift bildirim olmaması için burada tekrar showNotification ÇAĞIRMIYORUZ!
  if (payload.notification) {
    return;
  }
  
  const notificationTitle = payload.data?.title || 'RedChat';
  const notificationOptions = {
    body: payload.data?.body,
    icon: '/icon.png',
    badge: '/icon.png',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Bildirime tıklanma olayı
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  let targetUrl = '/';
  if (event.notification.data && event.notification.data.conversationId) {
    targetUrl = `/#/chat/${event.notification.data.conversationId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      // Zaten açık bir sekme varsa ona odaklan
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if (client.url.includes('redchat') || client.url.includes('localhost')) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Yoksa yeni aç
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
