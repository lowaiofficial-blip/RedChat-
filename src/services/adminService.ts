import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
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
import type { AppSettings, UserProfile, Conversation, ChatMessage, BannedDevice, ModerationActionType } from '../types';
import { getDeterministicConversationId } from './chatService';
import { REDCHAT_AI_UID } from './aiService';

export const ADMIN_EMAILS = [
  'robloxenes930@gmail.com',
  'gg00cat73@gmail.com',
];

export const MUSE_MODERATOR_UID = 'GnQk5MbPQdS4GDl4cohFzRlKNw22';
export const MUSE_MODERATOR_EMAIL = 'muse@gmail.com';

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
 * Muse hesabının UID + e-posta + Firestore rolü üzerinden doğrulanmış moderatör kontrolü.
 * Yalnızca e-posta string kontrolüne asla güvenilmez.
 */
export function isUserModerator(
  user?: UserProfile | { uid?: string | null; email?: string | null; role?: string | null } | null
): boolean {
  if (!user || isUserAdmin(user)) return false;

  const uid = (user as any).uid || auth?.currentUser?.uid;
  const authEmail = auth?.currentUser?.email?.trim().toLowerCase();
  const profileEmail = user.email?.trim().toLowerCase();

  return (
    uid === MUSE_MODERATOR_UID &&
    (authEmail === MUSE_MODERATOR_EMAIL || profileEmail === MUSE_MODERATOR_EMAIL) &&
    user.role === 'moderator'
  );
}

export function canAccessModerationPanel(user?: UserProfile | null): boolean {
  return isUserAdmin(user) || isUserModerator(user);
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
      username: 'deepred_ai',
      usernameLower: 'deepred_ai',
      displayName: 'DeepRed AI',
      email: 'ai@redchat.internal',
      photoURL: cleanUrl,
      bio: 'DeepRed AI — RedChat Resmi Yapay Zeka Asistanı',
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

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: isVerified ? 'user_verified' : 'user_unverified',
    reason: isVerified
      ? 'Yönetici tarafından kullanıcıya mavi tik verildi'
      : 'Yönetici tarafından kullanıcının mavi tiki kaldırıldı',
  });
}

function sanitizeModerationLogText(raw: string): string {
  return (raw || '')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[gizli-ağ]')
    .replace(/\bHWID[:\s-]*[A-Za-z0-9_-]{4,}\b/gi, '[gizli-cihaz]')
    .trim();
}

/**
 * Moderasyon işlemlerini hem moderationLogs hem de adminLogs koleksiyonlarına değiştirilemez denetim kaydı olarak yazar.
 */
