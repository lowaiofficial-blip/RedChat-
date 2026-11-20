import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  deleteUser,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile, BusinessProfile } from '../types';
import {
  markFreshLoginPending,
  clearLocalSessionCredentials,
} from './sessionSecurityService';

let activeRegistrationsCount = 0;

export function isRegistrationInProgress(): boolean {
  return activeRegistrationsCount > 0;
}

export function formatAuthErrorMessage(err: any, fallback = 'Bir hata oluştu.'): string {
  const code = String(err?.code || '').toLowerCase();
  const rawMessage = String(err?.message || '');
  const combined = `${code} ${rawMessage}`.toLowerCase();

  if (combined.includes('auth/email-already-in-use')) {
    return 'Bu e-posta adresi ile zaten bir hesap bulunuyor.';
  }
  if (combined.includes('auth/invalid-email')) {
    return 'Lütfen geçerli bir e-posta adresi girin.';
  }
  if (combined.includes('auth/wrong-password') || combined.includes('auth/invalid-credential')) {
    return 'E-posta veya şifre hatalı.';
  }
  if (combined.includes('auth/user-not-found')) {
    return 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.';
  }
  if (combined.includes('auth/weak-password')) {
    return 'Şifre çok zayıf. En az 6 karakter olmalı.';
  }
  if (combined.includes('auth/too-many-requests')) {
    return 'Çok fazla başarısız deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.';
  }
  if (combined.includes('auth/user-disabled')) {
    return 'Bu hesap yönetici tarafından devre dışı bırakılmış.';
  }
  if (combined.includes('auth/network-request-failed')) {
    return 'Ağ bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }
  if (combined.includes('permission-denied') || combined.includes('missing or insufficient permissions')) {
    return 'Firestore güvenlik kuralları bu işlemi reddetti. Lütfen kullanıcı profili ve kullanıcı adı alanlarını veya yönetici ayarlarını kontrol edin.';
  }
  if (combined.includes('unavailable') || combined.includes('failed to get document')) {
    return 'Sunucu veya veritabanına şu anda ulaşılamıyor. Lütfen tekrar deneyin.';
  }
  if (combined.includes('deadline-exceeded') || combined.includes('timeout')) {
    return 'İşlem zaman aşımına uğradı. Lütfen bağlantınızı kontrol edip tekrar deneyin.';
  }
  if (combined.includes('already-exists')) {
    return 'Bu kullanıcı adı veya kayıt zaten mevcut.';
  }

  return rawMessage || fallback;
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const clean = username.trim();
  if (clean.length < 3) {
    return { valid: false, error: 'Kullanıcı adı en az 3 karakter olmalıdır.' };
  }
  if (clean.length > 20) {
    return { valid: false, error: 'Kullanıcı adı en fazla 20 karakter olabilir.' };
  }
  const regex = /^[a-zA-Z0-9_]+$/;
  if (!regex.test(clean)) {
    return { valid: false, error: 'Kullanıcı adı sadece harf, rakam ve alt çizgi (_) içerebilir.' };
  }
  return { valid: true };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  if (!db) return false;
  const usernameLower = username.trim().toLowerCase();
  const usernameDocRef = doc(db, 'usernames', usernameLower);
  const snap = await getDoc(usernameDocRef);
  return snap.exists();
}

export async function registerWithEmailAndUsername(params: {
  email: string;
  password: string;
  username: string;
  displayName: string;
}): Promise<UserProfile> {
  if (!auth || !db) {
    throw new Error('Firebase bağlantısı henüz hazır değil. Lütfen Firebase ayarlarını kontrol edin.');
  }

  const { email, password, username, displayName } = params;
  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanDisplayName = displayName.trim() || cleanUsername;

  // 1. Validate username format
  const validation = validateUsername(cleanUsername);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const usernameLower = cleanUsername.toLowerCase();

  // 2. Check Firestore for username uniqueness (Single Source of Truth)
  const usernameDocRef = doc(db, 'usernames', usernameLower);
  const usernameSnap = await getDoc(usernameDocRef);
  if (usernameSnap.exists()) {
    throw new Error(`"@${cleanUsername}" kullanıcı adı zaten başka bir kullanıcı tarafından alınmış.`);
  }

  activeRegistrationsCount += 1;
  let createdAuthUser: User | null = null;

  try {
    // 3. Create user in Firebase Auth
    markFreshLoginPending();
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const authUser = userCredential.user;
    createdAuthUser = authUser;

    // 4. Update Firebase Auth displayName
    await updateProfile(authUser, {
      displayName: cleanDisplayName,
    });

    // 5. Atomic Batch write to Firestore: users/{uid} AND usernames/{usernameLower}
    const batch = writeBatch(db);

    const userDocRef = doc(db, 'users', authUser.uid);
    const newProfileData: any = {
      uid: authUser.uid,
      username: cleanUsername,
      usernameLower,
      email: cleanEmail,
      displayName: cleanDisplayName,
      photoURL: authUser.photoURL || null,
      bio: 'RedChat kullanıcısı',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isOnline: true,
      lastSeen: serverTimestamp(),
    };

    batch.set(userDocRef, newProfileData);
    batch.set(usernameDocRef, {
      uid: authUser.uid,
      username: cleanUsername,
      usernameLower,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    console.log(`✅ [RedChat Auth] Yeni kullanıcı Firestore ve Auth'a kaydedildi. UID: ${authUser.uid}`);

    return {
      ...newProfileData,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSeen: new Date(),
    };
  } catch (err: any) {
    // Auth kullanıcısı oluşturulup Firestore profil kaydı başarısız olursa sahipsiz Auth kaydı bırakma
    if (createdAuthUser) {
      clearLocalSessionCredentials(createdAuthUser.uid);
      try {
        await deleteUser(createdAuthUser);
      } catch (rollbackErr) {
        console.warn('Kısmi Auth kaydı silinemedi, oturum kapatılıyor:', rollbackErr);
        try {
          await signOut(auth);
        } catch {
          // noop
        }
      }
    }
    throw new Error(formatAuthErrorMessage(err, 'Kayıt işlemi tamamlanamadı. Lütfen tekrar deneyin.'));
  } finally {
    activeRegistrationsCount = Math.max(0, activeRegistrationsCount - 1);
  }
}

export async function setUserOnlineStatus(uid: string, isOnline: boolean): Promise<void> {
  if (!db || !uid) return;
  try {
    const userDocRef = doc(db, 'users', uid);
    await updateDoc(userDocRef, {
      isOnline,
      lastSeen: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not update presence status in Firestore:', err);
  }
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  if (!auth || !db) {
    throw new Error('Firebase bağlantısı henüz hazır değil.');
  }

  markFreshLoginPending();
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = userCredential.user;

  // Verify user profile exists & is readable in Firestore before completing login
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const profileSnap = await getDoc(userDocRef);
    if (!profileSnap.exists()) {
      clearLocalSessionCredentials(user.uid);
      await signOut(auth).catch(() => {});
      throw new Error(
        'Hesabınız doğrulandı ancak Firestore kullanıcı profiliniz bulunamadı. Kayıt işlemi tamamlanmamış olabilir; lütfen yeniden kayıt olun veya yöneticiyle iletişime geçin.'
      );
    }

    try {
      await updateDoc(userDocRef, {
        isOnline: true,
        lastSeen: serverTimestamp(),
      });
    } catch (presenceErr) {
      console.warn('Could not update online status during login:', presenceErr);
    }
  } catch (err: any) {
    if (err?.message?.includes('Firestore kullanıcı profiliniz bulunamadı')) {
      throw err;
    }
    clearLocalSessionCredentials(user.uid);
    await signOut(auth).catch(() => {});
    throw new Error(
      formatAuthErrorMessage(err, 'Kullanıcı profili okunamadığı için giriş tamamlanamadı.')
    );
  }

  return user;
}

export async function logoutUser(): Promise<void> {
  if (!auth) return;

  const currentUser = auth.currentUser;
  clearLocalSessionCredentials(currentUser?.uid);
  if (currentUser && db) {
    try {
      const userDocRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        isOnline: false,
        lastSeen: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Could not update offline status during logout:', err);
    }
  }

  await signOut(auth);
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!db) return null;
  const userDocRef = doc(db, 'users', uid);
  const snap = await getDoc(userDocRef);
  if (snap.exists()) {
    return snap.data() as UserProfile;
  }
  return null;
}

export async function updateUserBio(uid: string, bio: string): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  const userDocRef = doc(db, 'users', uid);
  await updateDoc(userDocRef, {
    bio: bio.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserPrivacySettings(
  uid: string,
  settings: {
    allowDirectMessages?: 'everyone' | 'none';
    allowGroupAdditions?: 'everyone' | 'none';
  }
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  const userDocRef = doc(db, 'users', uid);
  await updateDoc(userDocRef, {
    ...settings,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserProfileDetails(
  uid: string,
  data: { displayName?: string; bio?: string; photoURL?: string | null }
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  const userDocRef = doc(db, 'users', uid);
  await updateDoc(userDocRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  if (auth?.currentUser) {
    const authProfileUpdates: { displayName?: string; photoURL?: string | null } = {};
    if (data.displayName !== undefined) authProfileUpdates.displayName = data.displayName;
    if (data.photoURL !== undefined) authProfileUpdates.photoURL = data.photoURL;

    if (Object.keys(authProfileUpdates).length > 0) {
      try {
        await updateProfile(auth.currentUser, authProfileUpdates);
      } catch (authErr) {
        console.warn('Firebase Auth updateProfile uyarısı:', authErr);
      }
    }
  }
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError?: (error: any) => void
): () => void {
  if (!db) {
    callback(null);
    return () => {};
  }

  const userDocRef = doc(db, 'users', uid);
  return onSnapshot(
    userDocRef,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as UserProfile);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error('Error in user profile onSnapshot listener:', err);
      onError?.(err);
    }
  );
}

export function subscribeToAllUsers(
  callback: (users: UserProfile[]) => void
): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const usersCol = collection(db, 'users');
  const q = query(usersCol, limit(100));

  return onSnapshot(
    q,
    (snapshot) => {
      const users: UserProfile[] = [];
      snapshot.forEach((d) => {
        users.push(d.data() as UserProfile);
      });
      callback(users);
    },
    (err) => {
      console.error('Error in all users onSnapshot listener:', err);
    }
  );
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

/**
 * Kullanıcıyı işletme hesabına geçirir ve işletme profil bilgilerini Firestore'a kaydeder.
 */
export async function switchToBusinessAccount(
  uid: string,
  businessData: BusinessProfile,
  photoURL?: string | null
): Promise<void> {
  if (!db || !uid) throw new Error('Firestore bağlantısı hazır değil');

  const userDocRef = doc(db, 'users', uid);
  const cleanBusinessProfile: BusinessProfile = {
    businessName: businessData.businessName?.trim() || '',
    category: businessData.category?.trim() || 'Diğer',
    description: businessData.description?.trim() || '',
    website: businessData.website?.trim() || '',
    email: businessData.email?.trim() || '',
    phone: businessData.phone?.trim() || '',
    location: businessData.location?.trim() || '',
    hours: businessData.hours?.trim() || '',
    photoURL: photoURL !== undefined ? photoURL : businessData.photoURL || null,
    updatedAt: serverTimestamp(),
  };

  const updates: any = {
    accountType: 'business',
    businessProfile: cleanBusinessProfile,
    updatedAt: serverTimestamp(),
  };

  if (businessData.businessName?.trim()) {
    updates.displayName = businessData.businessName.trim();
  }
  if (businessData.description?.trim()) {
    updates.bio = businessData.description.trim();
  }
  if (photoURL !== undefined) {
    updates.photoURL = photoURL;
  }

  await updateDoc(userDocRef, updates);

  if (auth?.currentUser) {
    try {
      const authUpdates: any = {};
      if (updates.displayName) authUpdates.displayName = updates.displayName;
      if (photoURL !== undefined) authUpdates.photoURL = photoURL;
      if (Object.keys(authUpdates).length > 0) {
        await updateProfile(auth.currentUser, authUpdates);
      }
    } catch (err) {
      console.warn('Auth profile sync warning:', err);
    }
  }
}

/**
 * İşletme hesabından normal (bireysel) hesaba dönüş yapar.
 * İşletme bilgileri Firestore'da korunur, sadece hesap türü 'personal' yapılır.
 */
export async function switchToPersonalAccount(uid: string): Promise<void> {
  if (!db || !uid) throw new Error('Firestore bağlantısı hazır değil');

  const userDocRef = doc(db, 'users', uid);
  await updateDoc(userDocRef, {
    accountType: 'personal',
    updatedAt: serverTimestamp(),
  });
}

/**
 * İşletme profil bilgilerini günceller.
 */
export async function updateBusinessProfile(
  uid: string,
  businessData: BusinessProfile,
  photoURL?: string | null
): Promise<void> {
  if (!db || !uid) throw new Error('Firestore bağlantısı hazır değil');

  const userDocRef = doc(db, 'users', uid);
  const cleanBusinessProfile: BusinessProfile = {
    businessName: businessData.businessName?.trim() || '',
    category: businessData.category?.trim() || 'Diğer',
    description: businessData.description?.trim() || '',
    website: businessData.website?.trim() || '',
    email: businessData.email?.trim() || '',
    phone: businessData.phone?.trim() || '',
    location: businessData.location?.trim() || '',
    hours: businessData.hours?.trim() || '',
    photoURL: photoURL !== undefined ? photoURL : businessData.photoURL || null,
    updatedAt: serverTimestamp(),
  };

  const updates: any = {
    businessProfile: cleanBusinessProfile,
    updatedAt: serverTimestamp(),
  };

  if (businessData.businessName?.trim()) {
    updates.displayName = businessData.businessName.trim();
  }
  if (businessData.description !== undefined) {
    updates.bio = businessData.description.trim();
  }
  if (photoURL !== undefined) {
    updates.photoURL = photoURL;
  }

  await updateDoc(userDocRef, updates);

  if (auth?.currentUser) {
    try {
      const authUpdates: any = {};
      if (updates.displayName) authUpdates.displayName = updates.displayName;
      if (photoURL !== undefined) authUpdates.photoURL = photoURL;
      if (Object.keys(authUpdates).length > 0) {
        await updateProfile(auth.currentUser, authUpdates);
      }
    } catch (err) {
      console.warn('Auth profile sync warning:', err);
    }
  }
}

