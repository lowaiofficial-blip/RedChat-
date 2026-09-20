import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
  increment,
  limit,
  deleteField,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Conversation, ChatMessage, UserProfile, ChatReplyReference, GroupRole } from '../types';
import { sendPushNotification } from './messagingService';

/**
 * Kullanıcının grup içindeki güncel ve gerçek rolünü döner ('owner' | 'admin' | 'member').
 */
export function getUserRoleInGroup(conversation: Conversation, uid: string): GroupRole {
  if (!uid || !conversation) return 'member';
  if (conversation.groupOwnerId && conversation.groupOwnerId === uid) {
    return 'owner';
  }
  if (conversation.memberRoles?.[uid] === 'admin' || conversation.participants?.[uid]?.role === 'admin') {
    return 'admin';
  }
  return 'member';
}

/**
 * Kullanıcı adını güvenli ve fallback'li olarak alır. "undefined" göstermez.
 */
export function getSafeUserName(user?: { displayName?: string; username?: string } | null, fallback: string = 'Kullanıcı'): string {
  if (!user) return fallback;
  if (user.displayName && user.displayName.trim() && user.displayName !== 'undefined') {
    return user.displayName.trim();
  }
  if (user.username && user.username.trim() && user.username !== 'undefined') {
    return user.username.trim();
  }
  return fallback;
}

/**
 * İki kullanıcı arasında tek ve deterministik bir conversation ID üretir.
 * Böylece Test1 ve Test2 her iki tarafta da aynı conversation dokümanını kullanır.
 */
export function getDeterministicConversationId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('_');
}

/**
 * Yeni bir grup sohbeti oluşturur.
 * Grubu oluşturan kullanıcı otomatik olarak groupOwnerId ve 'owner' rolüyle eklenir.
 */
