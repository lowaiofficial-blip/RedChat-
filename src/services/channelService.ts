import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  runTransaction,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Channel,
  ChannelPost,
  ChannelFollower,
  UserProfile,
  ChannelNotification,
  ChannelOwnerPrivate,
} from '../types';
import { sendPushNotification } from './messagingService';

/**
 * 📢 Yeni Kanal Oluşturma
 * 
 * ⚠️ GİZLİLİK KURALI:
 * `channels/{channelId}` ana dokümanında ASLA kurucu UID'si ('ownerId', 'creatorUid' vb.) bulunmaz!
 * Kurucu UID'si yalnızca `channels/{channelId}/private/owner` ve `users/{uid}/myChannels/{channelId}`
 * içinde güvenle saklanır. Böylece normal kullanıcılar kurucuyu kesinlikle göremez ve tespit edemez.
 */
export async function createChannel(
  user: UserProfile,
  data: {
    name: string;
    description: string;
    photoURL?: string | null;
    bannerUrl?: string | null;
  }
): Promise<string> {
  if (!db || !user?.uid) throw new Error('Veritabanı veya kullanıcı oturumu bulunamadı.');

  const trimmedName = data.name.trim();
  const trimmedDesc = data.description.trim();
  if (!trimmedName) throw new Error('Kanal adı zorunludur.');

  // Yeni benzersiz kanal ID'si üret
  const channelRef = doc(collection(db, 'channels'));
  const channelId = channelRef.id;

  // 1. Genel Kanal Dokümanı (Kurucu bilgisi İÇERMEZ)
  await setDoc(channelRef, {
    id: channelId,
    name: trimmedName,
    description: trimmedDesc,
    photoURL: data.photoURL || null,
    bannerUrl: data.bannerUrl || null,
    isVerified: false,
    followerCount: 1, // Kurucu otomatik ilk takipçidir
    postCount: 0,
    lastPostText: null,
    lastPostTimestamp: null,
    disabled: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2. Gizli Kurucu Dokümanı (Yalnızca kurucu ve admin okuyabilir)
  const ownerRef = doc(db, 'channels', channelId, 'private', 'owner');
  await setDoc(ownerRef, {
    ownerId: user.uid,
    createdAt: serverTimestamp(),
  });

  // 3. Kurucunun Kendi Kanalları İndeksi (Yalnızca kurucu kendisi okuyabilir)
  const myChannelRef = doc(db, 'users', user.uid, 'myChannels', channelId);
  await setDoc(myChannelRef, {
    channelId,
    role: 'owner',
    createdAt: serverTimestamp(),
  });

  // 4. Kurucunun Takipçi Kaydı
  const followerRef = doc(db, 'channels', channelId, 'followers', user.uid);
  await setDoc(followerRef, {
    uid: user.uid,
    displayName: user.displayName || user.username,
    username: user.username,
    photoURL: user.photoURL || null,
    followedAt: serverTimestamp(),
  });

  // 5. Kurucunun Takip Ettikleri İndeksi
  const followingRef = doc(db, 'users', user.uid, 'followingChannels', channelId);
  await setDoc(followingRef, {
    channelId,
    followedAt: serverTimestamp(),
  });

  return channelId;
}

/**
 * 👑 Kullanıcının Bu Kanalın Sahibi / Kurucusu Olup Olmadığını Kontrol Eder
 * Hem asıl kurucuyu (ownerId) hem de kurucu yetkisi verilmiş ortak kurucuları (coOwnerIds) doğrular.
 */
export async function checkIsChannelOwner(
  channelId: string,
  currentUid: string,
  isAdminUser?: boolean
): Promise<boolean> {
  if (isAdminUser) return true;
  if (!db || !channelId || !currentUid) return false;
  try {
    // 1. Önce kullanıcının kendi 'myChannels' listesinden kontrol et
    const myChannelDoc = await getDoc(doc(db, 'users', currentUid, 'myChannels', channelId));
    if (myChannelDoc.exists()) {
      return true;
    }

    // 2. Gizli owner belgesini doğrula (ownerId veya coOwnerIds listesinde var mı)
    const ownerDoc = await getDoc(doc(db, 'channels', channelId, 'private', 'owner'));
    if (ownerDoc.exists()) {
      const data = ownerDoc.data();
      if (data?.ownerId === currentUid) {
        return true;
      }
      if (Array.isArray(data?.coOwnerIds) && data.coOwnerIds.includes(currentUid)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 👑 Kanala Yeni Kurucu / Ortak Kurucu Yetkisi Ver
 */
export async function addChannelCoOwner(
  channelId: string,
  targetUser: { uid: string; displayName?: string; username?: string; photoURL?: string | null }
): Promise<void> {
  if (!db || !channelId || !targetUser?.uid) throw new Error('Geçersiz parametre');

  const ownerRef = doc(db, 'channels', channelId, 'private', 'owner');
  const ownerSnap = await getDoc(ownerRef);
  let coOwnerIds: string[] = [];
  if (ownerSnap.exists()) {
    coOwnerIds = ownerSnap.data()?.coOwnerIds || [];
  }
  if (!coOwnerIds.includes(targetUser.uid)) {
    coOwnerIds.push(targetUser.uid);
  }

  await updateDoc(ownerRef, {
    coOwnerIds,
    updatedAt: serverTimestamp(),
  });

  // Hedef kullanıcının myChannels dizinine ekle (Kurucu yetkisiyle)
  const myChannelRef = doc(db, 'users', targetUser.uid, 'myChannels', channelId);
  await setDoc(myChannelRef, {
    channelId,
    role: 'co-owner',
    createdAt: serverTimestamp(),
  });
}

/**
 * 👑 Kanal Ortak Kurucu Yetkisini Geri Al
 */
export async function removeChannelCoOwner(
  channelId: string,
  targetUid: string
): Promise<void> {
  if (!db || !channelId || !targetUid) throw new Error('Geçersiz parametre');

  const ownerRef = doc(db, 'channels', channelId, 'private', 'owner');
  const ownerSnap = await getDoc(ownerRef);
  if (ownerSnap.exists()) {
    const currentCoOwners: string[] = ownerSnap.data()?.coOwnerIds || [];
    const newCoOwners = currentCoOwners.filter((id) => id !== targetUid);
    await updateDoc(ownerRef, {
      coOwnerIds: newCoOwners,
      updatedAt: serverTimestamp(),
    });
  }

  // Kullanıcının myChannels dizininden sil
  const myChannelRef = doc(db, 'users', targetUid, 'myChannels', channelId);
  await deleteDoc(myChannelRef).catch(() => {});
}

/**
 * 👑 Kanal Kurucularını Getir (ownerId ve coOwnerIds)
 */
export async function getChannelOwners(
  channelId: string
): Promise<{ ownerId: string; coOwnerIds: string[] }> {
  if (!db || !channelId) return { ownerId: '', coOwnerIds: [] };
  try {
    const ownerSnap = await getDoc(doc(db, 'channels', channelId, 'private', 'owner'));
    if (ownerSnap.exists()) {
      const data = ownerSnap.data();
      return {
        ownerId: data?.ownerId || '',
        coOwnerIds: Array.isArray(data?.coOwnerIds) ? data.coOwnerIds : [],
      };
    }
  } catch (err) {
    console.warn('Kurucu bilgisi alınamadı:', err);
  }
  return { ownerId: '', coOwnerIds: [] };
}

/**
 * 👑 Kanal Kurucularını Gerçek Zamanlı Dinle
 */
export function subscribeToChannelOwners(
  channelId: string,
  callback: (info: { ownerId: string; coOwnerIds: string[] }) => void
): Unsubscribe {
  if (!db || !channelId) {
    callback({ ownerId: '', coOwnerIds: [] });
    return () => {};
  }

  const ownerRef = doc(db, 'channels', channelId, 'private', 'owner');
  return onSnapshot(
    ownerRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          ownerId: data?.ownerId || '',
          coOwnerIds: Array.isArray(data?.coOwnerIds) ? data.coOwnerIds : [],
        });
      } else {
        callback({ ownerId: '', coOwnerIds: [] });
      }
    },
    () => {
      callback({ ownerId: '', coOwnerIds: [] });
    }
  );
}

/**
 * 📢 Tüm Kanalları Gerçek Zamanlı Dinle
 */
export function subscribeToChannels(callback: (channels: Channel[]) => void): Unsubscribe {
  if (!db) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'channels'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const channels: Channel[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Channel;
        // Devre dışı bırakılmamış kanalları listele
        if (!data.disabled) {
          channels.push({
            ...data,
            id: docSnap.id,
            followerCount: Math.max(0, data.followerCount || 0),
          });
        }
      });
      callback(channels);
    },
    (error) => {
      console.warn('Kanallar dinlenirken hata:', error);
      callback([]);
    }
  );
}

