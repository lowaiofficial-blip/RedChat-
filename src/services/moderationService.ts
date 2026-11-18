import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  UserProfile,
  ModeratorGrant,
  ModerationLogEntry,
  UserReport,
  UserReportCategory,
  ModerationReport,
  Conversation,
} from '../types';

export const MUSE_MODERATOR_UID = 'GnQk5MbPQdS4GDl4cohFzRlKNw22';
export const MUSE_MODERATOR_EMAIL = 'muse@gmail.com';

export interface VerifiedAuthorityResponse {
  uid: string;
  email: string | null;
  role: 'admin' | 'moderator' | 'user';
  isMainAdmin: boolean;
  isModerator: boolean;
  grantActive: boolean;
  verifiedAt: string;
  permissions: {
    canViewUsers: boolean;
    canTempMute: boolean;
    canTempBan: boolean;
    canPermBan: boolean;
    canManageRoles: boolean;
    canDeleteUsers: boolean;
    canDeleteMessagesOrLogs: boolean;
    canManageSecuritySessions: boolean;
    canManageSystemSettings: boolean;
    canInspectScopedChats: boolean;
    canInspectAllPrivateChats: boolean;
  };
}

export interface ScopedConversationItem extends Partial<Conversation> {
  id: string;
  scopeReason?: string;
}

export interface ScopedMessageItem {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  isSystemMessage?: boolean;
  isSecurityWarning?: boolean;
  createdAt?: any;
}

function logFirestoreError(operationType: string, path: string, error: unknown) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
    },
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

async function getBearerHeaders(): Promise<HeadersInit> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('Oturum açık değil.');
  }
  const token = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function toTimestampMs(val: any): number | null {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val?.toDate === 'function') return val.toDate().getTime();
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?.seconds === 'number') return val.seconds * 1000;
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof val === 'number') return val;
  return null;
}

export function isUserEffectivelyBanned(user?: UserProfile | null): boolean {
  if (!user?.isBanned) return false;
  if (user.banType === 'temporary') {
    const expMs = toTimestampMs(user.banExpiresAt);
    if (expMs !== null && expMs <= Date.now()) {
      return false;
    }
  }
  return true;
}

export function isUserEffectivelyMuted(user?: UserProfile | null): boolean {
  if (!user?.isMuted) return false;
  if (user.muteType === 'temporary') {
    const expMs = toTimestampMs(user.muteExpiresAt);
    if (expMs !== null && expMs <= Date.now()) {
      return false;
    }
  }
  return true;
}

export function formatRemainingTime(endsAt: any, referenceNowMs: number = Date.now()): string {
  const expMs = toTimestampMs(endsAt);
  if (expMs === null) return 'Süresiz';
  const diff = expMs - referenceNowMs;
  if (diff <= 0) return 'Süre doldu';

  const totalSec = Math.ceil(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) return `${days} gün ${hours} sa`;
  if (hours > 0) return `${hours} sa ${mins} dk`;
  if (mins > 0) return `${mins} dk ${secs} sn`;
  return `${secs} sn`;
}

export async function verifyModeratorAuthority(): Promise<VerifiedAuthorityResponse> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/verify-role', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Rol doğrulaması başarısız.');
  }
  return data as VerifiedAuthorityResponse;
}

export async function setModeratorRoleByAdmin(
  action: 'grant' | 'revoke',
  targetUid: string = MUSE_MODERATOR_UID,
  reason?: string
): Promise<{ success: boolean; role: string; active: boolean }> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/admin/moderation/set-moderator-role', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetUid, action, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Moderatör yetkisi güncellenemedi.');
  }
  return data;
}

export async function applyModerationMute(params: {
  targetUid: string;
  reason: string;
  durationMinutes: number | null;
  muteType?: 'temporary' | 'permanent';
}): Promise<any> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/mute', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Susturma işlemi başarısız.');
  }
  return data;
}

export async function liftModerationMute(targetUid: string, reason?: string): Promise<any> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/unmute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetUid, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Susturma kaldırılamadı.');
  }
  return data;
}

export async function applyModerationBan(params: {
  targetUid: string;
  reason: string;
  durationMinutes: number | null;
  banType?: 'temporary' | 'permanent';
}): Promise<any> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/ban', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Ban işlemi başarısız.');
  }
  return data;
}

export async function liftModerationBan(targetUid: string, reason?: string): Promise<any> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/unban', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetUid, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Ban kaldırılamadı.');
  }
  return data;
}

export async function checkModerationExpiry(
  targetUid?: string
): Promise<{ success: boolean; banExpired: boolean; muteExpired: boolean }> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/check-expiry', {
    method: 'POST',
    headers,
    body: JSON.stringify(targetUid ? { targetUid } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Süre kontrolü başarısız.');
  }
  return data;
}

export async function fetchScopedConversationsForModeration(): Promise<{
  scope: 'all' | 'moderation_only';
  conversations: ScopedConversationItem[];
}> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/scoped-conversations', {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Kapsamlı sohbet listesi alınamadı.');
  }
  return data;
}

