import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
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
import type { UserProfile } from '../types';

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

  // 1. Validate username format
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const usernameLower = username.trim().toLowerCase();

  // 2. Check Firestore for username uniqueness (Single Source of Truth)
  const usernameDocRef = doc(db, 'usernames', usernameLower);
  const usernameSnap = await getDoc(usernameDocRef);
  if (usernameSnap.exists()) {
    throw new Error(`"@${username}" kullanıcı adı zaten başka bir kullanıcı tarafından alınmış.`);
  }

  // 3. Create user in Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const authUser = userCredential.user;

  // 4. Update Firebase Auth displayName
  await updateProfile(authUser, {
    displayName: displayName.trim() || username.trim(),
  });

  // 5. Atomic Batch write to Firestore: users/{uid} AND usernames/{usernameLower}
  const batch = writeBatch(db);

  const userDocRef = doc(db, 'users', authUser.uid);
  const newProfileData: any = {
    uid: authUser.uid,
    username: username.trim(),
    usernameLower,
    email: email.trim().toLowerCase(),
    displayName: (displayName.trim() || username.trim()),
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
    username: username.trim(),
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

  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = userCredential.user;

  // Update online status in Firestore
  try {
    const userDocRef = doc(db, 'users', user.uid);
    await updateDoc(userDocRef, {
      isOnline: true,
      lastSeen: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not update online status during login:', err);
  }

  return user;
}

export async function logoutUser(): Promise<void> {
  if (!auth) return;

  const currentUser = auth.currentUser;
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

  if (auth?.currentUser && data.displayName) {
    await updateProfile(auth.currentUser, {
      displayName: data.displayName,
    });
  }
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void
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
