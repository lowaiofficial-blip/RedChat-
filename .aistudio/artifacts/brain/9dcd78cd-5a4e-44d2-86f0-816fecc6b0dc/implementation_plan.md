# RedChat — DeepRed AI FLUX.2-dev Görsel Üretme ve Çizim Animasyonu Sistemi

DeepRed AI için Hugging Face Inference API üzerinden `black-forest-labs/FLUX.2-dev` modeliyle gerçek görsel üretme yeteneği ekleyen, kullanıcının sağladığı özel SVG çizim animasyonunu yükleme aşamasında çalıştıran, üretilen görselleri Cloudinary CDN'de kalıcı olarak saklayan ve kullanıcı başına günlük 3 hak kotasını sunucu tarafında güvenle denetleyen kapsamlı sistem planı.

### User Review & Critical Decisions

> [!IMPORTANT]
> Kullanıcı ile yapılan ön görüşmede onaylanan kararlar:
> 1. **Çizim Animasyonu**: Kullanıcının paylaştığı `strokeDasharray` / `strokeDashoffset` tabanlı `startLoading()` ve `showImage(src)` mimarisi korunarak RedChat'e özel modern bir SVG çizim bileşenine uyarlanacaktır.
> 2. **Kota Yenilenme Zamanı**: Kullanıcıların 3 görsel hakkı **her gece yarısı saat 00:00'da** otomatik olarak yenilenecektir.
> 3. **Görsel Depolama**: Üretilen FLUX görselleri sunucu tarafında anında **Cloudinary CDN**'e (`redchat_ai_images` klasörü) yüklenip kalıcı ve optimize edilmiş HTTPS bağlantısı olarak kaydedilecektir.

---

### 1. Overview & Core Concept

- **Ne Yapıyor**: RedChat kullanıcıları DeepRed AI sohbetinde "Bir kedi çiz", "Uzayda uçan kırmızı bir ejderha görseli oluştur" gibi Türkçe veya İngilizce promptlar girdiğinde, sistem isteği algılar, sohbet balonunda özel SVG çizim animasyonunu başlatır, arka planda Hugging Face `FLUX.2-dev` modelinden gerçek görseli üretip Cloudinary'ye yükler ve animasyonu bitirip görseli aynı çerçevede gösterir.
- **Hedef Kitle**: RedChat kullanıcıları ve topluluk üyeleri.
- **Temel Değer**: Harici bir platforma geçmeden, doğrudan RedChat mesajlaşma arayüzü içinde yüksek kaliteli yapay zekâ görselleri üretme ve paylaşma imkânı.

---

### 2. User Experience & Visual Design

- **Görsel İstek Akışı**:
  1. Kullanıcı sohbete "Uzayda uçan kırmızı ejderha çiz" yazar.
  2. Sistem görsel isteğini tespit eder (`prompt` ayrıştırılır).
  3. Kalan kota kontrol edilir:
     - Kota varsa: Sohbet alanında DeepRed AI mesajı açılır ve içinde `startLoading()` fonksiyonuyla beslenen özel SVG kalem/taslak çizim animasyonu döngüye girer.
     - Kota yoksa: Kullanıcıya balonun üzerinde veya içinde "🎨 Görsel oluşturma limitin doldu. Yeni görsel oluşturma hakkın yarın saat 00.00'da yenilenecek." uyarısı gösterilir.
  4. Görsel Cloudinary'den hazır geldiğinde `showImage(cloudinaryUrl)` tetiklenir; SVG çizgileri pürüzsüzce kaybolur ve gerçek görsel belirir.
  5. Görsele tıklandığında RedChat'in mevcut tam ekran lightbox önizleme penceresi açılır.

- **Görsel Kimlik & Tema**:
  - Animasyon çerçevesi: `rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 aspect-square max-w-sm w-full`.
  - SVG Çizim Çizgileri: Koyu temada `stroke-red-500/80` ve `stroke-zinc-300`, açık temada `stroke-red-600` ve `stroke-zinc-700` ile canlı neon/fırça hatları.
  - Bilgilendirme Rozeti / Metni: Balonun hemen üstünde veya altında unboxed, sade tipografi (`text-xs text-zinc-500 dark:text-zinc-400 font-medium`).

---

### 3. Key Product Decisions & Trade-Offs

