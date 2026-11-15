import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "redchat-7c1db";
const ADMIN_EMAILS = ["robloxenes930@gmail.com", "gg00cat73@gmail.com"];
const SECURITY_NOTIFY_EMAIL = "redchatbusiness@outlook.com";

// Sunucu tarafı HMAC oturum doğrulama anahtarı
const SESSION_HMAC_SECRET =
  process.env.SESSION_SECRET ||
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
  process.env.RESEND_API_KEY ||
  "redchat-7c1db-server-session-hmac-secret";

// Google Public x509 Certs cache (Admin SDK yoksa Firebase ID Token doğrulaması için)
let cachedCerts: Record<string, string> = {};
let cachedCertsExpiry = 0;

interface VerifiedTokenUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  token: string;
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < cachedCertsExpiry && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const resp = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    { signal: AbortSignal.timeout(5000) }
  );
  if (!resp.ok) {
    throw new Error(`Google certs fetch failed: ${resp.status}`);
  }

  const cacheControl = resp.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  cachedCertsExpiry = now + maxAgeSec * 1000;
  return cachedCerts;
}

async function verifyBearerIdToken(req: Request): Promise<VerifiedTokenUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  // 1. Firebase Admin SDK mevcutsa doğrudan kullan
  if (getApps().length > 0) {
    try {
      const decoded = await getAuth().verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email || null,
        emailVerified: Boolean(decoded.email_verified),
        token: idToken,
      };
    } catch (err: any) {
      if (err?.code === "auth/id-token-revoked") {
        throw new Error("TOKEN_REVOKED");
      }
      return null;
    }
  }

  // 2. Fallback: Google x509 sertifikalarıyla kriptografik RS256 JWT doğrulaması
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;

    const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
    const signature = base64UrlDecode(parts[2]);

    if (header.alg !== "RS256" || !header.kid) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (payload.aud !== PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== "string") return null;

    const certs = await getGooglePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(certPem, signature);
    if (!valid) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified: Boolean(payload.email_verified),
      token: idToken,
    };
  } catch (err) {
    console.warn("[Security] Fallback ID token verification failed:", err);
    return null;
  }
}

async function authenticateRequest(
  req: Request,
  res: Response,
  asVerifyActive = false
): Promise<VerifiedTokenUser | null> {
  try {
    const tokenUser = await verifyBearerIdToken(req);
    if (!tokenUser) {
      res.status(401).json(
        asVerifyActive
          ? { active: false, reason: "UNAUTHORIZED" }
          : { error: "Kimlik doğrulama gerekli." }
      );
      return null;
    }
    return tokenUser;
  } catch (err: any) {
    if (err?.message === "TOKEN_REVOKED") {
      res.status(401).json(
        asVerifyActive
          ? {
              active: false,
              status: "revoked",
              reason: "TOKEN_REVOKED",
              error: "Oturum jetonu iptal edilmiş.",
            }
          : { error: "Oturum jetonu iptal edilmiş.", code: "TOKEN_REVOKED" }
      );
      return null;
    }
    res.status(401).json(
      asVerifyActive
        ? { active: false, reason: "UNAUTHORIZED" }
        : { error: "Kimlik doğrulama doğrulanamadı." }
    );
    return null;
  }
}

// =========================================================================
// 🔥 FIRESTORE DUAL ADAPTER (Admin SDK + Authenticated REST Fallback)
// =========================================================================

function toRestValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toRestValue) } };
  }
  if (typeof val === "object") {
    if (typeof val.toDate === "function") {
      return { timestampValue: val.toDate().toISOString() };
    }
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toRestValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromRestValue(val: any): any {
  if (!val || typeof val !== "object") return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return Boolean(val.booleanValue);
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("stringValue" in val) return val.stringValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("arrayValue" in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map(fromRestValue);
  }
  if ("mapValue" in val) {
    const out: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromRestValue(v);
    }
    return out;
  }
  return null;
}

function fromRestDoc(docJson: any): Record<string, any> | null {
  if (!docJson || !docJson.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(docJson.fields)) {
    out[k] = fromRestValue(v);
  }
  if (docJson.name) {
    out.id = docJson.name.split("/").pop();
  }
  return out;
}

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function dbGetDoc(
  colPath: string,
  docId: string,
  idToken?: string
): Promise<Record<string, any> | null> {
  if (getApps().length > 0) {
    const snap = await getFirestore().collection(colPath).doc(docId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  const resp = await fetch(`${FIRESTORE_BASE}/${colPath}/${encodeURIComponent(docId)}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST getDoc failed (${resp.status}): ${errText}`);
  }
  const json = await resp.json();
  return fromRestDoc(json);
}

async function dbSetDoc(
  colPath: string,
  docId: string,
  data: Record<string, any>,
  idToken?: string
): Promise<void> {
  if (getApps().length > 0) {
    await getFirestore().collection(colPath).doc(docId).set(data, { merge: true });
    return;
  }

  const cleanData: Record<string, any> = {};
  const fieldPaths: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      cleanData[k] = toRestValue(v);
      fieldPaths.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
    }
  }

  const url = `${FIRESTORE_BASE}/${colPath}/${encodeURIComponent(docId)}?${fieldPaths.join("&")}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ fields: cleanData }),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST setDoc failed (${resp.status}): ${errText}`);
  }
}

