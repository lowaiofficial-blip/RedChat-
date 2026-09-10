const fs = require('fs');
let content = fs.readFileSync('src/services/imageUploadService.ts', 'utf8');

const newCompressImage = `export async function compressImage(
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
}`;

content = content.replace(/export async function compressImage[\s\S]*?return new Promise\(\(resolve\) => \{[\s\S]*?reader\.readAsDataURL\(file\);\s*\}\);\s*\}/, newCompressImage);

fs.writeFileSync('src/services/imageUploadService.ts', content);
