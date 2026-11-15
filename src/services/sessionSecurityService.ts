import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from './firebase';
import { getHardwareDeviceId, getClientIp } from './deviceService';
import type {
  SecuritySession,
  SecuritySessionNetwork,
  AdminLogEntry,
} from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

const SESSION_STORAGE_PREFIX = 'redchat_sec_session_';
const FRESH_LOGIN_KEY = 'redchat_fresh_login_pending';

export interface LocalSessionCredentials {
  sessionId: string;
  sessionProof: string;
}

export function markFreshLoginPending(): void {
  try {
    sessionStorage.setItem(FRESH_LOGIN_KEY, '1');
  } catch {
    // sessiz geç
  }
}

export function getLocalSessionCredentials(uid: string): LocalSessionCredentials | null {
  if (!uid || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${SESSION_STORAGE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.sessionId && parsed?.sessionProof) {
      return {
        sessionId: String(parsed.sessionId),
        sessionProof: String(parsed.sessionProof),
      };
    }
  } catch {
    // sessiz geç
  }
  return null;
}

function saveLocalSessionCredentials(uid: string, creds: LocalSessionCredentials): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${SESSION_STORAGE_PREFIX}${uid}`, JSON.stringify(creds));
  } catch {
    // sessiz geç
  }
}

export function clearLocalSessionCredentials(uid?: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(FRESH_LOGIN_KEY);
    if (uid) {
      localStorage.removeItem(`${SESSION_STORAGE_PREFIX}${uid}`);
    } else {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(SESSION_STORAGE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch {
    // sessiz geç
  }
}

export async function registerOrVerifyDeviceSession(user: User): Promise<{
  session: SecuritySession;
  sessionProof: string;
}> {
  const idToken = await user.getIdToken();
  const deviceId = getHardwareDeviceId();
  const existing = getLocalSessionCredentials(user.uid);

  let isFreshLogin = false;
  try {
    isFreshLogin = sessionStorage.getItem(FRESH_LOGIN_KEY) === '1';
    if (isFreshLogin) {
      sessionStorage.removeItem(FRESH_LOGIN_KEY);
    }
  } catch {
    isFreshLogin = false;
  }

  let clientPublicIp: string | undefined;
  try {
    const ip = await getClientIp();
    if (ip && ip !== '127.0.0.1') {
      clientPublicIp = ip;
    }
  } catch {
    // sunucu kendi çözecek
  }

  const resp = await fetch('/api/security/sessions/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      deviceId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      existingSessionId: existing?.sessionId,
      existingSessionProof: existing?.sessionProof,
      clientPublicIp,
      isFreshLogin,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.session) {
    const err: any = new Error(data?.error || 'Oturum güvenlik kontrolü başlatılamadı.');
    if (data?.code) err.code = data.code;
    throw err;
  }

  const session = data.session as SecuritySession;
  const sessionProof = String(data.sessionProof || existing?.sessionProof || '');

  if (session.sessionId && sessionProof) {
    saveLocalSessionCredentials(user.uid, {
      sessionId: session.sessionId,
      sessionProof,
    });
  }

  return { session, sessionProof };
}

export async function respondToSuspiciousSession(
  sessionId: string,
  response: 'confirmed_me' | 'denied_not_me'
): Promise<SecuritySession> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı.');

  const creds = getLocalSessionCredentials(user.uid);
  if (!creds || creds.sessionId !== sessionId) {
    throw new Error('Bu cihaz için doğrulanmış oturum kanıtı bulunamadı.');
  }

  const idToken = await user.getIdToken();
  const resp = await fetch('/api/security/sessions/respond', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      sessionId,
      sessionProof: creds.sessionProof,
      response,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.session) {
    throw new Error(data?.error || 'Güvenlik yanıtı işlenemedi.');
  }

  return data.session as SecuritySession;
}

export async function revokeAllOtherUserSessions(sessionId: string): Promise<{
  revokedCount: number;
  firebaseTokensRevoked: boolean;
}> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı.');

  const creds = getLocalSessionCredentials(user.uid);
  if (!creds || creds.sessionId !== sessionId) {
    throw new Error('Yetkili oturum kanıtı bulunamadı.');
  }

  const idToken = await user.getIdToken();
  const resp = await fetch('/api/security/sessions/revoke-other-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      sessionId,
      sessionProof: creds.sessionProof,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'Diğer tüm oturumlar kapatılamadı.');
  }

  return {
    revokedCount: Number(data.revokedCount || 0),
    firebaseTokensRevoked: Boolean(data.firebaseTokensRevoked),
  };
}

export function subscribeToSessionStatus(
  sessionId: string,
  callback: (session: SecuritySession | null) => void
): () => void {
  if (!db || !sessionId) {
    callback(null);
    return () => {};
  }

  const path = `securitySessions/${sessionId}`;
  const docRef = doc(db, 'securitySessions', sessionId);
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...(snap.data() as Omit<SecuritySession, 'id'>) });
      } else {
        callback(null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeToAdminSecuritySessions(
  callback: (sessions: SecuritySession[]) => void,
  onError?: (msg: string) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const path = 'securitySessions';
  const q = query(
    collection(db, 'securitySessions'),
    orderBy('createdAt', 'desc'),
    limit(150)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: SecuritySession[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecuritySession, 'id'>),
      }));
      callback(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      onError?.('Şüpheli oturum listesi yüklenirken yetki veya bağlantı hatası oluştu.');
    }
  );
}

export function subscribeToAdminSecurityNetworkMap(
  callback: (networkMap: Record<string, SecuritySessionNetwork>) => void
): () => void {
  if (!db) {
    callback({});
    return () => {};
  }

  const path = 'securitySessionNetwork';
  const q = query(
    collection(db, 'securitySessionNetwork'),
    orderBy('createdAt', 'desc'),
    limit(150)
  );

  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, SecuritySessionNetwork> = {};
      snap.docs.forEach((d) => {
        map[d.id] = {
          id: d.id,
          ...(d.data() as Omit<SecuritySessionNetwork, 'id'>),
        };
      });
      callback(map);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeToAdminLogs(
  callback: (logs: AdminLogEntry[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const path = 'adminLogs';
  const q = query(
    collection(db, 'adminLogs'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: AdminLogEntry[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AdminLogEntry, 'id'>),
      }));
      callback(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function adminApproveSession(sessionId: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Oturum bulunamadı.');
  const idToken = await user.getIdToken();

  const resp = await fetch('/api/admin/security/sessions/approve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ sessionId }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'Oturuma izin verilemedi.');
  }
}

export async function adminRevokeSingleSession(sessionId: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Oturum bulunamadı.');
  const idToken = await user.getIdToken();

  const resp = await fetch('/api/admin/security/sessions/revoke-single', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ sessionId }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'Oturum kapatılamadı.');
  }
}

export async function adminRevokeAllUserSessions(
  targetUid: string,
  targetUsername?: string
): Promise<{ revokedCount: number; firebaseTokensRevoked: boolean }> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Oturum bulunamadı.');
  const idToken = await user.getIdToken();

  const resp = await fetch('/api/admin/security/sessions/revoke-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ targetUid, targetUsername }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'Tüm oturumlar kapatılamadı.');
  }

  return {
    revokedCount: Number(data.revokedCount || 0),
    firebaseTokensRevoked: Boolean(data.firebaseTokensRevoked),
  };
}

export function formatSessionDateTime(ts: any): string {
  if (!ts) return 'Bilinmiyor';
  let date: Date;
  if (typeof ts?.toDate === 'function') {
    date = ts.toDate();
  } else if (ts?.seconds) {
    date = new Date(ts.seconds * 1000);
  } else {
    date = new Date(ts);
  }
  if (isNaN(date.getTime())) return 'Bilinmiyor';
  return date.toLocaleString('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}