async function dbQueryByUserId(
  colPath: string,
  userId: string,
  idToken?: string
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const snap = await getFirestore()
      .collection(colPath)
      .where("userId", "==", userId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const resp = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: colPath }],
        where: {
          fieldFilter: {
            field: { fieldPath: "userId" },
            op: "EQUAL",
            value: { stringValue: userId },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST query failed (${resp.status}): ${errText}`);
  }

  const rows = (await resp.json()) as any[];
  const out: Record<string, any>[] = [];
  for (const row of rows) {
    if (row.document) {
      const parsed = fromRestDoc(row.document);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// =========================================================================
// 🌐 IP & GERÇEK GEOIP TESPİTİ
// =========================================================================

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (!ip) return true;
  const clean = ip.trim().replace(/^::ffff:/, "");
  if (
    clean === "::1" ||
    clean === "127.0.0.1" ||
    clean === "0.0.0.0" ||
    clean === "localhost" ||
    clean.startsWith("10.") ||
    clean.startsWith("192.168.") ||
    clean.startsWith("fc") ||
    clean.startsWith("fd") ||
    clean.startsWith("fe80:")
  ) {
    return true;
  }
  // 172.16.0.0 - 172.31.255.255
  if (clean.startsWith("172.")) {
    const second = parseInt(clean.split(".")[1] || "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function isValidIpFormat(ip: string): boolean {
  const clean = ip.trim().replace(/^::ffff:/, "");
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  return ipv4Regex.test(clean) || (clean.includes(":") && ipv6Regex.test(clean));
}

export async function extractRealClientIp(req: Request, clientPublicIp?: string): Promise<string> {
  const candidates: string[] = [];

  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string") candidates.push(cfIp.trim());

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    forwarded.split(",").forEach((part) => candidates.push(part.trim()));
  } else if (Array.isArray(forwarded)) {
    forwarded.forEach((part) => candidates.push(part.trim()));
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") candidates.push(realIp.trim());

  if (req.socket?.remoteAddress) candidates.push(req.socket.remoteAddress);
  if (req.ip) candidates.push(req.ip);

  // İlk herkese açık (public) IP'yi seç
  for (const raw of candidates) {
    const clean = raw.replace(/^::ffff:/, "").trim();
    if (clean && isValidIpFormat(clean) && !isPrivateOrLoopbackIp(clean)) {
      return clean;
    }
  }

  // Proxy olmayan yerel test/geliştirme ortamında istemcinin bildirdiği veya sunucu çıkış IP'si
  if (clientPublicIp && isValidIpFormat(clientPublicIp) && !isPrivateOrLoopbackIp(clientPublicIp)) {
    return clientPublicIp.trim();
  }

  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const json = (await res.json()) as { ip?: string };
      if (json.ip && isValidIpFormat(json.ip) && !isPrivateOrLoopbackIp(json.ip)) {
        return json.ip;
      }
    }
  } catch {
    // sessiz geç
  }

  const fallback = (candidates[0] || "127.0.0.1").replace(/^::ffff:/, "");
  return fallback || "127.0.0.1";
}

export function getCountryNameTurkish(countryCode: string, fallbackName?: string): string {
  const code = (countryCode || "").trim().toUpperCase();
  if (!code || code === "UNKNOWN" || code.length !== 2) {
    return fallbackName || "Bilinmeyen Ülke";
  }
  try {
    const displayNames = new Intl.DisplayNames(["tr"], { type: "region" });
    return displayNames.of(code) || fallbackName || code;
  } catch {
    return fallbackName || code;
  }
}

export function getCountryFlagEmoji(countryCode: string): string {
  const code = (countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(
    ...[...code].map((char) => 127397 + char.charCodeAt(0))
  );
}

export interface GeoIpResult {
  ip: string;
  countryCode: string;
  countryName: string;
  flagEmoji: string;
  city: string | null;
  region: string | null;
  isp: string | null;
  provider: string;
}

export async function lookupGeoIp(ip: string, req?: Request): Promise<GeoIpResult> {
  const cleanIp = ip.replace(/^::ffff:/, "").trim();

  if (!isPrivateOrLoopbackIp(cleanIp)) {
    // 1. Provider: ipwho.is
    try {
      const resp = await fetch(`https://ipwho.is/${encodeURIComponent(cleanIp)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (data?.success && data?.country_code) {
          const code = String(data.country_code).toUpperCase();
          return {
            ip: cleanIp,
            countryCode: code,
            countryName: getCountryNameTurkish(code, data.country),
            flagEmoji: getCountryFlagEmoji(code),
            city: data.city || null,
            region: data.region || null,
            isp: data.connection?.isp || data.connection?.org || null,
            provider: "ipwho.is",
          };
        }
      }
    } catch (err) {
      console.warn("[GeoIP] ipwho.is error:", err);
    }

    // 2. Provider: ipapi.co
    try {
      const resp = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`, {
        headers: { "User-Agent": "RedChat-Security/1.0" },
        signal: AbortSignal.timeout(3500),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (!data?.error && data?.country_code) {
          const code = String(data.country_code).toUpperCase();
          return {
            ip: cleanIp,
            countryCode: code,
            countryName: getCountryNameTurkish(code, data.country_name),
            flagEmoji: getCountryFlagEmoji(code),
            city: data.city || null,
            region: data.region || null,
            isp: data.org || null,
            provider: "ipapi.co",
          };
        }
      }
    } catch (err) {
      console.warn("[GeoIP] ipapi.co error:", err);
    }

    // 3. Provider: ip-api.com
    try {
      const resp = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,country,countryCode,regionName,city,isp`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (resp.ok) {
        const data: any = await resp.json();
        if (data?.status === "success" && data?.countryCode) {
          const code = String(data.countryCode).toUpperCase();
          return {
            ip: cleanIp,
            countryCode: code,
            countryName: getCountryNameTurkish(code, data.country),
            flagEmoji: getCountryFlagEmoji(code),
            city: data.city || null,
            region: data.regionName || null,
            isp: data.isp || null,
            provider: "ip-api.com",
          };
        }
      }
    } catch (err) {
      console.warn("[GeoIP] ip-api.com error:", err);
    }
  }

  // 4. Proxy / CDN başlıklarından ülke kodu kontrolü (örn. Cloudflare / Cloud Run / AppEngine)
  if (req) {
    const headerCode =
      (req.headers["cf-ipcountry"] as string) ||
      (req.headers["x-appengine-country"] as string) ||
      (req.headers["x-vercel-ip-country"] as string) ||
      "";
    const normCode = headerCode.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normCode) && normCode !== "XX" && normCode !== "T1") {
      return {
        ip: cleanIp,
        countryCode: normCode,
        countryName: getCountryNameTurkish(normCode),
        flagEmoji: getCountryFlagEmoji(normCode),
        city: (req.headers["x-appengine-city"] as string) || null,
        region: (req.headers["x-appengine-region"] as string) || null,
        isp: null,
        provider: "proxy-header",
      };
    }
  }

  return {
    ip: cleanIp,
    countryCode: "UNKNOWN",
    countryName: "Bilinmeyen Ülke",
    flagEmoji: "🌐",
    city: null,
    region: null,
    isp: null,
    provider: "unresolved",
  };
}

