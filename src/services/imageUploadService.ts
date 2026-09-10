import { storage } from './firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

function sanitizeFileName(name: string): string {
  const ext = name.split('.').pop() || 'jpg';
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  return `image_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${cleanExt}`;
}

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

          const imgbbApiKey = import.meta.env.VITE_IMGBB_API_KEY;
          if (imgbbApiKey && rawBase64) {
            try {
              const formData = new FormData();
              formData.append('image', rawBase64);
              formData.append('name', `avatar_${cleanName}`);

              const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
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

          if (storage) {
            try {
              const fileRef = ref(storage, `avatars/${Date.now()}_${cleanName}`);
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
}

export async function uploadImageToImgBB(file: File): Promise<string> {
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

  const imgbbApiKey = import.meta.env.VITE_IMGBB_API_KEY;
  if (imgbbApiKey) {
    try {
      const formData = new FormData();
      formData.append('image', rawBase64);
      formData.append('name', cleanName);

      const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.data?.url) {
          return data.data.url;
        }
      }
    } catch (err) {
      console.warn("ImgBB API çağrısı sırasında hata:", err);
    }
  }

  if (storage) {
    try {
      const storageRef = ref(storage, `chat_images/${Date.now()}_${cleanName}`);
      await uploadString(storageRef, compressedDataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (err) {
      console.warn("Firebase Storage upload failed, falling back to base64 inline...", err);
    }
  }

  if (compressedDataUrl && compressedDataUrl.startsWith('data:image/')) {
    if (compressedDataUrl.length < 1.8 * 1024 * 1024) {
      return compressedDataUrl;
    } else {
      const fallbackUrl = await compressImage(file, 800, 0.6);
      return fallbackUrl.base64;
    }
  }

  throw new Error('Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
}
