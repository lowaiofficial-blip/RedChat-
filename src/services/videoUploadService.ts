export interface VideoValidationResult {
  valid: boolean;
  duration: number;
  error?: string;
}

/**
 * Reads video duration in seconds on the client side using HTMLVideoElement.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration || 0);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video dosyası okunamadı veya bozuk format.'));
    };
  });
}

/**
 * Validates that the selected video does not exceed 30 seconds.
 */
export async function validateVideo(file: File): Promise<VideoValidationResult> {
  if (!file.type.startsWith('video/')) {
    return { valid: false, duration: 0, error: 'Lütfen geçerli bir video dosyası seçin.' };
  }

  try {
    const duration = await getVideoDuration(file);
    if (duration > 30.5) {
      return {
        valid: false,
        duration,
        error: `Video süresi 30 saniyeyi aşamaz (Seçilen video: ${Math.round(duration)} saniye).`,
      };
    }
    return { valid: true, duration };
  } catch (err: any) {
    return {
      valid: false,
      duration: 0,
      error: err.message || 'Video dosyası işlenirken hata oluştu.',
    };
  }
}

export interface UploadVideoTask {
  promise: Promise<{ videoUrl: string; duration: number }>;
  abort: () => void;
}

/**
 * Uploads a video file directly to Cloudinary using signed upload parameters from /api/cloudinary/signature.
 * Supports live percentage progress and clean abort/cancel.
 */
export function uploadVideoToCloudinary(
  file: File,
  duration: number,
  onProgress?: (pct: number) => void
): UploadVideoTask {
  let xhr: XMLHttpRequest | null = null;
  let isAborted = false;

  const promise = new Promise<{ videoUrl: string; duration: number }>(async (resolve, reject) => {
    try {
      // 1. Fetch Cloudinary signature from server endpoint
      const sigRes = await fetch('/api/cloudinary/signature');
      if (!sigRes.ok) {
        const errJson = await sigRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Cloudinary imza servisine ulaşılamadı.');
      }

      const { signature, timestamp, cloudName, apiKey, folder } = await sigRes.json();

      if (!cloudName || !apiKey || !signature) {
        throw new Error('Cloudinary API ayarları sunucuda eksik.');
      }

      if (isAborted) {
        throw new Error('Yükleme iptal edildi.');
      }

      // 2. Prepare FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', apiKey);
      formData.append('timestamp', String(timestamp));
      formData.append('folder', folder || 'redchat_videos');
      formData.append('signature', signature);

      // 3. XHR for upload tracking and cancel support
      xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`);

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && !isAborted) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (isAborted) {
          reject(new Error('Yükleme iptal edildi.'));
          return;
        }

        if (xhr!.status >= 200 && xhr!.status < 300) {
          try {
            const response = JSON.parse(xhr!.responseText);
            if (response.secure_url) {
              resolve({
                videoUrl: response.secure_url,
                duration,
              });
            } else {
              reject(new Error('Cloudinary yanıtında video URL bulunamadı.'));
            }
          } catch {
            reject(new Error('Cloudinary yanıtı işlenemedi.'));
          }
        } else {
          try {
            const errResp = JSON.parse(xhr!.responseText);
            reject(new Error(errResp.error?.message || 'Video yükleme başarısız oldu.'));
          } catch {
            reject(new Error(`Video yükleme hatası (HTTP ${xhr!.status}).`));
          }
        }
      };

      xhr.onerror = () => {
        if (!isAborted) {
          reject(new Error('Ağ hatası: Video Cloudinary sunucusuna yüklenemedi.'));
        }
      };

      xhr.onabort = () => {
        reject(new Error('Yükleme iptal edildi.'));
      };

      xhr.send(formData);
    } catch (err: any) {
      reject(err);
    }
  });

  const abort = () => {
    isAborted = true;
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
    }
  };

  return { promise, abort };
}

/**
 * Format duration in seconds into M:SS string (e.g. 24 -> "0:24", 75 -> "1:15")
 */
export function formatVideoDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