// =========================================================================
// 💻 GÜVENİLİR CİHAZ & TARAYICI PARSER
// =========================================================================

export function parseUserAgentInfo(uaRaw: string): {
  browserName: string;
  osName: string;
  deviceType: "desktop" | "tablet" | "mobile";
} {
  const ua = uaRaw || "";

  let browserName = "Bilinmeyen Tarayıcı";
  if (/Edg\//i.test(ua)) browserName = "Microsoft Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browserName = "Opera";
  else if (/Firefox\//i.test(ua)) browserName = "Mozilla Firefox";
  else if (/SamsungBrowser\//i.test(ua)) browserName = "Samsung Internet";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browserName = "Google Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browserName = "Apple Safari";

  let osName = "Bilinmeyen İşletim Sistemi";
  if (/Windows NT 10/i.test(ua)) osName = "Windows 10/11";
  else if (/Windows/i.test(ua)) osName = "Windows";
  else if (/iPhone/i.test(ua)) osName = "iOS (iPhone)";
  else if (/iPad/i.test(ua)) osName = "iPadOS";
  else if (/Android/i.test(ua)) osName = "Android";
  else if (/Mac OS X/i.test(ua)) osName = "macOS";
  else if (/Linux/i.test(ua)) osName = "Linux";

  let deviceType: "desktop" | "tablet" | "mobile" = "desktop";
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) {
    deviceType = "tablet";
  } else if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    deviceType = "mobile";
  }

  return { browserName, osName, deviceType };
}

// =========================================================================
// 🔐 KRİPTOGRAFİK OTURUM İMZALAMA & DOĞRULAMA
// =========================================================================

function computeProofHash(sessionProof: string): string {
  return crypto.createHash("sha256").update(sessionProof).digest("hex");
}

function computeSessionHmac(sessionId: string, userId: string, deviceId: string): string {
  return crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(`${sessionId}|${userId}|${deviceId}`)
    .digest("hex");
}

function buildSessionProof(sessionId: string, userId: string, deviceId: string): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = computeSessionHmac(sessionId, userId, deviceId).slice(0, 32);
  return `${sig}.${nonce}`;
}

function verifyProofAgainstSession(
  proof: string,
  session: Record<string, any>,
  networkDoc: Record<string, any> | null
): boolean {
  if (!proof || typeof proof !== "string") return false;
  if (networkDoc?.proofHash) {
    return computeProofHash(proof) === networkDoc.proofHash;
  }
  const expectedPrefix = computeSessionHmac(
    session.sessionId,
    session.userId,
    session.deviceId
  ).slice(0, 32);
  return proof.startsWith(`${expectedPrefix}.`);
}

// =========================================================================
// 📧 RESEND E-POSTA GÖNDERİM YARDIMCISI
// =========================================================================

interface SecurityEmailPayload {
  eventType: "new_country_detected" | "user_confirmed_me" | "user_denied_not_me";
  username: string;
  displayName: string;
  userId: string;
  previousCountryName: string;
  newCountryName: string;
  newCountryFlag: string;
  loginTimeFormatted: string;
  userChoiceLabel: string;
  ip: string;
  deviceSummary: string;
}

