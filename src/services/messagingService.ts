import { app, db } from "./firebase";
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";

let messagingInstance: any = null;

// Sadece tarayıcı destekliyorsa başlat
export const initMessaging = async () => {
  try {
    if (!app) return null;
    if (messagingInstance) return messagingInstance;
    
    const { getMessaging, isSupported } = await import("firebase/messaging");
    const supported = await isSupported();
    if (supported) {
      messagingInstance = getMessaging(app);
      return messagingInstance;
    }
  } catch (error) {
    console.error("Firebase Messaging desteklenmiyor veya başlatılamadı:", error);
  }
  return null;
};

// Cihazın benzersiz bir ID'si olsun (FCM token değişse bile cihazı tanımak için)
const getDeviceId = () => {
  let id = localStorage.getItem("redchat_device_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    localStorage.setItem("redchat_device_id", id);
  }
  return id;
};

export const requestNotificationPermissionAndToken = async (uid: string) => {
  try {
    const msg = await initMessaging();
    if (!msg) throw new Error("Tarayıcı bildirimleri desteklemiyor.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Bildirim izni reddedildi.");
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn("VITE_FIREBASE_VAPID_KEY .env dosyasında bulunamadı. VAPID anahtarı gerekiyorsa hata verebilir.");
    }

    const { getToken } = await import("firebase/messaging");
    const token = await getToken(msg, { vapidKey });
    if (token) {
      await saveTokenToFirestore(uid, token);
      return token;
    } else {
      throw new Error("FCM token alınamadı.");
    }
  } catch (error) {
    console.error("Bildirim izni istenirken hata:", error);
    throw error;
  }
};

const saveTokenToFirestore = async (uid: string, token: string) => {
  try {
    const deviceId = getDeviceId();
    const tokenDocRef = doc(db, `users/${uid}/fcmTokens`, deviceId);
    
    await setDoc(tokenDocRef, {
      token,
      uid,
      deviceId,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp() // Bu sadece ilk yaratmada kalacak (merge:true kullanırsak ezer, ama setDoc ezebilir, bunu daha iyi yönetebiliriz)
    }, { merge: true });
    
    console.log("FCM token başarıyla Firestore'a kaydedildi.");
  } catch (error) {
    console.error("Token Firestore'a kaydedilemedi:", error);
  }
};

export const removeTokenFromFirestore = async (uid: string) => {
  try {
    const deviceId = getDeviceId();
    const tokenDocRef = doc(db, `users/${uid}/fcmTokens`, deviceId);
    await deleteDoc(tokenDocRef);
    console.log("FCM token Firestore'dan silindi.");
  } catch (error) {
    console.error("Token silinemedi:", error);
  }
};

// Frontend'den aktif olarak alınan mesajları dinleme (Foreground push)
export const setupForegroundListener = async (onReceive: (payload: any) => void) => {
  const msg = await initMessaging();
  if (!msg) return null;
  const { onMessage } = await import("firebase/messaging");
  return onMessage(msg, (payload) => {
    console.log("Ön planda mesaj alındı:", payload);
    onReceive(payload);
  });
};

export const sendPushNotification = async (params: {
  receiverIds: string[];
  title: string;
  body: string;
  data?: any;
}) => {
  try {
    if (params.receiverIds.length === 0) return;

    // Her alıcı için tokenları Firestore'dan çek
    const allTokens: string[] = [];
    const tokensToUidMap = new Map<string, string>(); // invalid token olursa kimden sileceğimizi bilmek için

    for (const uid of params.receiverIds) {
      const tokensRef = collection(db, `users/${uid}/fcmTokens`);
      const snapshot = await getDocs(tokensRef);
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.token) {
          allTokens.push(data.token);
          tokensToUidMap.set(data.token, uid);
        }
      });
    }

    if (allTokens.length === 0) return;

    // Server-side endpoint'e gönder
    const response = await fetch('/api/notifications/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: allTokens,
        title: params.title,
        body: params.body,
        data: params.data
      })
    });

    const result = await response.json();
    
    // Geçersiz tokenları temizle
    if (result.failedTokens && Array.isArray(result.failedTokens) && result.failedTokens.length > 0) {
      for (const failedToken of result.failedTokens) {
        const uid = tokensToUidMap.get(failedToken);
        if (uid) {
          // Token'a karşılık gelen dökümanı bul ve sil
          const q = query(collection(db, `users/${uid}/fcmTokens`), where("token", "==", failedToken));
          const snapshot = await getDocs(q);
          snapshot.forEach(async (docSnap) => {
            await deleteDoc(doc(db, `users/${uid}/fcmTokens`, docSnap.id));
            console.log("Geçersiz FCM token temizlendi:", docSnap.id);
          });
        }
      }
    }

  } catch (error) {
    console.error("Push notification gönderilirken hata oluştu:", error);
  }
};
