# Uygulama Planı: RedChat Cloudinary Video Gönderme Sistemi

Bu plan, RedChat uygulamasına 30 saniye süre limitli, Cloudinary imzalı direkt video yükleme, WhatsApp tarzı dairesel yükleme animasyonu ve gelişmiş video oynatıcı lightbox desteğini ekleme adımlarını içerir.

## 1. Mimarisi ve Teknoloji Yaklaşımı

- **Güvenlik (Server-Side Signature)**: API Secret istemci tarafına asla sızdırılmaz. `/api/cloudinary/signature` sunucu rotası `.env` değişkenlerinden (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) güvenli SHA-1 imzası üretir.
- **İstemci Tarafından Direkt Yükleme**: `XMLHttpRequest` kullanılarak Cloudinary CDN'ine doğrudan yükleme yapılır. Bu sayede canlı yükleme yüzdesi (%) anlık olarak hesaplanır ve iptal 'X' butonu ile `xhr.abort()` çağrılır.
- **Süre Kontrolü (Max 30s)**: İstemci tarafında video dosyası seçildiği anda in-memory `HTMLVideoElement` ile süresi ölçülür. 30 saniyeyi aşan videolarda kullanıcıya anında uyarı verilir ve seçim iptal edilir.
- **WhatsApp Tarzı Yükleme Animasyonu**: İlerleme sırasında videonun üzerinde karartılmış thumbnail, ortada kırmızı dairesel SVG ilerleme halkası (%) ve iptal etme 'X' butonu gösterilir.
- **Video Oynatıcı Lightbox**: Gönderilen videolara tıklandığında açılan tam ekran modal; Oynat/Duraklat, Ses/Sessiz, İlerleme Çubuğu (Seek bar), Süre ve Tam Ekran modlarını barındırır.

---

## 2. Yapılacak Değişiklikler ve Dosya Planı

### Sunucu ve Tip Tanımlamaları
1. **`server.ts`**:
   - `/api/cloudinary/signature` POST/GET rotasını ekle. `timestamp`, `folder` ve `upload_preset` parametreleri ile SHA-1 imzası üret.
   - `.env` içerisinde `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` eksikse açıklayıcı 400 hatası döndür.

2. **`src/types/index.ts`**:
   - `ChatMessage` ve `ChannelPost` tiplerine `videoUrl?: string | null` ve `videoDuration?: number | null` alanlarını ekle.

### Servisler ve Bileşenler
3. **`src/services/videoUploadService.ts`**:
   - `getVideoDuration(file: File): Promise<number>`: Video süresini saniye cinsinden döndürür.
   - `uploadVideoToCloudinary(file: File, onProgress: (pct: number) => void): { promise: Promise<CloudinaryUploadResult>, cancel: () => void }`: Sunucudan imza alıp Cloudinary'e XHR ile yükler.

4. **`src/components/VideoSendPreviewModal.tsx`**:
   - Göndermeden önceki önizleme ekranı.
   - Oynatma önizlemesi, açıklama (caption) metin alanı, Gönder ve İptal butonları.

5. **`src/components/VideoLightboxModal.tsx`**:
   - Gönderilmiş videolara tıklanınca açılan gelişmiş medya oynatıcı modalı.

### Sohbet ve Kanal Entegrasyonları
6. **`src/components/ChatMessageItem.tsx`**:
   - Sohbet balonlarında video içeriklerini (Thumbnail, Süre Etiketi e.g. "0:24", Caption) göster.
   - Aktif yükleme durumunda WhatsApp tarzı dairesel yükleme göstergesini ve 'X' iptal butonunu sun.

7. **`src/components/ChatRoom.tsx`**:
   - Galeri butonunda `image/*,video/*` kabul et.
   - Video seçiminde 30 saniye kontrolünü yap.
   - Gönderme önizleme modalını tetikle, XHR ilerlemesini state'e aktar ve Firestore'a `videoUrl` + `videoDuration` ile kaydet.

8. **`src/components/ChannelView.tsx`**:
   - Kanal gönderisi oluştururken video seçimini ve Cloudinary yüklemesini entegre et.
   - Kanal gönderilerinde video ve süre rozetini görüntüle.

---

## 3. Doğrulama ve Test Planı

1. **Sunucu İmza Testi**: `/api/cloudinary/signature` endpoint'inin doğru SHA-1 ürettiğini ve eksik .env durumunda anlamlı hata döndürdüğünü doğrula.
2. **Süre Limiti Testi**: 30 saniyeden uzun bir video dosyası yüklemeyi dene ve uyarı mesajının çıktığını kontrol et.
3. **Canlı Yüzde ve İptal Testi**: Yükleme sırasında dairesel % halkasını ve 'X' butonuna basıldığında XHR'ın iptal edildiğini doğrula.
4. **Mesaj ve Kanal Testi**: Hem DM hem Kanallarda videonun thumbnail, süre rozeti ve açıklama ile birlikte yayınlandığını doğrulama.
5. **Lightbox Oynatıcı Testi**: Oynat/Duraklat, Ses Aç/Kapa, İlerleme Çubuğu ve Tam Ekran kontrollerini test et.
6. **Derleme ve Lint Testi**: `compile_applet` ve `lint_applet` çalıştırarak sıfır hata olduğunu doğrula.