/**
 * 📢 Tek Bir Kanalı Dinle
 */
export function subscribeToChannel(
  channelId: string,
  callback: (channel: Channel | null) => void
): Unsubscribe {
  if (!db || !channelId) {
    callback(null);
    return () => {};
  }

  const docRef = doc(db, 'channels', channelId);
  const followersCol = collection(db, 'channels', channelId, 'followers');

  // Gerçek takipçi dokümanlarını sayıp gerekirse senkronize et
  getDocs(followersCol)
    .then((snap) => {
      const actualCount = snap.size;
      getDoc(docRef)
        .then((docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as Channel;
            if (data.followerCount !== actualCount) {
              updateDoc(docRef, { followerCount: actualCount }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    })
    .catch(() => {});

  return onSnapshot(
    docRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Channel;
        const safeCount = Math.max(0, data.followerCount || 0);

        // Veritabanında eksiye düşmüşse arka planda otomatik düzelt
        if (data.followerCount !== undefined && data.followerCount < 0) {
          updateDoc(docRef, { followerCount: safeCount }).catch(() => {});
        }

        callback({
          ...data,
          id: docSnap.id,
          followerCount: safeCount,
        });
      } else {
        callback(null);
      }
    },
    (error) => {
      console.warn('Kanal dinlenirken hata:', error);
      callback(null);
    }
  );
}

/**
 * 👥 Kullanıcının Takip Ettiği Kanal ID'lerini Dinle
 */
export function subscribeToUserFollowingChannels(
  userId: string,
  callback: (channelIds: string[]) => void
): Unsubscribe {
  if (!db || !userId) {
    callback([]);
    return () => {};
  }

  const colRef = collection(db, 'users', userId, 'followingChannels');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const ids: string[] = [];
      snapshot.forEach((docSnap) => {
        ids.push(docSnap.id);
      });
      callback(ids);
    },
    (error) => {
      console.warn('Takip edilen kanallar dinlenirken hata:', error);
      callback([]);
    }
  );
}