export async function createGroupConversation(
  currentUser: UserProfile,
  groupName: string,
  memberUsers: UserProfile[],
  photoURL?: string | null
): Promise<string> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');

  if (currentUser.isBanned) {
    throw new Error('Hesabınız askıya alınmıştır (Banlandınız). Grup oluşturamazsınız.');
  }

  const cleanGroupName = groupName.trim();
  if (!cleanGroupName) {
    throw new Error('Grup adı boş bırakılamaz');
  }

  // Grubu oluşturan kullanıcı + seçilen üyeler
  const allMembers = [currentUser, ...memberUsers.filter((u) => u.uid !== currentUser.uid)];
  const participantIds = allMembers.map((u) => u.uid);

  const participantsMap: { [uid: string]: any } = {};
  const memberRolesMap: { [uid: string]: GroupRole } = {};
  const unreadCountsMap: { [uid: string]: number } = {};

  allMembers.forEach((u) => {
    const isOwner = u.uid === currentUser.uid;
    const role: GroupRole = isOwner ? 'owner' : 'member';

    participantsMap[u.uid] = {
      displayName: getSafeUserName(u),
      username: u.username || 'kullanici',
      photoURL: u.photoURL || null,
      role,
    };
    memberRolesMap[u.uid] = role;
    unreadCountsMap[u.uid] = 0;
  });

  const convCol = collection(db, 'conversations');
  const groupDocRef = doc(convCol); // Yeni benzersiz ID üret

  const initialSystemText = `${getSafeUserName(currentUser)} grubu oluşturdu`;

  const groupData: any = {
    id: groupDocRef.id,
    isGroup: true,
    name: cleanGroupName,
    photoURL: photoURL || null,
    groupOwnerId: currentUser.uid,
    participantIds,
    participants: participantsMap,
    memberRoles: memberRolesMap,
    unreadCounts: unreadCountsMap,
    lastMessageText: initialSystemText,
    lastMessageHasImage: false,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(groupDocRef, groupData);

  // Firestore messages alt koleksiyonuna da gerçek sistem mesajı yaz
  const messagesCol = collection(db, 'conversations', groupDocRef.id, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: initialSystemText,
    isSystemMessage: true,
    systemType: 'create',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  return groupDocRef.id;
}

/**
 * Gruba yeni üye(ler) ekleme (Kurucu ve Yöneticiler yapabilir).
 * Sistem mesajı: "Test1, Test2'yi gruba ekledi"
 */
export async function addMembersToGroup(
  conversationId: string,
  currentUser: UserProfile,
  newMembers: UserProfile[]
): Promise<void> {
  if (!db || !conversationId || newMembers.length === 0) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  const currentRole = getUserRoleInGroup(convData, currentUser.uid);

  if (currentRole !== 'owner' && currentRole !== 'admin') {
    throw new Error('Gruba üye ekleme yetkiniz yok (Yalnızca Kurucu ve Yöneticiler ekleyebilir)');
  }

  // Halihazırda grupta olmayanları filtrele
  const currentParticipantIds = new Set(convData.participantIds || []);
  const validNewMembers = newMembers.filter((u) => !currentParticipantIds.has(u.uid));

  if (validNewMembers.length === 0) {
    throw new Error('Seçilen kullanıcılar zaten bu grupta');
  }

  const newParticipantIds = [...(convData.participantIds || [])];
  const updatePayload: any = {
    updatedAt: serverTimestamp(),
  };

  const addedNames: string[] = [];

  validNewMembers.forEach((u) => {
    newParticipantIds.push(u.uid);
    const uName = getSafeUserName(u);
    addedNames.push(uName);

    updatePayload[`participants.${u.uid}`] = {
      displayName: uName,
      username: u.username || 'kullanici',
      photoURL: u.photoURL || null,
      role: 'member' as GroupRole,
    };
    updatePayload[`memberRoles.${u.uid}`] = 'member' as GroupRole;
    updatePayload[`unreadCounts.${u.uid}`] = 0;
  });

  updatePayload.participantIds = newParticipantIds;

  const adderName = getSafeUserName(currentUser);
  const targetsFormatted = addedNames.join(', ');
  const systemText = `${adderName}, ${targetsFormatted}'yi gruba ekledi`;

  updatePayload.lastMessageText = systemText;
  updatePayload.lastMessageHasImage = false;
  updatePayload.lastMessageImageUrl = null;
  updatePayload.lastMessageSenderId = currentUser.uid;
  updatePayload.lastMessageTimestamp = serverTimestamp();

  // 1. Gerçek Firestore messages alt koleksiyonuna sistem mesajı ekle
  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'join',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  // 2. Conversation dokümanını güncelle
  await updateDoc(convDocRef, updatePayload);
}

/**
 * Gruptan üye çıkarma.
 * Kurucu: Normal üyeyi veya yöneticiyi çıkarabilir.
 * Yönetici: Sadece normal üyeyi çıkarabilir.
 * Hiç kimse: Kurucuyu çıkaramaz.
 * Sistem mesajı: "Test1, Test2'yi gruptan çıkardı"
 */
export async function removeMemberFromGroup(
  conversationId: string,
  currentUser: UserProfile,
  targetUserId: string,
  targetUserProfile?: { displayName?: string; username?: string; role?: GroupRole } | null
): Promise<void> {
  if (!db || !conversationId || !targetUserId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  const currentRole = getUserRoleInGroup(convData, currentUser.uid);
  const targetRole = getUserRoleInGroup(convData, targetUserId);

  if (targetUserId === convData.groupOwnerId) {
    throw new Error('Grup kurucusu gruptan çıkarılamaz');
  }

  if (currentRole === 'owner') {
    // Kurucu herkesi çıkarabilir
  } else if (currentRole === 'admin') {
    // Yönetici yalnızca normal üyeyi çıkarabilir
    if (targetRole === 'admin' || targetRole === 'owner') {
      throw new Error('Yöneticiler diğer yöneticileri veya kurucuyu çıkaramaz');
    }
  } else {
    throw new Error('Üye çıkarma yetkiniz yok');
  }

  const newParticipantIds = (convData.participantIds || []).filter((id) => id !== targetUserId);

  const removerName = getSafeUserName(currentUser);
  const targetInfo = targetUserProfile || convData.participants?.[targetUserId];
  const targetName = getSafeUserName(targetInfo);
  const systemText = `${removerName}, ${targetName}'yi gruptan çıkardı`;

  // 1. Gerçek Firestore messages alt koleksiyonuna sistem mesajı ekle
  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'leave',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  // 2. Conversation dokümanını güncelle
  await updateDoc(convDocRef, {
    participantIds: newParticipantIds,
    [`participants.${targetUserId}`]: deleteField(),
    [`memberRoles.${targetUserId}`]: deleteField(),
    [`unreadCounts.${targetUserId}`]: deleteField(),
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Üyeyi yönetici yapma (Sadece Kurucu yapabilir).
 * Sistem mesajı: "Test1, Test2'yi yönetici yaptı"
 */
export async function makeMemberAdmin(
  conversationId: string,
  currentUser: UserProfile,
  targetUserId: string,
  targetUserProfile?: { displayName?: string; username?: string } | null
): Promise<void> {
  if (!db || !conversationId || !targetUserId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  if (convData.groupOwnerId !== currentUser.uid) {
    throw new Error('Yalnızca grup kurucusu üyeleri yönetici yapabilir');
  }

  if (targetUserId === convData.groupOwnerId) {
    throw new Error('Kurucu zaten en yüksek yetkiye sahiptir');
  }

  const ownerName = getSafeUserName(currentUser);
  const targetInfo = targetUserProfile || convData.participants?.[targetUserId];
  const targetName = getSafeUserName(targetInfo);
  const systemText = `${ownerName}, ${targetName}'yi yönetici yaptı`;

  // 1. Sistem mesajı
  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'role_change',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  // 2. Doküman güncelle
  await updateDoc(convDocRef, {
    [`memberRoles.${targetUserId}`]: 'admin',
    [`participants.${targetUserId}.role`]: 'admin',
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Yöneticiliği kaldırma (Sadece Kurucu yapabilir).
 * Sistem mesajı: "Test1, Test2'nin yöneticiliğini kaldırdı"
 */
export async function removeMemberAdmin(
  conversationId: string,
  currentUser: UserProfile,
  targetUserId: string,
  targetUserProfile?: { displayName?: string; username?: string } | null
): Promise<void> {
  if (!db || !conversationId || !targetUserId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  if (convData.groupOwnerId !== currentUser.uid) {
    throw new Error('Yalnızca grup kurucusu yöneticiliği kaldırabilir');
  }

  const ownerName = getSafeUserName(currentUser);
  const targetInfo = targetUserProfile || convData.participants?.[targetUserId];
  const targetName = getSafeUserName(targetInfo);
  const systemText = `${ownerName}, ${targetName}'nin yöneticiliğini kaldırdı`;

  // 1. Sistem mesajı
  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'role_change',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  // 2. Doküman güncelle
  await updateDoc(convDocRef, {
    [`memberRoles.${targetUserId}`]: 'member',
    [`participants.${targetUserId}.role`]: 'member',
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Kuruculuğu devretme (Sadece mevcut Kurucu yapabilir).
 * Yeni kurucunun rolü "owner", eski kurucunun rolü "member" olur.
 * Sistem mesajı: "Test1 kuruculuğu Test2'ye devretti"
 */
export async function transferGroupOwnership(
  conversationId: string,
  currentUser: UserProfile,
  newOwnerId: string,
  newOwnerProfile?: { displayName?: string; username?: string } | null
): Promise<void> {
  if (!db || !conversationId || !newOwnerId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  if (convData.groupOwnerId !== currentUser.uid) {
    throw new Error('Yalnızca mevcut kurucu kuruculuğu devredebilir');
  }

  if (newOwnerId === currentUser.uid) {
    throw new Error('Zaten grup kurucususunuz');
  }

  if (!convData.participantIds.includes(newOwnerId)) {
    throw new Error('Kuruculuk yalnızca mevcut bir grup üyesine devredilebilir');
  }

  const oldOwnerName = getSafeUserName(currentUser);
  const targetInfo = newOwnerProfile || convData.participants?.[newOwnerId];
  const newOwnerName = getSafeUserName(targetInfo);
  const systemText = `${oldOwnerName} kuruculuğu ${newOwnerName}'ye devretti`;

  // 1. Sistem mesajı
  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'ownership_transfer',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  // 2. Doküman güncelle (Atomik olarak yeni owner ve eski owner rolleri atanır)
  await updateDoc(convDocRef, {
    groupOwnerId: newOwnerId,
    [`memberRoles.${newOwnerId}`]: 'owner',
    [`participants.${newOwnerId}.role`]: 'owner',
    [`memberRoles.${currentUser.uid}`]: 'member',
    [`participants.${currentUser.uid}.role`]: 'member',
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Grup adını değiştirme (Kurucu ve Yöneticiler yapabilir).
 */
export async function updateGroupName(
  conversationId: string,
  currentUser: UserProfile,
  newName: string
): Promise<void> {
  if (!db || !conversationId) return;
  const cleanName = newName.trim();
  if (!cleanName) throw new Error('Grup adı boş bırakılamaz');

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  const currentRole = getUserRoleInGroup(convData, currentUser.uid);

  if (currentRole !== 'owner' && currentRole !== 'admin') {
    throw new Error('Grup adını değiştirme yetkiniz yok');
  }

  const updaterName = getSafeUserName(currentUser);
  const systemText = `${updaterName} grup adını "${cleanName}" olarak değiştirdi`;

  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'name_change',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  await updateDoc(convDocRef, {
    name: cleanName,
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Grup fotoğrafını değiştirme / kaldırma (Kurucu ve Yöneticiler yapabilir).
 */
export async function updateGroupPhoto(
  conversationId: string,
  currentUser: UserProfile,
  newPhotoURL: string | null
): Promise<void> {
  if (!db || !conversationId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) throw new Error('Grup bulunamadı');

  const convData = snap.data() as Conversation;
  const currentRole = getUserRoleInGroup(convData, currentUser.uid);

  if (currentRole !== 'owner' && currentRole !== 'admin') {
    throw new Error('Grup fotoğrafını değiştirme yetkiniz yok');
  }

  const updaterName = getSafeUserName(currentUser);
  const systemText = newPhotoURL
    ? `${updaterName} grup fotoğrafını güncelledi`
    : `${updaterName} grup fotoğrafını kaldırdı`;

  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  await addDoc(messagesCol, {
    senderId: currentUser.uid,
    senderName: 'Sistem',
    senderUsername: 'system',
    text: systemText,
    isSystemMessage: true,
    systemType: 'photo_change',
    createdAt: serverTimestamp(),
    isRead: true,
    status: 'sent',
  });

  await updateDoc(convDocRef, {
    photoURL: newPhotoURL || null,
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUser.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Kullanıcının gruptan ayrılması.
 * Kurucu grupta başka üyeler varken doğrudan ayrılamaz (önce kuruculuğu devretmelidir).
 * Grupta tek kişi kaldıysa hata vermeden ayrılabilir.
 */
export async function leaveGroup(
  conversationId: string,
  currentUserId: string,
  userProfile?: UserProfile | null
): Promise<void> {
  if (!db || !conversationId || !currentUserId) return;

  const convDocRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convDocRef);
  if (!snap.exists()) return;

  const data = snap.data() as Conversation;
  const participantIds = data.participantIds || [];

  // Kurucu kontrolü: Grupta başka üye varken kurucu ayrılamaz
  if (data.groupOwnerId === currentUserId && participantIds.length > 1) {
    throw new Error('Gruptan ayrılmadan önce kuruculuğu başka bir üyeye devretmelisin.');
  }

  const newParticipantIds = participantIds.filter((id) => id !== currentUserId);

  // Ayrılan kullanıcının adını gerçek ve güvenli şekilde tespit et
  const leavingUserName = getSafeUserName(userProfile || data.participants?.[currentUserId], 'Bir üye');
  const systemText = `${leavingUserName} gruptan ayrıldı`;

  // Eğer başka üyeler varsa sistem mesajı yaz
  if (newParticipantIds.length > 0) {
    const messagesCol = collection(db, 'conversations', conversationId, 'messages');
    await addDoc(messagesCol, {
      senderId: currentUserId,
      senderName: 'Sistem',
      senderUsername: 'system',
      text: systemText,
      isSystemMessage: true,
      systemType: 'leave',
      createdAt: serverTimestamp(),
      isRead: true,
      status: 'sent',
    });
  }

  // Conversation dokümanını güncelle
  await updateDoc(convDocRef, {
    participantIds: newParticipantIds,
    [`participants.${currentUserId}`]: deleteField(),
    [`memberRoles.${currentUserId}`]: deleteField(),
    [`unreadCounts.${currentUserId}`]: deleteField(),
    lastMessageText: systemText,
    lastMessageHasImage: false,
    lastMessageImageUrl: null,
    lastMessageSenderId: currentUserId,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * İki kullanıcı arasında özel sohbet başlatır veya var olanı getirir.
 */
export async function getOrCreateDirectConversation(
  currentUser: UserProfile,
  targetUser: UserProfile
): Promise<string> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');

  const conversationId = getDeterministicConversationId(currentUser.uid, targetUser.uid);
  const conversationDocRef = doc(db, 'conversations', conversationId);

  try {
    const snap = await getDoc(conversationDocRef);
    if (!snap.exists()) {
      const newConversationData = {
        id: conversationId,
        participantIds: [currentUser.uid, targetUser.uid],
        participants: {
          [currentUser.uid]: {
            displayName: currentUser.displayName || currentUser.username,
            username: currentUser.username,
            photoURL: currentUser.photoURL || null,
          },
          [targetUser.uid]: {
            displayName: targetUser.displayName || targetUser.username,
            username: targetUser.username,
            photoURL: targetUser.photoURL || null,
          },
        },
        unreadCounts: {
          [currentUser.uid]: 0,
          [targetUser.uid]: 0,
        },
        lastMessageText: '',
        lastMessageTimestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(conversationDocRef, newConversationData, { merge: true });
    }
  } catch (err: any) {
    console.warn('getDoc check, fallback setDoc with merge:', err);
    const fallbackData = {
      id: conversationId,
      participantIds: [currentUser.uid, targetUser.uid],
      participants: {
        [currentUser.uid]: {
          displayName: currentUser.displayName || currentUser.username,
          username: currentUser.username,
          photoURL: currentUser.photoURL || null,
        },
        [targetUser.uid]: {
          displayName: targetUser.displayName || targetUser.username,
          username: targetUser.username,
          photoURL: targetUser.photoURL || null,
        },
      },
      unreadCounts: {
        [currentUser.uid]: 0,
        [targetUser.uid]: 0,
      },
      lastMessageText: '',
      lastMessageTimestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(conversationDocRef, fallbackData, { merge: true });
  }

  return conversationId;
}

/**
 * Kullanıcının dahil olduğu sohbetleri gerçek zamanlı olarak dinler.
 * En son mesaj gelen sohbet en üstte olacak şekilde sıralanır.
 */
export function subscribeToConversations(
  currentUserId: string,
  callback: (conversations: Conversation[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const convCol = collection(db, 'conversations');
  const q = query(convCol, where('participantIds', 'array-contains', currentUserId));

  return onSnapshot(
    q,
    async (snapshot) => {
      const convs: Conversation[] = [];
      const updatePromises: Promise<void>[] = [];

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Omit<Conversation, 'id'>;
        const convObj: Conversation = {
          id: docSnap.id,
          ...data,
        };

        // Eğer lastMessageHasImage alanı henüz kaydedilmemişse, messages koleksiyonundaki en son mesaja bakarak tespit et
        if (convObj.lastMessageHasImage === undefined && db) {
          const checkPromise = async () => {
            try {
              const msgsCol = collection(db, 'conversations', docSnap.id, 'messages');
              const lastMsgQuery = query(msgsCol, orderBy('createdAt', 'desc'), limit(1));
              const msgSnap = await getDocs(lastMsgQuery);
              if (!msgSnap.empty) {
                const lastMsgData = msgSnap.docs[0].data();
                if (lastMsgData.imageUrl) {
                  convObj.lastMessageHasImage = true;
                  convObj.lastMessageImageUrl = lastMsgData.imageUrl;
                  // Firestore conversation dokümanını onar
                  await updateDoc(doc(db, 'conversations', docSnap.id), {
                    lastMessageHasImage: true,
                    lastMessageImageUrl: lastMsgData.imageUrl,
                  });
                } else {
                  convObj.lastMessageHasImage = false;
                }
              }
            } catch (err) {
              console.warn('Son mesaj görsel kontrolü yapılamadı:', err);
            }
          };
          updatePromises.push(checkPromise());
        }

        convs.push(convObj);
      }

      // İstemci tarafında son güncellenme zamanına göre en yeniden en eskiye sırala
      convs.sort((a, b) => {
        const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.lastMessageTimestamp?.toMillis ? a.lastMessageTimestamp.toMillis() : 0);
        const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.lastMessageTimestamp?.toMillis ? b.lastMessageTimestamp.toMillis() : 0);
        return timeB - timeA;
      });

      // İlk sonucu anında ver
      callback([...convs]);

      // Eğer eski konuşmalarda eksik alan tespit edildiyse, arka planda kontrol bitince callback'i güncelle
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        callback([...convs]);
      }
    },
    (error) => {
      console.error('Conversations onSnapshot error:', error);
    }
  );
}

/**
 * Seçilen sohbetin mesajlarını gerçek zamanlı dinler.
 */
export function subscribeToMessages(
  conversationId: string,
  callback: (messages: ChatMessage[]) => void
): () => void {
  if (!db || !conversationId) {
    callback([]);
    return () => {};
  }

  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  const q = query(messagesCol, orderBy('createdAt', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const messages: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        messages.push({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ChatMessage, 'id'>),
        });
      });
      callback(messages);
    },
    (error) => {
      console.error('Messages onSnapshot error:', error);
    }
  );
}

/**
 * Sohbete yeni mesaj gönderir ve alıcının okunmamış mesaj sayısını (unread count) artırır.
 * Hem sadece metin, hem sadece fotoğraf, hem de fotoğraf + metin gönderebilir.
 */
/**
 * WhatsApp benzeri gruplanmış bildirim için son okunmamış mesajları kronolojik sırayla ve saatleriyle çeker.
 * Mesaj gerçekten okunmamışsa listeye eklenir; okunmuşsa (readBy[userId] === true) listeye eklenmez.
 * Eğer okunmamış mesaj yoksa boş dizi [] döner (asla sahte unread uydurmaz).
 */
export async function getGroupedUnreadMessages(
  conversationId: string,
  currentUserId?: string,
  senderUid?: string,
  fallbackText: string = 'Yeni mesaj'
): Promise<Array<{ id: string; text: string; time: string }>> {
  const now = new Date();
  const defaultTime = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  if (!db || !conversationId) return [];

  try {
    const msgsCol = collection(db, 'conversations', conversationId, 'messages');
    // En son 20 mesajı çekip hafızada filtreliyoruz
    const q = query(msgsCol, orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);

    const unread: Array<{ id: string; text: string; time: string }> = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      // Kendi gönderdiğimiz mesajlar bizim için okunmamış sayılamaz
      if (currentUserId && data.senderId === currentUserId) return;
      // Belirli bir gönderici hedeflenmişse ve eşleşmiyorsa atla
      if (senderUid && data.senderId !== senderUid) return;

      // Okunma kontrolü:
      // Eğer alıcı (currentUserId) mesajı okumuşsa:
      if (currentUserId && data.readBy && data.readBy[currentUserId] === true) {
        return; // Zaten okundu!
      }
      // Genel okunma kontrolü (birebir sohbetler veya eski veriler için)
      if (data.isRead === true || data.status === 'read') {
        if (!currentUserId || !data.readBy || data.readBy[currentUserId] === true) {
          return;
        }
      }

      let msgText = data.text?.trim() || '';
      if (data.imageUrl && !msgText) {
        msgText = '📷 Fotoğraf';
      } else if (data.imageUrl && msgText) {
        msgText = `📷 ${msgText}`;
      }
      if (!msgText && data.isThinking) {
        msgText = 'Düşünüyor...';
      }

      let timeStr = defaultTime;
      if (data.createdAt?.toDate) {
        timeStr = data.createdAt.toDate().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      }

      if (msgText) {
        unread.push({ id: docSnap.id, text: msgText, time: timeStr });
      }
    });

    if (unread.length > 0) {
      // Kronolojik sıra (en eski okunmamıştan en yeniye)
      unread.reverse();
      return unread;
    }
  } catch (err) {
    console.warn('getGroupedUnreadMessages hatası:', err);
  }

  return [];
}

export async function sendMessage(
  conversationId: string,
  sender: UserProfile,
  text: string = '',
  imageUrl?: string | null,
  replyTo?: ChatReplyReference | null,
  options?: {
    isThinking?: boolean;
    isStreaming?: boolean;
    isSecurityWarning?: boolean;
    securityType?: 'terminated' | 'warning';
  }
): Promise<string> {
  if (!db) throw new Error('Firestore hazır değil');
  
  if (sender.isBanned) {
    throw new Error('Hesabınız askıya alınmıştır (Banlandınız). Mesaj gönderemezsiniz.');
  }

  if (sender.isMuted) {
    throw new Error('Hesabınız susturulmuştur. Mesaj gönderemezsiniz.');
  }

  const cleanText = text.trim();
  const cleanImageUrl = imageUrl?.trim() || null;

  if (!cleanText && !cleanImageUrl && !options?.isThinking && !options?.isSecurityWarning) return '';

  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  const convDocRef = doc(db, 'conversations', conversationId);

  // 1. Mesaj alt koleksiyonuna ekle
  const messageData: any = {
    senderId: sender.uid,
    senderName: sender.displayName || sender.username,
    senderUsername: sender.username,
    text: cleanText,
    createdAt: serverTimestamp(),
    status: 'sent',
    isRead: false,
    readBy: {
      [sender.uid]: true, // Gönderen kendi mesajını doğal olarak okumuştur
    },
    isEdited: false,
    ...(options?.isThinking && { isThinking: true }),
    ...(options?.isStreaming && { isStreaming: true }),
    ...(options?.isSecurityWarning && {
      isSecurityWarning: true,
      securityType: options.securityType || 'terminated',
    }),
  };

  if (cleanImageUrl) {
    messageData.imageUrl = cleanImageUrl;
  }

  if (replyTo) {
    messageData.replyTo = {
      messageId: replyTo.messageId,
      senderId: replyTo.senderId,
      senderName: replyTo.senderName,
      text: replyTo.text || '',
      imageUrl: replyTo.imageUrl || null,
    };
  }

  const newDocRef = await addDoc(messagesCol, messageData);

  // 2. Alıcıların UID'lerini bul ve unreadCount'larını artır
  const hasImage = Boolean(cleanImageUrl);
  let lastMessageSummary = cleanText;
  if (hasImage) {
    lastMessageSummary = cleanText ? cleanText : 'Fotoğraf';
  } else if (options?.isThinking && !cleanText) {
    lastMessageSummary = 'Düşünüyor...';
  }

  const updateData: any = {
    lastMessageText: lastMessageSummary,
    lastMessageHasImage: hasImage,
    lastMessageImageUrl: cleanImageUrl || null,
    lastMessageSenderId: sender.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  let conversationData: Conversation | null = null;
  try {
    const convSnap = await getDoc(convDocRef);
    if (convSnap.exists()) {
      conversationData = convSnap.data() as Conversation;
      const otherParticipantIds = (conversationData.participantIds || []).filter((uid) => uid !== sender.uid);
      otherParticipantIds.forEach((uid) => {
        updateData[`unreadCounts.${uid}`] = increment(1);
      });
    } else {
      const [uid1, uid2] = conversationId.split('_');
      const recipientUid = uid1 === sender.uid ? uid2 : uid1;
      if (recipientUid) {
        updateData[`unreadCounts.${recipientUid}`] = increment(1);
      }
    }
  } catch (err) {
    const [uid1, uid2] = conversationId.split('_');
    const recipientUid = uid1 === sender.uid ? uid2 : uid1;
    if (recipientUid) {
      updateData[`unreadCounts.${recipientUid}`] = increment(1);
    }
  }

  // 3. Ana konuşma dokümanındaki son mesajı, unread count'u ve güncelleme zamanını güncelle
  await updateDoc(convDocRef, updateData);

  // 4. WhatsApp tarzı Gruplanmış Push Notification gönder
  // Alıcının sohbette olup mesajı anında okumuş olma ihtimaline karşı 500ms sonra kontrol edilir.
  // Eğer alıcı mesajı zaten okumuşsa (readBy[userId] === true) push notification GÖNDERİLMEZ.
  setTimeout(async () => {
    try {
      if (!db) return;

      // Mesajın Firestore'daki güncel durumunu kontrol et
      const msgCheckSnap = await getDoc(newDocRef);
      if (!msgCheckSnap.exists()) return;
      const msgCheckData = msgCheckSnap.data();

      let targetRecipients: string[] = [];
      if (conversationData) {
        targetRecipients = (conversationData.participantIds || []).filter((uid) => uid !== sender.uid);
      } else {
        const [uid1, uid2] = conversationId.split('_');
        const recipientUid = uid1 === sender.uid ? uid2 : uid1;
        if (recipientUid) targetRecipients = [recipientUid];
      }

      // SADECE VE SADECE henüz okumamış olan alıcıları filtrele
      const unreadRecipients = targetRecipients.filter((uid) => {
        // Alıcı mesajı zaten okuduysa (readBy[uid] === true) bildirim gönderme!
        if (msgCheckData.readBy && msgCheckData.readBy[uid] === true) return false;
        // Birebir sohbette genel isRead true ise gönderme
        if (!conversationData?.isGroup && (msgCheckData.isRead === true || msgCheckData.status === 'read')) return false;
        return true;
      });

      if (unreadRecipients.length === 0) {
        return;
      }

      const currentMsgText = hasImage && cleanText 
        ? `📷 Fotoğraf: ${cleanText.substring(0, 40)}` 
        : hasImage 
        ? '📷 Fotoğraf' 
        : cleanText || 'Yeni mesaj';

      const unreadMessages = await getGroupedUnreadMessages(
        conversationId,
        unreadRecipients[0],
        sender.uid,
        currentMsgText
      );

      const unreadCount = unreadMessages.length || 1;
      const senderName = sender.displayName || sender.username || "Bir kullanıcı";

      let notifTitle = senderName;
      let notifBody = "";

      if (conversationData?.isGroup) {
        const groupName = conversationData.name || "Grup";
        notifTitle = unreadCount > 1 ? `${groupName} (${unreadCount} yeni mesaj)` : groupName;
        if (unreadCount > 1) {
          notifBody = unreadMessages.map((m) => `${senderName}: ${m.text} (${m.time})`).join('\n');
        } else {
          notifBody = `${senderName}: ${unreadMessages[0]?.text || currentMsgText}`;
        }
      } else {
        notifTitle = unreadCount > 1 ? `${senderName} (${unreadCount} yeni mesaj)` : senderName;
        if (unreadCount > 1) {
          notifBody = unreadMessages.map((m) => `${m.text}  ${m.time}`).join('\n');
        } else {
          notifBody = unreadMessages[0]?.text || currentMsgText;
        }
      }

      sendPushNotification({
        receiverIds: unreadRecipients,
        title: notifTitle,
        body: notifBody,
        data: {
          conversationId,
          messageId: newDocRef.id,
          senderId: sender.uid,
          senderName,
          senderPhoto: sender.photoURL || '',
          unreadCount: String(unreadCount),
          messagesJson: JSON.stringify(unreadMessages.length > 0 ? unreadMessages : [{ text: currentMsgText, time: '' }]),
          type: "chat_message"
        }
      }).catch((err) => console.error("Push notification gönderme hatası:", err));
    } catch (err) {
      console.error("Push hazırlık aşamasında hata:", err);
    }
  }, 500);

  return newDocRef.id;
}

/**
 * Karşı tarafın gönderdiği okunmamış mesajları 'okundu' olarak işaretler ve kullanıcının unread count'unu sıfırlar.
 * Hem Firestore conversation dokümanındaki unreadCounts[uid]'yi 0 yapar hem de mesajların readBy[uid] = true kaydını tutar.
 */
export async function markMessagesAsRead(
  conversationId: string,
  currentUserId: string,
  knownUnreadMessageIds?: string[]
): Promise<void> {
  if (!db || !conversationId || !currentUserId) return;

  try {
    // 1. ÖNCELİKLE: Conversation dokümanındaki bu kullanıcıya ait unreadCount'u sıfırla.
    // Realtime snapshot sayesinde tüm bağlı cihazlar (telefon, tablet, PC) hemen anında 0 görür!
    const convDocRef = doc(db, 'conversations', conversationId);
    await updateDoc(convDocRef, {
      [`unreadCounts.${currentUserId}`]: 0,
    });

    // 2. Mesajları okundu olarak güncelle (readBy[currentUserId] = true, isRead = true, status = 'read')
    const messagesCol = collection(db, 'conversations', conversationId, 'messages');

    if (knownUnreadMessageIds && knownUnreadMessageIds.length > 0) {
      const batch = writeBatch(db);
      const targetIds = knownUnreadMessageIds.slice(0, 450);
      targetIds.forEach((msgId) => {
        const msgRef = doc(messagesCol, msgId);
        batch.update(msgRef, {
          [`readBy.${currentUserId}`]: true,
          isRead: true,
          status: 'read',
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } else {
      // Bilinen ID yoksa, son 50 mesajı çek ve bu kullanıcının okumadıklarını güncelle
      const q = query(messagesCol, orderBy('createdAt', 'desc'), limit(50));
      const snapshot = await getDocs(q);
      const unreadDocs = snapshot.docs.filter((d) => {
        const data = d.data();
        if (data.senderId === currentUserId) return false;
        if (data.readBy && data.readBy[currentUserId] === true) return false;
        return !data.isRead || data.status !== 'read';
      });

      if (unreadDocs.length > 0) {
        const batch = writeBatch(db);
        unreadDocs.forEach((d) => {
          batch.update(d.ref, {
            [`readBy.${currentUserId}`]: true,
            isRead: true,
            status: 'read',
            readAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.error('Mesajlar okundu olarak işaretlenemedi:', err);
  }
}

/**
 * Kullanıcının kendi gönderdiği mesajı düzenlemesi.
 * Fotoğraflı mesajlarda fotoğraf URL'si korunur, yalnızca metin güncellenir.
 */
export async function editMessage(
  conversationId: string,
  messageId: string,
  newText: string,
  isLastMessage: boolean = false,
  hasImage: boolean = false,
  options?: { isThinking?: boolean, isStreaming?: boolean, isAiUpdate?: boolean }
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  const cleanText = newText;
  if (!cleanText && !hasImage && !options?.isThinking) return;

  const messageDocRef = doc(db, 'conversations', conversationId, 'messages', messageId);

  const updates: any = {
    text: cleanText,
  };
  
  if (!options?.isAiUpdate) {
    updates.isEdited = true;
    updates.editedAt = serverTimestamp();
  } else {
    if (options.isThinking !== undefined) updates.isThinking = options.isThinking;
    if (options.isStreaming !== undefined) updates.isStreaming = options.isStreaming;
  }

  await updateDoc(messageDocRef, updates);

  if (isLastMessage) {
    let summaryText = cleanText;
    if (hasImage) {
      summaryText = cleanText ? cleanText : 'Fotoğraf';
    }

    const convDocRef = doc(db, 'conversations', conversationId);
    await updateDoc(convDocRef, {
      lastMessageText: summaryText,
      lastMessageHasImage: hasImage,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Yapay zeka yanıt üretirken (streaming) Firestore'daki mesajı gerçek zamanlı günceller.
 * Böylece gruptaki veya sohbetteki diğer kullanıcılar "Düşünüyorum..." durumunda takılı kalmaz,
 * akışı anlık ve canlı olarak izleyebilir.
 */
export async function updateAIMessageStream(
  conversationId: string,
  messageId: string,
  text: string,
  options?: { isThinking?: boolean; isStreaming?: boolean }
): Promise<void> {
  if (!db || !conversationId || !messageId) return;
  try {
    const messageDocRef = doc(db, 'conversations', conversationId, 'messages', messageId);
    const updates: Record<string, any> = {
      text: text,
    };
    if (options?.isThinking !== undefined) updates.isThinking = options.isThinking;
    if (options?.isStreaming !== undefined) updates.isStreaming = options.isStreaming;
    await updateDoc(messageDocRef, updates);
  } catch (err) {
    console.warn('updateAIMessageStream hatası:', err);
  }
}

/**
 * Kullanıcının kendi gönderdiği mesajı silmesi.
 */
export async function deleteMessage(
  conversationId: string,
  messageId: string,
  isLastMessage: boolean = false,
  previousMessageText?: string,
  previousHasImage: boolean = false,
  previousImageUrl?: string | null
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');

  const messageDocRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  await deleteDoc(messageDocRef);

  if (isLastMessage) {
    const convDocRef = doc(db, 'conversations', conversationId);
    await updateDoc(convDocRef, {
      lastMessageText: previousMessageText || '',
      lastMessageHasImage: previousHasImage,
      lastMessageImageUrl: previousImageUrl || null,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Kullanıcının son görülme durumunu Türkçe olarak formatlar.
 * Örn: "Çevrimiçi", "Son görülme bugün 19:42", "Son görülme dün 15:30", "Son görülme 28.08 14:10"
 */
export function formatLastSeen(isOnline?: boolean, lastSeen?: any): string {
  if (isOnline) return 'Çevrimiçi';
  if (!lastSeen) return 'Çevrimdışı';

  const date = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
  if (isNaN(date.getTime())) return 'Çevrimdışı';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Son görülme bugün ${timeStr}`;
  }
  if (isYesterday) {
    return `Son görülme dün ${timeStr}`;
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `Son görülme ${day}.${month} ${timeStr}`;
}

/**
 * Mesaja emoji tepkisi ekleme veya kaldırma (Toggle).
 * reactions: { [emoji: string]: string[] } (UID dizisi)
 */
export async function toggleMessageReaction(
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<void> {
  if (!db || !conversationId || !messageId || !userId || !emoji) return;

  const msgDocRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  const msgSnap = await getDoc(msgDocRef);
  if (!msgSnap.exists()) return;

  const data = msgSnap.data();
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

  await updateDoc(msgDocRef, {
    reactions: currentReactions,
  });
}

/**
 * Kullanıcının belirli bir sohbette yazma (typing) durumunu Firestore'da günceller.
 */
export async function setUserTypingStatus(
  conversationId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  if (!db || !conversationId || !userId) return;
  try {
    const convRef = doc(db, 'conversations', conversationId);
    if (isTyping) {
      await updateDoc(convRef, {
        [`typingUsers.${userId}`]: Date.now(),
      });
    } else {
      await updateDoc(convRef, {
        [`typingUsers.${userId}`]: deleteField(),
      });
    }
  } catch (err) {
    // Yazma durumu kritik bir hata fırlatmamalıdır
    console.debug('Failed to update typing status', err);
  }
}

/**
 * RedChat AI sohbet oturumunun hakaret/küfür ihlali sayacını günceller.
 */
export async function updateAbusiveCount(
  conversationId: string,
  count: number
): Promise<void> {
  if (!db || !conversationId) return;
  const convRef = doc(db, 'conversations', conversationId);
  await updateDoc(convRef, {
    abusiveCount: count,
    updatedAt: serverTimestamp(),
  });
}

/**
 * RedChat AI sohbet oturumunu hakaret/küfür ihlali nedeniyle kalıcı olarak sonlandırır.
 * Firestore Conversation dokümanını 'terminated' olarak işaretler ve kırmızı güvenlik uyarısı mesajını kaydeder.
 */
export async function terminateAIConversation(
  conversationId: string,
  aiProfile: UserProfile,
  warningText: string
): Promise<string> {
  if (!db || !conversationId) return '';

  const convRef = doc(db, 'conversations', conversationId);

  // 1. Konuşma dokümanını kalıcı olarak sonlandır
  await updateDoc(convRef, {
    securityStatus: 'terminated',
    terminatedAt: serverTimestamp(),
    terminatedReason: 'abusive_language',
    abusiveCount: 3,
    lastMessageText: 'Sohbet güvenliği uyarısı: Oturum sonlandırıldı.',
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2. Kırmızı güvenlik uyarısı mesajını kalıcı olarak mesajlar koleksiyonuna ekle
  const msgId = await sendMessage(
    conversationId,
    aiProfile,
    warningText,
    null,
    null,
    {
      isSecurityWarning: true,
      securityType: 'terminated',
    }
  );

  return msgId;
}

