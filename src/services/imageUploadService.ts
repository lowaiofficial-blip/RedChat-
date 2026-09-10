/**
 * RedChat Ultra-Reliable Image Upload Service
 * 
 * Görselleri optimize eder ve kesintisiz şekilde yükler.
 * 400 Bad Request, API anahtarı geçersizliği veya ağ engellerine karşı
 * yerel sunucu depolama ve otomatik akıllı sıkıştırma mimarisi içerir.
 */

/**
 * Dosya adını Türkçe ve özel karakterlerden arındırıp güvenli ASCII haline getirir.
 */
function sanitizeFileName(name: string): string {
  const ext = name.split('.').pop() || 'jpg';
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  return `image_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${cleanExt}`;
}

/**
 * Görseli tarayıcıda Canvas ile orantılı olarak yeniden boyutlandırır ve sıkıştırır.
 */
export async function compressImage(
  file: File,
  maxDimension = 1400,
  quality = 0.82
): Promise<{ base64: string; cleanName: string }> {
  const cleanName = sanitizeFileName(file.name);

  // SVG, GIF, PNG ve WEBP gibi saydam formatları bozmamak için direkt base64 al
  if (file.size < 3 * 1024 * 1024 || file.type.includes('svg') || file.type.includes('gif') || file.type.includes('png') || file.type.includes('webp')) {
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
        
        // Boyutlandırma oranı hesapla
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
          // Sadece JPEG için beyaz arka planla çiz (boyutu küçültmek için)
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

/**
 * 👤 Profil Fotoğrafı İçin Özel Optimizasyon ve Yükleme
 * Kare merkezli kırpar, 320x320 piksel yapar ve süper optimize eder (~25-35 KB).
 * Doğrudan kalıcı ve engelsiz Data URL sağlar, arka planda sunucuya da yazar.
 * Bu sayede profil fotoğrafı asla boş kalmaz, hiçbir ağ/CDN sansürüne takılmaz.
 */
export async function uploadProfilePhoto(file: File): Promise<string> {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const targetSize = 320;
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }

          // Arka planı beyaz yap (şeffaf png'ler siyah olmasın)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetSize, targetSize);

          // Kare merkezli kırpma (Center crop)
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

          // Arka planda sunucuya da kaydetmeyi dene (opsiyonel)
          try {
            fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image: optimizedDataUrl,
                name: sanitizeFileName(file.name),
              }),
            }).catch(() => {});
          } catch {
            // Sessizce geç
          }

          // Profil fotoğrafları için doğrudan garantili data URL döndür
          // Firestore'a 25KB olarak anında yazılır, hiçbir CDN kısıtlaması yaşanmaz
          resolve(optimizedDataUrl);
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
}

/**
 * 💬 Genel Görsel Yükleme Fonksiyonu (Sohbet Mesajları, Grup Avatarları, Rozetler)
 * Yerel sunucu (/uploads/...) öncelikli, ardında çok katmanlı güvenli yedekler.
 */
export async function uploadImageToImgBB(file: File): Promise<string> {
  // 1. Dosya Doğrulama
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP vb.).');
  }

  // 2. İstemci Tarafında Akıllı Sıkıştırma (10MB+ fotoğrafları anında optimize eder)
  const { base64: compressedDataUrl, cleanName } = await compressImage(file, 1400, 0.82);
  const rawBase64 = compressedDataUrl.includes(',')
    ? compressedDataUrl.split(',')[1]
    : compressedDataUrl;

  if (!rawBase64) {
    throw new Error('Görsel dosyası okunamadı.');
  }

  // 1. ÖNCELİK: Kendi Yerel Sunucu Depolamamız (/api/upload -> /uploads/...)
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: compressedDataUrl,
        name: cleanName,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.url) {
        return data.url;
      }
    }
  } catch (proxyErr) {
    console.warn('/api/upload yerel sunucu çağrısı başarısız, yedek katman deneniyor...', proxyErr);
  }

  // 2. ÖNCELİK: Optimize Edilmiş Data URL (Garantili Veri Koruma)
  if (compressedDataUrl && compressedDataUrl.startsWith('data:image/')) {
    // Sıkıştırılmış veri 1.8MB altındaysa sorunsuz şekilde çalışır
    if (compressedDataUrl.length < 1.8 * 1024 * 1024) {
      return compressedDataUrl;
    }
  }

  throw new Error('Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
}
