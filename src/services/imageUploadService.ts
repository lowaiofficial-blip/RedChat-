export const IMGBB_TIMEOUT_MS = 15_000;
export const FALLBACK_UPLOAD_TIMEOUT_MS = 15_000;
export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const RECENT_UPLOAD_CACHE_TTL_MS = 10 * 60 * 1000; // 10 dakika
const RECENT_UPLOAD_CACHE_MAX_ENTRIES = 50;

export const GENERIC_IMAGE_UPLOAD_ERROR =
  'Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.';

export interface UploadTransportDeps {
  imgbbApiKey?: string;
  fetchFn?: typeof fetch;
  imgbbTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  fallbackEndpoint?: string;
}

const inFlightUploads = new Map<string, Promise<string>>();
const recentUploadCache = new Map<string, { url: string; expiresAt: number }>();

export function clearImageUploadDeduplicationCache(): void {
  inFlightUploads.clear();
  recentUploadCache.clear();
}

export function isValidHostedImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validateImageFile(file: File, invalidTypeMessage: string): void {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error(invalidTypeMessage);
  }
  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    throw new Error('Görsel boyutu en fazla 10MB olabilir.');
  }
}

function sanitizeFileName(name: string): string {
  const ext = name.split('.').pop() || 'jpg';
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  return `image_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${cleanExt}`;
}

function extractRawBase64(dataUrlOrBase64: string): string {
  const trimmed = (dataUrlOrBase64 || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    return (trimmed.split(',')[1] || '').trim();
  }
  return trimmed;
}