export async function recordModerationAuditLogClient(params: {
  actor?: UserProfile | null;
  targetUid: string;
  targetUsername?: string | null;
  actionType: ModerationActionType;
  reason: string;
  durationMinutes?: number | null;
  endsAt?: any;
}) {
  if (!db) return;
  const now = serverTimestamp();
  const logId = `modlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const actorUid = params.actor?.uid || auth?.currentUser?.uid || 'system';
  const actorEmail = params.actor?.email || auth?.currentUser?.email || null;
  const actorUsername =
    params.actor?.username ||
    params.actor?.displayName ||
    auth?.currentUser?.displayName ||
    auth?.currentUser?.email ||
    'Admin';
  const actorRole: 'admin' | 'moderator' | 'system' = params.actor
    ? isUserAdmin(params.actor)
      ? 'admin'
      : 'moderator'
    : actorEmail && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(actorEmail.toLowerCase())
    ? 'admin'
    : 'moderator';

  const safeReason = sanitizeModerationLogText(params.reason) || 'Moderasyon işlemi';

  try {
    const modRef = doc(db, 'moderationLogs', logId);
    await setDoc(modRef, {
      id: logId,
      actorUid,
      actorEmail,
      actorUsername,
      actorRole,
      targetUid: params.targetUid,
      targetUsername: params.targetUsername ?? null,
      actionType: params.actionType,
      reason: safeReason,
      startsAt: now,
      endsAt: params.endsAt || null,
      durationMinutes: params.durationMinutes ?? null,
      reportId: null,
      createdAt: now,
    });
  } catch (err) {
    console.warn('[AdminService] moderationLogs write failed:', err);
  }

  try {
    const adminLogId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const adminLogRef = doc(db, 'adminLogs', adminLogId);
    await setDoc(adminLogRef, {
      id: adminLogId,
      category: 'moderation',
      action: params.actionType,
      severity: params.actionType.includes('ban') ? 'critical' : params.actionType.includes('mute') ? 'warning' : 'info',
      actorUid,
      actorEmail,
      actorName: actorUsername,
      targetUid: params.targetUid,
      targetUsername: params.targetUsername ?? null,
      sessionId: null,
      details: `[${actorRole.toUpperCase()}] @${params.targetUsername || params.targetUid} -> ${params.actionType}: ${safeReason}`,
      metadata: {
        actionType: params.actionType,
        durationMinutes: params.durationMinutes ?? null,
      },
      createdAt: now,
    });
  } catch (err) {
    console.warn('[AdminService] adminLogs write failed:', err);
  }
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

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: 'perm_ban',
    reason: reason.trim(),
  });
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
      banType: null,
      banReason: null,
      bannedAt: null,
      banExpiresAt: null,
      bannedByUid: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: 'unban',
    reason: 'Admin tarafından ban kaldırıldı',
  });
}

/**
 * Kullanıcıyı e-posta inceleme durumuna alır (isEmailInReview: true) veya çıkarır (isEmailInReview: false).
 */
export async function setUserEmailInReview(
  adminUser: UserProfile,
  targetUid: string,
  isInReview: boolean
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (adminUser?.uid && targetUid === adminUser.uid) {
    throw new Error('Kendi hesabınızı incelemeye alamazsınız');
  }
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  const updateData: any = {
    isEmailInReview: isInReview,
    emailInReviewAt: isInReview ? serverTimestamp() : null,
    emailInReviewBy: isInReview ? adminUser.uid : null,
    updatedAt: serverTimestamp(),
  };

  if (isInReview) {
    updateData.isOnline = false;
    updateData.lastSeen = serverTimestamp();
  }

  await setDoc(userDocRef, updateData, { merge: true });

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: isInReview ? 'email_in_review' : 'email_review_released',
    reason: isInReview
      ? 'Yönetici tarafından şüpheli e-posta incelemesine alındı'
      : 'Yönetici tarafından e-posta incelemesi kaldırıldı',
  });
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

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: 'perm_mute',
    reason: reason.trim(),
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
    muteType: null,
    muteReason: null,
    mutedAt: null,
    muteExpiresAt: null,
    mutedByUid: null,
    updatedAt: serverTimestamp(),
  });

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid,
    actionType: 'unmute',
    reason: 'Admin tarafından susturma kaldırıldı',
  });
}

/**
 * 🚫 IP ve Donanım (Hardware) Banı Uygular
 * Hem IP adresini hem de cihaz parmak izini (HWID) banned_devices tablosuna işler.
 * Kullanıcı kimliği varsa hesabını da kalıcı olarak kilitler.
 */
export async function banDeviceAndIp(
  adminUser: UserProfile,
  params: {
    deviceId: string;
    ip?: string | null;
    deviceType: 'desktop' | 'tablet' | 'mobile' | 'unknown';
    hardwareFingerprint?: string;
    targetUid?: string | null;
    targetUsername?: string | null;
    targetDisplayName?: string | null;
    targetEmail?: string | null;
    reason: string;
  }
): Promise<string> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }
  if (!params.deviceId && !params.ip) {
    throw new Error('Banlamak için en az bir Cihaz Kimliği (HWID) veya IP Adresi gereklidir.');
  }

  const bannedCol = collection(db, 'banned_devices');
  const banRecord: any = {
    deviceId: (params.deviceId || '').trim(),
    ip: (params.ip || '').trim() || null,
    deviceType: params.deviceType || 'unknown',
    hardwareFingerprint: (params.hardwareFingerprint || '').trim(),
    targetUid: params.targetUid || null,
    targetUsername: params.targetUsername || null,
    targetDisplayName: params.targetDisplayName || null,
    targetEmail: params.targetEmail || null,
    bannedBy: adminUser.displayName || adminUser.username || adminUser.email || 'Admin',
    bannedByUid: adminUser.uid,
    reason: (params.reason || 'Kalıcı Ağ ve Cihaz Güvenlik Engeli').trim(),
    bannedAt: serverTimestamp(),
    isActive: true,
  };

  const docRef = await addDoc(bannedCol, banRecord);

  // Kullanıcı profili varsa kullanıcı hesabını da banla
  if (params.targetUid) {
    try {
      const targetUserRef = doc(db, 'users', params.targetUid);
      await setDoc(
        targetUserRef,
        {
          isBanned: true,
          banReason: `[IP & Donanım Banı] ${banRecord.reason}`,
          bannedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Hedef kullanıcının hesabı güncellenemedi:', err);
    }
  }

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid: params.targetUid || `device_${docRef.id}`,
    targetUsername: params.targetUsername || params.targetDisplayName || null,
    actionType: 'perm_ban',
    reason: sanitizeModerationLogText(banRecord.reason) || 'Kalıcı cihaz/hesap erişim engeli',
  });

  return docRef.id;
}

/**
 * 🟢 IP ve Donanım (Hardware) Banını Kaldırır (Unban)
 * Dokümanı siler veya deaktife eder. Cihaz anında kilit ekranından kurtulur.
 */
export async function unbanDeviceAndIp(
  adminUser: UserProfile,
  banId: string,
  targetUid?: string | null
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }
  if (!banId) throw new Error('Geçersiz Ban ID');

  const banDocRef = doc(db, 'banned_devices', banId);
  await deleteDoc(banDocRef);

  // Eğer hedef kullanıcının hesabı da banlıysa hesabı da açmayı dene
  if (targetUid) {
    try {
      const targetUserRef = doc(db, 'users', targetUid);
      await setDoc(
        targetUserRef,
        {
          isBanned: false,
          banReason: null,
          bannedAt: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Hedef kullanıcının hesabı güncellenemedi:', err);
    }
  }

  await recordModerationAuditLogClient({
    actor: adminUser,
    targetUid: targetUid || `device_${banId}`,
    actionType: 'unban',
    reason: 'Admin tarafından cihaz/hesap engeli kaldırıldı',
  });
}

/**
 * Aktif tüm IP & Donanım banlarını gerçek zamanlı (onSnapshot) dinler
 */
export function listenToBannedDevices(
  callback: (bans: BannedDevice[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const bannedCol = collection(db, 'banned_devices');
  const q = query(bannedCol, orderBy('bannedAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const bans = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as BannedDevice[];
      callback(bans);
    },
    (err) => {
      console.warn('listenToBannedDevices hatası:', err);
      // Fallback: orderBy index yoksa düz collection çek
      const fallbackUnsub = onSnapshot(bannedCol, (snap) => {
        const bans = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as BannedDevice[];
        callback(bans);
      });
      return fallbackUnsub;
    }
  );
}

/**
 * Tüm IP ve Donanım banlarını tek seferlik çeker
 */
export async function fetchAllBannedDevices(): Promise<BannedDevice[]> {
  if (!db) return [];
  try {
    const bannedCol = collection(db, 'banned_devices');
    const snap = await getDocs(bannedCol);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as BannedDevice[];
  } catch (err) {
    console.error('fetchAllBannedDevices hatası:', err);
    return [];
  }
}

export interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  totalMessages: number;
  totalConversations: number;
  terminatedAiCount: number;
}

/**
 * Gerçek Firestore verilerinden anlık istatistikleri çeker.
 * Mock veya sahte veri içermez.
 */
export async function fetchRealAdminStats(): Promise<AdminStats> {
  if (!db) {
    return { totalUsers: 0, onlineUsers: 0, totalMessages: 0, totalConversations: 0, terminatedAiCount: 0 };
  }

  let totalUsers = 0;
  let onlineUsers = 0;
  let totalMessages = 0;
  let totalConversations = 0;
  let terminatedAiCount = 0;

  // 1. Toplam Kullanıcı Sayısı
  try {
    const usersCol = collection(db, 'users');
    const userCountSnap = await getCountFromServer(usersCol);
    totalUsers = userCountSnap.data().count;
  } catch (e) {
    console.warn('Users count fetch warning:', e);
  }

  // 2. Çevrimiçi Kullanıcı Sayısı
  try {
    const usersCol = collection(db, 'users');
    const onlineQuery = query(usersCol, where('isOnline', '==', true));
    const onlineCountSnap = await getCountFromServer(onlineQuery);
    onlineUsers = onlineCountSnap.data().count;
  } catch (e) {
    console.warn('Online users count fetch warning:', e);
  }

  // 3. Konuşmalar Sayısı
  try {
    const convCol = collection(db, 'conversations');
    const convCountSnap = await getCountFromServer(convCol);
    totalConversations = convCountSnap.data().count;
  } catch (e) {
    console.warn('Conversations count fetch warning:', e);
  }

  // 4. Kapatılan AI Sohbetleri Sayısı (securityStatus: 'terminated' ve aiAccess: 'blocked')
  try {
    const termUsersSet = new Set<string>();

    // 4.a. Güvenlik İhlali ile kapatılmış konuşmalar
    const convCol = collection(db, 'conversations');
    const termConvQuery = query(convCol, where('securityStatus', '==', 'terminated'));
    try {
      const termConvDocs = await getDocs(termConvQuery);
      termConvDocs.forEach((doc) => {
        const data = doc.data();
        if (Array.isArray(data.participantIds)) {
          data.participantIds.forEach((pid: string) => {
            if (pid && pid !== REDCHAT_AI_UID) termUsersSet.add(pid);
          });
        } else {
          termUsersSet.add(doc.id);
        }
      });
    } catch (e) {
      console.warn('Terminated AI conversations count fetch warning:', e);
    }

    // 4.b. securityStatus === 'terminated' olan kullanıcılar
    const usersCol = collection(db, 'users');
    const termUserQuery = query(usersCol, where('securityStatus', '==', 'terminated'));
    try {
      const userTermDocs = await getDocs(termUserQuery);
      userTermDocs.forEach((doc) => termUsersSet.add(doc.id));
    } catch (e) {
      console.warn('Terminated users query warning:', e);
    }

    // 4.c. aiAccess === 'blocked' olan kullanıcılar
    const blockedUserQuery = query(usersCol, where('aiAccess', '==', 'blocked'));
    try {
      const userBlockedDocs = await getDocs(blockedUserQuery);
      userBlockedDocs.forEach((doc) => termUsersSet.add(doc.id));
    } catch (e) {
      console.warn('Blocked users query warning:', e);
    }

    terminatedAiCount = termUsersSet.size;
  } catch (e) {
    console.warn('Terminated AI count fetch warning:', e);
  }

  // 5. Mesajlar Sayısı
  try {
    const msgGroup = collectionGroup(db, 'messages');
    const msgCountSnap = await getCountFromServer(msgGroup);
    totalMessages = msgCountSnap.data().count;
  } catch (e) {
    // Kota veya aggregate sorgu hatasında tüm sohbetleri ve mesajları tek tek
    // okumaya düşme. Bu fallback, kota sorununu daha da büyütebilirdi.
    console.warn('Messages count fetch warning:', e);
  }

  return {
    totalUsers,
    onlineUsers,
    totalMessages,
    totalConversations,
    terminatedAiCount,
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

/**
 * Kullanıcının DeepRed AI erişim durumunu ayarlar ('allowed' veya 'blocked').
 * Normal hesap banından tamamen ayrıdır: Kullanıcı özel mesaj, grup ve kanallara erişmeye devam eder.
 */
export async function setUserAiAccess(
  adminUser: UserProfile,
  targetUid: string,
  aiAccess: 'allowed' | 'blocked'
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (targetUid === 'system_redchat_ai') {
    throw new Error('Sistem AI asistanının erişim durumu değiştirilemez');
  }
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  const userDocRef = doc(db, 'users', targetUid);
  await setDoc(
    userDocRef,
    {
      aiAccess,
      aiAccessUpdatedAt: serverTimestamp(),
      aiAccessUpdatedBy: adminUser.email || adminUser.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Tüm konuşmaları gerçek zamanlı dinler (Admin yetkisiyle).
 */
export function subscribeToAllConversations(
  callback: (conversations: Conversation[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const convCol = collection(db, 'conversations');
  return onSnapshot(
    convCol,
    (snapshot) => {
      const list: Conversation[] = [];
      snapshot.forEach((docSnap) => {
        list.push({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Conversation, 'id'>),
        });
      });
      callback(list);
    },
    (error) => {
      console.error('subscribeToAllConversations onSnapshot error:', error);
      callback([]);
    }
  );
}

/**
 * Kullanıcının AI sohbetini yeniden açar:
 * 1. AI konuşma dokümanındaki 'securityStatus: terminated' durumunu 'active' yapar, abusiveCount'u sıfırlar.
 * 2. Kullanıcı dokümanındaki 'aiAccess' alanını 'allowed', 'securityStatus' alanını 'active' yapar.
 */
export async function reopenUserAiChat(
  adminUser: UserProfile,
  targetUid: string
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  // 1. Kullanıcı dokümanını güncelle (aiAccess: allowed, securityStatus: active)
  const userDocRef = doc(db, 'users', targetUid);
  await setDoc(
    userDocRef,
    {
      aiAccess: 'allowed',
      securityStatus: 'active',
      aiAccessUpdatedAt: serverTimestamp(),
      aiAccessUpdatedBy: adminUser.email || adminUser.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 2. AI konuşma dokümanını bul ve sıfırla
  const convId = getDeterministicConversationId(targetUid, 'system_redchat_ai');
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  if (convSnap.exists()) {
    await updateDoc(convRef, {
      securityStatus: 'active',
      abusiveCount: 0,
      terminatedAt: null,
      terminatedReason: null,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Kullanıcının AI sohbetini kapatır / kısıtlar:
 * 1. AI konuşma dokümanındaki 'securityStatus' alanını 'terminated' yapar.
 * 2. Kullanıcı dokümanındaki 'aiAccess' alanını 'blocked', 'securityStatus' alanını 'terminated' yapar.
 */
export async function closeUserAiChat(
  adminUser: UserProfile,
  targetUid: string,
  reason: string = 'admin_action'
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil');
  if (!targetUid) throw new Error('Geçersiz kullanıcı kimliği');
  if (targetUid === 'system_redchat_ai') {
    throw new Error('Sistem AI asistanının erişim durumu değiştirilemez');
  }
  if (!isUserAdmin(adminUser)) {
    throw new Error('Bu işlemi gerçekleştirme yetkiniz yok (Yalnızca Admin)');
  }

  // 1. Kullanıcı dokümanını güncelle (aiAccess: blocked, securityStatus: terminated)
  const userDocRef = doc(db, 'users', targetUid);
  await setDoc(
    userDocRef,
    {
      aiAccess: 'blocked',
      securityStatus: 'terminated',
      aiAccessUpdatedAt: serverTimestamp(),
      aiAccessUpdatedBy: adminUser.email || adminUser.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 2. AI konuşma dokümanını bul ve sonlandır
  const convId = getDeterministicConversationId(targetUid, 'system_redchat_ai');
  const convRef = doc(db, 'conversations', convId);
  const convSnap = await getDoc(convRef);
  if (convSnap.exists()) {
    await updateDoc(convRef, {
      securityStatus: 'terminated',
      terminatedAt: serverTimestamp(),
      terminatedReason: reason,
      updatedAt: serverTimestamp(),
    });
  }
}