export async function fetchScopedMessagesForModeration(conversationId: string): Promise<{
  conversationId: string;
  scope: 'full' | 'moderation_scoped';
  messages: ScopedMessageItem[];
}> {
  const headers = await getBearerHeaders();
  const res = await fetch(`/api/moderation/scoped-messages/${encodeURIComponent(conversationId)}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Kapsamlı mesajlar okunamadı.');
  }
  return data;
}

export async function submitModerationReport(params: {
  targetUid: string;
  conversationId?: string | null;
  userReportId?: string | null;
  title: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedAction?: string;
  messageCountReviewed?: number;
  nextUserReportStatus?: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
}): Promise<{ success: boolean; report: ModerationReport }> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/moderation/reports', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Moderasyon raporu kaydedilemedi.');
  }
  return data;
}

export async function submitUserComplaint(params: {
  reporter: UserProfile;
  reportedUid: string;
  reportedUsername: string;
  conversationId?: string | null;
  messageId?: string | null;
  messageExcerpt?: string | null;
  category: UserReportCategory;
  reason: string;
}): Promise<string> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil.');
  const cleanReason = params.reason.trim();
  if (cleanReason.length < 5) {
    throw new Error('Lütfen en az 5 karakterlik bir şikâyet açıklaması yazın.');
  }
  if (!params.reportedUid || params.reportedUid === params.reporter.uid) {
    throw new Error('Geçersiz şikâyet hedefi.');
  }

  const reportId = `urep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const reportRef = doc(db, 'userReports', reportId);

  try {
    await setDoc(reportRef, {
      id: reportId,
      reporterUid: params.reporter.uid,
      reporterUsername: params.reporter.username || 'kullanici',
      reportedUid: params.reportedUid,
      reportedUsername: params.reportedUsername || 'kullanici',
      conversationId: params.conversationId || null,
      messageId: params.messageId || null,
      messageExcerpt: params.messageExcerpt ? params.messageExcerpt.slice(0, 280) : null,
      category: params.category,
      reason: cleanReason.slice(0, 1000),
      status: 'pending',
      assignedModeratorUid: null,
      resolutionNote: null,
      reviewedByUid: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return reportId;
  } catch (err) {
    logFirestoreError('create', `userReports/${reportId}`, err);
    throw new Error('Şikâyet gönderilemedi. Lütfen tekrar deneyin.');
  }
}

export async function updateUserReportStatus(
  reportId: string,
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed',
  reviewedByUid: string,
  resolutionNote?: string
): Promise<void> {
  if (!db) throw new Error('Firestore bağlantısı hazır değil.');
  const reportRef = doc(db, 'userReports', reportId);
  try {
    const payload: Record<string, any> = {
      status,
      reviewedByUid,
      updatedAt: serverTimestamp(),
    };
    if (typeof resolutionNote === 'string') {
      payload.resolutionNote = resolutionNote.slice(0, 500);
    }
    await updateDoc(reportRef, payload);
  } catch (err) {
    logFirestoreError('update', `userReports/${reportId}`, err);
    throw new Error('Şikâyet durumu güncellenemedi.');
  }
}

export function subscribeToModeratorGrant(
  uid: string,
  callback: (grant: ModeratorGrant | null) => void
): () => void {
  if (!db || !uid) {
    callback(null);
    return () => {};
  }

  const ref = doc(db, 'moderatorGrants', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...(snap.data() as Omit<ModeratorGrant, 'id'>) });
      } else {
        callback(null);
      }
    },
    (err) => {
      logFirestoreError('get', `moderatorGrants/${uid}`, err);
      callback(null);
    }
  );
}

export function subscribeToModerationLogs(
  callback: (logs: ModerationLogEntry[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'moderationLogs'), orderBy('createdAt', 'desc'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ModerationLogEntry, 'id'>),
      }));
      callback(list);
    },
    (err) => {
      logFirestoreError('list', 'moderationLogs', err);
      callback([]);
    }
  );
}

export function subscribeToUserReports(
  callback: (reports: UserReport[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'userReports'), orderBy('createdAt', 'desc'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserReport, 'id'>),
      }));
      callback(list);
    },
    (err) => {
      logFirestoreError('list', 'userReports', err);
      callback([]);
    }
  );
}

export function subscribeToModerationReports(
  callback: (reports: ModerationReport[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'moderationReports'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ModerationReport, 'id'>),
      }));
      callback(list);
    },
    (err) => {
      logFirestoreError('list', 'moderationReports', err);
      callback([]);
    }
  );
}

/**
 * RedChat AI — Sohbet Güvenliği & Hakaret / Küfür Filtresi
 * Türkçe diline ve yaygın saldırgan ifadelere göre optimize edilmiş kontrol motoru.
 */

