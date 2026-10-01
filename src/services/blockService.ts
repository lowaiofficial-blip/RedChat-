import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from './firebase';
import { REDCHAT_AI_UID } from './aiService';

/**
 * İki kullanıcı arasında tek ve deterministik bir conversation ID üretir.
 */
function getDeterministicConvId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('_');
}

/**
 * Kullanıcıyı gerçek ve kalıcı olarak engeller.
 * 1. Firestore 'users/{currentUserId}/blockedUsers/{targetUserId}' altına kalıcı kayıt yazar.
 * 2. İki kullanıcı arasındaki doğrudan konuşma (conversations) dokümanına blockedBy bilgisini senkronize eder.
 */
export async function blockUser(currentUserId: string, targetUserId: string): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!currentUserId || !targetUserId) throw new Error('Kullanıcı ID bilgileri eksik');
  if (currentUserId === targetUserId) throw new Error('Kullanıcı kendisini engelleyemez');

  // RedChat AI asla engellenemez
  if (targetUserId === REDCHAT_AI_UID || targetUserId === 'system_redchat_ai') {
    throw new Error('RedChat AI / DeepRed asistanı engellenemez');
  }

  // 1. users/{currentUserId}/blockedUsers/{targetUserId} dokümanını oluştur
  const blockedDocRef = doc(db, 'users', currentUserId, 'blockedUsers', targetUserId);
  await setDoc(blockedDocRef, {
    blockedUserId: targetUserId,
    createdAt: serverTimestamp(),
  });

  // 2. İki kullanıcı arasındaki birebir sohbet varsa blockedBy durumunu güncelle
  try {
    const convId = getDeterministicConvId(currentUserId, targetUserId);
    const convDocRef = doc(db, 'conversations', convId);
    const snap = await getDoc(convDocRef);

    if (snap.exists()) {
      await setDoc(
        convDocRef,
        {
          [`blockedBy.${currentUserId}`]: true,
          blockedUserIds: arrayUnion(currentUserId),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (convErr) {
    console.warn('Konuşma dokümanına engelleme durumu yazılırken uyarı:', convErr);
  }
}

/**
 * Kullanıcının engelini kaldırır.
 * 1. Firestore 'users/{currentUserId}/blockedUsers/{targetUserId}' kaydını siler.
 * 2. Birebir konuşma dokümanındaki engelleme bilgisini kaldırır.
 */
export async function unblockUser(currentUserId: string, targetUserId: string): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!currentUserId || !targetUserId) return;

  // 1. users/{currentUserId}/blockedUsers/{targetUserId} dokümanını sil
  const blockedDocRef = doc(db, 'users', currentUserId, 'blockedUsers', targetUserId);
  await deleteDoc(blockedDocRef);

  // 2. İki kullanıcı arasındaki birebir sohbet varsa engeli kaldır
  try {
    const convId = getDeterministicConvId(currentUserId, targetUserId);
    const convDocRef = doc(db, 'conversations', convId);
    const snap = await getDoc(convDocRef);

    if (snap.exists()) {
      await setDoc(
        convDocRef,
        {
          [`blockedBy.${currentUserId}`]: false,
          blockedUserIds: arrayRemove(currentUserId),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (convErr) {
    console.warn('Konuşma dokümanından engel kaldırılırken uyarı:', convErr);
  }
}

/**
 * Kullanıcının engellediği kişilerin listesini gerçek zamanlı (realtime) dinler.
 * Cihazlar arası (Telefon, Tablet, PC) anında senkronize olur.
 */
export function subscribeToBlockedUsers(
  currentUserId: string,
  callback: (blockedUserIds: string[]) => void
): () => void {
  if (!db || !currentUserId) {
    callback([]);
    return () => {};
  }

  const blockedColRef = collection(db, 'users', currentUserId, 'blockedUsers');

  return onSnapshot(
    blockedColRef,
    (snapshot) => {
      const ids: string[] = [];
      snapshot.forEach((d) => {
        ids.push(d.id);
      });
      callback(ids);
    },
    (error) => {
      console.error('BlockedUsers onSnapshot hatası:', error);
    }
  );
}

/**
 * Belirli bir kullanıcının engellenip engellenmediğini doğrudan sorgular.
 */
export async function isUserBlockedByMe(
  currentUserId: string,
  targetUserId: string
): Promise<boolean> {
  if (!db || !currentUserId || !targetUserId) return false;
  try {
    const blockedDocRef = doc(db, 'users', currentUserId, 'blockedUsers', targetUserId);
    const snap = await getDoc(blockedDocRef);
    return snap.exists();
  } catch (err) {
    console.warn('isUserBlockedByMe sorgu hatası:', err);
    return false;
  }
}
