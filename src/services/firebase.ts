import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/**
 * REDCHAT FIREBASE YAPILANDIRMASI (DOĞRUDAN KOD İÇİNDE)
 * Firebase Console'dan (Proje Ayarları -> Web Uygulaması) aldığınız değerleri buraya yazabilirsiniz.
 */
export const FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: "AIzaSyBYhgYrEdHagHmyj2R7QgywccHyYEBdX8I",
  authDomain: "redchat-7c1db.firebaseapp.com",
  projectId: "redchat-7c1db",
  storageBucket: "redchat-7c1db.firebasestorage.app",
  messagingSenderId: "544653180299",
  appId: "1:544653180299:web:b279e851cbe1a384b0c38e",
};

const STORAGE_KEY = 'redchat_firebase_config';

function getStoredCustomConfig(): Partial<FirebaseOptions> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to parse stored Firebase config', err);
  }
  return null;
}

export function getEffectiveFirebaseConfig(): FirebaseOptions {
  const custom = getStoredCustomConfig();
  // Öncelik: Custom (UI'dan girilen) > FIREBASE_CONFIG (koddaki) > Fallback
  return {
    apiKey: custom?.apiKey || FIREBASE_CONFIG.apiKey || '',
    authDomain: custom?.authDomain || FIREBASE_CONFIG.authDomain || '',
    projectId: custom?.projectId || FIREBASE_CONFIG.projectId || '',
    storageBucket: custom?.storageBucket || FIREBASE_CONFIG.storageBucket || '',
    messagingSenderId: custom?.messagingSenderId || FIREBASE_CONFIG.messagingSenderId || '',
    appId: custom?.appId || FIREBASE_CONFIG.appId || '',
  };
}

export function isFirebaseConfigured(): boolean {
  const config = getEffectiveFirebaseConfig();
  return Boolean(config.apiKey && config.projectId);
}

export function saveCustomFirebaseConfig(config: FirebaseOptions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.location.reload();
}

export function clearCustomFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

try {
  const config = getEffectiveFirebaseConfig();
  if (config.apiKey && config.projectId) {
    if (!getApps().length) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  }
} catch (error) {
  console.error('Firebase initialization error:', error);
}

export { app, auth, db, storage };

