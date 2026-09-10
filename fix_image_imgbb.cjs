const fs = require('fs');
let content = fs.readFileSync('src/services/imageUploadService.ts', 'utf8');

const uploadImageRegex = /export async function uploadImageToImgBB[\s\S]*?throw new Error\('Görsel yüklenemedi[^\)]+'\);\s*\}/m;
const newUploadImage = `export async function uploadImageToImgBB(file: File): Promise<string> {
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

  // 1. ÖNCELİK: ImgBB (Limitsiz ve hızlı harici depolama)
  const imgbbApiKey = import.meta.env.VITE_IMGBB_API_KEY;
  if (imgbbApiKey) {
    try {
      const formData = new FormData();
      formData.append('image', rawBase64);
      formData.append('name', cleanName);

      const response = await fetch(\`https://api.imgbb.com/1/upload?key=\${imgbbApiKey}\`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.data && data.data.url) {
          return data.data.url;
        }
      } else {
        console.warn("ImgBB yüklemesi başarısız oldu, diğer yöntemlere geçiliyor...");
      }
    } catch (err) {
      console.warn("ImgBB API çağrısı sırasında hata oluştu, Firebase'e geçiliyor:", err);
    }
  } else {
    console.warn("ImgBB API anahtarı bulunamadı (VITE_IMGBB_API_KEY). Firebase'e geçiliyor.");
  }

  // 2. ÖNCELİK: Firebase Storage (Kalıcı bulut depolaması)
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

  // 3. ÖNCELİK: Base64 (Son çare olarak doğrudan mesaja gömme)
  if (compressedDataUrl && compressedDataUrl.startsWith('data:image/')) {
    if (compressedDataUrl.length < 1.8 * 1024 * 1024) {
      return compressedDataUrl;
    } else {
      const fallbackUrl = await compressImage(file, 800, 0.6);
      return fallbackUrl.base64;
    }
  }

  throw new Error('Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
}`;

content = content.replace(uploadImageRegex, newUploadImage);


const uploadProfileRegex = /export async function uploadProfilePhoto[\s\S]*?reader\.readAsDataURL\(file\);\s*\}\);/m;
const newUploadProfile = `export async function uploadProfilePhoto(file: File): Promise<string> {
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

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetSize, targetSize);

          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
          
          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const rawBase64 = optimizedDataUrl.split(',')[1];
          const cleanName = sanitizeFileName(file.name);

          // 1. ÖNCELİK: ImgBB
          const imgbbApiKey = import.meta.env.VITE_IMGBB_API_KEY;
          if (imgbbApiKey && rawBase64) {
            try {
              const formData = new FormData();
              formData.append('image', rawBase64);
              formData.append('name', \`avatar_\${cleanName}\`);

              const response = await fetch(\`https://api.imgbb.com/1/upload?key=\${imgbbApiKey}\`, {
                method: 'POST',
                body: formData,
              });

              if (response.ok) {
                const data = await response.json();
                if (data?.data?.url) {
                  resolve(data.data.url);
                  return;
                }
              }
            } catch (err) {
              console.warn("ImgBB upload failed for avatar, falling back...", err);
            }
          }

          // 2. ÖNCELİK: Firebase Storage
          if (storage) {
            try {
              const fileRef = ref(storage, \`avatars/\${Date.now()}_\${cleanName}\`);
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
}`;

content = content.replace(uploadProfileRegex, newUploadProfile);

fs.writeFileSync('src/services/imageUploadService.ts', content);
