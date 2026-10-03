import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'firebase/auth';
import { auth, db } from './firebase';
import type { PasswordResetRequest } from '../types';

/**
 * Kullanıcı şifre sıfırlama talebi gönderir.
 * Firebase doğrudan kullanıcıya e-posta göndermez; backend gerçek link üretip redchatbusiness@outlook.com adresine bildirir.
 */
export async function requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim();
  const response = await fetch('/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Şifre sıfırlama talebi gönderilemedi.');
  }

  return data;
}

/**
 * Admin için Firestore'daki tüm şifre sıfırlama taleplerini gerçek zamanlı dinler.
 */
export function subscribeToPasswordResetRequests(
  callback: (requests: PasswordResetRequest[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  try {
    const colRef = collection(db, 'passwordResetRequests');
    const q = query(colRef, orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const requests: PasswordResetRequest[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          requests.push({
            id: docSnap.id,
            userId: data.userId,
            username: data.username || 'Kullanıcı',
            displayName: data.displayName || data.username || 'Kullanıcı',
            email: data.email,
            accountType: data.accountType || 'personal',
            status: data.status || 'pending',
            createdAt: data.createdAt,
            processedAt: data.processedAt,
            processedBy: data.processedBy,
            resetLink: data.resetLink,
            ip: data.ip,
          });
        });
        callback(requests);
      },
      (err) => {
        console.warn('Password reset requests subscription error:', err);
        callback([]);
      }
    );
  } catch (err) {
    console.warn('Failed to subscribe to password reset requests:', err);
    callback([]);
    return () => {};
  }
}

/**
 * Admin talep durumunu günceller (Bekliyor / İşlendi / Reddedildi)
 */
export async function updatePasswordResetRequestStatus(
  requestId: string,
  status: 'pending' | 'completed' | 'rejected',
  adminEmail: string
): Promise<void> {
  if (!db || !requestId) return;

  try {
    const docRef = doc(db, 'passwordResetRequests', requestId);
    await updateDoc(docRef, {
      status,
      processedAt: serverTimestamp(),
      processedBy: adminEmail,
    });
  } catch (err) {
    console.warn('Could not update reset request in Firestore, trying API fallback:', err);
    await fetch('/api/auth/update-reset-request-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, status, adminEmail }),
    });
  }
}

/**
 * Firebase Authentication ile gelen oobCode'u doğrular ve hedef e-postayı döner.
 */
export async function verifyResetCode(oobCode: string): Promise<string> {
  if (!auth) throw new Error('Firebase Auth başlatılamadı.');
  return await verifyPasswordResetCode(auth, oobCode);
}

/**
 * Firebase Authentication ile yeni şifreyi kaydeder.
 */
export async function confirmResetPassword(oobCode: string, newPass: string): Promise<void> {
  if (!auth) throw new Error('Firebase Auth başlatılamadı.');
  await confirmPasswordReset(auth, oobCode, newPass);
}
