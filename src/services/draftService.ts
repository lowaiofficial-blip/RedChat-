import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';

// Debounce haritası (targetId -> NodeJS.Timeout)
const saveDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

// Canlı dinleyiciler (UI anında güncellenmesi için)
const draftListeners = new Set<(draftsMap: Map<string, string>) => void>();

/**
 * Taslak anahtarı (localStorage için)
 */
function getLocalDraftKey(userId: string, targetId: string): string {
  return `redchat_draft_${userId}_${targetId}`;
}

/**
 * Yerel hafızadaki tüm aktif taslakları tarar ve Map döner
 */
export function getAllLocalDrafts(userId: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!userId) return map;
  try {
    const prefix = `redchat_draft_${userId}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const targetId = key.substring(prefix.length);
        const text = localStorage.getItem(key);
        if (targetId && text && text.trim()) {
          map.set(targetId, text.trim());
        }
      }
    }
  } catch (e) {
    console.warn('getAllLocalDrafts error:', e);
  }
  return map;
}

/**
 * Dinleyicilere anlık yerel harita güncellemesini duyurur
 */
function notifyDraftListeners(userId: string) {
  const currentMap = getAllLocalDrafts(userId);
  draftListeners.forEach((listener) => {
    try {
      listener(currentMap);
    } catch (e) {}
  });
}

/**
 * Yerel hafızadaki tek bir sohbet taslağını okur
 */
export function getLocalDraft(userId: string, targetId: string): string {
  if (!userId || !targetId) return '';
  try {
    return localStorage.getItem(getLocalDraftKey(userId, targetId)) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Mesaj taslağını kaydeder (Local storage instant + Firestore debounced).
 */
export function saveDraft(
  userId: string,
  targetId: string,
  text: string,
  targetType: 'conversation' | 'channel' = 'conversation'
) {
  const activeUserId = auth?.currentUser?.uid || userId;
  if (!activeUserId || !targetId) return;

  const trimmedText = text;
  const localKey = getLocalDraftKey(activeUserId, targetId);

  // 1. LocalStorage anında güncelle
  if (!trimmedText || trimmedText.trim() === '') {
    try {
      localStorage.removeItem(localKey);
    } catch (e) {}
  } else {
    try {
      localStorage.setItem(localKey, trimmedText);
    } catch (e) {}
  }

  // 2. Arayüz dinleyicilerini anında tetikle (UI sıfır gecikmeyle güncellenir)
  notifyDraftListeners(activeUserId);

  // 3. Önceki debounce zamanlayıcısını temizle
  if (saveDebounceMap.has(targetId)) {
    clearTimeout(saveDebounceMap.get(targetId)!);
  }

  // 4. 500ms Debounced Firestore Yazma/Silme İşlemi
  const timeoutId = setTimeout(async () => {
    saveDebounceMap.delete(targetId);
    if (!db || !auth?.currentUser?.uid) return;

    // Oturum açmış kullanıcının gerçek UID'sini doğrula
    const currentUid = auth.currentUser.uid;
    const draftDocRef = doc(db, 'users', currentUid, 'drafts', targetId);

    try {
      if (!trimmedText || trimmedText.trim() === '') {
        await deleteDoc(draftDocRef);
      } else {
        await setDoc(
          draftDocRef,
          {
            id: targetId,
            userId: currentUid,
            targetId,
            targetType,
            text: trimmedText,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (error) {
      console.warn('Draft Firestore save warning:', error);
    }
  }, 500);

  saveDebounceMap.set(targetId, timeoutId);
}

/**
 * Taslağı kalıcı olarak siler (Mesaj gönderildiğinde veya iptal edildiğinde).
 */
export async function deleteDraft(userId: string, targetId: string) {
  const activeUserId = auth?.currentUser?.uid || userId;
  if (!activeUserId || !targetId) return;

  // Debounced bekleyen kayıt varsa iptal et
  if (saveDebounceMap.has(targetId)) {
    clearTimeout(saveDebounceMap.get(targetId)!);
    saveDebounceMap.delete(targetId);
  }

  // LocalStorage'dan sil ve UI güncelle
  try {
    localStorage.removeItem(getLocalDraftKey(activeUserId, targetId));
  } catch (e) {}
  notifyDraftListeners(activeUserId);

  // Firestore'dan sil
  if (db && auth?.currentUser?.uid) {
    try {
      const currentUid = auth.currentUser.uid;
      const draftDocRef = doc(db, 'users', currentUid, 'drafts', targetId);
      await deleteDoc(draftDocRef);
    } catch (error) {
      console.warn('Draft Firestore delete warning:', error);
    }
  }
}

/**
 * Kullanıcının tüm aktif taslaklarını canlı olarak dinler (LocalStorage + Firestore snapshot).
 * Dönüş değeri: Map<targetId, text>
 */
export function subscribeUserDrafts(
  userId: string,
  callback: (draftsMap: Map<string, string>) => void
): () => void {
  const activeUserId = auth?.currentUser?.uid || userId;
  if (!activeUserId) {
    callback(new Map());
    return () => {};
  }

  // 1. İlk yüklemede anında LocalStorage haritasını ver (Arayüz anında yüklenir)
  callback(getAllLocalDrafts(activeUserId));

  // 2. Dinleyici kümesine ekle
  draftListeners.add(callback);

  let unsubscribeFirestore = () => {};

  if (db && activeUserId) {
    const draftsCol = collection(db, 'users', activeUserId, 'drafts');
    unsubscribeFirestore = onSnapshot(
      draftsCol,
      (snapshot) => {
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.targetId && data.text && data.text.trim()) {
            try {
              localStorage.setItem(getLocalDraftKey(activeUserId, data.targetId), data.text);
            } catch (e) {}
          }
        });

        // Firestore güncellemeleri dahil güncel yerel taslakları gönder
        callback(getAllLocalDrafts(activeUserId));
      },
      (error) => {
        console.warn('Drafts Firestore subscription warning:', error);
        // Hata durumunda dahi yerel depolamadaki taslakları koru ve sun
        callback(getAllLocalDrafts(activeUserId));
      }
    );
  }

  return () => {
    draftListeners.delete(callback);
    unsubscribeFirestore();
  };
}
