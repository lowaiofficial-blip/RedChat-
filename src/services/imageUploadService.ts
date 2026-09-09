/**
 * ImgBB Image Upload Service
 * Profil fotoğraflarını güvenli şekilde ImgBB API'ye yükler ve kalıcı CDN URL'sini döndürür.
 */

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

export interface ImgBBUploadResponse {
  data: {
    id: string;
    title: string;
    url_viewer: string;
    url: string;
    display_url: string;
    width: string;
    height: string;
    size: number;
    time: string;
    expiration: string;
    image: {
      filename: string;
      name: string;
      mime: string;
      extension: string;
      url: string;
    };
    thumb: {
      filename: string;
      name: string;
      mime: string;
      extension: string;
      url: string;
    };
    delete_url: string;
  };
  success: boolean;
  status: number;
}

export async function uploadImageToImgBB(file: File): Promise<string> {
  const apiKey = (import.meta.env.VITE_IMGBB_API_KEY as string | undefined)?.trim();

  if (!apiKey) {
    console.error('ImgBB API key eksik. VITE_IMGBB_API_KEY ortam değişkeni tanımlanmalıdır.');
    throw new Error('ImgBB API key eksik.');
  }

  // 1. Dosya Türü Doğrulama
  if (!file.type.startsWith('image/')) {
    throw new Error('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP vb.).');
  }

  // 2. Dosya Boyutu Doğrulama (Max 10 MB)
  const MAX_SIZE_MB = 10;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Görsel boyutu en fazla ${MAX_SIZE_MB}MB olabilir.`);
  }

  // 3. ImgBB API FormData Hazırlama
  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch(`${IMGBB_UPLOAD_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ImgBB API upload failed:', response.status, errorText);
      throw new Error(`Fotoğraf yüklenemedi (Sunucu yanıtı: ${response.status})`);
    }

    const json: ImgBBUploadResponse = await response.json();

    if (!json.success || !json.data?.url) {
      throw new Error('Görsel URL alınamadı');
    }

    // Direct url veya display_url döndür
    return json.data.display_url || json.data.url;
  } catch (error: any) {
    console.error('ImgBB upload error:', error);
    if (error.message?.includes('ImgBB API key eksik')) {
      throw error;
    }
    throw new Error(error?.message || 'Fotoğraf yüklenirken bir hata oluştu.');
  }
}
