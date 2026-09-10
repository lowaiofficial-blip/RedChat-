const fs = require('fs');

let content = fs.readFileSync('src/services/imageUploadService.ts', 'utf8');

// Add Firebase Storage import at the top
if (!content.includes("import { storage }")) {
  content = "import { storage } from './firebase';\nimport { ref, uploadString, getDownloadURL } from 'firebase/storage';\n" + content;
}

// Replace uploadProfilePhoto
const profileRegex = /export async function uploadProfilePhoto[\s\S]*?resolve\(optimizedDataUrl\);\s*\}\s*catch[^\}]+\}\s*\};\s*img\.onerror[\s\S]*?reader\.readAsDataURL\(file\);\s*\}\);/m;
const newProfile = `export async function uploadProfilePhoto(file: File): Promise<string> {
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

          // 1. ÖNCELİK: Firebase Storage
          if (storage) {
            try {
              const fileRef = ref(storage, \`avatars/\${Date.now()}_\${sanitizeFileName(file.name)}\`);
              await uploadString(fileRef, optimizedDataUrl, 'data_url');
              const url = await getDownloadURL(fileRef);
              resolve(url);
              return;
            } catch (err) {
              console.warn("Firebase Storage upload failed for avatar, falling back to base64.", err);
            }
          }

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
`;

content = content.replace(profileRegex, newProfile);

// Replace uploadImageToImgBB
const uploadRegex = /export async function uploadImageToImgBB[\s\S]*?throw new Error\('Görsel yüklenemedi[^\)]+'\);\s*\}/m;
const newUpload = `export async function uploadImageToImgBB(file: File): Promise<string> {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP vb.).');
  }

  const { base64: compressedDataUrl, cleanName } = await compressImage(file, 1400, 0.82);
  const rawBase64 = compressedDataUrl.includes(',')
    ? compressedDataUrl.split(',')[1]
    : compressedDataUrl;

  if (!rawBase64) {
    throw new Error('Görsel dosyası okunamadı.');
  }

  // 1. ÖNCELİK: Kalıcı Veri İçin Firebase Storage
  if (storage) {
    try {
      const storageRef = ref(storage, \`chat_images/\${Date.now()}_\${cleanName}\`);
      await uploadString(storageRef, compressedDataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (err) {
      console.warn("Firebase Storage upload failed, falling back to base64 inline...", err);
    }
  }

  // 2. ÖNCELİK: Firebase Storage yoksa, doğrudan Base64'e çevirip kaydet (Firestore desteklerse)
  // Eski yerel sunucu depolaması sunucu yeniden başlayınca dosyaları sildiği için Base64 kullanıyoruz.
  if (compressedDataUrl && compressedDataUrl.startsWith('data:image/')) {
    // Sıkıştırılmış veri 1.8MB altındaysa sorunsuz şekilde çalışır
    if (compressedDataUrl.length < 1.8 * 1024 * 1024) {
      return compressedDataUrl;
    } else {
      // Daha agresif sıkıştırma yapmayı dene
      const fallbackUrl = await compressImage(file, 800, 0.6);
      return fallbackUrl.base64;
    }
  }

  throw new Error('Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
}`;

content = content.replace(uploadRegex, newUpload);

fs.writeFileSync('src/services/imageUploadService.ts', content);
