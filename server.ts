import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON gövdeleri için middleware
  app.use(express.json({ limit: "10mb" }));

  // 🤖 REDCHAT AI SERVER-SIDE ENDPOINT (GPT-OSS 120B / Groq / Fallback AI)
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { messages, userMessage } = req.body;

      if (!userMessage && (!messages || messages.length === 0)) {
        return res.status(400).json({ error: "Mesaj içeriği eksik." });
      }

      const groqApiKey = process.env.GROQ_API_KEY?.trim();
      const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

      // 🛡️ Model İsmi Sanitizasyon Fonksiyonu:
      // Kesinlikle 'GPT-4', 'GPT-OSS', 'OpenAI', 'Gemini' veya 'Llama' isimlerini sızdırmaz, daima 'Flash Lite 1.0' yapar.
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
5. Markdown biçimlendirmelerini (kalın metinler, tablolar, listeler, kod blokları) zengin ve düzgün şekilde kullan.
6. Asla sahte bir insan olduğunu iddia etme; RedChat platformunun resmi AI asistanı olduğunu bil.`;

      // Eğer kullanıcı doğrudan modelini soruyorsa kesin ve hatasız doğrudan yanıt ver
      const isModelQuestion = userMessage && /^(modelin(\s+ne|\s+nedir|\s+hangisi)?|sen\s+hangi\s+modelsin|hangi\s+modelsin|hangi\s+modeli\s+kullan[ıi]yorsun|sen\s+kimsin|modelini\s+s[öo]yle)\??$/i.test(userMessage.trim());
      if (isModelQuestion) {
        return res.json({
          text: "Ben RedChat AI'yım ve **Flash Lite 1.0** modeli üzerine inşa edildim. Türkçe olarak samimi, net ve yardımcı yanıtlar vermek üzere özel olarak yapılandırıldım. Başka merak ettiğin bir şey olursa sormaktan çekinme! 😊",
          provider: "flash_lite_1.0"
        });
      }

      // 1. ÖNCELİK: Groq API (GPT-OSS 120B / openai/gpt-oss-120b veya llama-3.3-70b-versatile)
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

          // Groq modellerini dene: 'openai/gpt-oss-120b', 'gpt-oss-120b', 'llama-3.3-70b-versatile'
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
            return res.json({ text: sanitizeAIResponse(aiTextResponse), provider: "groq" });
          } else {
            console.warn("Groq API denemeleri başarısız oldu:", lastGroqError);
          }
        } catch (groqErr) {
          console.error("Groq chat endpoint error:", groqErr);
        }
      }

      // 2. YEDEK: Gemini API (Ortamda GEMINI_API_KEY varsa kesinti yaşatmamak için)
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
            return res.json({ text: sanitizeAIResponse(response.text), provider: "gemini" });
          }
        } catch (geminiErr) {
          console.error("Gemini fallback error:", geminiErr);
        }
      }

      // API anahtarı yoksa veya her iki servis de yanıt vermediyse temiz hata
      return res.status(503).json({
        error: "RedChat AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.",
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
