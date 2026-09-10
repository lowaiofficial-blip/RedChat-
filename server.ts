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

  // 🔔 PUSH NOTIFICATION GÖNDERİM ENDPOINT'İ
  app.post("/api/notifications/send", async (req, res) => {
    try {
      console.log("🔔 Sunucuya bildirim isteği düştü:", req.body);
      if (!getApps().length) {
        console.error("Firebase Admin is not configured on the server.");
        return res.status(503).json({ error: "Firebase Admin is not configured on the server." });
      }

      const { receiverIds, title, body, data } = req.body;
      
      if (!receiverIds || !Array.isArray(receiverIds) || receiverIds.length === 0) {
        return res.status(400).json({ error: "receiverIds array is required" });
      }

      if (!title || !body) {
        return res.status(400).json({ error: "Title and body are required" });
      }

      const db = getFirestore();
      let allTokens: string[] = [];
      const tokenToDocRefMap = new Map<string, any>();
      
      for (const uid of receiverIds) {
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
        notification: { title, body },
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

  // 🤖 REDCHAT AI SERVER-SIDE ENDPOINT (GPT-OSS 120B / Groq / Fallback AI)
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { messages, userMessage, userId } = req.body;

      if (!userMessage && (!messages || messages.length === 0)) {
        return res.status(400).json({ error: "Mesaj içeriği eksik." });
      }

      const groqApiKey = process.env.GROQ_API_KEY?.trim();
      const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

      // Kullanıcının mevcut bellek verilerini çek
      let memoriesText = "";
      if (userId) {
        try {
          const db = getFirestore();
          const memorySnap = await db.collection(`users/${userId}/memories`).get();
          const memories: string[] = [];
          memorySnap.forEach(doc => {
            const data = doc.data();
            if (data.text) memories.push(data.text);
          });
          if (memories.length > 0) {
            memoriesText = `\n\n[KULLANICI BELLEĞİ (HATIRLAMAN GEREKENLER)]:\nKullanıcı hakkında önceden kaydettiğin bilgiler şunlardır:\n- ${memories.join('\n- ')}\n`;
          }
        } catch (err) {
          console.error("Bellek okuma hatası:", err);
        }
      }

      // 🛡️ Model İsmi Sanitizasyon Fonksiyonu:
      const sanitizeAIResponse = (raw: string): string => {
        if (!raw) return raw;
        return raw
          .replace(/OpenAI['’]?n[ıi]n\s+\*\*?GPT[-‑]?[0-9a-zA-Z.]*\*\*?/gi, '**Flash Lite 1.0**')
          .replace(/OpenAI\s+tarafından\s+geliştirilen/gi, 'RedChat için geliştirilen')
          .replace(/\bGPT[-‑]?[0-9a-zA-Z.]*(?:[- ]OSS)?(?:[- ]120B)?\b/gi, 'Flash Lite 1.0')
          .replace(/\bGemini(?:\s*2\.5(?:\s*Flash)?)?\b/gi, 'Flash Lite 1.0')
          .replace(/\bLlama[- ]?[0-9a-zA-Z.]*\b/gi, 'Flash Lite 1.0')
          .replace(/\bOpenAI\b/gi, 'RedChat');
      };

      // Model bağlamı hazırlama
      const systemPrompt = `Sen 'RedChat AI' adlı resmi RedChat yapay zeka asistanısın.
[KİMLİK VE MODEL BİLGİSİ - KESİN KURAL]:
1. Modelin sorulduğunda ('modelin ne', 'hangi modelsin', 'hangi yapay zekasın', 'altyapın ne', 'kimsin', 'hangi dili/modeli kullanıyorsun' vb.), kesinlikle ve daima modelinin 'Flash Lite 1.0' olduğunu söyle.
2. ASLA 'GPT-4', 'GPT-OSS', 'GPT-OSS 120B', 'OpenAI', 'Gemini' veya 'Llama' isimlerini kullanma. Bu isimleri anmak veya kendi modelin olarak iddia etmek KESİNLİKLE YASAKTIR.
3. Modelin sorulduğunda yanıtın daima şu şekilde olmalıdır: "Ben RedChat AI'yım ve **Flash Lite 1.0** modeli üzerine inşa edildim. Türkçe olarak samimi, net ve yardımcı yanıtlar vermek üzere özel olarak yapılandırıldım. Başka merak ettiğin bir şey olursa sormaktan çekinme! 😊"
4. Kullanıcılara samimi, akıllı, net, yardımsever ve Türkçe olarak yanıt verirsin.
5. Markdown biçimlendirmelerini zengin ve düzgün şekilde kullan.
6. Asla sahte bir insan olduğunu iddia etme; RedChat platformunun resmi AI asistanı olduğunu bil.

[BELLEK ÖZELLİĞİ - ÇOK ÖNEMLİ KURALLAR]:
1. KAYDETME: Kullanıcı senden bir bilgiyi belleğine kaydetmeni, hatırlamanı veya unutmamanı açıkça isterse, yanıtının en sonuna SADECE şu özel etiketi ekle: [BELLEK_KAYDET: kaydedilecek bilgi]
2. YALANCI ONAYLAR YASAKTIR: KESİNLİKLE mesajının içine kendi kendine "📖 Belleğe Kaydedildi" yazma! Sadece etiketi kullan, sistem bunu algılayıp kullanıcıya gerçek görsel bildirimi kendisi gösterecektir.
3. SİLME (ÇOK ÖNEMLİ): Kullanıcı senden belleğindeki bir şeyi silmeni, unutmanı veya temizlemeni isterse, SAKIN "sildim" veya "unuttum" diye yalan söyleme! Senin sohbet üzerinden doğrudan bellek silme YETKİN YOKTUR.
4. SİLME YANITI: Bir bilgiyi silme veya unutma talebi gelirse tam olarak şöyle yanıt ver: "Benim sohbet üzerinden doğrudan bellek silme yetkim yok. Ancak profilinize gidip **Ayarlar > RedChat AI Belleği** bölümünden istediğiniz bilgiyi kendiniz kolayca silebilir veya düzenleyebilirsiniz."

Örnek Kayıt:
Kullanıcı: "Benim en sevdiğim oyun Brawl Stars, bunu bellekte tut."
Sen: "En sevdiğim oyunun Brawl Stars olduğunu belleğime kaydettim! Başka ne hakkında konuşmak istersin? [BELLEK_KAYDET: En sevdiği oyun Brawl Stars]"

Eğer kullanıcı açıkça bir şey kaydetmeni İSTEMEDİYSE, kendi kafana göre bu etiketi ASLA KULLANMA.${memoriesText}`;

      // Bellek kaydetme işlemini ayıklayan ve Firestore'a yazan fonksiyon
      const processAIResponse = async (responseText: string): Promise<string> => {
        let finalResponse = sanitizeAIResponse(responseText);
        
        // [BELLEK_KAYDET: X] etiketini ara
        const memoryMatch = finalResponse.match(/\[BELLEK_KAYDET:\s*(.*?)\]/i);
        if (memoryMatch && userId) {
          const memoryTextToSave = memoryMatch[1].trim();
          if (memoryTextToSave) {
            try {
              const db = getFirestore();
              await db.collection(`users/${userId}/memories`).add({
                text: memoryTextToSave,
                createdAt: new Date(),
                updatedAt: new Date()
              });
            } catch (err) {
              console.error("Bellek kaydetme hatası:", err);
            }
          }
          // Etiketi metinden sil ve yerine mesajın başına bilgilendirme ekle
          finalResponse = finalResponse.replace(/\[BELLEK_KAYDET:\s*(.*?)\]/i, '').trim();
          finalResponse = `📖 **Belleğe Kaydedildi**\n\n${finalResponse}`;
        }
        
        return finalResponse;
      };

      // Eğer kullanıcı doğrudan modelini soruyorsa kesin ve hatasız doğrudan yanıt ver
      const isModelQuestion = userMessage && /^(modelin(\s+ne|\s+nedir|\s+hangisi)?|sen\s+hangi\s+modelsin|hangi\s+modelsin|hangi\s+modeli\s+kullan[ıi]yorsun|sen\s+kimsin|modelini\s+s[öo]yle)\??$/i.test(userMessage.trim());
      if (isModelQuestion) {
        return res.json({
          text: "Ben RedChat AI'yım ve **Flash Lite 1.0** modeli üzerine inşa edildim. Türkçe olarak samimi, net ve yardımcı yanıtlar vermek üzere özel olarak yapılandırıldım. Başka merak ettiğin bir şey olursa sormaktan çekinme! 😊",
          provider: "flash_lite_1.0"
        });
      }

      // 1. ÖNCELİK: Groq API
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

          if (userMessage && (groqMessages.length === 0 || groqMessages[groqMessages.length - 1].content !== userMessage)) {
            groqMessages.push({ role: "user", content: userMessage });
          }

          const candidateModels = ["openai/gpt-oss-120b", "gpt-oss-120b", "llama-3.3-70b-versatile"];
          let aiTextResponse: string | null = null;
          let lastGroqError: any = null;

          for (const modelName of candidateModels) {
            try {
              const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${groqApiKey}`,
                },
                body: JSON.stringify({
                  model: modelName,
                  messages: groqMessages,
                  temperature: 0.7,
                  max_tokens: 2048,
                }),
              });

              if (groqRes.ok) {
                const groqData = await groqRes.json();
                const text = groqData.choices?.[0]?.message?.content;
                if (text) {
                  aiTextResponse = text;
                  break;
                }
              } else {
                const errBody = await groqRes.text();
                lastGroqError = errBody;
              }
            } catch (err) {
              lastGroqError = err;
            }
          }

          if (aiTextResponse) {
            const finalProcessedText = await processAIResponse(aiTextResponse);
            return res.json({ text: finalProcessedText, provider: "groq" });
          } else {
            console.warn("Groq API denemeleri başarısız oldu:", lastGroqError);
          }
        } catch (groqErr) {
          console.error("Groq chat endpoint error:", groqErr);
        }
      }

      // 2. OPSİYONEL YEDEK: Gemini API
      if (geminiApiKey) {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: geminiApiKey });

          const chatHistory = Array.isArray(messages) ? messages.slice(-10) : [];
          let contents = "";
          chatHistory.forEach((m: any) => {
            const role = m.role === "assistant" || m.senderId === "system_redchat_ai" ? "RedChat AI" : "Kullanıcı";
            contents += `${role}: ${m.content || m.text}\n`;
          });
          if (userMessage) {
            contents += `Kullanıcı: ${userMessage}\n`;
          }

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `${systemPrompt}\n\nSohbet Geçmişi:\n${contents}\n\nRedChat AI Yanıtı:`,
          });

          if (response?.text) {
            const finalProcessedText = await processAIResponse(response.text);
            return res.json({ text: finalProcessedText, provider: "gemini" });
          }
        } catch (geminiErr) {
          console.warn("Gemini çağrısı başarısız oldu (opsiyonel):", geminiErr);
        }
      }

      // API anahtarı yoksa veya servis yanıt vermediyse samimi bilgilendirme yanıtı
      if (!groqApiKey && !geminiApiKey) {
        return res.json({
          text: "Merhaba! Ben **RedChat AI** asistanıyım. Yapay zeka motorunun tam performansla yanıt verebilmesi için sunucu ortamına `GROQ_API_KEY` eklenmesi gerekmektedir. Size başka bir konuda yardımcı olabilir miyim? 😊",
          provider: "fallback",
        });
      }

      return res.status(503).json({
        error: "RedChat AI şu anda yanıt veremiyor. Lütfen birkaç saniye sonra tekrar deneyin.",
      });
    } catch (error: any) {
      console.error("AI chat server error:", error);
      return res.status(500).json({
        error: "RedChat AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.",
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