- **Model ve API Güvenliği (`HF_TOKEN`)**:
  - *Seçim*: Hugging Face Inference API çağrısı tamamen sunucu tarafında `server.ts` içinde `/api/ai/image/generate` endpoint'inde yapılır.
  - *Neden*: `HF_TOKEN` asla istemciye (tarayıcıya) gönderilmez. Kullanıcıların token'ı görmesi veya kötüye kullanması imkansız hale getirilir.
- **Kota Yönetimi & Güvenlik**:
  - *Seçim*: Kota hesaplama ve düşme işlemi Firestore Admin SDK ile sunucu tarafında atomik olarak yönetilir. Kullanıcının istemciden kendi kotasını sıfırlaması engellenir.
  - *Neden*: Sayfa yenileme veya tarayıcı konsolundan müdahaleler kotayı sıfırlayamaz.
- **Kota Yenilenme Mantığı**:
  - Kullanıcının `lastGeneratedDate` bilgisi yerel tarih formatında (`YYYY-MM-DD`) saklanır. Gün değiştiğinde (gece yarısı 00:00) sayaç otomatik olarak 0'a çekilir ve 3 hak tekrar açılır.
- **Hata Durumunda Kota İadesi**:
  - Hugging Face API meşgul veya hata verirse kullanıcının kotası kesinlikle düşülmez.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                       İSTEMCİ (Tarayıcı)                    │
│                                                             │
│  [ChatWindow Input] ──> Kullanıcı: "Kırmızı ejderha çiz"    │
│            │                                                │
│            ▼                                                │
│  [AiDrawingAnimation Component]                             │
│     ├─ startLoading() -> SVG animasyon döngüsü              │
│     └─ showImage(url) -> SVG gizlenir, FLUX resmi belirir   │
│            │                                                │
│            ▼ POST /api/ai/image/generate                    │
└────────────┬────────────────────────────────────────────────┘
             │ (userId, prompt, conversationId)
             ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUNUCU (server.ts)                       │
│                                                             │
│  1. Kota Kontrolü (Firestore Admin: users/{uid}/imageQuota) │
│     └─ Kalan hak < 1 ise 403 & 'resetTime: 00:00' dön       │
│                                                             │
│  2. Hugging Face Inference API Çağrısı                      │
│     └─ POST black-forest-labs/FLUX.2-dev (HF_TOKEN)         │
│                                                             │
│  3. Cloudinary CDN Yükleme                                  │
│     └─ Buffer -> POST api.cloudinary.com/v1_1/...           │
│                                                             │
│  4. Kota Güncelleme (usedCount++)                           │
│     └─ Firestore users/{uid}/imageQuota atomik kayıt        │
│                                                             │
│  5. Sonuç: { imageUrl, remainingQuota, nextResetTime }      │
└─────────────────────────────────────────────────────────────┘
```

#### Veri Modeli (`users/{userId}/imageQuota`)
```typescript
interface UserImageQuota {
  used: number;          // 0, 1, 2, 3
  total: number;         // 3
  dateStr: string;       // "2026-11-09" (Gece 00:00 kontrolü için)
  lastUpdated: Timestamp;
}
```

#### Bileşen ve Dosya Dağılımı
1. **`server.ts`**:
   - `POST /api/ai/image/generate`: Kota doğrulama, HF FLUX.2-dev çağrısı, Cloudinary yükleme ve kota düşme.
   - `GET /api/ai/image/quota`: İlgili kullanıcının kalan hak ve yenilenme zamanını döndürme.
2. **`src/components/AiDrawingAnimation.tsx`**:
   - Kullanıcının sağladığı animasyon mantığını içeren (`startLoading`, `showImage`, `el.animate({ strokeDashoffset })`), iptal ve temizleme güvenliği tam olan izole React bileşeni.
3. **`src/components/ChatWindow.tsx`**:
   - Görsel isteklerinin tespiti, animasyon bileşeninin mesaj baloncuğu içinde render edilmesi, kota uyarı metninin gösterimi.
4. **`firestore.rules`**:
   - `users/{userId}/imageQuota` koleksiyonuna kullanıcının yalnızca okuma erişimi verilmesi, yazma işlemlerinin yalnızca sunucu Admin SDK tarafından yapılması kuralı.
