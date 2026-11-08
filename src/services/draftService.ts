import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';

export interface DraftData {
  text: string;
  mediaType?: 'image' | 'video' | 'gif' | null;
  mediaUrl?: string | null;
  videoDuration?: number | null;
}

// Debounce haritası (targetId -> NodeJS.Timeout)
const saveDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

// Canlı dinleyiciler (UI anında güncellenmesi için)
const draftListeners = new Set<(draftsMap: Map<string, DraftData>) => void>();

/**
 * Taslak anahtarı (localStorage için)
 */
function getLocalDraftKey(userId: string, targetId: string): string {
  return `redchat_draft_${userId}_${targetId}`;
}

/**
 * Ham localStorage verisini DraftData yapısına dönüştürür (Geriye dönük uyumlu)
 */
function parseDraftRaw(rawVal: string | null): DraftData | null {
  if (!rawVal) return null;
  try {
    const parsed = JSON.parse(rawVal);
    if (parsed && typeof parsed === 'object') {
      return {
        text: parsed.text || '',
        mediaType: parsed.mediaType || null,
        mediaUrl: parsed.mediaUrl || null,
        videoDuration: parsed.videoDuration || null,
      };
    }
  } catch (e) {}

  // Eski düz metin taslağı ise
  if (rawVal.trim()) {
    return { text: rawVal };
  }

  return null;
}

/**
 * Yerel hafızadaki tüm aktif taslakları tarar ve Map döner
 */
export function getAllLocalDrafts(userId: string): Map<string, DraftData> {
  const map = new Map<string, DraftData>();
  if (!userId) return map;
  try {
    const prefix = `redchat_draft_${userId}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const targetId = key.substring(prefix.length);
        const rawVal = localStorage.getItem(key);
        const draft = parseDraftRaw(rawVal);
        if (targetId && draft && (draft.text?.trim() || draft.mediaUrl || draft.mediaType)) {
          map.set(targetId, draft);
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
export function getLocalDraft(userId: string, targetId: string): DraftData | null {
  if (!userId || !targetId) return null;
  try {
    const rawVal = localStorage.getItem(getLocalDraftKey(userId, targetId));
    return parseDraftRaw(rawVal);
  } catch (e) {
    return null;
  }
}

/**
 * Mesaj taslağını kaydeder (Local storage instant + Firestore debounced).
 */
export function saveDraft(
  userId: string,
  targetId: string,
  draftInput: string | DraftData,
  targetType: 'conversation' | 'channel' = 'conversation'
) {
  const activeUserId = auth?.currentUser?.uid || userId;
  if (!activeUserId || !targetId) return;

  const draftData: DraftData =
    typeof draftInput === 'string'
      ? { text: draftInput }
      : {
          text: draftInput.text || '',
          mediaType: draftInput.mediaType || null,
          mediaUrl: draftInput.mediaUrl || null,
          videoDuration: draftInput.videoDuration || null,
        };

  const isEmpty =
    (!draftData.text || draftData.text.trim() === '') &&
    !draftData.mediaUrl &&
    !draftData.mediaType;

  const localKey = getLocalDraftKey(activeUserId, targetId);

  // 1. LocalStorage anında güncelle
  if (isEmpty) {
    try {
      localStorage.removeItem(localKey);
    } catch (e) {}
  } else {
    try {
      localStorage.setItem(localKey, JSON.stringify(draftData));
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

    const currentUid = auth.currentUser.uid;
    const draftDocRef = doc(db, 'users', currentUid, 'drafts', targetId);

    try {
      if (isEmpty) {
        await deleteDoc(draftDocRef);
      } else {
        await setDoc(
          draftDocRef,
          {
            id: targetId,
            userId: currentUid,
            targetId,
            targetType,
            text: draftData.text || '',
            mediaType: draftData.mediaType || null,
            mediaUrl: draftData.mediaUrl || null,
            videoDuration: draftData.videoDuration || null,
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
 * Dönüş değeri: Map<targetId, DraftData>
 */
export function subscribeUserDrafts(
  userId: string,
  callback: (draftsMap: Map<string, DraftData>) => void
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
          if (data.targetId && (data.text?.trim() || data.mediaUrl || data.mediaType)) {
            const draftObj: DraftData = {
              text: data.text || '',
              mediaType: data.mediaType || null,
              mediaUrl: data.mediaUrl || null,
              videoDuration: data.videoDuration || null,
            };
            try {
              localStorage.setItem(getLocalDraftKey(activeUserId, data.targetId), JSON.stringify(draftObj));
            } catch (e) {}
          }
        });

        // Firestore güncellemeleri dahil güncel yerel taslakları gönder
        callback(getAllLocalDrafts(activeUserId));
      },
      (error) => {
        console.warn('Drafts Firestore subscription warning:', error);
        callback(getAllLocalDrafts(activeUserId));
      }
    );
  }

  return () => {
    draftListeners.delete(callback);
    unsubscribeFirestore();
  };
}

/**
 * Görsel dosyasından hafif DataURL önizleme oluşturur (max 400px width/height).
 */
export function createImageDraftPreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return resolve('');

      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        } else {
          resolve(result);
        }
      };
      img.onerror = () => resolve(result);
      img.src = result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/**
 * Video dosyasından ilk kare önizleme DataURL ve süresini çıkartır.
 */
export function createVideoDraftPreview(file: File): Promise<{ previewUrl: string; duration: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      const duration = video.duration || 0;
      video.currentTime = Math.min(0.5, duration / 2);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth || 320, 400);
      canvas.height = Math.min(video.videoHeight || 240, 300);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const previewUrl = canvas.toDataURL('image/jpeg', 0.75);
        URL.revokeObjectURL(url);
        resolve({ previewUrl, duration: video.duration || 0 });
      } else {
        URL.revokeObjectURL(url);
        resolve({ previewUrl: '', duration: video.duration || 0 });
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ previewUrl: '', duration: 0 });
    };
  });
}