// Yaygın Türkçe küfür ve hakaret kökleri / terimleri
const DIRECT_PROFANITY_WORDS = [
  'amk',
  'aq',
  'amq',
  'amguard',
  'amina',
  'aminakoyayim',
  'aminakoyim',
  'amcik',
  'amcık',
  'orospu',
  'orospucocugu',
  'orospuçocuğu',
  'oc',
  'oç',
  'pic',
  'piç',
  'siktir',
  'siktirgit',
  'sikeyim',
  'sikeyim',
  'sikis',
  'sikiş',
  'sikik',
  'sik',
  'yarrak',
  'yarak',
  'dassak',
  'daşşak',
  'tassak',
  'taşşak',
  'gotos',
  'götoş',
  'pezevenk',
  'kahpe',
  'fahişe',
  'fahise',
  'kancik',
  'kancık',
  'surtuk',
  'sürtük',
  'kevase',
  'kevaşe',
  'gavat',
  'kavat',
  'ibne',
  'pust',
  'puşt',
  'gotlek',
  'götlek',
  'gotveren',
  'götveren',
  'amcigi',
  'amcığı',
  'ananisikeyim',
  'ananısikeyim',
  'ebenisikeyim',
  'ebenin',
];

// Doğrudan hakaret / aşağılama sıfatları
const DIRECT_INSULT_WORDS = [
  'salak',
  'gerizekali',
  'gerizekalı',
  'aptal',
  'ahmak',
  'embesil',
  'dangalak',
  'dallama',
  'yavsak',
  'yavşak',
  'serefsiz',
  'şerefsiz',
  'namussuz',
  'haysiyetsiz',
  'karaktersiz',
  'beyinsiz',
  'moron',
  'idiot',
  'okuz',
  'öküz',
  'gerzek',
  'angut',
  'hiyar',
  'hıyar',
];

// Yanlış pozitif vermesi muhtemel kelimeleri ("malzeme", "malum", "normal", "salata" vb.)
// korumak için özel bağlamlı kurallar
const CONTEXTUAL_INSULT_PATTERNS = [
  // "mal" hakareti (mal mısın, tam bir mal, mal herif, malsın)
  /\b(tam\s+bir\s+)?mal(\s+m[ıi]s[ıi]n|s[ıi]n|lar|\s+herif|\s+ya)?\b/i,
  // "it" hakareti (pis it, it herif, itsin)
  /\b(pis\s+it|it\s+herif|it\s+oğlu\s+it|it\s+oglu\s+it)\b/i,
  // "köpek" / "kopek" hakareti
  /\b(k[öo]pek\s+herif|pis\s+k[öo]pek|k[öo]peksin)\b/i,
  // "göt" hakareti
  /\b(g[öo]t\s+k[ıi]l[ıi]|g[öo]ts[üu]n|g[öo]t\s+herif)\b/i,
  // Kısaltmalar (oç, o.ç., amk, a.m.k, aq, a.q., piç, p.i.ç)
  /(^|[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ])(o\s*\.?\s*[çc]\s*\.?|a\s*\.?\s*m\s*\.?\s*k\s*\.?|a\s*\.?\s*q\s*\.?|p\s*\.?\s*i\s*\.?\s*[çc]\s*\.?)([^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ]|$)/i,
  // "ananı / ananın ..."
  /\banan[ıi]n?\s+(am[ıi]|sik|bac[ıi]|avrad)/i,
  // "canın cehenneme", "geber", "öl pislik"
  /\b(can[ıi]n\s+cehenneme|geber\s+pislik|geber\s+lan)\b/i,
];

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/**
 * Gönderilen mesajın hakaret, küfür veya saldırgan içerik barındırıp barındırmadığını tespit eder.
 */
export function isAbusiveMessage(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') return false;

  const originalLower = rawText.toLocaleLowerCase('tr-TR').trim();
  if (!originalLower) return false;

  for (const pattern of CONTEXTUAL_INSULT_PATTERNS) {
    if (pattern.test(originalLower)) {
      return true;
    }
  }

  const words = originalLower.split(/[\s,.:;!?"'()\-[\]{}<>/\\|]+/);

  for (const rawWord of words) {
    if (!rawWord) continue;

    if (/^(şık|ışık|ışıklandırma|aşık|beşik|değişik|karışık|bulaşık|dikiş)$/i.test(rawWord)) {
      continue;
    }

    const normWord = normalizeText(rawWord);

    for (const profanity of DIRECT_PROFANITY_WORDS) {
      if (profanity === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
        continue;
      }

      const normProf = normalizeText(profanity);

      if (normWord === normProf) {
        if (normProf === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
          continue;
        }
        return true;
      }

      if (normProf.length <= 4) {
        if (normWord === normProf) {
          if (normProf === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
            continue;
          }
          return true;
        }
      } else {
        if (normWord.includes(normProf)) {
          return true;
        }
      }
    }

    for (const insult of DIRECT_INSULT_WORDS) {
      const normInsult = normalizeText(insult);
      const insultRegex = new RegExp(`^${normInsult}(s[ıi]n[ıi]z|s[ıi]n|lar|ler|lik|ce|im|sin)?$`, 'i');
      if (insultRegex.test(normWord)) {
        return true;
      }
    }
  }

  return false;
}