async function sendSecurityResendEmail(payload: SecurityEmailPayload): Promise<{
  sent: boolean;
  status: "sent" | "failed" | "not_configured";
  error?: string;
}> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey || !resendApiKey.trim()) {
    console.warn("⚠️ [Security Email] RESEND_API_KEY tanımlı değil; e-posta gönderilemedi.");
    return {
      sent: false,
      status: "not_configured",
      error: "RESEND_API_KEY ortam değişkeni sunucuda tanımlı değil.",
    };
  }

  const subject =
    payload.eventType === "new_country_detected"
      ? "RedChat — Yeni Ülkeden Oturum Açıldı"
      : payload.eventType === "user_denied_not_me"
      ? "RedChat ACİL — Kullanıcı Şüpheli Oturumu Reddetti (Ben Değilim)"
      : "RedChat — Şüpheli Oturum İçin Kullanıcı Yanıtı (Bu Benim)";

  const accentColor =
    payload.eventType === "user_denied_not_me"
      ? "#dc2626"
      : payload.eventType === "user_confirmed_me"
      ? "#d97706"
      : "#dc2626";

  const bannerTitle =
    payload.eventType === "new_country_detected"
      ? "Yeni Ülkeden Oturum Açıldı"
      : payload.eventType === "user_denied_not_me"
      ? "ACİL GÜVENLİK UYARISI — Oturum Reddedildi"
      : "Kullanıcı Girişi Kendisine Ait Olduğunu Bildirdi";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #27272a; border-radius: 16px; background-color: #09090b; color: #f4f4f5;">
      <div style="border-bottom: 1px solid #27272a; padding-bottom: 14px; margin-bottom: 18px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: ${accentColor}; font-weight: 700;">
          RedChat Oturum Güvenliği
        </div>
        <h2 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700; color: #ffffff;">
          ${bannerTitle}
        </h2>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tbody>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b; width: 42%;">Kullanıcı adı</td>
            <td style="padding: 9px 0; color: #ffffff; font-weight: 600; border-bottom: 1px solid #18181b;">@${payload.username} (${payload.displayName})</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Hesap kimliği</td>
            <td style="padding: 9px 0; color: #e4e4e7; font-family: monospace; border-bottom: 1px solid #18181b;">${payload.userId}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Önceki bilinen ülke</td>
            <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${payload.previousCountryName}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Yeni giriş yapılan ülke</td>
            <td style="padding: 9px 0; color: #fbbf24; font-weight: 700; border-bottom: 1px solid #18181b;">${payload.newCountryName} ${payload.newCountryFlag}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Oturum açılma zamanı</td>
            <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${payload.loginTimeFormatted}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Kullanıcının seçimi</td>
            <td style="padding: 9px 0; color: #ffffff; font-weight: 700; border-bottom: 1px solid #18181b;">${payload.userChoiceLabel}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">IP adresi (Admin)</td>
            <td style="padding: 9px 0; color: #e4e4e7; font-family: monospace; border-bottom: 1px solid #18181b;">${payload.ip}</td>
          </tr>
          <tr>
            <td style="padding: 9px 0; color: #a1a1aa;">Cihaz ve tarayıcı</td>
            <td style="padding: 9px 0; color: #e4e4e7;">${payload.deviceSummary}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #27272a; font-size: 12px; color: #71717a;">
        Bu bildirim RedChat Oturum Güvenliği sistemi tarafından otomatik olarak oluşturulmuştur. Yönetici onay/iptal işlemleri Admin Paneli → Şüpheli Oturumlar sekmesinden yapılabilir.
      </div>
    </div>
  `;

  const text = [
    bannerTitle,
    `Kullanıcı adı: @${payload.username} (${payload.displayName})`,
    `Hesap kimliği: ${payload.userId}`,
    `Önceki bilinen ülke: ${payload.previousCountryName}`,
    `Yeni giriş yapılan ülke: ${payload.newCountryName} ${payload.newCountryFlag}`,
    `Oturum açılma zamanı: ${payload.loginTimeFormatted}`,
    `Kullanıcının seçimi: ${payload.userChoiceLabel}`,
    `IP adresi: ${payload.ip}`,
    `Cihaz ve tarayıcı: ${payload.deviceSummary}`,
  ].join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey.trim()}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to: [SECURITY_NOTIFY_EMAIL],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok) {
      return { sent: true, status: "sent" };
    }

    const errText = await resp.text();
    console.warn(`⚠️ [Security Resend] HTTP ${resp.status}:`, errText);
    return {
      sent: false,
      status: "failed",
      error: `Resend HTTP ${resp.status}: ${errText}`,
    };
  } catch (err: any) {
    console.error("❌ [Security Resend] Exception:", err);
    return {
      sent: false,
      status: "failed",
      error: err?.message || "Resend ağ hatası",
    };
  }
}

function formatTrDateTime(d: Date): string {
  return d.toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "full",
    timeStyle: "medium",
  });
}

async function writeAdminLog(
  params: {
    category: "security_session" | "email_review" | "moderation" | "system";
    action: string;
    severity: "info" | "warning" | "critical";
    actorUid: string;
    actorEmail?: string | null;
    actorName?: string | null;
    targetUid?: string | null;
    targetUsername?: string | null;
    sessionId?: string | null;
    details: string;
    metadata?: Record<string, any>;
  },
  idToken?: string
) {
  const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  try {
    await dbSetDoc(
      "adminLogs",
      logId,
      {
        id: logId,
        category: params.category,
        action: params.action,
        severity: params.severity,
        actorUid: params.actorUid,
        actorEmail: params.actorEmail || null,
        actorName: params.actorName || null,
        targetUid: params.targetUid || null,
        targetUsername: params.targetUsername || null,
        sessionId: params.sessionId || null,
        details: params.details,
        metadata: params.metadata || {},
        createdAt: new Date(),
      },
      idToken
    );
  } catch (err) {
    console.warn("[AdminLogs] Log yazılamadı:", err);
  }
}

async function assertAdminUser(tokenUser: VerifiedTokenUser): Promise<{
  isAdmin: boolean;
  displayName: string;
}> {
  const emailLower = (tokenUser.email || "").trim().toLowerCase();
  const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token).catch(() => null);
  const isAdmin =
    ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(emailLower) ||
    userDoc?.role === "admin";
  return {
    isAdmin,
    displayName: userDoc?.displayName || userDoc?.username || tokenUser.email || "Admin",
  };
}

// =========================================================================
// 🛡️ EXPRESS SECURITY ROUTES
// =========================================================================

export function registerSessionSecurityRoutes(app: Express) {
  // 1. Oturum Kaydı ve Yeni Ülke + Yeni Cihaz Kontrolü
  app.post("/api/security/sessions/register", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const {
        deviceId,
        userAgent,
        existingSessionId,
        existingSessionProof,
        clientPublicIp,
        isFreshLogin,
      } = req.body || {};

      if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length < 4) {
        return res.status(400).json({ error: "Geçerli cihaz kimliği (deviceId) gerekli." });
      }

      const cleanDeviceId = deviceId.trim().slice(0, 140);
      const uaString = typeof userAgent === "string" ? userAgent : req.headers["user-agent"] || "";
      const uaInfo = parseUserAgentInfo(uaString);

      const clientIp = await extractRealClientIp(req, clientPublicIp);
      const geo = await lookupGeoIp(clientIp, req);
      const now = new Date();

      const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token);
      const username = userDoc?.username || tokenUser.email?.split("@")[0] || "kullanici";
      const displayName = userDoc?.displayName || username;
      const photoURL = userDoc?.photoURL || null;

      // Eğer istemcinin geçerli bir mevcut oturum kimliği varsa ve taze login değilse doğrula
      if (
        !isFreshLogin &&
        typeof existingSessionId === "string" &&
        existingSessionId.trim().length > 0 &&
        typeof existingSessionProof === "string"
      ) {
        const existingSession = await dbGetDoc("securitySessions", existingSessionId.trim(), tokenUser.token);
        if (existingSession && existingSession.userId === tokenUser.uid) {
          const networkDoc = await dbGetDoc(
            "securitySessionNetwork",
            existingSessionId.trim(),
            tokenUser.token
          ).catch(() => null);

          if (verifyProofAgainstSession(existingSessionProof, existingSession, networkDoc)) {
            if (existingSession.status === "active") {
              await dbSetDoc(
                "securitySessions",
                existingSession.sessionId,
                { lastActiveAt: now },
                tokenUser.token
              );
            }
            return res.json({
              success: true,
              session: existingSession,
              sessionProof: existingSessionProof,
              geoSummary: {
                countryCode: existingSession.countryCode,
                countryName: existingSession.countryName,
                flagEmoji: existingSession.flagEmoji,
              },
            });
          }
        }
      }

      // Kullanıcının bilinen ülke & cihaz profili (Security Baseline)
      const secProfile = await dbGetDoc("userSecurityProfiles", tokenUser.uid, tokenUser.token);
      const knownCountryCodes: string[] = Array.isArray(secProfile?.knownCountryCodes)
        ? secProfile.knownCountryCodes
        : [];
      const knownDeviceIds: string[] = Array.isArray(secProfile?.knownDeviceIds)
        ? secProfile.knownDeviceIds
        : [];

      const hasBaseline = knownCountryCodes.length > 0 || knownDeviceIds.length > 0;
      const detectedCode = geo.countryCode;
      const isNewCountry =
        detectedCode !== "UNKNOWN" && !knownCountryCodes.includes(detectedCode);
      const isNewDevice = !knownDeviceIds.includes(cleanDeviceId);

      // Onaylı kural: Yalnızca YENİ CİHAZ ve YENİ ÜLKE birlikteyse güvenlik kontrolü tetiklenir!
      const shouldTriggerCountryCheck = hasBaseline && isNewCountry && isNewDevice;

      const sessionId = `sess_${crypto.randomBytes(12).toString("hex")}`;
      const sessionProof = buildSessionProof(sessionId, tokenUser.uid, cleanDeviceId);
      const proofHash = computeProofHash(sessionProof);

      const previousCountryCode = secProfile?.lastKnownCountryCode || knownCountryCodes[0] || null;
      const previousCountryName =
        secProfile?.lastKnownCountryName ||
        (previousCountryCode ? getCountryNameTurkish(previousCountryCode) : "Bilinmiyor");

      let emailResult: { sent: boolean; status: "sent" | "failed" | "not_configured" | "skipped"; error?: string } = {
        sent: false,
        status: "skipped",
      };

      const sessionData: Record<string, any> = {
        id: sessionId,
        sessionId,
        userId: tokenUser.uid,
        username,
        displayName,
        photoURL,
        deviceId: cleanDeviceId,
        deviceType: uaInfo.deviceType,
        browserName: uaInfo.browserName,
        osName: uaInfo.osName,
        countryCode: geo.countryCode,
        countryName: geo.countryName,
        flagEmoji: geo.flagEmoji,
        previousCountryCode,
        previousCountryName,
        isSuspicious: shouldTriggerCountryCheck,
        trusted: !shouldTriggerCountryCheck,
        status: shouldTriggerCountryCheck ? "pending_verification" : "active",
        userResponse: shouldTriggerCountryCheck ? "pending" : "not_required",
        adminDecision: shouldTriggerCountryCheck ? "pending" : "auto_trusted",
        createdAt: now,
        lastActiveAt: now,
      };

      const networkData: Record<string, any> = {
        id: sessionId,
        sessionId,
        userId: tokenUser.uid,
        ip: geo.ip,
        city: geo.city,
        region: geo.region,
        isp: geo.isp,
        countryCode: geo.countryCode,
        countryName: geo.countryName,
        geoProvider: geo.provider,
        userAgentRaw: uaString.slice(0, 500),
        proofHash,
        createdAt: now,
        updatedAt: now,
      };

      // İlk kez baseline oluşturuluyor ya da mevcut ülke + yeni cihaz ise baseline güncelle
      if (!hasBaseline) {
        await dbSetDoc(
          "userSecurityProfiles",
          tokenUser.uid,
          {
            uid: tokenUser.uid,
            knownCountryCodes: detectedCode !== "UNKNOWN" ? [detectedCode] : [],
            knownDeviceIds: [cleanDeviceId],
            lastKnownCountryCode: detectedCode !== "UNKNOWN" ? detectedCode : null,
            lastKnownCountryName: detectedCode !== "UNKNOWN" ? geo.countryName : null,
            createdAt: now,
            updatedAt: now,
          },
          tokenUser.token
        );
      } else if (!shouldTriggerCountryCheck && isNewDevice && !isNewCountry) {
        // Bilinen ülkeden yeni cihaz -> güvenilen cihaz listesine ekle
        const nextDevices = Array.from(new Set([...knownDeviceIds, cleanDeviceId])).slice(-25);
        await dbSetDoc(
          "userSecurityProfiles",
          tokenUser.uid,
          {
            uid: tokenUser.uid,
            knownDeviceIds: nextDevices,
            updatedAt: now,
          },
          tokenUser.token
        );
      }

      if (shouldTriggerCountryCheck) {
        // Admin'e Resend üzerinden gerçek e-posta gönder
        emailResult = await sendSecurityResendEmail({
          eventType: "new_country_detected",
          username,
          displayName,
          userId: tokenUser.uid,
          previousCountryName,
          newCountryName: geo.countryName,
          newCountryFlag: geo.flagEmoji,
          loginTimeFormatted: formatTrDateTime(now),
          userChoiceLabel: "Henüz yanıtlamadı (Güvenlik ekranında bekleniyor)",
          ip: geo.ip,
          deviceSummary: `${uaInfo.browserName} · ${uaInfo.osName} (${uaInfo.deviceType})`,
        });

        sessionData.emailSent = emailResult.sent;
        sessionData.emailStatus = emailResult.status;
        sessionData.emailError = emailResult.error || null;

        await writeAdminLog(
          {
            category: "security_session",
            action: "new_country_detected",
            severity: "warning",
            actorUid: tokenUser.uid,
            actorEmail: tokenUser.email,
            actorName: displayName,
            targetUid: tokenUser.uid,
            targetUsername: username,
            sessionId,
            details: `Yeni cihaz ve yeni ülkeden giriş algılandı: ${geo.countryName} (${geo.countryCode}). Önceki bilinen ülke: ${previousCountryName}.`,
            metadata: {
              countryCode: geo.countryCode,
              countryName: geo.countryName,
              previousCountryName,
              emailStatus: emailResult.status,
            },
          },
          tokenUser.token
        );
      }

      await dbSetDoc("securitySessions", sessionId, sessionData, tokenUser.token);
      await dbSetDoc("securitySessionNetwork", sessionId, networkData, tokenUser.token);

      return res.json({
        success: true,
        session: sessionData,
        sessionProof,
        emailResult,
        geoSummary: {
          countryCode: geo.countryCode,
          countryName: geo.countryName,
          flagEmoji: geo.flagEmoji,
        },
      });
    } catch (err: any) {
      console.error("❌ [Security Register] Error:", err);
      return res.status(500).json({
        error: err?.message || "Oturum güvenlik kontrolü tamamlanamadı.",
      });
    }
  });

  // 2. Kullanıcı Kararı ("Bu Benim" / "Ben Değilim")
  app.post("/api/security/sessions/respond", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { sessionId, sessionProof, response } = req.body || {};
      if (!sessionId || !["confirmed_me", "denied_not_me"].includes(response)) {
        return res.status(400).json({ error: "Geçersiz güvenlik yanıtı." });
      }

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session) {
        return res.status(404).json({ error: "Oturum kaydı bulunamadı." });
      }

      if (session.userId !== tokenUser.uid) {
        return res.status(403).json({ error: "Bu oturuma yanıt verme yetkiniz yok." });
      }

      // Yetkili oturum kontrolü: Başka bir oturumun bu oturum yerine yanıt vermesini engelle
      const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
        () => null
      );
      if (!verifyProofAgainstSession(sessionProof, session, networkDoc)) {
        return res.status(403).json({
          error: "Bu güvenlik kararını yalnızca ilgili cihaz oturumundan bildirebilirsiniz.",
        });
      }

      if (session.status !== "pending_verification") {
        return res.status(400).json({
          error: "Bu oturum için güvenlik yanıtı zaten işlenmiş veya oturum sonlandırılmış.",
        });
      }

      const now = new Date();
      const isConfirmedMe = response === "confirmed_me";

      const updates: Record<string, any> = isConfirmedMe
        ? {
            userResponse: "confirmed_me",
            userRespondedAt: now,
            status: "awaiting_admin_approval",
            adminDecision: "pending",
            lastActiveAt: now,
          }
        : {
            userResponse: "denied_not_me",
            userRespondedAt: now,
            status: "revoked",
            trusted: false,
            adminDecision: "revoked",
            revokedAt: now,
            revokedBy: tokenUser.uid,
            revokedReason: "user_denied_not_me",
            lastActiveAt: now,
          };

      const emailResult = await sendSecurityResendEmail({
        eventType: isConfirmedMe ? "user_confirmed_me" : "user_denied_not_me",
        username: session.username,
        displayName: session.displayName,
        userId: session.userId,
        previousCountryName: session.previousCountryName || "Bilinmiyor",
        newCountryName: session.countryName,
        newCountryFlag: session.flagEmoji || "🌐",
        loginTimeFormatted: formatTrDateTime(now),
        userChoiceLabel: isConfirmedMe
          ? "Bu Benim (Kullanıcı onayladı — Admin incelemesi bekleniyor)"
          : "Ben Değilim (Şüpheli oturum kullanıcı tarafından iptal edildi)",
        ip: networkDoc?.ip || "Bilinmiyor",
        deviceSummary: `${session.browserName} · ${session.osName} (${session.deviceType})`,
      });

      updates.emailSent = emailResult.sent;
      updates.emailStatus = emailResult.status;
      updates.emailError = emailResult.error || null;

      await dbSetDoc("securitySessions", sessionId, updates, tokenUser.token);

      await writeAdminLog(
        {
          category: "security_session",
          action: isConfirmedMe ? "user_confirmed_login" : "user_denied_login_urgent",
          severity: isConfirmedMe ? "info" : "critical",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: session.displayName,
          targetUid: session.userId,
          targetUsername: session.username,
          sessionId,
          details: isConfirmedMe
            ? `@${session.username} ${session.countryName} girişi için 'Bu Benim' seçeneğini bildirdi. Admin onayı bekleniyor.`
            : `ACİL: @${session.username} ${session.countryName} girişi için 'Ben Değilim' dedi ve oturum derhal iptal edildi.`,
          metadata: {
            countryCode: session.countryCode,
            countryName: session.countryName,
            emailStatus: emailResult.status,
          },
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        session: { ...session, ...updates },
        emailResult,
      });
    } catch (err: any) {
      console.error("❌ [Security Respond] Error:", err);
      return res.status(500).json({ error: err?.message || "Güvenlik yanıtı kaydedilemedi." });
    }
  });

  // 3. Kullanıcı İsteğiyle Diğer Tüm Oturumları Tek Tıkla Kapat ("Ben Değilim" Sonrası)
  app.post("/api/security/sessions/revoke-other-all", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { sessionId, sessionProof } = req.body || {};
      if (!sessionId || !sessionProof) {
        return res.status(400).json({ error: "Oturum doğrulama bilgileri eksik." });
      }

      const callerSession = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
        () => null
      );

      if (
        !callerSession ||
        callerSession.userId !== tokenUser.uid ||
        !verifyProofAgainstSession(sessionProof, callerSession, networkDoc)
      ) {
        return res.status(403).json({ error: "Yetkisiz oturum işlemi." });
      }

      const allUserSessions = await dbQueryByUserId("securitySessions", tokenUser.uid, tokenUser.token);
      const now = new Date();
      let revokedCount = 0;

      for (const s of allUserSessions) {
        if (s.status !== "revoked") {
          await dbSetDoc(
            "securitySessions",
            s.sessionId || s.id,
            {
              status: "revoked",
              trusted: false,
              adminDecision: "revoked",
              revokedAt: now,
              revokedBy: tokenUser.uid,
              revokedReason: "user_revoked_all_after_alert",
            },
            tokenUser.token
          );
          revokedCount++;
        }
      }

      let firebaseTokensRevoked = false;
      if (getApps().length > 0) {
        try {
          await getAuth().revokeRefreshTokens(tokenUser.uid);
          firebaseTokensRevoked = true;
        } catch (err) {
          console.warn("[RevokeOtherAll] revokeRefreshTokens error:", err);
        }
      }

      await writeAdminLog(
        {
          category: "security_session",
          action: "user_revoked_all_sessions",
          severity: "critical",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: callerSession.displayName,
          targetUid: tokenUser.uid,
          targetUsername: callerSession.username,
          sessionId,
          details: `@${callerSession.username} güvenlik uyarısı sonrası diğer tüm aktif oturumlarını (${revokedCount} oturum) tek tıkla kapattı.`,
          metadata: { revokedCount, firebaseTokensRevoked },
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        revokedCount,
        firebaseTokensRevoked,
      });
    } catch (err: any) {
      console.error("❌ [Revoke Other All] Error:", err);
      return res.status(500).json({ error: err?.message || "Diğer oturumlar kapatılamadı." });
    }
  });

  // 4. Oturumun Aktifliğini Sunucuda Doğrula
  app.post("/api/security/sessions/verify-active", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res, true);
      if (!tokenUser) return;
      const { sessionId, sessionProof } = req.body || {};
      if (!sessionId || !sessionProof) {
        return res.status(400).json({ active: false, reason: "MISSING_SESSION" });
      }

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || session.userId !== tokenUser.uid) {
        return res.status(401).json({ active: false, reason: "SESSION_NOT_FOUND" });
      }

      const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
        () => null
      );
      if (!verifyProofAgainstSession(sessionProof, session, networkDoc)) {
        return res.status(403).json({ active: false, reason: "INVALID_PROOF" });
      }

      return res.json({
        active: session.status === "active",
        status: session.status,
      });
    } catch {
      return res.status(500).json({ active: false, reason: "SERVER_ERROR" });
    }
  });

  // 5. ADMIN: Oturuma İzin Ver
  app.post("/api/admin/security/sessions/approve", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertAdminUser(tokenUser);
      if (!adminCheck.isAdmin) {
        return res.status(403).json({ error: "Bu işlem için yönetici yetkisi gerekli." });
      }

      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session) return res.status(404).json({ error: "Oturum bulunamadı." });

      const now = new Date();
      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          status: "active",
          trusted: true,
          adminDecision: "approved",
          adminReviewedAt: now,
          adminReviewedBy: tokenUser.email || tokenUser.uid,
          lastActiveAt: now,
        },
        tokenUser.token
      );

      // Kullanıcının bilinen ülke ve cihaz profilini güncelle
      const secProfile = await dbGetDoc("userSecurityProfiles", session.userId, tokenUser.token);
      const existingCountries: string[] = Array.isArray(secProfile?.knownCountryCodes)
        ? secProfile.knownCountryCodes
        : [];
      const existingDevices: string[] = Array.isArray(secProfile?.knownDeviceIds)
        ? secProfile.knownDeviceIds
        : [];

      const nextCountries =
        session.countryCode && session.countryCode !== "UNKNOWN"
          ? Array.from(new Set([...existingCountries, session.countryCode]))
          : existingCountries;
      const nextDevices = session.deviceId
        ? Array.from(new Set([...existingDevices, session.deviceId])).slice(-25)
        : existingDevices;

      await dbSetDoc(
        "userSecurityProfiles",
        session.userId,
        {
          uid: session.userId,
          knownCountryCodes: nextCountries,
          knownDeviceIds: nextDevices,
          lastKnownCountryCode: session.countryCode || secProfile?.lastKnownCountryCode || null,
          lastKnownCountryName: session.countryName || secProfile?.lastKnownCountryName || null,
          updatedAt: now,
        },
        tokenUser.token
      );

      await writeAdminLog(
        {
          category: "security_session",
          action: "admin_approved_session",
          severity: "info",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: adminCheck.displayName,
          targetUid: session.userId,
          targetUsername: session.username,
          sessionId,
          details: `Admin (${adminCheck.displayName}), @${session.username} kullanıcısının ${session.countryName} oturumuna izin verdi.`,
          metadata: {
            countryCode: session.countryCode,
            countryName: session.countryName,
            deviceId: session.deviceId,
          },
        },
        tokenUser.token
      );

      return res.json({ success: true });
    } catch (err: any) {
      console.error("❌ [Admin Approve Session] Error:", err);
      return res.status(500).json({ error: err?.message || "Oturum onaylanamadı." });
    }
  });

  // 6. ADMIN: Yalnızca Seçilen Tek Oturumu Kapat (Diğer cihazlara dokunmaz)
  app.post("/api/admin/security/sessions/revoke-single", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertAdminUser(tokenUser);
      if (!adminCheck.isAdmin) {
        return res.status(403).json({ error: "Bu işlem için yönetici yetkisi gerekli." });
      }

      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session) return res.status(404).json({ error: "Oturum bulunamadı." });

      const now = new Date();
      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          status: "revoked",
          trusted: false,
          adminDecision: "revoked",
          adminReviewedAt: now,
          adminReviewedBy: tokenUser.email || tokenUser.uid,
          revokedAt: now,
          revokedBy: tokenUser.email || tokenUser.uid,
          revokedReason: "admin_revoked_single",
        },
        tokenUser.token
      );

      await writeAdminLog(
        {
          category: "security_session",
          action: "admin_revoked_single_session",
          severity: "warning",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: adminCheck.displayName,
          targetUid: session.userId,
          targetUsername: session.username,
          sessionId,
          details: `Admin (${adminCheck.displayName}), @${session.username} kullanıcısının ${session.countryName} (${session.browserName}) oturumunu tekil olarak kapattı. Diğer oturumlar korundu.`,
          metadata: {
            countryCode: session.countryCode,
            countryName: session.countryName,
          },
        },
        tokenUser.token
      );

      return res.json({ success: true });
    } catch (err: any) {
      console.error("❌ [Admin Revoke Single] Error:", err);
      return res.status(500).json({ error: err?.message || "Oturum kapatılamadı." });
    }
  });

  // 7. ADMIN: Kullanıcının Tüm Oturumlarını Kapat
  app.post("/api/admin/security/sessions/revoke-all", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertAdminUser(tokenUser);
      if (!adminCheck.isAdmin) {
        return res.status(403).json({ error: "Bu işlem için yönetici yetkisi gerekli." });
      }

      const { targetUid, targetUsername } = req.body || {};
      if (!targetUid) return res.status(400).json({ error: "targetUid gerekli." });

      const sessions = await dbQueryByUserId("securitySessions", targetUid, tokenUser.token);
      const now = new Date();
      let revokedCount = 0;

      for (const s of sessions) {
        if (s.status !== "revoked") {
          await dbSetDoc(
            "securitySessions",
            s.sessionId || s.id,
            {
              status: "revoked",
              trusted: false,
              adminDecision: "revoked",
              adminReviewedAt: now,
              adminReviewedBy: tokenUser.email || tokenUser.uid,
              revokedAt: now,
              revokedBy: tokenUser.email || tokenUser.uid,
              revokedReason: "admin_revoked_all",
            },
            tokenUser.token
          );
          revokedCount++;
        }
      }

      let firebaseTokensRevoked = false;
      if (getApps().length > 0) {
        try {
          await getAuth().revokeRefreshTokens(targetUid);
          firebaseTokensRevoked = true;
        } catch (err) {
          console.warn("[Admin Revoke All] revokeRefreshTokens error:", err);
        }
      }

      await writeAdminLog(
        {
          category: "security_session",
          action: "admin_revoked_all_sessions",
          severity: "critical",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: adminCheck.displayName,
          targetUid,
          targetUsername: targetUsername || sessions[0]?.username || null,
          sessionId: null,
          details: `Admin (${adminCheck.displayName}), @${
            targetUsername || sessions[0]?.username || targetUid
          } kullanıcısının tüm oturumlarını (${revokedCount} aktif/bekleyen oturum) kapattı.`,
          metadata: { revokedCount, firebaseTokensRevoked },
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        revokedCount,
        firebaseTokensRevoked,
      });
    } catch (err: any) {
      console.error("❌ [Admin Revoke All] Error:", err);
      return res.status(500).json({ error: err?.message || "Tüm oturumlar kapatılamadı." });
    }
  });
}
