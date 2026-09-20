import { db } from './firebase';
import {
  collection,
  onSnapshot,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { BannedDevice } from '../types';

let cachedClientIp: string | null = null;
let cachedHardwareId: string | null = null;
let cachedFingerprint: string | null = null;

/**
 * Cihaz tipini tespit eder: 'desktop' (Bilgisayar) | 'tablet' | 'mobile' (Telefon)
 */
export function getDeviceType(): 'desktop' | 'tablet' | 'mobile' {
  if (typeof window === 'undefined') return 'desktop';

  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTabletUa = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua);

  // iPad on iOS 13+ reports as MacIntel with touch points
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  if (isTabletUa || isIPadOS) {
    return 'tablet';
  }

  if (isMobileUa) {
    return 'mobile';
  }

  // Dokunmatik ve ekran genişliği analizi
  if (window.innerWidth <= 640) {
    return 'mobile';
  } else if (window.innerWidth <= 1024 && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    return 'tablet';
  }

  return 'desktop';
}

/**
 * Cihaz tipi için kullanıcı dostu Türkçe başlık ve simge döndürür
 */
export function getDeviceTypeInfo(type?: string): { label: string; icon: string } {
  switch (type) {
    case 'mobile':
      return { label: 'Akıllı Telefon (Mobil)', icon: '📱' };
    case 'tablet':
      return { label: 'Tablet', icon: '📱' };
    case 'desktop':
      return { label: 'Masaüstü / Dizüstü Bilgisayar (PC)', icon: '💻' };
    default:
      return { label: 'Bilinmeyen Cihaz', icon: '🌐' };
  }
}

/**
 * Donanım düzeyinde benzersiz canvas ve WebGL parmak izi üretir
 */
