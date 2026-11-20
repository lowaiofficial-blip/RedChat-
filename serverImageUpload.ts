import type { Express, Request, Response } from "express";

export const FREEIMAGE_UPLOAD_URL = "https://freeimage.host/api/1/upload";
export const FREEIMAGE_TIMEOUT_MS = 15_000;
const MAX_DECODED_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB safety ceiling for processed image payloads

export function isValidHttpsImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function extractCleanBase64Image(rawInput: unknown): {
  cleanBase64: string;
  decodedBytes: number;
} | null {
  if (typeof rawInput !== "string") return null;
  let cleanBase64 = rawInput.trim();
  if (!cleanBase64) return null;

  if (cleanBase64.startsWith("data:")) {
    const match = cleanBase64.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
    if (!match) return null;
    cleanBase64 = match[1].trim();
  } else if (cleanBase64.includes(",")) {
    cleanBase64 = cleanBase64.split(",").pop()?.trim() || "";
  }

  cleanBase64 = cleanBase64.replace(/\s+/g, "");
  if (!cleanBase64 || !/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
    return null;
  }

  const decodedBytes = Buffer.byteLength(cleanBase64, "base64");
  if (decodedBytes <= 0 || decodedBytes > MAX_DECODED_IMAGE_BYTES) {
    return null;
  }

  return { cleanBase64, decodedBytes };
}

export async function uploadToFreeimageHost(
  cleanBase64: string,
  options?: {
    apiKey?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<string> {
  const apiKey = (options?.apiKey ?? process.env.FREEIMAGE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("Görsel yükleme yapılandırması eksik.");
  }

  const fetchImpl = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? FREEIMAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new URLSearchParams();
    form.append("key", apiKey);
    form.append("action", "upload");
    form.append("source", cleanBase64);
    form.append("format", "json");

    const response = await fetchImpl(FREEIMAGE_UPLOAD_URL, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const statusOk = data?.status_code === 200 || data?.success?.code === 200;
    if (!statusOk) {
      throw new Error("Geçersiz görsel yükleme yanıtı.");
    }

    const candidateUrl = [
      data?.image?.url,
      data?.image?.display_url,
      data?.image?.image?.url,
    ].find((candidate) => isValidHttpsImageUrl(candidate));

    if (!candidateUrl) {
      throw new Error("Geçerli görsel bağlantısı alınamadı.");
    }

    return candidateUrl.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerImageUploadRoutes(app: Express): void {
  app.post("/api/upload/freeimage", async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.FREEIMAGE_API_KEY?.trim();
      if (!apiKey) {
        return res.status(503).json({
          error: "Görsel yüklenemedi. Lütfen tekrar deneyin.",
        });
      }

      const extracted = extractCleanBase64Image(req.body?.image);
      if (!extracted) {
        return res.status(400).json({
          error: "Geçersiz veya eksik görsel verisi.",
        });
      }

      const uploadedUrl = await uploadToFreeimageHost(extracted.cleanBase64, {
        apiKey,
        timeoutMs: FREEIMAGE_TIMEOUT_MS,
      });

      return res.json({ url: uploadedUrl });
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      console.warn(
        "Fallback image upload failed:",
        isAbort ? "Request timed out" : err?.message || "Unknown error"
      );
      return res.status(isAbort ? 504 : 502).json({
        error: "Görsel yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.",
      });
    }
  });
}
