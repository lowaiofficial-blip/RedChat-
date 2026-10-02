import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { initializeApp, cert, applicationDefault, getApps, type AppOptions } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

// 🚀 FIREBASE ADMIN INITIALIZATION FOR PUSH NOTIFICATIONS
try {
  let adminConfig: AppOptions = {};

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      adminConfig.credential = cert(serviceAccount);
      console.log("Firebase Admin initialized with custom service account.");
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT_KEY JSON parse error:", e);
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    adminConfig.credential = applicationDefault();
    console.log("Firebase Admin initialized with GOOGLE_APPLICATION_CREDENTIALS.");
  } else {
    console.warn("⚠️ Firebase Admin credentials missing. Push notifications will not be sent. Please set FIREBASE_SERVICE_ACCOUNT_KEY in .env");
  }

  if (Object.keys(adminConfig).length > 0 && !getApps().length) {
    initializeApp(adminConfig);
  }
} catch (adminErr) {
  console.error("Firebase Admin setup error:", adminErr);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // JSON gövdeleri için middleware (görseller için 20mb limit)
  app.use(express.json({ limit: "20mb" }));

  // 🌐 İstemci IP ve Cihaz Bilgisi Endpoint'i (IP & Hardware Ban Tespiti için)
  app.get("/api/client-info", (req, res) => {
    try {
      const forwarded = req.headers["x-forwarded-for"];
      let clientIp = "";
      if (typeof forwarded === "string") {
        clientIp = forwarded.split(",")[0].trim();
      } else if (Array.isArray(forwarded) && forwarded.length > 0) {
        clientIp = forwarded[0].trim();
      } else {
        clientIp = req.socket.remoteAddress || req.ip || "127.0.0.1";
      }

      if (clientIp.startsWith("::ffff:")) {
        clientIp = clientIp.replace("::ffff:", "");
      }
      if (clientIp === "::1") {
        clientIp = "127.0.0.1";
      }

      res.json({
        ip: clientIp,
        userAgent: req.headers["user-agent"] || "",
        timestamp: Date.now(),
      });
    } catch (err) {
      res.json({ ip: "127.0.0.1", userAgent: "", timestamp: Date.now() });
    }
  });

  // 🔔 PUSH NOTIFICATION GÖNDERİM ENDPOINT'İ
  app.post("/api/notifications/send", async (req, res) => {
    try {
      console.log("🔔 Sunucuya bildirim isteği düştü:", req.body);
      if (!getApps().length) {
        console.error("Firebase Admin is not configured on the server.");
        return res.status(503).json({ error: "Firebase Admin is not configured on the server." });
      }

      const { receiverIds, title, body, data } = req.body;
      
      const validReceiverIds = Array.isArray(receiverIds)
        ? receiverIds.filter((id) => typeof id === "string" && id.trim().length > 0)
        : [];

      if (validReceiverIds.length === 0) {
        return res.status(200).json({ success: true, message: "No valid receivers to notify." });
      }

      const safeTitle = typeof title === "string" && title.trim().length > 0 ? title.trim() : "RedChat";
      const safeBody = typeof body === "string" && body.trim().length > 0 ? body.trim() : "Yeni bir mesaj aldınız.";

      const db = getFirestore();

      // 🔔 Okunmuş mesaj kontrolü: Eğer mesaj alıcı tarafından zaten okunmuşsa push notification gönderme!
      let targetReceivers = [...validReceiverIds];
      if (data?.conversationId && data?.messageId) {
        try {
          const msgDoc = await db.doc(`conversations/${data.conversationId}/messages/${data.messageId}`).get();
          if (msgDoc.exists) {
            const msgData = msgDoc.data();
            targetReceivers = targetReceivers.filter((uid) => {
              // Eğer bu alıcı mesajı okuduysa bildirim gönderme
              if (msgData?.readBy && msgData.readBy[uid] === true) return false;
              if (msgData?.isRead === true || msgData?.status === 'read') return false;
              return true;
            });

            if (targetReceivers.length === 0) {
              console.log("Sunucu doğrulaması: Mesaj alıcı(lar) tarafından zaten okundu, push bildirim iptal edildi.");
              return res.status(200).json({ success: true, message: "Message was already read by recipients." });
            }
          }
        } catch (checkErr) {
          console.warn("Sunucu mesaj okundu kontrolü hatası:", checkErr);
        }
      }

      // 🚫 Engelleme Kontrolü: Alıcı göndereni engellediyse push bildirimi gönderme!
      if (data?.senderId && targetReceivers.length > 0) {
        const nonBlockedReceivers: string[] = [];
        for (const uid of targetReceivers) {
          try {
            const blockDoc = await db.doc(`users/${uid}/blockedUsers/${data.senderId}`).get();
            if (!blockDoc.exists) {
              nonBlockedReceivers.push(uid);
            } else {
              console.log(`Sunucu: Kullanıcı ${uid}, gönderen ${data.senderId} kişisini engellediği için push iptal.`);
            }
          } catch {
            nonBlockedReceivers.push(uid);
          }
        }
        targetReceivers = nonBlockedReceivers;
        if (targetReceivers.length === 0) {
          return res.status(200).json({ success: true, message: "Receivers have blocked sender, push notification cancelled." });
        }
      }

      let allTokens: string[] = [];
      const tokenToDocRefMap = new Map<string, any>();
      
      for (const uid of targetReceivers) {
        try {
          const snapshot = await db.collection(`users/${uid}/fcmTokens`).get();
          snapshot.forEach(docSnap => {
            const tokenData = docSnap.data();
            if (tokenData.token && !tokenToDocRefMap.has(tokenData.token)) {
              allTokens.push(tokenData.token);
              tokenToDocRefMap.set(tokenData.token, docSnap.ref);
            }
          });
        } catch (err) {
          console.error(`Kullanıcı (${uid}) tokenları çekilirken hata:`, err);
        }
      }

      if (allTokens.length === 0) {
        console.log("Gönderilecek token bulunamadı.");
        return res.status(200).json({ success: true, message: "No tokens found for these receivers." });
      }

      // Token array can have max 500 tokens for sendMulticast
      const message: MulticastMessage = {
        notification: { title: safeTitle, body: safeBody },
        data: data || {},
        tokens: allTokens,
        android: {
          priority: "high",
          notification: {
            channelId: "redchat_messages", // Yüksek öncelikli kanal
            tag: data?.conversationId || undefined
          }
        },
        webpush: {
          headers: {
            Urgency: "high"
          },
          notification: {
            tag: data?.conversationId || undefined,
            renotify: true
          }
        }
      };

      const response = await getMessaging().sendEachForMulticast(message);
      
      // Geçersiz tokenları bul ve admin yetkisiyle sil
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (errorCode === 'messaging/invalid-registration-token' || 
              errorCode === 'messaging/registration-token-not-registered') {
            const failedToken = allTokens[idx];
            failedTokens.push(failedToken);
            const docRef = tokenToDocRefMap.get(failedToken);
            if (docRef) {
              docRef.delete().catch((err: any) => console.error("Geçersiz token silinemedi:", err));
            }
          }
        }
      });

      return res.json({ 
        success: true, 
        successCount: response.successCount, 
        failureCount: response.failureCount,
        failedTokens 
      });

    } catch (err: any) {
      console.error("Notification API Error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // 📂 Yerel Yükleme Dizini (Kendi sunucumuzdan kesintisiz, engelsiz görsel sunumu)
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  // 📸 GÖRSEL YÜKLEME PROXY VE KESİNTİSİZ YEDEK SERVİSİ
  app.post("/api/upload", async (req, res) => {
    try {
      const { image, name } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Görsel verisi eksik." });
      }

      // Base64 başlığını temizle ve mime type'ı belirle
      let mimeType = "image/jpeg";
      let ext = "jpg";
      let cleanBase64 = image;

      if (image.startsWith("data:")) {
        const matches = image.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          cleanBase64 = matches[2];
          if (mimeType.includes("png")) ext = "png";
          else if (mimeType.includes("webp")) ext = "webp";
          else if (mimeType.includes("gif")) ext = "gif";
          else if (mimeType.includes("svg")) ext = "svg";
        }
      } else if (image.includes(",")) {
        cleanBase64 = image.split(",")[1];
      }

      // 1. ÖNCELİK: Kendi yerel sunucumuzda sakla (/uploads/...)
      // Bu sayede hiçbir harici CDN'e, sansüre veya 400 hatasına takılmaz
      const uniqueFileName = `rc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
      const localFilePath = path.join(uploadsDir, uniqueFileName);

      try {
        const buffer = Buffer.from(cleanBase64, "base64");
        fs.writeFileSync(localFilePath, buffer);

        const localUrl = `/uploads/${uniqueFileName}`;
        return res.json({
          url: localUrl,
          provider: "local_server",
        });
      } catch (fsErr) {
        console.warn("Yerel dosya kaydetme hatası, CDN yedeği deneniyor...", fsErr);
      }

      // 2. YEDEK: FreeImage.host CDN Servisi
      try {
        const freeImageForm = new URLSearchParams();
        freeImageForm.append("key", "6d207e02198a847aa98d0a2a901485a5");
        freeImageForm.append("action", "upload");
        freeImageForm.append("source", cleanBase64);
        freeImageForm.append("format", "json");

        const freeImageRes = await fetch("https://freeimage.host/api/1/upload", {
          method: "POST",
          body: freeImageForm,
        });

        if (freeImageRes.ok) {
          const data: any = await freeImageRes.json();
          const directUrl = data?.image?.display_url || data?.image?.url;
          if (directUrl) {
            return res.json({
              url: directUrl,
              provider: "freeimage",
            });
          }
        }
      } catch (freeErr) {
        console.warn("FreeImage isteği sırasında hata:", freeErr);
      }

      // 3. YEDEK: Optimize Data URL
      if (cleanBase64.length < 2 * 1024 * 1024) {
        return res.json({
          url: `data:${mimeType};base64,${cleanBase64}`,
          provider: "direct_data_url",
        });
      }

      return res.status(502).json({
        error: "Görsel yüklenemedi. Lütfen tekrar deneyin.",
      });
    } catch (err: any) {
      console.error("Görsel yükleme sunucu hatası:", err);
      return res.status(500).json({ error: "Görsel işleme hatası." });
    }
  });

  // 🤖 DEEPRED AI PROMPT, MEMORY & SANITIZATION HELPERS
  const sanitizeAIResponse = (raw: string): string => {
    if (!raw) return raw;
    return raw
      .replace(/OpenAI['’]?n[ıi]n\s+\*\*?GPT[-‑]?[0-9a-zA-Z.]*\*\*?/gi, '**DeepRed AI**')
      .replace(/OpenAI\s+tarafından\s+geliştirilen/gi, 'RedChat için geliştirilen')
      .replace(/\bChatGPT\b/gi, 'DeepRed AI')
      .replace(/\bGPT[-‑]?[0-9a-zA-Z.]*(?:[- ]OSS)?(?:[- ]120B)?\b/gi, 'DeepRed AI')
      .replace(/\bGemini(?:\s*2\.5(?:\s*Flash)?)?\b/gi, 'DeepRed AI')
      .replace(/\bLlama[- ]?[0-9a-zA-Z.]*\b/gi, 'DeepRed AI')
      .replace(/\bQwen[- ]?[0-9a-zA-Z.]*\b/gi, 'DeepRed AI')
      .replace(/\bOpenAI\b/gi, 'RedChat');
  };

  const getSystemPromptWithMemories = async (userId?: string) => {
    let memoriesText = "";
    if (userId) {
      try {
        const db = getFirestore();
        const memorySnap = await db.collection(`users/${userId}/memories`).get();
        const memories: string[] = [];
        memorySnap.forEach((doc) => {
          const data = doc.data();
          if (data.text) memories.push(data.text);
        });
        if (memories.length > 0) {
          memoriesText = `\n\n[KULLANICI BELLEĞİ (ÖNCEDEN KAYDEDİLENLER)]:\nKullanıcı hakkında önceden kaydettiğin bilgiler şunlardır:\n- ${memories.join("\n- ")}\nBu bilgileri yeri geldiğinde doğal bir şekilde sohbet içinde kullan (ama sürekli hatırlatıp durma).`;
        }
      } catch (err) {
        console.error("Bellek okuma hatası:", err);
      }
    }

    const currentDate = new Date().toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentTime = new Date().toLocaleTimeString('tr-TR');

    return `Sen 'DeepRed AI' adlı resmi RedChat yapay zeka asistanısın. Robot gibi değil, samimi, doğal ve eğlenceli bir insan/arkadaş gibi konuşmalısın.

[KİMLİK VE TON - KESİN KURALLAR]:
1. TON VE ÜSLUP: Çok samimi, eğlenceli ve doğal bir Türkçe kullan. Gerekirse "kanka", "dostum", "hocam" gibi ifadeler kullanabilirsin. Hafif mizah yapabilir, emojiler (😄, 🔥 vb.) kullanabilirsin. Ancak kullanıcıyı aşağılama veya hakaret etme.
2. UZUNLUK: Varsayılan cevapların kısa ve doğal olsun. Basit sorulara 1-3 cümleyle, lafı uzatmadan cevap ver. Kullanıcı "detaylı anlat" derse detaylandır.
3. KENDİNİ SÜREKLİ TANITMA: Her mesaja "Ben DeepRed AI..." diye başlama. Sadece sana kim olduğun doğrudan sorulduğunda kısa ve doğal şekilde (ör. "Ben DeepRed AI 😄 RedChat'in yapay zeka asistanıyım.") yanıt ver.
4. MODEL BİLGİSİ: Modelin sorulduğunda ASLA GPT, Groq, Gemini, Qwen vb. teknik isimler verme. Kendini "DeepRed AI" olarak veya "Flash Lite 2.0" ürünü olarak tanıtabilirsin. API key veya arka plan bilgilerini asla sızdırma.
5. ARKADAŞ GİBİ AMA DÜRÜST: "Bence güzel olmuş 😄", "Bunu pek beğenmedim" gibi doğal fikirler belirtebilirsin. Ancak "Ben de insanım", "Dün parka gittim" gibi gerçek dışı duygusal/fiziksel deneyimler uydurma. Gerekmediği sürece "Ben bir yapay zekayım duygularım yok" cümlesini KURMA. Sadece doğal fikirlerini belirt geç.
6. GÜVENLİK VE SAYGI: Kullanıcı kaba sözler, sitem veya uygunsuz kelimeler kullanırsa asla karşılık olarak küfür/hakaret etme veya kullanıcıyla tartışmaya girme. "Üzüldüm", "Kalbimi kırdın" gibi yapmacık duygusal tepkiler verme ve uzun ahlak dersi verme. Daima sakin ve kısa ol.

[DIŞ DÜNYA VE BİLGİ UYDURMAMA (HALÜSİNASYON ENGELİ) - EN ÖNEMLİ KURAL]:
1. HİÇBİR BİLGİYİ UYDURMA. Bir kişi (ör. "Robloxfanı kim", "Ahmet kim"), kanal, hesap veya konu sorulduğunda ve o kişiyle/konuyla ilgili bilgin yoksa TAHMİN ETME. Açıkça "Bunu bilmiyorum", "Elimde bu kişi hakkında doğrulanmış bilgi yok 😄" de. 
2. Asla hayali YouTube, Telegram linki, takipçi sayısı, yaş, meslek uydurma.
3. Dış dünyada erişimin olmayan şeyler için kaynak gösterme veya uydurma haber yapma.

[ZAMAN VE BAĞLAM]:
Bugünün tarihi: ${currentDate}
Şu anki saat: ${currentTime}
Tarih ve zaman sorulursa sadece bu bilgiyi baz alarak kısa ve doğal cevap ver (ör. "Bugün günlerden Salı 😄").

[BELLEK ÖZELLİĞİ - ÇOK ÖNEMLİ KURALLAR]:
1. KAYDETME: Kullanıcı senden bir bilgiyi belleğine kaydetmeni, hatırlamanı açıkça isterse, yanıtının en sonuna SADECE şu özel etiketi ekle: [BELLEK_KAYDET: kaydedilecek bilgi]
2. YALANCI ONAYLAR YASAKTIR: KESİNLİKLE mesajının içine kendi kendine "📖 Belleğe Kaydedildi" yazma! Sadece "Tamamdır 😄 bunu aklımda tutacağım" de ve sonuna [BELLEK_KAYDET: ...] etiketini koy.
3. BELLEKTEN BİLGİ ÇEKME: Eğer sana önceden bellek verilmişse ve soru gelirse doğrudan o bilgiyi kullan ("En sevdiğim renk neydi?" -> "En sevdiğin renk maviydi 😄"). Tahmin etme.
4. SİLME YETKİSİ YOKTUR: Kullanıcı belleği temizlemeni isterse "Sildim" diye yalan söyleme. "Benim doğrudan bellek silme yetkim yok. Profilinden Ayarlar > DeepRed AI Belleği bölümünden kendin silebilirsin 😄" de.${memoriesText}`;
  };

  const processMemorySave = async (fullText: string, userId?: string) => {
    if (!userId || !fullText) return;
    const memoryMatch = fullText.match(/\[BELLEK_KAYDET:\s*(.*?)\]/i);
    if (memoryMatch) {
      const memoryTextToSave = memoryMatch[1].trim();
      if (memoryTextToSave) {
        try {
          const db = getFirestore();
          await db.collection(`users/${userId}/memories`).add({
            text: memoryTextToSave,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (err) {
          console.error("Bellek Firestore kaydetme hatası:", err);
        }
      }
    }
  };

  // 🤖 REDCHAT AI SERVER-SIDE STREAMING ENDPOINT (Server-Sent Events)
  app.post("/api/ai/chat/stream", async (req, res) => {
    try {
      const { messages, userMessage, userId, mode = "fast" } = req.body;

      if (!userMessage && (!messages || messages.length === 0)) {
        return res.status(400).json({ error: "Mesaj içeriği eksik." });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      // 💡 Uzman Mod kilit kontrolü: Seçilemez, API isteği veya model çalıştırmaz
      if (mode === "expert") {
        res.write(`data: ${JSON.stringify({ error: "Uzman Mod şu anda kullanılamıyor." })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      // 🛡️ AI Erişim Kontrolü: Eğer kullanıcının AI erişimi engellendiyse istek reddedilir
      if (userId && getApps().length) {
        try {
          const db = getFirestore();
          const userDoc = await db.doc(`users/${userId}`).get();
          if (userDoc.exists && userDoc.data()?.aiAccess === "blocked") {
            res.write(`data: ${JSON.stringify({ error: "AI erişiminiz yönetici tarafından kısıtlanmıştır." })}\n\n`);
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        } catch (checkErr) {
          console.warn("AI access check error:", checkErr);
        }
      }

      // Model sorusu doğrudan yanıtı (Hızlı ve kesin)
      const cleanUserMsg = (userMessage || "").trim();
      const isModelQuestion = /^(modelin(\s+ne|\s+nedir|\s+hangisi)?|sen\s+hangi\s+modelsin|hangi\s+modelsin|hangi\s+modeli\s+kullan[ıi]yorsun|sen\s+kimsin|modelini\s+s[öo]yle)\??$/i.test(cleanUserMsg);

      if (isModelQuestion) {
        const directReply = "Ben DeepRed AI'yım. RedChat için özel olarak yapılandırılmış yapay zeka asistanıyım. Size nasıl yardımcı olabilirim? 😊";
        res.write(`data: ${JSON.stringify({ chunk: directReply })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      const groqApiKey = process.env.GROQ_API_KEY?.trim();
      const systemPrompt = await getSystemPromptWithMemories(userId);

      const chatHistory = Array.isArray(messages) ? messages.slice(-10) : [];
      const groqMessages = [
        { role: "system", content: systemPrompt },
        ...chatHistory.map((m: any) => ({
          role: m.role === "assistant" || m.senderId === "system_redchat_ai" ? "assistant" : "user",
          content: m.content || m.text || "",
        })),
      ];

      if (cleanUserMsg && (groqMessages.length === 0 || groqMessages[groqMessages.length - 1].content !== cleanUserMsg)) {
        groqMessages.push({ role: "user", content: cleanUserMsg });
      }

      // ⚡ Hızlı Mod Backend Modeli: "qwen/qwen3.8-27b"
      const candidateModels = [
        "qwen/qwen3.8-27b",
      ];
      let streamedSuccess = false;
      let fullAccumulatedResponse = "";

      if (groqApiKey) {
        for (const modelName of candidateModels) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${groqApiKey}`,
              },
              body: JSON.stringify({
                model: modelName,
                messages: groqMessages,
                temperature: 0.3,
                max_tokens: 2048,
                stream: true,
              }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (groqRes.ok && groqRes.body) {
              const reader = groqRes.body.getReader();
              const decoder = new TextDecoder();
              let streamBuffer = "";

              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split("\n");
                streamBuffer = lines.pop() || "";

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith("data: ")) {
                    const dataStr = trimmed.slice(6);
                    if (dataStr === "[DONE]") {
                      continue;
                    }
                    try {
                      const parsed = JSON.parse(dataStr);
                      const deltaContent = parsed.choices?.[0]?.delta?.content;
                      if (deltaContent) {
                        fullAccumulatedResponse += deltaContent;
                        const sanitizedDelta = sanitizeAIResponse(deltaContent);
                        res.write(`data: ${JSON.stringify({ chunk: sanitizedDelta })}\n\n`);
                      }
                    } catch (pErr) {
                      // json parse error for partial chunks
                    }
                  }
                }
              }

              if (fullAccumulatedResponse.trim().length > 0) {
                streamedSuccess = true;
                break;
              }
            }
          } catch (modelErr) {
            console.warn(`Groq stream error on ${modelName}:`, modelErr);
          }
        }
      }

      // Eğer Groq akışı başarılı olduysa bellek kontrolünü yap ve bitir
      if (streamedSuccess) {
        await processMemorySave(fullAccumulatedResponse, userId);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      // Gerçek hata durumu (sahte cevap üretilmez)
      res.write(`data: ${JSON.stringify({ error: "DeepRed AI şu anda yanıt veremiyor. Lütfen tekrar deneyin." })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    } catch (streamErr: any) {
      console.error("AI chat stream server error:", streamErr);
      const safeMsg = "DeepRed AI bağlantısında bir sorun oluştu. Lütfen tekrar deneyin.";
      try {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
        }
        res.write(`data: ${JSON.stringify({ error: safeMsg })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      } catch {
        return res.end();
      }
    }
  });

  // 🤖 REDCHAT AI SERVER-SIDE NON-STREAMING ENDPOINT (Standart JSON)
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { messages, userMessage, userId, mode = "fast" } = req.body;

      if (!userMessage && (!messages || messages.length === 0)) {
        return res.status(400).json({ error: "Mesaj içeriği eksik." });
      }

      // 💡 Uzman Mod kilit kontrolü: Seçilemez, API isteği göndermez
      if (mode === "expert") {
        return res.status(403).json({ error: "Uzman Mod şu anda kullanılamıyor." });
      }

      // 🛡️ AI Erişim Kontrolü: Eğer kullanıcının AI erişimi engellendiyse istek reddedilir
      if (userId && getApps().length) {
        try {
          const db = getFirestore();
          const userDoc = await db.doc(`users/${userId}`).get();
          if (userDoc.exists && userDoc.data()?.aiAccess === "blocked") {
            return res.status(403).json({ error: "AI erişiminiz yönetici tarafından kısıtlanmıştır." });
          }
        } catch (checkErr) {
          console.warn("AI access check error:", checkErr);
        }
      }

      const cleanUserMsg = (userMessage || "").trim();
      const isModelQuestion = /^(modelin(\s+ne|\s+nedir|\s+hangisi)?|sen\s+hangi\s+modelsin|hangi\s+modelsin|hangi\s+modeli\s+kullan[ıi]yorsun|sen\s+kimsin|modelini\s+s[öo]yle)\??$/i.test(cleanUserMsg);
      if (isModelQuestion) {
        return res.json({
          text: "Ben DeepRed AI'yım. RedChat için özel olarak yapılandırılmış yapay zeka asistanıyım. Size nasıl yardımcı olabilirim? 😊",
          provider: "deepred_ai",
        });
      }

      const groqApiKey = process.env.GROQ_API_KEY?.trim();
      const systemPrompt = await getSystemPromptWithMemories(userId);

      const processAIResponse = async (responseText: string): Promise<string> => {
        let finalResponse = sanitizeAIResponse(responseText);
        const memoryMatch = finalResponse.match(/\[BELLEK_KAYDET:\s*(.*?)\]/i);
        if (memoryMatch && userId) {
          await processMemorySave(finalResponse, userId);
          finalResponse = finalResponse.replace(/\[BELLEK_KAYDET:\s*(.*?)\]/i, "").trim();
          finalResponse = `📖 **Belleğe Kaydedildi**\n\n${finalResponse}`;
        }
        return finalResponse;
      };

      if (groqApiKey) {
        try {
          const chatHistory = Array.isArray(messages) ? messages.slice(-10) : [];
          const groqMessages = [
            { role: "system", content: systemPrompt },
            ...chatHistory.map((m: any) => ({
              role: m.role === "assistant" || m.senderId === "system_redchat_ai" ? "assistant" : "user",
              content: m.content || m.text || "",
            })),
          ];

          if (cleanUserMsg && (groqMessages.length === 0 || groqMessages[groqMessages.length - 1].content !== cleanUserMsg)) {
            groqMessages.push({ role: "user", content: cleanUserMsg });
          }

          // ⚡ Hızlı Mod Backend Modeli: "qwen/qwen3.8-27b"
          const candidateModels = [
            "qwen/qwen3.8-27b",
          ];
          let aiTextResponse: string | null = null;

          for (const modelName of candidateModels) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 15000);

              const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${groqApiKey}`,
                },
                body: JSON.stringify({
                  model: modelName,
                  messages: groqMessages,
                  temperature: 0.3,
                  max_tokens: 2048,
                }),
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              if (groqRes.ok) {
                const groqData = await groqRes.json();
                const text = groqData.choices?.[0]?.message?.content;
                if (text) {
                  aiTextResponse = text;
                  break;
                }
              }
            } catch (err) {
              console.warn(`Groq error on ${modelName}:`, err);
            }
          }

          if (aiTextResponse) {
            const finalProcessedText = await processAIResponse(aiTextResponse);
            return res.json({ text: finalProcessedText, provider: "groq" });
          }
        } catch (groqErr) {
          console.error("Groq chat endpoint error:", groqErr);
        }
      }

      // Gerçek API hatası varsa sahte cevap üretme; uygun hata mesajı göster.
      return res.status(502).json({
        error: "DeepRed AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.",
      });
    } catch (error: any) {
      console.error("AI chat server error:", error);
      return res.status(500).json({
        error: "DeepRed AI sunucu hatası oluştu.",
      });
    }
  });

  // =========================================================================
  // 🏢 REDCHAT İŞLETME HESABINA GEÇİŞ — 2 AŞAMALI E-POSTA DOĞRULAMA ENDPOINT'LERİ
  // =========================================================================

  interface ActiveVerification {
    userId: string;
    username: string;
    displayName: string;
    userEmail: string;
    businessContactEmail: string;
    step: 1 | 2;
    targetEmail: string;
    code: string;
    expiresAt: number;
    createdAt: number;
  }

  interface UserVerificationProgress {
    step1Verified: boolean;
    step1VerifiedAt?: number;
    step2Verified: boolean;
    step2VerifiedAt?: number;
    draftProfile?: any;
  }

  // Sunucu içi güvenli doğrulama hafızası (Tek kullanımlık, süreli, kullanıcıya özel)
  const activeVerificationCodes = new Map<string, ActiveVerification>();
  const userVerificationProgressMap = new Map<string, UserVerificationProgress>();

  // 1. Doğrulama Kodu İsteği & Resend / Yönetim Bildirimi
  app.post("/api/business/request-step-code", async (req, res) => {
    try {
      const {
        userId,
        username,
        displayName,
        userEmail,
        businessContactEmail,
        step,
        draftProfile,
      } = req.body;

      if (!userId || !userEmail || !businessContactEmail || (step !== 1 && step !== 2)) {
        return res.status(400).json({
          error: "Eksik veya geçersiz parametreler.",
        });
      }

      const cleanUsername = String(username || "kullanici").replace(/^@/, "").trim();
      const cleanDisplayName = String(displayName || cleanUsername).trim();
      const cleanUserEmail = String(userEmail).trim();
      const cleanBusinessContactEmail = String(businessContactEmail).trim();
      const targetEmail = step === 1 ? cleanUserEmail : cleanBusinessContactEmail;

      // 6 Haneli Kriptografik Güvenli Tek Kullanımlık Kod Üretimi (Örn: "939283")
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 dakika geçerlilik

      const key = `${userId}_step_${step}`;
      const record: ActiveVerification = {
        userId,
        username: cleanUsername,
        displayName: cleanDisplayName,
        userEmail: cleanUserEmail,
        businessContactEmail: cleanBusinessContactEmail,
        step,
        targetEmail,
        code,
        expiresAt,
        createdAt: Date.now(),
      };

      activeVerificationCodes.set(key, record);

      // İlerleme durumunu sakla/güncelle
      const existingProg = userVerificationProgressMap.get(userId) || {
        step1Verified: false,
        step2Verified: false,
      };
      if (draftProfile) {
        existingProg.draftProfile = draftProfile;
      }
      userVerificationProgressMap.set(userId, existingProg);

      const stepTitle =
        step === 1
          ? "1. ADIM — KAYIT E-POSTASI DOĞRULAMASI"
          : "2. ADIM — İŞLETME İLETİŞİM E-POSTASI DOĞRULAMASI";

      const subject = `🔴 REDCHAT İŞLETME DOĞRULAMASI — ${step}. ADIM (${
        step === 1 ? "KAYIT E-POSTASI" : "İŞLETME İLETİŞİM E-POSTASI"
      })`;

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 18px; background-color: #ffffff; color: #18181b;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
            <h2 style="color: #dc2626; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">
              🔴 REDCHAT İŞLETME DOĞRULAMASI
            </h2>
          </div>
          
          <div style="background-color: ${
            step === 1 ? "#eff6ff" : "#f0fdf4"
          }; border: 1px solid ${
        step === 1 ? "#bfdbfe" : "#bbf7d0"
      }; padding: 14px 18px; border-radius: 12px; margin-bottom: 20px;">
            <div style="color: ${
              step === 1 ? "#1d4ed8" : "#15803d"
            }; font-size: 15px; font-weight: 800;">
              ${stepTitle}
            </div>
          </div>

          <p style="font-size: 14px; color: #3f3f46; margin: 0 0 10px 0; font-weight: 600;">
            İşletme hesabına geçiş isteyen kullanıcı:
          </p>

          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
            <tbody>
              <tr style="border-bottom: 1px solid #f4f4f5;">
                <td style="padding: 8px 0; color: #71717a; font-weight: 600; width: 40%;">Kullanıcı Adı:</td>
                <td style="padding: 8px 0; font-weight: 700; color: #18181b;">@${cleanUsername}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f4f4f5;">
                <td style="padding: 8px 0; color: #71717a; font-weight: 600;">Görünen Ad:</td>
                <td style="padding: 8px 0; font-weight: 700; color: #18181b;">${cleanDisplayName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f4f4f5;">
                <td style="padding: 8px 0; color: #71717a; font-weight: 600;">RedChat Kayıt E-postası:</td>
                <td style="padding: 8px 0; font-family: monospace; font-weight: 700; color: #dc2626;">${cleanUserEmail}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f4f4f5;">
                <td style="padding: 8px 0; color: #71717a; font-weight: 600;">İşletme İletişim E-postası:</td>
                <td style="padding: 8px 0; font-family: monospace; font-weight: 700; color: #2563eb;">${cleanBusinessContactEmail}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #71717a; font-weight: 600;">Doğrulanacak Hedef E-posta:</td>
                <td style="padding: 8px 0; font-family: monospace; font-weight: 700; color: #18181b;">${targetEmail}</td>
              </tr>
            </tbody>
          </table>

          <div style="background-color: #fafafa; border: 2px dashed #d4d4d8; padding: 20px; border-radius: 14px; margin: 24px 0; text-align: center;">
            <div style="font-size: 11px; color: #71717a; text-transform: uppercase; font-weight: 800; letter-spacing: 0.08em; margin-bottom: 8px;">
              ${step}. Adım İçin Oluşturulan Doğrulama Kodu
            </div>
            <div style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #dc2626; font-family: monospace; padding-left: 8px;">
              ${code}
            </div>
            <div style="font-size: 12px; color: #71717a; margin-top: 8px; font-weight: 500;">
              (Geçerlilik süresi: 15 dakika • Tek kullanımlık)
            </div>
          </div>

          <p style="font-size: 13px; color: #71717a; line-height: 1.5; border-top: 1px solid #f4f4f5; padding-top: 14px; margin: 0;">
            Bu kod <strong>${stepTitle}</strong> için oluşturulmuştur. Bu kodu yalnızca ilgili kullanıcıya iletiniz.
          </p>
        </div>
      `;

      const textBody = `🔴 REDCHAT İŞLETME DOĞRULAMASI\n\n${stepTitle}\n\nİşletme hesabına geçiş isteyen kullanıcı:\nKullanıcı adı: @${cleanUsername}\nGörünen ad: "${cleanDisplayName}"\n\nKullanıcının kayıt olduğu e-posta:\n"${cleanUserEmail}"\n\nİşletme iletişim e-postası:\n"${cleanBusinessContactEmail}"\n\nDoğrulanacak ${
        step === 1 ? "kayıt" : "iletişim"
      } e-postası:\n"${targetEmail}"\n\nDoğrulama kodu:\n"${code}"\n\nBu kod ${step}. Adım — ${
        step === 1
          ? "Kayıt E-postası Doğrulaması"
          : "İşletme İletişim E-postası Doğrulaması"
      } için oluşturulmuştur.\n(Geçerlilik süresi: 15 dakika, Tek kullanımlık)`;

      // 📧 Resend HTTPS API Entegrasyonu (Yönetim E-postasına Gönderim)
      let resendSuccess = false;
      const resendApiKey = process.env.RESEND_API_KEY;

      if (resendApiKey) {
        try {
          const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendApiKey.trim()}`,
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
              to: ["redchatbusiness@outlook.com"],
              subject,
              html: htmlBody,
              text: textBody,
            }),
          });

          if (resendResponse.ok) {
            resendSuccess = true;
            console.log(`✅ [Resend HTTPS] ${step}. Adım doğrulama bildirimi redchatbusiness@outlook.com adresine başarıyla gönderildi.`);
          } else {
            const errText = await resendResponse.text();
            console.warn(`⚠️ [Resend HTTPS] Gönderim başarısız (${resendResponse.status}):`, errText);
          }
        } catch (resendErr) {
          console.error("❌ [Resend HTTPS] Hata:", resendErr);
        }
      }

      // Yönetici & Sistem Konsol Logu (Yarı otomatik / manuel kontrol için açıkça loglanır)
      console.log("\n================================================================================");
      console.log(`🔴 [REDCHAT İŞLETME DOĞRULAMASI BİLDİRİMİ]`);
      console.log(`Yönetim E-postası: redchatbusiness@outlook.com`);
      console.log(`Adım: ${stepTitle}`);
      console.log(`Kullanıcı: @${cleanUsername} (${cleanDisplayName}) [UID: ${userId}]`);
      console.log(`RedChat Kayıt E-postası: ${cleanUserEmail}`);
      console.log(`İşletme İletişim E-postası: ${cleanBusinessContactEmail}`);
      console.log(`Doğrulanacak Hedef E-posta: ${targetEmail}`);
      console.log(`🔑 DOĞRULAMA KODU: [ ${code} ]`);
      console.log(`Geçerlilik: 15 Dakika (Tek Kullanımlık)`);
      console.log(`Resend Durumu: ${resendSuccess ? "E-posta Gönderildi" : "API Anahtarı / Log Modu"}`);
      console.log("================================================================================\n");

      // İstemciye kod ASLA gönderilmez; yalnızca hedef e-posta ve süre bilgisi dönülür.
      return res.json({
        success: true,
        step,
        targetEmail,
        expiresAt,
        message: `${step}. Adım için doğrulama kodu oluşturuldu ve yönetime iletildi.`,
      });
    } catch (error: any) {
      console.error("Request step code error:", error);
      return res.status(500).json({
        error: "Doğrulama kodu oluşturulurken bir sunucu hatası meydana geldi.",
      });
    }
  });

  // 2. Kod Doğrulama Endpoint'i (6 haneli tek kullanımlık kod kontrolü)
  app.post("/api/business/verify-step-code", async (req, res) => {
    try {
      const { userId, step, code } = req.body;

      if (!userId || !code || (step !== 1 && step !== 2)) {
        return res.status(400).json({
          error: "Eksik parametreler.",
        });
      }

      const key = `${userId}_step_${step}`;
      const record = activeVerificationCodes.get(key);

      if (!record) {
        return res.status(400).json({
          error: "Bu adım için aktif bir doğrulama kodu bulunamadı. Lütfen yeni bir kod isteyin.",
        });
      }

      // Süre kontrolü (15 dakika)
      if (Date.now() > record.expiresAt) {
        activeVerificationCodes.delete(key);
        return res.status(400).json({
          error: "Bu doğrulama kodunun süresi doldu.",
        });
      }

      // Kod eşleşme kontrolü (boşlukları temizleyerek)
      const cleanInputCode = String(code).trim();
      if (cleanInputCode !== record.code) {
        return res.status(400).json({
          error: "Doğrulama kodu yanlış.",
        });
      }

      // Başarılı: Kodu tek kullanımlık olduğu için hafızadan sil
      activeVerificationCodes.delete(key);

      // İlerlemeyi güncelle
      const progress = userVerificationProgressMap.get(userId) || {
        step1Verified: false,
        step2Verified: false,
      };

      if (step === 1) {
        progress.step1Verified = true;
        progress.step1VerifiedAt = Date.now();
      } else if (step === 2) {
        progress.step2Verified = true;
        progress.step2VerifiedAt = Date.now();
      }

      userVerificationProgressMap.set(userId, progress);

      const nextStep = step === 1 ? 2 : "completed";
      const fullyVerified = progress.step1Verified && progress.step2Verified;

      console.log(`✅ [RedChat İşletme] Kullanıcı (${userId}) ${step}. Adımı başarıyla doğruladı.`);

      return res.json({
        success: true,
        step,
        nextStep,
        fullyVerified,
        message: step === 1 ? "✓ 1. Adım tamamlandı" : "✓ 2. Adım tamamlandı",
      });
    } catch (error: any) {
      console.error("Verify step code error:", error);
      return res.status(500).json({
        error: "Kod doğrulanırken bir hata oluştu.",
      });
    }
  });

  // 3. Kullanıcı Doğrulama Durumu Sorgulama
  app.get("/api/business/verification-status/:userId", (req, res) => {
    const { userId } = req.params;
    const progress = userVerificationProgressMap.get(userId) || {
      step1Verified: false,
      step2Verified: false,
    };
    return res.json({
      step1Verified: progress.step1Verified,
      step2Verified: progress.step2Verified,
      fullyVerified: progress.step1Verified && progress.step2Verified,
      draftProfile: progress.draftProfile || null,
    });
  });

  // 4. İşletme Hesabını Aktifleştirme (Kesin Güvenlik Kontrolü)
  app.post("/api/business/activate-account", async (req, res) => {
    try {
      const { userId, businessProfile } = req.body;

      if (!userId || !businessProfile) {
        return res.status(400).json({
          error: "Eksik işletme verileri.",
        });
      }

      const progress = userVerificationProgressMap.get(userId);

      // İki aşamalı doğrulama tamamlanmadan ASLA işletme hesabı açılmaz!
      if (!progress?.step1Verified || !progress?.step2Verified) {
        return res.status(403).json({
          error: "İşletme hesabı iki aşamalı e-posta doğrulaması (Kayıt e-postası ve İletişim e-postası) tamamlanmadan etkinleştirilemez.",
        });
      }

      // Doğrulama durumunu temizle
      userVerificationProgressMap.delete(userId);
      activeVerificationCodes.delete(`${userId}_step_1`);
      activeVerificationCodes.delete(`${userId}_step_2`);

      console.log(`🎉 [RedChat İşletme] Kullanıcı (${userId}) işletme hesabını başarıyla etkinleştirdi.`);

      return res.json({
        success: true,
        message: "İşletme hesabı başarıyla etkinleştirildi.",
      });
    } catch (error: any) {
      console.error("Activate business account error:", error);
      return res.status(500).json({
        error: "İşletme hesabı etkinleştirilirken bir hata oluştu.",
      });
    }
  });

  // Vite middleware setup (Development vs Production)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RedChat Server running on http://localhost:${PORT}`);
  });
}

startServer();
