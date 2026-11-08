/**
 * IndexedDB tabanlı Medya Taslak Saklayıcısı
 * Fotoğraf ve Video (Blob/File) nesnelerini yerel tarayıcı veritabanında saklar.
 * Böylece sayfa yenilense veya tarayıcı kapatılıp açılsa bile medya dosyası kaybolmaz.
 */

const DB_NAME = 'redchat_media_drafts_db';
const STORE_NAME = 'media_drafts';
const DB_VERSION = 1;

interface StoredMediaDraft {
  targetId: string;
  blob: Blob;
  fileName?: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'gif';
  duration?: number;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB desteklenmiyor.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'targetId' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

// In-memory hızlı önbellek (aynı oturumda anında erişim için)
const memoryMediaCache = new Map<string, { file: File; duration?: number; mediaType: 'image' | 'video' | 'gif' }>();

/**
 * Medya dosyasını (Fotoğraf veya Video) IndexedDB ve belleğe kaydeder.
 */
export async function saveMediaDraftFile(
  targetId: string,
  file: File,
  mediaType: 'image' | 'video' | 'gif',
  duration?: number
): Promise<void> {
  if (!targetId || !file) return;

  // 1. Bellek önbelleğine anında kaydet
  memoryMediaCache.set(targetId, { file, duration, mediaType });

  // 2. IndexedDB'ye kalıcı olarak yaz
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: StoredMediaDraft = {
      targetId,
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      mediaType,
      duration: duration || undefined,
      timestamp: Date.now(),
    };

    store.put(record);
  } catch (err) {
    console.warn('IndexedDB saveMediaDraftFile error:', err);
  }
}

/**
 * Kayıtlı medya dosyasını IndexedDB veya bellekten File olarak geri yükler.
 */
export async function getMediaDraftFile(
  targetId: string
): Promise<{ file: File; mediaType: 'image' | 'video' | 'gif'; duration?: number } | null> {
  if (!targetId) return null;

  // 1. Önce bellek önbelleğinde varsa anında dön
  if (memoryMediaCache.has(targetId)) {
    return memoryMediaCache.get(targetId)!;
  }

  // 2. Yoksa IndexedDB'den oku
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(targetId);

      req.onsuccess = () => {
        const result = req.result as StoredMediaDraft | undefined;
        if (result && result.blob) {
          const reconstructedFile = new File(
            [result.blob],
            result.fileName || (result.mediaType === 'video' ? 'draft_video.mp4' : 'draft_photo.jpg'),
            { type: result.mimeType || result.blob.type }
          );

          const data = {
            file: reconstructedFile,
            mediaType: result.mediaType,
            duration: result.duration,
          };

          // Bellek önbelleğine de al
          memoryMediaCache.set(targetId, data);
          resolve(data);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('IndexedDB getMediaDraftFile error:', err);
    return null;
  }
}

/**
 * Medya taslağını IndexedDB ve bellekten siler.
 */
export async function deleteMediaDraftFile(targetId: string): Promise<void> {
  if (!targetId) return;

  memoryMediaCache.delete(targetId);

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(targetId);
  } catch (err) {
    console.warn('IndexedDB deleteMediaDraftFile error:', err);
  }
}

/**
 * Base64 DataURL'i gerçek bir File nesnesine dönüştürür.
 */
export function dataURLtoFile(dataurl: string, filename = 'draft_photo.jpg'): File {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}
