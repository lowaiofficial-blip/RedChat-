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
export async function sendMessage(
  conversationId: string,
  sender: UserProfile,
  text: string = '',
  imageUrl?: string | null,
  replyTo?: ChatReplyReference | null
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  
  if (sender.isBanned) {
    throw new Error('Hesabınız askıya alınmıştır (Banlandınız). Mesaj gönderemezsiniz.');
  }

  if (sender.isMuted) {
    throw new Error('Hesabınız susturulmuştur. Mesaj gönderemezsiniz.');
  }

  const cleanText = text.trim();
  const cleanImageUrl = imageUrl?.trim() || null;

  if (!cleanText && !cleanImageUrl) return;

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
    isEdited: false,
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

  await addDoc(messagesCol, messageData);

  // 2. Alıcıların UID'lerini bul ve unreadCount'larını artır
  const hasImage = Boolean(cleanImageUrl);
  let lastMessageSummary = cleanText;
  if (hasImage) {
    lastMessageSummary = cleanText ? cleanText : 'Fotoğraf';
  }

  const updateData: any = {
    lastMessageText: lastMessageSummary,
    lastMessageHasImage: hasImage,
    lastMessageImageUrl: cleanImageUrl || null,
    lastMessageSenderId: sender.uid,
    lastMessageTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const convSnap = await getDoc(convDocRef);
    if (convSnap.exists()) {
      const convData = convSnap.data() as Conversation;
      const otherParticipantIds = (convData.participantIds || []).filter((uid) => uid !== sender.uid);
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
}

/**
 * Karşı tarafın gönderdiği okunmamış mesajları 'okundu' olarak işaretler ve kullanıcının unread count'unu sıfırlar.
 */
export async function markMessagesAsRead(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  if (!db || !conversationId || !currentUserId) return;

  try {
    const messagesCol = collection(db, 'conversations', conversationId, 'messages');
    const q = query(
      messagesCol,
      where('senderId', '!=', currentUserId)
    );

    const snapshot = await getDocs(q);
    const unreadDocs = snapshot.docs.filter((d) => {
      const data = d.data();
      return !data.isRead || data.status !== 'read';
    });

    // 1. Mesajları okundu olarak güncelle
    if (unreadDocs.length > 0) {
      const batch = writeBatch(db);
      unreadDocs.forEach((d) => {
        batch.update(d.ref, {
          isRead: true,
          status: 'read',
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    // 2. Conversation dokümanındaki bu kullanıcıya ait unreadCount'u sıfırla
    const convDocRef = doc(db, 'conversations', conversationId);
    await updateDoc(convDocRef, {
      [`unreadCounts.${currentUserId}`]: 0,
    });
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
  hasImage: boolean = false
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  const cleanText = newText.trim();
  if (!cleanText && !hasImage) return;

  const messageDocRef = doc(db, 'conversations', conversationId, 'messages', messageId);

  await updateDoc(messageDocRef, {
    text: cleanText,
    isEdited: true,
    editedAt: serverTimestamp(),
  });

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