/**
 * 👥 Kanal Takipçilerini Dinle (Yalnızca Kanal Kurucusu veya Admin)
 * ⚠️ Normal kullanıcılar için bu liste kurallarla kilitlidir!
 */
export function subscribeToChannelFollowers(
  channelId: string,
  callback: (followers: ChannelFollower[]) => void
): Unsubscribe {
  if (!db || !channelId) {
    callback([]);
    return () => {};
  }

  const colRef = collection(db, 'channels', channelId, 'followers');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: ChannelFollower[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as ChannelFollower);
      });

      // Gerçek takipçi listesi boyutunu kanal ana dokümanıyla otomatik senkronize et
      if (channelId && db) {
        const channelRef = doc(db, 'channels', channelId);
        updateDoc(channelRef, {
          followerCount: list.length,
        }).catch(() => {});
      }

      callback(list);
    },
    (error) => {
      console.warn('Takipçiler dinlenirken hata (yetki kısıtlaması olabilir):', error);
      callback([]);
    }
  );
}

/**
 * ➕ Kanalı Takip Et (Spam ve Mükerrer Tıklama Korumalı)
 */
export async function followChannel(channelId: string, user: UserProfile): Promise<void> {
  if (!db || !channelId || !user?.uid) throw new Error('Kullanıcı veya kanal bilgisi eksik.');

  const followerRef = doc(db, 'channels', channelId, 'followers', user.uid);
  const followingRef = doc(db, 'users', user.uid, 'followingChannels', channelId);
  const channelRef = doc(db, 'channels', channelId);

  await runTransaction(db, async (transaction) => {
    const followerDoc = await transaction.get(followerRef);
    if (followerDoc.exists()) {
      // Kullanıcı zaten takip ediyor, mükerrer artış yapma
      return;
    }

    const channelDoc = await transaction.get(channelRef);
    const currentCount = channelDoc.exists()
      ? Math.max(0, channelDoc.data()?.followerCount || 0)
      : 0;

    // 1. Kanal followers koleksiyonuna ekle
    transaction.set(followerRef, {
      uid: user.uid,
      displayName: user.displayName || user.username,
      username: user.username,
      photoURL: user.photoURL || null,
      followedAt: serverTimestamp(),
    });

    // 2. Kullanıcının takip ettikleri dizinine ekle
    transaction.set(followingRef, {
      channelId,
      followedAt: serverTimestamp(),
    });

    // 3. Takipçi sayısını artır
    if (channelDoc.exists()) {
      transaction.update(channelRef, {
        followerCount: currentCount + 1,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/**
 * ➖ Kanalı Takipten Çık (Spam ve Eksiye Düşme Korumalı)
 */
export async function unfollowChannel(channelId: string, userId: string): Promise<void> {
  if (!db || !channelId || !userId) throw new Error('Kullanıcı veya kanal bilgisi eksik.');

  const followerRef = doc(db, 'channels', channelId, 'followers', userId);
  const followingRef = doc(db, 'users', userId, 'followingChannels', channelId);
  const channelRef = doc(db, 'channels', channelId);

  await runTransaction(db, async (transaction) => {
    const followerDoc = await transaction.get(followerRef);
    if (!followerDoc.exists()) {
      // Kullanıcı zaten takip etmiyor, sahte veya mükerrer azaltma yapma!
      return;
    }

    const channelDoc = await transaction.get(channelRef);
    const currentCount = channelDoc.exists()
      ? Math.max(0, channelDoc.data()?.followerCount || 0)
      : 0;
    const newCount = Math.max(0, currentCount - 1);

    // 1. Takipçi dokümanını sil
    transaction.delete(followerRef);

    // 2. Kullanıcının takip ettiklerinden sil
    transaction.delete(followingRef);

    // 3. Takipçi sayısını güvenle güncelle (asla 0'ın altına düşmez)
    if (channelDoc.exists()) {
      transaction.update(channelRef, {
        followerCount: newCount,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/**
 * 📝 Kanal Gönderilerini Tek Seferlik Çek (Eski üstte, Yeni altta)
 */
export async function fetchChannelPosts(channelId: string): Promise<ChannelPost[]> {
  if (!db || !channelId) return [];
  try {
    const q = query(collection(db, 'channels', channelId, 'posts'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    const posts: ChannelPost[] = [];
    snap.forEach((docSnap) => {
      posts.push({
        ...(docSnap.data() as ChannelPost),
        id: docSnap.id,
        channelId,
      });
    });
    posts.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeA - timeB;
    });
    return posts;
  } catch (err) {
    console.warn('Gönderiler çekilirken hata:', err);
    return [];
  }
}

/**
 * 📝 Kanal Gönderilerini Gerçek Zamanlı Dinle (Eski üstte, Yeni altta - Mesajlaşma Sırası)
 */
export function subscribeToChannelPosts(
  channelId: string,
  callback: (posts: ChannelPost[]) => void
): Unsubscribe {
  if (!db || !channelId) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'channels', channelId, 'posts'), orderBy('createdAt', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const posts: ChannelPost[] = [];
      snapshot.forEach((docSnap) => {
        posts.push({
          ...(docSnap.data() as ChannelPost),
          id: docSnap.id,
          channelId,
        });
      });
      posts.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeA - timeB;
      });

      // Kanal ana dokümanındaki son gönderi önizlemesini (lastPostText) otomatik senkronize et
      if (channelId && db) {
        const channelRef = doc(db, 'channels', channelId);
        if (posts.length > 0) {
          const latestPost = posts[posts.length - 1];
          const latestText = latestPost.text || (latestPost.imageUrl ? 'Fotoğraf' : null);
          const latestTimestamp = latestPost.createdAt || null;
          updateDoc(channelRef, {
            postCount: posts.length,
            lastPostText: latestText,
            lastPostTimestamp: latestTimestamp,
          }).catch(() => {});
        } else {
          updateDoc(channelRef, {
            postCount: 0,
            lastPostText: null,
            lastPostTimestamp: null,
          }).catch(() => {});
        }
      }

      callback(posts);
    },
    (error) => {
      console.warn('Gönderiler dinlenirken hata:', error);
      callback([]);
    }
  );
}

/**
 * 📢 Yeni Kanal Gönderisi Paylaş (Kurucu veya Admin)
 * ⚠️ GİZLİLİK KURALI: Gönderide kurucunun adı, avatarı veya UID'si saklanmaz!
 * Gönderi tamamen kanalın kendisine aittir.
 *
 * 🔔 BİLDİRİM KURALI:
 * Kanalda gönderi paylaşıldığında kurucu/paylaşan HARİÇ tüm takipçilere uygulama içi
 * bildirim (users/{followerUid}/channelNotifications/{postId}) ve web push bildirimi iletilir.
 */
export async function createChannelPost(
  channelId: string,
  text: string,
  imageUrl?: string | null,
  channelName?: string,
  authorUid?: string
): Promise<string> {
  if (!db || !channelId) throw new Error('Kanal ID eksik.');
  const trimmedText = text.trim();
  if (!trimmedText && !imageUrl) {
    throw new Error('Gönderi için metin veya fotoğraf gereklidir.');
  }

  const postRef = doc(collection(db, 'channels', channelId, 'posts'));
  const postId = postRef.id;

  await setDoc(postRef, {
    id: postId,
    channelId,
    text: trimmedText,
    imageUrl: imageUrl || null,
    viewsCount: 0,
    createdAt: serverTimestamp(),
  });

  // Kanal ana dokümanını güncelle
  const channelRef = doc(db, 'channels', channelId);
  const channelSnap = await getDoc(channelRef);
  const channelData = channelSnap.exists() ? (channelSnap.data() as Channel) : null;
  const finalChannelName = channelName || channelData?.name || 'Kanal';
  const finalChannelPhoto = channelData?.photoURL || null;

  await updateDoc(channelRef, {
    postCount: increment(1),
    lastPostText: trimmedText || 'Fotoğraf',
    lastPostTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 🔔 Kurucu/Paylaşan HARİÇ takip edenlere Uygulama İçi Bildirim ve Push Bildirimi Gönder
  try {
    const followersSnap = await getDocs(collection(db, 'channels', channelId, 'followers'));
    
    // Kurucu ve ortak kurucu ID'lerini al
    let excludedUids = new Set<string>();
    if (authorUid) excludedUids.add(authorUid);

    try {
      const ownerSnap = await getDoc(doc(db, 'channels', channelId, 'private', 'owner'));
      if (ownerSnap.exists()) {
        const ownerData = ownerSnap.data();
        if (ownerData.ownerId) excludedUids.add(ownerData.ownerId);
        if (Array.isArray(ownerData.coOwnerIds)) {
          ownerData.coOwnerIds.forEach((id: string) => excludedUids.add(id));
        }
      }
    } catch {
      // ignore
    }

    const targetFollowerIds: string[] = [];
    followersSnap.forEach((d) => {
      const followerUid = d.id;
      if (!excludedUids.has(followerUid)) {
        targetFollowerIds.push(followerUid);
      }
    });

    if (targetFollowerIds.length > 0) {
      // 1. Firestore Uygulama İçi Bildirimleri Oluştur (Batch)
      // Firestore batch max 500 işlem destekler
      const batchChunks: string[][] = [];
      for (let i = 0; i < targetFollowerIds.length; i += 450) {
        batchChunks.push(targetFollowerIds.slice(i, i + 450));
      }

      for (const chunk of batchChunks) {
        const batch = writeBatch(db);
        for (const followerId of chunk) {
          const notifDocRef = doc(db, 'users', followerId, 'channelNotifications', postId);
          batch.set(notifDocRef, {
            id: postId,
            channelId,
            channelName: finalChannelName,
            channelPhotoURL: finalChannelPhoto,
            postId,
            text: trimmedText,
            imageUrl: imageUrl || null,
            createdAt: serverTimestamp(),
            read: false,
          });
        }
        await batch.commit().catch((e) => console.warn('Kanal bildirim batch hatası:', e));
      }

      // 2. Web Push Bildirimi Gönder
      const notifTitle = finalChannelName;
      const notifBody = trimmedText
        ? trimmedText.length > 100
          ? trimmedText.slice(0, 97) + '...'
          : trimmedText
        : 'Yeni bir görsel paylaştı.';

      sendPushNotification({
        receiverIds: targetFollowerIds,
        title: `📢 ${notifTitle}`,
        body: notifBody,
        data: {
          type: 'channel',
          channelId,
          postId,
        },
      }).catch((err) => console.warn('Kanal push bildirim hatası:', err));
    }
  } catch (err) {
    console.warn('Takipçi listesi alınırken bildirim uyarısı:', err);
  }

  return postId;
}

/**
 * 🗑️ Kanal Gönderisini Sil (Kurucu veya Admin)
 */
export async function deleteChannelPost(channelId: string, postId: string): Promise<void> {
  if (!db || !channelId || !postId) return;

  // 1. Gönderi dokümanını sil
  await deleteDoc(doc(db, 'channels', channelId, 'posts', postId));

  try {
    // 2. Kalan tüm gönderileri çekerek en güncelini bul ve kanal önizlemesini düzelt
    const postsQuery = query(
      collection(db, 'channels', channelId, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );
    const postsSnap = await getDocs(postsQuery);

    let lastPostText: string | null = null;
    let lastPostTimestamp: any = null;

    if (!postsSnap.empty) {
      const latestData = postsSnap.docs[0].data() as ChannelPost;
      lastPostText = latestData.text || (latestData.imageUrl ? 'Fotoğraf' : null);
      lastPostTimestamp = latestData.createdAt || null;
    }

    // Toplam kalan gönderi sayısını hesapla
    const allPostsSnap = await getDocs(collection(db, 'channels', channelId, 'posts'));
    const remainingCount = allPostsSnap.size;

    const channelRef = doc(db, 'channels', channelId);
    await updateDoc(channelRef, {
      postCount: remainingCount,
      lastPostText: lastPostText,
      lastPostTimestamp: lastPostTimestamp,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Gönderi silindikten sonra kanal son mesajı güncellenemedi:', err);
  }
}

/**
 * 👁️ Benzersiz Görüntülenme Kaydı (Kalıcı Firestore Verisi)
 * Aynı kullanıcı aynı gönderiye tekrar baktığında sayı artmaz.
 */
export async function recordPostView(
  channelId: string,
  postId: string,
  userId: string
): Promise<void> {
  if (!db || !channelId || !postId || !userId) return;

  try {
    const viewDocRef = doc(db, 'channels', channelId, 'posts', postId, 'views', userId);
    const viewSnap = await getDoc(viewDocRef);

    if (!viewSnap.exists()) {
      // 1. Kullanıcının görüntüleme kaydını oluştur
      await setDoc(viewDocRef, {
        uid: userId,
        viewedAt: serverTimestamp(),
      });

      // 2. Gönderinin görüntülenme sayısını atomik olarak 1 artır
      const postRef = doc(db, 'channels', channelId, 'posts', postId);
      await updateDoc(postRef, {
        viewsCount: increment(1),
      });
    }
  } catch (err) {
    // Kullanıcı zaten kaydetmişse veya kural kısıtlaması varsa sessizce geç
    console.debug('Görüntüleme kaydı uyarısı:', err);
  }
}

/**
 * ⚙️ Kanal Bilgilerini Güncelle (Kurucu veya Admin)
 */
export async function updateChannelInfo(
  channelId: string,
  data: {
    name?: string;
    description?: string;
    photoURL?: string | null;
    bannerUrl?: string | null;
  }
): Promise<void> {
  if (!db || !channelId) return;

  const updates: Record<string, any> = {
    updatedAt: serverTimestamp(),
  };

  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.description !== undefined) updates.description = data.description.trim();
  if (data.photoURL !== undefined) updates.photoURL = data.photoURL;
  if (data.bannerUrl !== undefined) updates.bannerUrl = data.bannerUrl;

  await updateDoc(doc(db, 'channels', channelId), updates);
}

/**
 * 🗑️ Kanalı Sil (Kurucu veya Admin)
 */
export async function deleteChannel(channelId: string, ownerUid?: string): Promise<void> {
  if (!db || !channelId) return;

  // 1. Ana kanal dokümanını sil
  await deleteDoc(doc(db, 'channels', channelId));

  // 2. Varsa gizli owner dokümanını sil
  try {
    await deleteDoc(doc(db, 'channels', channelId, 'private', 'owner'));
  } catch {}

  // 3. Kullanıcının myChannels ve followingChannels kayıtlarını sil
  if (ownerUid) {
    try {
      await deleteDoc(doc(db, 'users', ownerUid, 'myChannels', channelId));
    } catch {}
    try {
      await deleteDoc(doc(db, 'users', ownerUid, 'followingChannels', channelId));
    } catch {}
  }

  // 4. Varsa alt gönderileri temizle
  try {
    const postsSnap = await getDocs(collection(db, 'channels', channelId, 'posts'));
    postsSnap.forEach((d) => {
      deleteDoc(d.ref).catch(() => {});
    });
  } catch {}
}

// ==========================================
// 🛡️ ADMİN İŞLEMLERİ (ADMIN FUNCTIONS)
// ==========================================

/**
 * ☑️ Kanal Mavi Tik Doğrulama Durumunu Değiştir
 */
export async function setChannelVerification(
  channelId: string,
  isVerified: boolean
): Promise<void> {
  if (!db || !channelId) return;

  await updateDoc(doc(db, 'channels', channelId), {
    isVerified,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 🚫 Kanalı Devre Dışı Bırak / Aktifleştir (Moderasyon)
 */
export async function setChannelDisabled(
  channelId: string,
  disabled: boolean
): Promise<void> {
  if (!db || !channelId) return;

  await updateDoc(doc(db, 'channels', channelId), {
    disabled,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 🛡️ Admin Olarak Tüm Kanalları (Devre dışı olanlar dahil) Getir
 */
export async function fetchAllChannelsForAdmin(): Promise<Channel[]> {
  if (!db) return [];
  const q = query(collection(db, 'channels'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const list: Channel[] = [];
  snap.forEach((d) => {
    list.push({ ...(d.data() as Channel), id: d.id });
  });
  return list;
}

/**
 * 📢 Otomatik kanal tohumlama kaldırılmıştır (Kullanıcı talebi doğrultusunda)
 */
export async function ensureOfficialRedChatChannel(_creatorUid: string): Promise<void> {
  // Kullanıcı izni olmadan otomatik kanal oluşturulmaz
  return;
}

/**
 * ❤️ Kanal gönderisine emoji tepkisi ekle / kaldır (Toggle).
 * Hem kanal kurucuları hem de takipçi kullanıcılar tepki verebilir.
 */
export async function toggleChannelPostReaction(
  channelId: string,
  postId: string,
  userId: string,
  emoji: string
): Promise<void> {
  if (!db || !channelId || !postId || !userId || !emoji) return;

  const postDocRef = doc(db, 'channels', channelId, 'posts', postId);
  const postSnap = await getDoc(postDocRef);
  if (!postSnap.exists()) return;

  const data = postSnap.data();
  const currentReactions: { [key: string]: string[] } = { ...(data.reactions || {}) };

  const userList: string[] = Array.isArray(currentReactions[emoji])
    ? [...currentReactions[emoji]]
    : [];

  const userIndex = userList.indexOf(userId);

  if (userIndex > -1) {
    // Kullanıcı zaten bu tepkiyi vermiş -> Kaldır
    userList.splice(userIndex, 1);
    if (userList.length === 0) {
      delete currentReactions[emoji];
    } else {
      currentReactions[emoji] = userList;
    }
  } else {
    // Kullanıcı bu tepkiyi vermemiş -> Ekle
    userList.push(userId);
    currentReactions[emoji] = userList;
  }

  await updateDoc(postDocRef, {
    reactions: currentReactions,
  });
}

/**
 * 🧹 Belirli bir kanal gönderisinin tepkilerini sıfırla (Sadece bu gönderiyi temizler)
 */
export async function clearChannelPostReactions(
  channelId: string,
  postId: string
): Promise<void> {
  if (!db || !channelId || !postId) return;
  const postDocRef = doc(db, 'channels', channelId, 'posts', postId);
  await updateDoc(postDocRef, {
    reactions: {},
  });
}

/**
 * 🧹 YALNIZCA BU KANALDAKİ tüm gönderilerin tepkilerini sıfırla (Diğer kanallara veya sohbetlere asla dokunmaz)
 */
export async function clearAllChannelReactions(channelId: string): Promise<void> {
  if (!db || !channelId) return;
  const postsSnap = await getDocs(collection(db, 'channels', channelId, 'posts'));
  const promises = postsSnap.docs.map((docSnap) => {
    return updateDoc(doc(db, 'channels', channelId, 'posts', docSnap.id), {
      reactions: {},
    });
  });
  await Promise.all(promises);
}

/**
 * 🔔 Kullanıcının Takip Ettiği Kanallardan Gelen Bildirimleri Gerçek Zamanlı Dinle
 */
export function subscribeToUserChannelNotifications(
  userId: string,
  callback: (notifications: ChannelNotification[]) => void
): Unsubscribe {
  if (!db || !userId) {
    callback([]);
    return () => {};
  }

  const notifQuery = query(
    collection(db, 'users', userId, 'channelNotifications'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  return onSnapshot(
    notifQuery,
    (snapshot) => {
      const list: ChannelNotification[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as ChannelNotification;
        list.push({
          ...data,
          id: docSnap.id,
        });
      });
      callback(list);
    },
    (error) => {
      console.warn('Kanal bildirimleri dinlenirken hata:', error);
      callback([]);
    }
  );
}

/**
 * 🔔 Kanal Bildirimini Okundu Olarak İşaretle
 */
export async function markChannelNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  if (!db || !userId || !notificationId) return;
  const notifRef = doc(db, 'users', userId, 'channelNotifications', notificationId);
  await updateDoc(notifRef, {
    read: true,
  }).catch(() => {});
}

/**
 * 🔔 Tüm Kanal Bildirimlerini Okundu Olarak İşaretle
 */
export async function markAllChannelNotificationsAsRead(userId: string): Promise<void> {
  if (!db || !userId) return;
  const notifSnap = await getDocs(
    query(
      collection(db, 'users', userId, 'channelNotifications'),
      where('read', '==', false)
    )
  );

  if (notifSnap.empty) return;

  const batch = writeBatch(db);
  notifSnap.forEach((docSnap) => {
    batch.update(docSnap.ref, { read: true });
  });
  await batch.commit().catch(() => {});
}

/**
 * 🗑️ Tüm Kanal Bildirimlerini Temizle
 */
export async function clearAllChannelNotifications(userId: string): Promise<void> {
  if (!db || !userId) return;
  const notifSnap = await getDocs(
    collection(db, 'users', userId, 'channelNotifications')
  );

  if (notifSnap.empty) return;

  const batch = writeBatch(db);
  notifSnap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit().catch(() => {});
}