function computeContentFingerprint(variant: 'avatar' | 'image' | 'badge', rawBase64: string): string {
  // Hızlı, deterministik 64-bit benzeri çift FNV-1a özeti (birebir aynı görsel verisini ayırt etmek için)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  const len = rawBase64.length;
  for (let i = 0; i < len; i++) {
    const code = rawBase64.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${variant}:${len}:${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

function getCachedUploadedUrl(fingerprint: string): string | null {
  const cached = recentUploadCache.get(fingerprint);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    recentUploadCache.delete(fingerprint);
    return null;
  }
  return cached.url;
}

function setCachedUploadedUrl(fingerprint: string, url: string): void {
  const now = Date.now();
  for (const [key, entry] of recentUploadCache.entries()) {
    if (now > entry.expiresAt) {
      recentUploadCache.delete(key);
    }
  }
  if (recentUploadCache.size >= RECENT_UPLOAD_CACHE_MAX_ENTRIES) {
    const oldestKey = recentUploadCache.keys().next().value;
    if (oldestKey) {
      recentUploadCache.delete(oldestKey);
    }
  }
  recentUploadCache.set(fingerprint, {
    url,
    expiresAt: now + RECENT_UPLOAD_CACHE_TTL_MS,
  });
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tryUploadToImgbb(
  rawBase64: string,
  fileName: string,
  imgbbApiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | null> {
  if (!imgbbApiKey || !rawBase64) return null;

  try {
    const formData = new FormData();
    formData.append('image', rawBase64);
    formData.append('name', fileName);

    const response = await fetchWithTimeout(
      fetchImpl,
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbApiKey)}`,
      {
        method: 'POST',
        body: formData,
      },
      timeoutMs
    );

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    if (data?.success === false) {
      return null;
    }

    const candidateUrl = [data?.data?.url, data?.data?.display_url].find((url) =>
      isValidHostedImageUrl(url)
    );

    return candidateUrl ? candidateUrl.trim() : null;
  } catch {
    return null;
  }
}

async function tryUploadToFreeimageFallback(
  rawBase64: string,
  fileName: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  endpoint: string
): Promise<string | null> {
  if (!rawBase64) return null;

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: rawBase64,
          name: fileName,
        }),
      },
      timeoutMs
    );

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    if (!isValidHostedImageUrl(data?.url)) {
      return null;
    }

    return data.url.trim();
  } catch {
    return null;
  }
}

function getDefaultImgbbApiKey(): string {
  try {
    return ((import.meta as any)?.env?.VITE_IMGBB_API_KEY || '').trim();
  } catch {
    return '';
  }
}

export async function uploadRawBase64WithFallback(
  params: {
    rawBase64: string;
    fileName: string;
    variant: 'avatar' | 'image' | 'badge';
  },
  deps?: UploadTransportDeps
): Promise<string> {
  const cleanRawBase64 = extractRawBase64(params.rawBase64);
  if (!cleanRawBase64) {
    throw new Error('Görsel dosyası okunamadı.');
  }

  const fingerprint = computeContentFingerprint(params.variant, cleanRawBase64);

  const cachedUrl = getCachedUploadedUrl(fingerprint);
  if (cachedUrl) {
    return cachedUrl;
  }

  const existingInFlight = inFlightUploads.get(fingerprint);
  if (existingInFlight) {
    return existingInFlight;
  }

  const fetchImpl = deps?.fetchFn ?? fetch;
  const imgbbApiKey = (deps?.imgbbApiKey ?? getDefaultImgbbApiKey()).trim();
  const imgbbTimeoutMs = deps?.imgbbTimeoutMs ?? IMGBB_TIMEOUT_MS;
  const fallbackTimeoutMs = deps?.fallbackTimeoutMs ?? FALLBACK_UPLOAD_TIMEOUT_MS;
  const fallbackEndpoint = deps?.fallbackEndpoint ?? '/api/upload/freeimage';

  const uploadPromise = (async (): Promise<string> => {
    // 1. Ana sağlayıcı: ImgBB (maksimum 15 saniye zaman aşımı)
    if (imgbbApiKey) {
      const primaryUrl = await tryUploadToImgbb(
        cleanRawBase64,
        params.fileName,
        imgbbApiKey,
        fetchImpl,
        imgbbTimeoutMs
      );
      if (primaryUrl) {
        setCachedUploadedUrl(fingerprint, primaryUrl);
        return primaryUrl;
      }
    }

    // 2. Yedek sağlayıcı: Freeimage.host (güvenli sunucu proxy'si üzerinden)
    const fallbackUrl = await tryUploadToFreeimageFallback(
      cleanRawBase64,
      params.fileName,
      fetchImpl,
      fallbackTimeoutMs,
      fallbackEndpoint
    );
    if (fallbackUrl) {
      setCachedUploadedUrl(fingerprint, fallbackUrl);
      return fallbackUrl;
    }

    // 3. Her iki sağlayıcı da başarısız olduğunda kullanıcı dostu hata
    throw new Error(GENERIC_IMAGE_UPLOAD_ERROR);
  })();

  inFlightUploads.set(fingerprint, uploadPromise);

  try {
    return await uploadPromise;
  } finally {
    if (inFlightUploads.get(fingerprint) === uploadPromise) {
      inFlightUploads.delete(fingerprint);
    }
  }
}

export async function compressImage(
  file: File,
  maxDimension = 1400,
  quality = 0.82
): Promise<{ base64: string; cleanName: string }> {
  const cleanName = sanitizeFileName(file.name);

  // SVG, GIF, PNG ve WEBP gibi saydam formatları bozmamak için direkt base64 al
  if (
    file.size < 3 * 1024 * 1024 ||
    file.type.includes('svg') ||
    file.type.includes('gif') ||
    file.type.includes('png') ||
    file.type.includes('webp')
  ) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result as string, cleanName });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve({ base64: canvas.toDataURL('image/jpeg', quality), cleanName });
        } else {
          resolve({ base64: (e.target?.result as string) || '', cleanName });
        }
      };
      img.onerror = () => resolve({ base64: (e.target?.result as string) || '', cleanName });
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = () => resolve({ base64: '', cleanName });
    reader.readAsDataURL(file);
  });
}

export async function uploadProfilePhoto(file: File): Promise<string> {
  validateImageFile(file, 'Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');

  const optimized = await new Promise<{ rawBase64: string; cleanName: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const targetSize = 320;
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');
          const cleanName = sanitizeFileName(file.name);

          if (!ctx) {
            const rawFallback = extractRawBase64((e.target?.result as string) || '');
            resolve({ rawBase64: rawFallback, cleanName });
            return;
          }

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetSize, targetSize);

          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const rawBase64 = extractRawBase64(optimizedDataUrl);
          resolve({ rawBase64, cleanName });
        } catch (canvasErr) {
          reject(canvasErr);
        }
      };
      img.onerror = () => reject(new Error('Görsel açılamadı.'));
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });

  return uploadRawBase64WithFallback({
    rawBase64: optimized.rawBase64,
    fileName: `avatar_${optimized.cleanName}`,
    variant: 'avatar',
  });
}

export async function uploadImageToImgBB(file: File): Promise<string> {
  validateImageFile(file, 'Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP vb.).');

  const { base64: compressedDataUrl, cleanName } = await compressImage(file, 1400, 0.82);
  const rawBase64 = extractRawBase64(compressedDataUrl);

  if (!rawBase64) {
    throw new Error('Görsel dosyası okunamadı.');
  }

  return uploadRawBase64WithFallback({
    rawBase64,
    fileName: cleanName,
    variant: 'image',
  });
}

/**
 * 🌟 Mavi Tik Rozet PNG görselini saydamlığı koruyarak optimize eder ve yükler.
 * Maksimum 128x128 piksel boyutuna getirir, saydam arka planı (alpha) korur.
 */
export async function uploadBadgeImage(file: File): Promise<string> {
  validateImageFile(file, 'Lütfen geçerli bir PNG veya görsel dosyası seçin.');

  const optimized = await new Promise<{ rawBase64: string; cleanName: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 128;
          let { width, height } = img;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const cleanName = sanitizeFileName(file.name.replace(/\.[^/.]+$/, '') + '.png');

          if (!ctx) {
            const rawFallback = extractRawBase64((e.target?.result as string) || '');
            resolve({ rawBase64: rawFallback, cleanName });
            return;
          }

          // Saydamlığı korumak için arka planı boyama!
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          // Saydam PNG formatında dışa aktar
          const pngDataUrl = canvas.toDataURL('image/png');
          const rawBase64 = extractRawBase64(pngDataUrl);
          resolve({ rawBase64, cleanName });
        } catch (canvasErr) {
          reject(canvasErr);
        }
      };
      img.onerror = () => reject(new Error('Rozet görseli işlenemedi.'));
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });

  return uploadRawBase64WithFallback({
    rawBase64: optimized.rawBase64,
    fileName: `badge_${optimized.cleanName}`,
    variant: 'badge',
  });
}
