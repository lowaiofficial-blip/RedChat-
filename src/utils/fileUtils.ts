/**
 * Metin dosyalarını tarayıcıda doğrudan indirmek ve uzun metinleri parçalara bölmek için yardımcı araçlar.
 */

export function downloadTextFile(filename: string, text: string) {
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function splitTextIntoChunks(text: string, chunkSize: number = 1500): string[] {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }

    // Paragraf veya yeni satırdan bölmeye çalış
    let cutIndex = remaining.lastIndexOf('\n', chunkSize);
    if (cutIndex < chunkSize * 0.5) {
      // Bulunamazsa boşluktan böl
      cutIndex = remaining.lastIndexOf(' ', chunkSize);
    }
    if (cutIndex < chunkSize * 0.5) {
      // Bulunamazsa doğrudan sınırdan kes
      cutIndex = chunkSize;
    }

    chunks.push(remaining.substring(0, cutIndex));
    remaining = remaining.substring(cutIndex).trimStart();
  }

  return chunks;
}
