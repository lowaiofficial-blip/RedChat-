import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
  getCountFromServer,
  collectionGroup,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { AppSettings, UserProfile, Conversation, ChatMessage } from '../types';

export const ADMIN_EMAILS = [
  'robloxenes930@gmail.com',
  'gg00cat73@gmail.com',
];

/**
 * Kullanıcının yetkili bir admin olup olmadığını doğrular.
 * Kontrol email listesi (robloxenes930@gmail.com, gg00cat73@gmail.com),
 * Firebase Auth oturum e-postası veya Firestore role ('admin') üzerinden yapılır.
 */
export function isUserAdmin(
  user?: UserProfile | { email?: string | null; role?: string | null } | null
): boolean {
  const adminEmailList = ADMIN_EMAILS.map((e) => e.toLowerCase());

  // 1. Profil nesnesindeki e-postayı kontrol et
  const userEmail = user?.email?.trim().toLowerCase();
  if (userEmail && adminEmailList.includes(userEmail)) {
    return true;
  }

  // 2. Profildeki 'admin' rolünü kontrol et
  if (user?.role === 'admin') {
    return true;
  }

  // 3. Aktif Firebase Auth kullanıcısının e-postasını kontrol et (Profilde email henüz yoksa bile)
  const authEmail = auth?.currentUser?.email?.trim().toLowerCase();
  if (authEmail && adminEmailList.includes(authEmail)) {
    return true;
  }

  return false;
}

/**
 * Uygulama genel ayarlarını (örneğin Mavi Tik PNG URL'si) gerçek zamanlı dinler.
 */
export function subscribeToAppSettings(
  callback: (settings: AppSettings | null) => void
): () => void {
  if (!db) {
    callback(null);
    return () => {};
  }

  const settingsDocRef = doc(db, 'settings', 'app');
  return onSnapshot(
    settingsDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as AppSettings);
      } else {
        callback({ verifiedBadgeUrl: null });
      }
    },
    (error) => {
      console.error('AppSettings onSnapshot error:', error);
      callback({ verifiedBadgeUrl: null });
    }
  );
}

/**
 * Mavi Tik PNG URL'sini Firestore'a kalıcı olarak kaydeder veya kaldırır.
 */
export async function updateVerifiedBadgeUrl(
  adminUser: UserProfile,
  badgeUrl: string | null
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const settingsDocRef = doc(db, 'settings', 'app');
  await setDoc(
    settingsDocRef,
    {
      verifiedBadgeUrl: badgeUrl ? badgeUrl.trim() : null,
      updatedAt: serverTimestamp(),
      updatedBy: adminUser.email || adminUser.uid,
    },
    { merge: true }
  );
}

/**
 * RedChat AI profil fotoğrafını Firestore'a kalıcı olarak kaydeder ve 'system_redchat_ai' kullanıcısını günceller.
 */