export function getHardwareFingerprint(): string {
  if (cachedFingerprint) return cachedFingerprint;
  if (typeof window === 'undefined') return 'HW-NODE-ENV';

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');

    let canvasHash = 'no-canvas';
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial', 'Segoe UI', sans-serif";
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('RedChat-Sec-HWID-2026', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('RedChat-Sec-HWID-2026', 4, 17);
      canvasHash = canvas.toDataURL().slice(-40);
    }

    // WebGL GPU ve Render bilgisi
    let gpuInfo = 'no-gpu';
    try {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const vendor = (gl as any).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          const renderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          gpuInfo = `${vendor}~${renderer}`;
        }
      }
    } catch {
      // sessizce geç
    }

    const screenInfo = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth || 24}`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as any).deviceMemory || 8;
    const lang = navigator.language || 'tr';

    const rawString = `${screenInfo}|${tz}|${cores}|${mem}|${lang}|${gpuInfo}|${canvasHash}`;
    
    // Hızlı hash fonksiyonu (FNV-1a benzeri 32-bit hex)
    let hash1 = 0x811c9dc5;
    let hash2 = 0x55555555;
    for (let i = 0; i < rawString.length; i++) {
      const ch = rawString.charCodeAt(i);
      hash1 ^= ch;
      hash1 = Math.imul(hash1, 0x01000193);
      hash2 = (hash2 << 5) - hash2 + ch;
      hash2 |= 0;
    }

    const hex1 = (hash1 >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const hex2 = (hash2 >>> 0).toString(16).toUpperCase().padStart(8, '0');
    
    cachedFingerprint = `FP-${hex1}-${hex2}`;
    return cachedFingerprint;
  } catch (err) {
    cachedFingerprint = 'FP-FALLBACK-001';
    return cachedFingerprint;
  }
}

/**
 * Cihaz için kalıcı ve silinmeye dayanıklı Donanım / Hardware ID (HWID) üretir veya getirir
 */
export function getHardwareDeviceId(): string {
  if (cachedHardwareId) return cachedHardwareId;
  if (typeof window === 'undefined') return 'HWID-SERVER';

  const STORAGE_KEY = 'redchat_hardware_id';
  let stored = '';

  try {
    stored = localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    // localStorage erişim hatası
  }

  if (!stored) {
    try {
      stored = sessionStorage.getItem(STORAGE_KEY) || '';
    } catch {
      // sessionStorage hatası
    }
  }

  // Cookie kontrolü
  if (!stored && typeof document !== 'undefined') {
    const match = document.cookie.match(new RegExp('(^| )' + STORAGE_KEY + '=([^;]+)'));
    if (match) stored = match[2];
  }

  if (!stored) {
    const fp = getHardwareFingerprint();
    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
    const timeHex = Date.now().toString(36).toUpperCase().slice(-4);
    stored = `HWID-${fp.replace('FP-', '')}-${timeHex}-${randomHex}`;

    try {
      localStorage.setItem(STORAGE_KEY, stored);
      sessionStorage.setItem(STORAGE_KEY, stored);
      document.cookie = `${STORAGE_KEY}=${stored}; path=/; max-age=315360000; SameSite=Lax`;
    } catch {
      // sessizce geç
    }
  }

  cachedHardwareId = stored;
  return stored;
}

/**
 * İstemcinin güncel dış/ağ IP adresini getirir
 */
export async function getClientIp(): Promise<string> {
  if (cachedClientIp) return cachedClientIp;

  // 1. Kendi sunucumuzdan öğrenmeyi dene
  try {
    const res = await fetch('/api/client-info', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      if (data?.ip && data.ip !== '127.0.0.1' && !data.ip.startsWith('10.') && !data.ip.startsWith('172.')) {
        cachedClientIp = data.ip;
        return data.ip;
      }
      if (data?.ip) {
        cachedClientIp = data.ip;
      }
    }
  } catch (err) {
    // API isteği başarısız oldu
  }

  // 2. Eğer sunucu local ya da proxy arkasındaysa genel IP servisini yedek olarak sorgula
  try {
    const ipifyRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2000) });
    if (ipifyRes.ok) {
      const ipData = await ipifyRes.json();
      if (ipData?.ip) {
        cachedClientIp = ipData.ip;
        return ipData.ip;
      }
    }
  } catch {
    // Harici IP servisi engellenmiş olabilir
  }

  return cachedClientIp || '127.0.0.1';
}

/**
 * Kullanıcı oturum açtığında veya sayfaya girdiğinde cihaz bilgilerini Firestore'a senkronize eder
 */
export async function syncCurrentDeviceInfo(uid?: string): Promise<{
  ip: string;
  deviceId: string;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  fingerprint: string;
}> {
  const deviceId = getHardwareDeviceId();
  const deviceType = getDeviceType();
  const fingerprint = getHardwareFingerprint();
  const ip = await getClientIp();

  if (uid && db) {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        lastIp: ip,
        lastDeviceId: deviceId,
        deviceType,
        lastUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Cihaz bilgileri kullanıcı profiline işlenemedi:', err);
    }
  }

  return { ip, deviceId, deviceType, fingerprint };
}

/**
 * Bu cihazın veya IP'nin banlanıp banlanmadığını gerçek zamanlı (onSnapshot) olarak dinler.
 * Admin ban attığında anında ban ekranı gelir; admin banı kaldırdığında anında kalkar!
 */
export function subscribeToDeviceBanStatus(
  callback: (
    banInfo: BannedDevice | null,
    ip: string | null,
    deviceId: string,
    deviceType: 'desktop' | 'tablet' | 'mobile' | 'unknown'
  ) => void
): () => void {
  if (!db) {
    callback(null, null, getHardwareDeviceId(), getDeviceType());
    return () => {};
  }

  const myDeviceId = getHardwareDeviceId();
  const myFingerprint = getHardwareFingerprint();
  const myDeviceType = getDeviceType();
  const bannedCol = collection(db, 'banned_devices');

  // Son bilinen ban işaretçisi (localStorage'da saklanır)
  const BAN_MARKER_KEY = 'redchat_active_hw_ban_id';
  let markedBanId: string | null = null;
  try {
    markedBanId = localStorage.getItem(BAN_MARKER_KEY);
  } catch {}

  const unsubscribe = onSnapshot(
    bannedCol,
    async (snapshot) => {
      const currentIp = await getClientIp();
      const allBans = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as BannedDevice));
      const activeBans = allBans.filter((b) => b.isActive !== false);

      // Eşleşen bir IP veya Donanım Banı var mı?
      const matchingBan = activeBans.find((b) => {
        // 1. Doğrudan Device ID (HWID) eşleşmesi
        if (b.deviceId && (b.deviceId === myDeviceId || myDeviceId.includes(b.deviceId))) {
          return true;
        }
        // 2. Parmak izi eşleşmesi
        if (b.hardwareFingerprint && b.hardwareFingerprint === myFingerprint) {
          return true;
        }
        // 3. IP Adresi eşleşmesi (IP boş değilse ve geçerliyse)
        if (b.ip && currentIp && b.ip.trim() === currentIp.trim() && b.ip !== '127.0.0.1') {
          return true;
        }
        // 4. Bu cihaz daha önce bu ban ID'si ile işaretlenmişse ve ban hala aktifse
        if (markedBanId && b.id === markedBanId) {
          return true;
        }
        return false;
      });

      if (matchingBan) {
        // Ban tespit edildi, cihazı işaretle
        try {
          localStorage.setItem(BAN_MARKER_KEY, matchingBan.id);
          markedBanId = matchingBan.id;
        } catch {}
        callback(matchingBan, currentIp, myDeviceId, myDeviceType);
      } else {
        // Aktif ban bulunamadı veya Admin tarafından kaldırıldı!
        // Eğer daha önce işaretlenmişse temizle
        if (markedBanId) {
          try {
            localStorage.removeItem(BAN_MARKER_KEY);
            markedBanId = null;
          } catch {}
        }
        callback(null, currentIp, myDeviceId, myDeviceType);
      }
    },
    (err) => {
      console.warn('banned_devices dinleme hatası:', err);
    }
  );

  return unsubscribe;
}

/**
 * Anlık olarak ban durumunu tek seferlik kontrol eder
 */
export async function checkDeviceBanNow(): Promise<BannedDevice | null> {
  if (!db) return null;

  try {
    const myDeviceId = getHardwareDeviceId();
    const myFingerprint = getHardwareFingerprint();
    const currentIp = await getClientIp();

    const bannedCol = collection(db, 'banned_devices');
    const snap = await getDocs(bannedCol);
    const activeBans = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as BannedDevice))
      .filter((b) => b.isActive !== false);

    const match = activeBans.find((b) => {
      if (b.deviceId && (b.deviceId === myDeviceId || myDeviceId.includes(b.deviceId))) return true;
      if (b.hardwareFingerprint && b.hardwareFingerprint === myFingerprint) return true;
      if (b.ip && currentIp && b.ip.trim() === currentIp.trim() && b.ip !== '127.0.0.1') return true;
      return false;
    });

    return match || null;
  } catch (err) {
    console.error('checkDeviceBanNow hatası:', err);
    return null;
  }
}
