import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { UserProfile, BusinessProfile, BusinessVerificationState } from '../types';
import { switchToBusinessAccount } from './authService';

export interface RequestCodeResponse {
  success: boolean;
  step: 1 | 2;
  targetEmail: string;
  expiresAt: number;
  message?: string;
  error?: string;
}

export interface VerifyCodeResponse {
  success: boolean;
  step: 1 | 2;
  nextStep: 2 | 'completed';
  fullyVerified: boolean;
  message?: string;
  error?: string;
}

/**
 * 1. veya 2. Adım için sunucudan güvenli doğrulama kodu ister.
 * Kod sunucu tarafında üretilir ve redchatbusiness@outlook.com adresine Resend HTTPS ile iletilir.
 */
export async function requestBusinessStepCode(params: {
  userId: string;
  username: string;
  displayName: string;
  userEmail: string;
  businessContactEmail: string;
  step: 1 | 2;
  draftProfile?: BusinessProfile;
}): Promise<RequestCodeResponse> {
  const response = await fetch('/api/business/request-step-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `${params.step}. Adım için doğrulama kodu alınamadı.`);
  }

  // İlerlemeyi Firestore'a da kaydet (sayfa yenilemede kaybolmaması için)
  if (db && params.userId) {
    try {
      const userRef = doc(db, 'users', params.userId);
      const verificationUpdates: any = {
        'businessVerification.currentStep': params.step,
        'businessVerification.step1Email': params.userEmail,
        'businessVerification.step2Email': params.businessContactEmail,
        'businessVerification.updatedAt': serverTimestamp(),
      };
      if (params.draftProfile) {
        verificationUpdates['businessVerification.draftProfile'] = params.draftProfile;
      }
      await updateDoc(userRef, verificationUpdates);
    } catch (fsErr) {
      console.warn('Firestore draft sync warning:', fsErr);
    }
  }

  return data;
}

/**
 * Kullanıcının girdiği 6 haneli doğrulama kodunu doğrular.
 */
export async function verifyBusinessStepCode(params: {
  userId: string;
  step: 1 | 2;
  code: string;
}): Promise<VerifyCodeResponse> {
  const response = await fetch('/api/business/verify-step-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Doğrulama kodu geçersiz.');
  }

  // Firestore'daki doğrulama durumunu güncelle
  if (db && params.userId) {
    try {
      const userRef = doc(db, 'users', params.userId);
      const updates: any = {
        'businessVerification.updatedAt': serverTimestamp(),
      };

      if (params.step === 1) {
        updates['businessVerification.step1Verified'] = true;
        updates['businessVerification.step1VerifiedAt'] = serverTimestamp();
        updates['businessVerification.currentStep'] = 2;
      } else if (params.step === 2) {
        updates['businessVerification.step2Verified'] = true;
        updates['businessVerification.step2VerifiedAt'] = serverTimestamp();
        updates['businessVerification.currentStep'] = 3;
      }

      await updateDoc(userRef, updates);
    } catch (fsErr) {
      console.warn('Firestore verification status sync warning:', fsErr);
    }
  }

  return data;
}

/**
 * Kullanıcının mevcut doğrulama durumunu sunucudan ve Firestore'dan sorgular.
 */
export async function getBusinessVerificationStatus(userId: string): Promise<{
  step1Verified: boolean;
  step2Verified: boolean;
  fullyVerified: boolean;
  draftProfile: BusinessProfile | null;
}> {
  try {
    const response = await fetch(`/api/business/verification-status/${encodeURIComponent(userId)}`);
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.warn('Failed to fetch verification status from server:', err);
  }

  return {
    step1Verified: false,
    step2Verified: false,
    fullyVerified: false,
    draftProfile: null,
  };
}

/**
 * Doğrulamaları tamamlanmış işletme hesabını etkinleştirir.
 */
export async function activateVerifiedBusinessAccount(
  currentUser: UserProfile,
  businessData: BusinessProfile,
  photoURL?: string | null
): Promise<void> {
  if (!currentUser?.uid) throw new Error('Kullanıcı oturumu bulunamadı');

  // 1. Sunucu tarafında doğrulamaları kontrol et ve aktifleştir
  const response = await fetch('/api/business/activate-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.uid,
      businessProfile: businessData,
    }),
  });

  const resData = await response.json();
  if (!response.ok) {
    throw new Error(resData.error || 'İşletme hesabı etkinleştirilemedi.');
  }

  // 2. Firestore'da kullanıcı hesabını 'business' yap ve işletme profilini kaydet
  await switchToBusinessAccount(currentUser.uid, businessData, photoURL);

  // 3. Geçici doğrulama taslağını temizle
  if (db) {
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        businessVerification: {
          currentStep: 3,
          step1Verified: true,
          step2Verified: true,
          updatedAt: serverTimestamp(),
        },
      });
    } catch (e) {
      console.warn('Clear business draft warning:', e);
    }
  }
}