export async function updateAIProfilePhotoUrl(
  adminUser: UserProfile,
  photoUrl: string | null
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const cleanUrl = photoUrl ? photoUrl.trim() : null;

  // 1. Settings dokümanına kaydet
  const settingsDocRef = doc(db, 'settings', 'app');
  await setDoc(
    settingsDocRef,
    {
      aiProfilePhotoUrl: cleanUrl,
      updatedAt: serverTimestamp(),
      updatedBy: adminUser.email || adminUser.uid,
    },
    { merge: true }
  );

  // 2. users/system_redchat_ai dokümanını da güncelle
  const aiUserDocRef = doc(db, 'users', 'system_redchat_ai');
  await setDoc(
    aiUserDocRef,
    {
      uid: 'system_redchat_ai',
      username: 'redchat_ai',
      usernameLower: 'redchat_ai',
      displayName: 'RedChat AI',
      email: 'ai@redchat.internal',
      photoURL: cleanUrl,
      bio: 'RedChat Resmi Yapay Zeka Asistanı',
      isSystemAI: true,
      isOnline: true,
      isVerified: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Bir kullanıcıya Mavi Tik verir (isVerified: true) veya kaldırır (isVerified: false).
 */
export async function setUserVerificationStatus(
  adminUser: UserProfile,
  targetUid: string,
  isVerified: boolean
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await updateDoc(userDocRef, {
    isVerified,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Kullanıcıyı kalıcı olarak banlar (isBanned: true).
 */
export async function banUser(
  adminUser: UserProfile,
  targetUid: string,
  reason: string = 'Topluluk kurallarına aykırı davranış'
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (adminUser?.uid && targetUid === adminUser.uid) {
    throw new Error('Kendi hesabınızı banlayamazsınız');
  }
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await setDoc(
    userDocRef,
    {
      isBanned: true,
      banReason: reason.trim(),
      bannedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Kullanıcının banını kaldırır (isBanned: false).
 */
export async function unbanUser(
  adminUser: UserProfile,
  targetUid: string
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await setDoc(
    userDocRef,
    {
      isBanned: false,
      banReason: null,
      bannedAt: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Kullanıcıyı susturur (isMuted: true).
 */
export async function muteUser(
  adminUser: UserProfile,
  targetUid: string,
  reason: string = 'Uygunsuz mesaj gönderimi'
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await updateDoc(userDocRef, {
    isMuted: true,
    muteReason: reason.trim(),
    mutedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Kullanıcının susturmasını kaldırır (isMuted: false).
 */
export async function unmuteUser(
  adminUser: UserProfile,
  targetUid: string
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await updateDoc(userDocRef, {
    isMuted: false,
    muteReason: null,
    mutedAt: null,
    updatedAt: serverTimestamp(),
  });
}

export interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  totalMessages: number;
  totalConversations: number;
}

/**
 * Gerçek Firestore verilerinden anlık istatistikleri çeker.
 * Mock veya sahte veri içermez.
 */
export async function fetchRealAdminStats(): Promise<AdminStats> {
  if (!db) {
    return { totalUsers: 0, onlineUsers: 0, totalMessages: 0, totalConversations: 0 };
  }

  let totalUsers = 0;
  let onlineUsers = 0;
  let totalMessages = 0;
  let totalConversations = 0;

  // 1. Toplam Kullanıcı Sayısı
  try {
    const usersCol = collection(db, 'users');
    try {
      const userCountSnap = await getCountFromServer(usersCol);
      totalUsers = userCountSnap.data().count;
    } catch {
      const usersSnap = await getDocs(usersCol);
      totalUsers = usersSnap.size;
    }
  } catch (e) {
    console.warn('Users count fetch warning:', e);
  }

  // 2. Çevrimiçi Kullanıcı Sayısı
  try {
    const usersCol = collection(db, 'users');
    const onlineQuery = query(usersCol, where('isOnline', '==', true));
    try {
      const onlineCountSnap = await getCountFromServer(onlineQuery);
      onlineUsers = onlineCountSnap.data().count;
    } catch {
      const onlineSnap = await getDocs(onlineQuery);
      onlineUsers = onlineSnap.size;
    }
  } catch (e) {
    console.warn('Online users count fetch warning:', e);
  }

  // 3. Konuşmalar Sayısı
  try {
    const convCol = collection(db, 'conversations');
    const convSnap = await getDocs(convCol);
    totalConversations = convSnap.size;
  } catch (e) {
    console.warn('Conversations count fetch warning:', e);
  }

  // 4. Mesajlar Sayısı
  try {
    const msgGroup = collectionGroup(db, 'messages');
    const msgCountSnap = await getCountFromServer(msgGroup);
    totalMessages = msgCountSnap.data().count;
  } catch {
    try {
      const convCol = collection(db, 'conversations');
      const convSnap = await getDocs(convCol);
      let msgSum = 0;
      for (const convDoc of convSnap.docs) {
        const msgsCol = collection(db, 'conversations', convDoc.id, 'messages');
        const msgsSnap = await getDocs(msgsCol);
        msgSum += msgsSnap.size;
      }
      totalMessages = msgSum;
    } catch (e) {
      console.warn('Messages count fetch warning:', e);
    }
  }

  return {
    totalUsers,
    onlineUsers,
    totalMessages,
    totalConversations,
  };
}

/**
 * Admin için Firestore'daki tüm gerçek sohbetleri (özel ve grup) çeker.
 */
export async function fetchAllConversationsForAdmin(
  adminUser: UserProfile
): Promise<Conversation[]> {
  if (!db) throw new Error('Firestore hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Yetkisiz erişim (Yalnızca Admin)');
  }

  const convCol = collection(db, 'conversations');
  const convSnap = await getDocs(convCol);

  const convs: Conversation[] = [];
  convSnap.forEach((docSnap) => {
    convs.push({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Conversation, 'id'>),
    });
  });

  // Tarihe göre en yeniden en eskiye sırala
  convs.sort((a, b) => {
    const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.lastMessageTimestamp?.toMillis ? a.lastMessageTimestamp.toMillis() : 0);
    const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.lastMessageTimestamp?.toMillis ? b.lastMessageTimestamp.toMillis() : 0);
    return timeB - timeA;
  });

  return convs;
}

/**
 * Admin için belirli bir sohbetin TÜM gerçek mesaj geçmişini Firestore'dan çeker.
 * Limit veya kırpma olmadan kronolojik sırayla alır.
 */
export async function fetchAllMessagesForConversationAdmin(
  adminUser: UserProfile,
  conversationId: string
): Promise<ChatMessage[]> {
  if (!db || !conversationId) return [];
  if (!isUserAdmin(adminUser)) {
    throw new Error('Yetkisiz erişim (Yalnızca Admin)');
  }

  const msgsCol = collection(db, 'conversations', conversationId, 'messages');
  const q = query(msgsCol, orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);

  const messages: ChatMessage[] = [];
  snap.forEach((docSnap) => {
    messages.push({
      id: docSnap.id,
      ...(docSnap.data() as Omit<ChatMessage, 'id'>),
    });
  });

  return messages;
}

/**
 * Sohbeti belirtilen resmi formatta metne dönüştürür.
 */
export function formatChatLogText(
  conversation: Conversation,
  messages: ChatMessage[]
): string {
  const isGroup = Boolean(conversation.isGroup);
  const nowStr = new Date().toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let headerBlock = '';

  if (isGroup) {
    const groupName = conversation.name || 'İsimsiz Grup';
    const participantsList = conversation.participants
      ? Object.values(conversation.participants)
          .map((p) => p.displayName || p.username)
          .join(', ')
      : `${conversation.participantIds?.length || 0} Üye`;

    headerBlock = `━━━━━━━━━━━━━━━━━━
REDCHAT GRUP SOHBET LOGU
━━━━━━━━━━━━━━━━━━

Grup:
${groupName}

Tür:
Grup Sohbeti

Katılımcılar:
${participantsList}

Oluşturulma / Log Tarihi:
${nowStr}

Toplam Mesaj: ${messages.length}

━━━━━━━━━━━━━━━━━━\n\n`;
  } else {
    // Özel sohbet
    let pNames: string[] = [];
    if (conversation.participants) {
      pNames = Object.values(conversation.participants).map(
        (p) => p.displayName || p.username
      );
    }
    const pairName = pNames.length >= 2 ? `${pNames[0]} ↔ ${pNames[1]}` : 'Özel Sohbet';

    headerBlock = `━━━━━━━━━━━━━━━━━━
REDCHAT SOHBET LOGU
━━━━━━━━━━━━━━━━━━

Sohbet:
${pairName}

Tür:
Özel Sohbet

Log Tarihi:
${nowStr}

Toplam Mesaj: ${messages.length}

━━━━━━━━━━━━━━━━━━\n\n`;
  }

  const messageLines: string[] = [];

  messages.forEach((msg) => {
    let timeFormatted = 'Tarihsiz';
    if (msg.createdAt?.toDate) {
      const d = msg.createdAt.toDate();
      timeFormatted = d.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (msg.createdAt instanceof Date) {
      timeFormatted = msg.createdAt.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    const senderDisplay = msg.senderName || msg.senderUsername || 'Kullanıcı';

    if (msg.isSystemMessage) {
      messageLines.push(`[${timeFormatted}] [SİSTEM BİLDİRİMİ]: ${msg.text}\n`);
      return;
    }

    let msgContent = '';

    // Yanıtlanan mesaj varsa
    if (msg.replyTo) {
      const replySender = msg.replyTo.senderName || 'Kullanıcı';
      const replySnippet = msg.replyTo.text
        ? `"${msg.replyTo.text.slice(0, 40)}${msg.replyTo.text.length > 40 ? '...' : ''}"`
        : '[Fotoğraf]';
      msgContent += `↩ ${replySender}: ${replySnippet}\n`;
    }

    // Fotoğraf varsa
    if (msg.imageUrl) {
      msgContent += `[Fotoğraf: ${msg.imageUrl}]\n`;
    }

    // Metin varsa
    if (msg.text) {
      msgContent += `${msg.text}\n`;
    }

    // Reaksiyonlar varsa
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      const rxSummary = Object.entries(msg.reactions)
        .map(([emoji, uids]) => `${emoji} (${uids.length})`)
        .join(' ');
      msgContent += `[Reaksiyonlar: ${rxSummary}]\n`;
    }

    messageLines.push(`[${timeFormatted}] ${senderDisplay}:\n${msgContent.trimEnd()}\n`);
  });

  const footerBlock = `\n━━━━━━━━━━━━━━━━━━\nREDCHAT LOG SONU\n━━━━━━━━━━━━━━━━━━`;

  return `${headerBlock}${messageLines.join('\n')}${footerBlock}`;
}
