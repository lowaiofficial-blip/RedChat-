import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "redchat-7c1db";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export const MAIN_ADMIN_EMAILS = ["robloxenes930@gmail.com", "gg00cat73@gmail.com"];
export const MUSE_MODERATOR_UID = "GnQk5MbPQdS4GDl4cohFzRlKNw22";
export const MUSE_MODERATOR_EMAIL = "muse@gmail.com";
const SECURITY_NOTIFY_EMAIL = "redchatbusiness@outlook.com";

const DEVICE_COOKIE_NAME = "__rc_dev";
const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 dakika
const CHALLENGE_PROOF_TTL_MS = 10 * 60 * 1000; // Doğrulandıktan sonra karar için 10 dakika
const ACTIVE_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 gün
const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat
const REAUTH_MAX_AGE_SECONDS = 300; // Ana Yönetici kurtarma için son 5 dakika

// Sunucu tarafı HMAC doğrulama anahtarı (istemciye asla açılmaz)
const SESSION_HMAC_SECRET =
  process.env.SESSION_SECRET ||
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
  process.env.RESEND_API_KEY ||
  "redchat-7c1db-server-session-hmac-secret";

// Bellekte tekilleştirme ve atomik tek-kullanımlık kilitler
const sentEmailEventsCache = new Set<string>();
const verifiedChallengeCache = new Map<
  string,
  { sessionId: string; uid: string; verifiedAtMs: number; expiresAtMs: number }
>();

let cachedCerts: Record<string, string> = {};
let cachedCertsExpiry = 0;

export interface VerifiedTokenUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  authTime: number | null;
  token: string;
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== "string") return result;

  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  });
  return result;
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

export async function verifyBearerIdTokenWithAuthTime(
  req: Request
): Promise<VerifiedTokenUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  // 1. Firebase Admin SDK
  if (getApps().length > 0) {
    try {
      const decoded = await getAuth().verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email || null,
        emailVerified: Boolean(decoded.email_verified),
        authTime: typeof decoded.auth_time === "number" ? decoded.auth_time : null,
        token: idToken,
      };
    } catch (err: any) {
      if (err?.code === "auth/id-token-revoked") {
        throw new Error("TOKEN_REVOKED");
      }
      return null;
    }
  }

  // 2. Fallback: RS256 Google x509 doğrulaması
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
      authTime: typeof payload.auth_time === "number" ? payload.auth_time : null,
      token: idToken,
    };
  } catch (err) {
    console.warn("[Security] ID token verification failed:", err);
    return null;
  }
}

async function authenticateRequest(
  req: Request,
  res: Response,
  asVerifyActive = false
): Promise<VerifiedTokenUser | null> {
  try {
    const tokenUser = await verifyBearerIdTokenWithAuthTime(req);
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
              sessionStatus: "revoked",
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
// 🔥 FIRESTORE DUAL ADAPTER (Admin SDK + Authenticated REST & Atomic Commit)
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

function parseTimestampMs(val: any): number | null {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.toDate === "function") return val.toDate().getTime();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

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
  return fromRestDoc(await resp.json());
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

interface AtomicWriteOp {
  colPath: string;
  docId: string;
  data: Record<string, any>;
  mustExist?: boolean;
}

async function dbAtomicCommit(ops: AtomicWriteOp[], idToken?: string): Promise<void> {
  if (ops.length === 0) return;

  if (getApps().length > 0) {
    const db = getFirestore();
    const batch = db.batch();
    for (const op of ops) {
      const ref = db.collection(op.colPath).doc(op.docId);
      batch.set(ref, op.data, { merge: true });
    }
    await batch.commit();
    return;
  }

  const docRoot = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const writes = ops.map((op) => {
    const fields: Record<string, any> = {};
    const fieldPaths: string[] = [];
    for (const [k, v] of Object.entries(op.data)) {
      if (v !== undefined) {
        fields[k] = toRestValue(v);
        fieldPaths.push(k);
      }
    }
    const writeObj: Record<string, any> = {
      update: {
        name: `${docRoot}/${op.colPath}/${op.docId}`,
        fields,
      },
      updateMask: { fieldPaths },
    };
    if (op.mustExist !== undefined) {
      writeObj.currentDocument = { exists: op.mustExist };
    }
    return writeObj;
  });

  const resp = await fetch(`${FIRESTORE_BASE}:commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST atomic commit failed (${resp.status}): ${errText}`);
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
      .orderBy("createdAt", "desc")
      .limit(100)
      .get()
      .catch(async () =>
        getFirestore().collection(colPath).where("userId", "==", userId).get()
      );
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
        limit: 100,
      },
    }),
    signal: AbortSignal.timeout(6000),
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

async function dbListRecent(
  colPath: string,
  limitCount = 150,
  idToken?: string
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const snap = await getFirestore()
      .collection(colPath)
      .orderBy("createdAt", "desc")
      .limit(limitCount)
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
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: limitCount,
      },
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST list failed (${resp.status}): ${errText}`);
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
  if (clean.startsWith("172.")) {
    const second = parseInt(clean.split(".")[1] || "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function isValidIpFormat(ip: string): boolean {
  const clean = ip.trim().replace(/^::ffff:/, "");
  const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  return ipv4Regex.test(clean) || (clean.includes(":") && ipv6Regex.test(clean));
}

export async function extractRealClientIp(
  req: Request,
  clientPublicIp?: string
): Promise<string> {
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

  for (const raw of candidates) {
    const clean = raw.replace(/^::ffff:/, "").trim();
    if (clean && isValidIpFormat(clean) && !isPrivateOrLoopbackIp(clean)) {
      return clean;
    }
  }

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
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
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
    // 1. ipwho.is
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

    // 2. ipapi.co
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

    // 3. ip-api.com
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
// 💻 SUNUCU DOĞRULAMALI GİZLİLİĞE UYGUN CİHAZ KİMLİĞİ & PARSER
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

interface DeviceSignals {
  hardwareFingerprint?: string;
  screenBucket?: string;
  timezone?: string;
  platform?: string;
  language?: string;
  touchPoints?: number;
}

function signDeviceCookieValue(serverDeviceId: string, osName: string, deviceType: string): string {
  const sig = crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(`rcdev|${serverDeviceId}|${osName}|${deviceType}`)
    .digest("hex")
    .slice(0, 32);
  return `${serverDeviceId}.${sig}`;
}

function verifyDeviceCookie(
  rawCookie: string | undefined,
  osName: string,
  deviceType: string
): string | null {
  if (!rawCookie || typeof rawCookie !== "string") return null;
  const parts = rawCookie.split(".");
  if (parts.length !== 2) return null;
  const [devId, sig] = parts;
  if (!devId || !sig || !devId.startsWith("RCD-")) return null;
  const expected = signDeviceCookieValue(devId, osName, deviceType).split(".")[1];
  return safeTimingEqual(sig, expected) ? devId : null;
}

function computePrivacySafeDeviceSignature(
  uid: string,
  uaInfo: { browserName: string; osName: string; deviceType: string },
  signals?: DeviceSignals,
  fallbackClientHwid?: string
): string {
  const fp =
    typeof signals?.hardwareFingerprint === "string" && signals.hardwareFingerprint.trim()
      ? signals.hardwareFingerprint.trim().slice(0, 80)
      : (fallbackClientHwid || "").trim().slice(0, 80);
  const platform =
    typeof signals?.platform === "string" ? signals.platform.trim().slice(0, 40) : "";
  const screenBucket =
    typeof signals?.screenBucket === "string" ? signals.screenBucket.trim().slice(0, 40) : "";
  const tz =
    typeof signals?.timezone === "string" ? signals.timezone.trim().slice(0, 50) : "";

  const material = `dsg|${uid}|${uaInfo.osName}|${uaInfo.deviceType}|${uaInfo.browserName}|${platform}|${screenBucket}|${tz}|${fp}`;
  return (
    "SIG-" +
    crypto
      .createHmac("sha256", SESSION_HMAC_SECRET)
      .update(material)
      .digest("hex")
      .slice(0, 28)
      .toUpperCase()
  );
}

function setSignedDeviceCookie(
  req: Request,
  res: Response,
  serverDeviceId: string,
  osName: string,
  deviceType: string
) {
  const value = signDeviceCookieValue(serverDeviceId, osName, deviceType);
  const isSecure =
    req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
  const cookieParts = [
    `${DEVICE_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "Max-Age=315360000",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure) {
    cookieParts.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function getDeviceTypeTurkish(deviceType: string): string {
  switch (deviceType) {
    case "mobile":
      return "Akıllı Telefon (Mobil)";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Masaüstü / Dizüstü Bilgisayar";
    default:
      return "Bilinmeyen Cihaz";
  }
}

// =========================================================================
// 🔐 KRİPTOGRAFİK OTURUM, CHALLENGE TOKEN & AKTİFLİK DOĞRULAMA
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
    return safeTimingEqual(computeProofHash(proof), String(networkDoc.proofHash));
  }
  const ownerUid = session.uid || session.userId;
  const expectedPrefix = computeSessionHmac(
    session.sessionId,
    ownerUid,
    session.deviceId
  ).slice(0, 32);
  return proof.startsWith(`${expectedPrefix}.`);
}

function computeSaltedSha256(secret: string, salt: string): string {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${secret}`)
    .digest("hex");
}

function deriveDeterministicCommitSecret(
  sessionId: string,
  uid: string,
  tokenHash: string
): string {
  return crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(`atomic-commit|${sessionId}|${uid}|${tokenHash}`)
    .digest("hex");
}

function buildVerifiedChallengeProof(
  sessionId: string,
  uid: string,
  expiresAtMs: number
): string {
  const payload = `${sessionId}.${uid}.${expiresAtMs}`;
  const sig = crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(`challenge-ok|${payload}`)
    .digest("hex")
    .slice(0, 36);
  return `${payload}.${sig}`;
}

function verifyChallengeProof(
  challengeProof: string,
  expectedSessionId: string,
  expectedUid: string
): boolean {
  if (!challengeProof || typeof challengeProof !== "string") return false;
  const parts = challengeProof.split(".");
  if (parts.length !== 4) return false;
  const [sid, uid, expStr, sig] = parts;
  if (sid !== expectedSessionId || uid !== expectedUid) return false;
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
  const expectedSig = crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(`challenge-ok|${sid}.${uid}.${expStr}`)
    .digest("hex")
    .slice(0, 36);
  return safeTimingEqual(sig, expectedSig);
}

function generateOtpCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function resolveAppOrigin(req: Request): string {
  const originHeader = req.headers.origin;
  if (typeof originHeader === "string" && /^https?:\/\//.test(originHeader)) {
    return originHeader.replace(/\/$/, "");
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

/**
 * Aktif oturum doğrulaması (Middleware / Helper):
 * İptal edilmiş, süresi dolmuş veya pending_verification oturumlarının hassas uçları kullanmasını engeller.
 */
export async function requireActiveSecuritySession(
  req: Request,
  res: Response,
  tokenUser: VerifiedTokenUser,
  options: { requireSessionHeaders?: boolean } = {}
): Promise<{ ok: boolean; session?: Record<string, any> }> {
  const sessionId = String(req.headers["x-redchat-session-id"] || "").trim();
  const sessionProof = String(req.headers["x-redchat-session-proof"] || "").trim();

  if (!sessionId || !sessionProof) {
    if (options.requireSessionHeaders) {
      res.status(403).json({
        error: "Aktif oturum güvenlik doğrulaması eksik.",
        code: "SESSION_HEADERS_REQUIRED",
      });
      return { ok: false };
    }
    return { ok: true };
  }

  const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token).catch(
    () => null
  );
  if (!session || (session.uid || session.userId) !== tokenUser.uid) {
    res.status(401).json({
      error: "Oturum kaydı bulunamadı veya kullanıcıya ait değil.",
      code: "SESSION_NOT_FOUND",
    });
    return { ok: false };
  }

  const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
    () => null
  );
  if (!verifyProofAgainstSession(sessionProof, session, networkDoc)) {
    res.status(403).json({
      error: "Geçersiz oturum imzası.",
      code: "INVALID_SESSION_PROOF",
    });
    return { ok: false };
  }

  const expiresMs = parseTimestampMs(session.expiresAt);
  if (expiresMs !== null && expiresMs <= Date.now()) {
    await dbSetDoc(
      "securitySessions",
      sessionId,
      {
        status: "revoked",
        sessionStatus: "revoked",
        verificationStatus:
          session.verificationStatus === "pending" ? "expired" : "expired",
        trusted: false,
        revokedAt: new Date(),
        revokedReason: "session_expired",
      },
      tokenUser.token
    ).catch(() => {});

    res.status(401).json({
      error: "Oturum süresi doldu. Lütfen yeniden giriş yapın.",
      code: "SESSION_EXPIRED",
    });
    return { ok: false };
  }

  const effStatus = session.sessionStatus || session.status;
  if (effStatus === "revoked" || session.status === "revoked" || session.revokedAt) {
    res.status(401).json({
      error: "Bu oturum sonlandırılmıştır.",
      code: "SESSION_REVOKED",
    });
    return { ok: false };
  }

  if (
    session.status === "pending_verification" ||
    session.status === "awaiting_admin_approval" ||
    effStatus === "pending_verification" ||
    session.trusted !== true
  ) {
    res.status(403).json({
      error: "Bu oturum henüz doğrulanmadığı için işlem kısıtlanmıştır.",
      code: "SESSION_PENDING_VERIFICATION",
    });
    return { ok: false };
  }

  return { ok: true, session };
}

// =========================================================================
// 📧 RESEND E-POSTA GÖNDERİMİ & ÇİFT GÖNDERİM ENGELLEME
// =========================================================================

type SecurityEmailEventType =
  | "unverified_suspicious_login"
  | "verified_login_notification"
  | "owner_denied_alert";

interface SecurityEmailDispatchParams {
  sessionId: string;
  eventType: SecurityEmailEventType;
  recipientEmail?: string | null;
  username: string;
  displayName: string;
  userId: string;
  countryName: string;
  countryCode: string;
  countryFlag: string;
  city?: string | null;
  deviceType: string;
  osName: string;
  browserName: string;
  loginTimeFormatted: string;
  previousCountryName?: string;
  verificationUrl?: string;
  verificationCode?: string;
  sessionDataForDedup?: Record<string, any> | null;
}

async function sendSecurityResendEmailOnce(params: SecurityEmailDispatchParams): Promise<{
  sent: boolean;
  status: "sent" | "failed" | "not_configured" | "skipped";
  recipient: string | null;
  subject: string | null;
  error?: string;
  deduplicated?: boolean;
}> {
  const fixedRecipient = SECURITY_NOTIFY_EMAIL;
  const dedupKey = `${params.sessionId}:${params.eventType}`;
  const existingDispatch = params.sessionDataForDedup?.emailDispatches?.[params.eventType];

  if (sentEmailEventsCache.has(dedupKey) || existingDispatch?.sent === true) {
    return {
      sent: true,
      status: "sent",
      recipient: fixedRecipient,
      subject: existingDispatch?.subject || null,
      deduplicated: true,
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey || !resendApiKey.trim()) {
    console.warn(
      `⚠️ [Security Email] RESEND_API_KEY tanımlı değil (${params.eventType} -> ${fixedRecipient}).`
    );
    return {
      sent: false,
      status: "not_configured",
      recipient: fixedRecipient,
      subject: null,
      error: "RESEND_API_KEY ortam değişkeni sunucuda tanımlı değil.",
    };
  }

  const cityText = params.city && params.city.trim() ? params.city.trim() : "Belirtilmedi";
  const deviceLabel = getDeviceTypeTurkish(params.deviceType);

  let subject = "";
  let headline = "";
  let statusBadgeText = "";
  let accentColor = "#dc2626";
  let statusNoticeHtml = "";
  let statusNoticeText = "";
  let verificationChallengeHtml = "";
  let verificationChallengeText = "";

  if (params.eventType === "unverified_suspicious_login") {
    subject = "RedChat — Yeni Oturum Açıldı";
    headline = "Hesabınızda Yeni Bir Şüpheli Oturum Algılandı";
    statusBadgeText = "Bu oturum henüz doğrulanmadı (pending_verification)";
    accentColor = "#dc2626";
    statusNoticeHtml = `
      <div style="margin: 16px 0; padding: 14px; border-radius: 12px; background-color: #18181b; border: 1px solid #3f3f46;">
        <div style="font-size: 12px; color: #fbbf24; font-weight: 700; margin-bottom: 6px;">
          ⚠️ Şüpheli Oturum Bildirimi — Oturum Kısıtlı
        </div>
        <p style="margin: 0; font-size: 13px; color: #d4d4d8; line-height: 1.5;">
          Hesaba daha önce doğrulanmamış veya tanınmayan bir cihazdan giriş denemesi tespit edildi.
          Güvenlik doğrulaması tamamlanana kadar sohbet ve hassas işlemler kapalı tutulmaktadır.
        </p>
      </div>
    `;
    statusNoticeText =
      "Oturum durumu: Bu oturum henüz doğrulanmadı (kısıtlı modda bekletiliyor).";

    if (params.verificationCode || params.verificationUrl) {
      verificationChallengeHtml = `
        <div style="margin: 22px 0 0 0; padding: 18px; border-radius: 14px; background-color: #111113; border: 1px solid #dc2626;">
          <div style="font-size: 11px; color: #f87171; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;">
            Bölüm 2 · Güvenlik Doğrulama Akışı (Tek Kullanımlık)
          </div>
          <p style="margin: 0 0 12px 0; font-size: 12px; color: #d4d4d8; line-height: 1.5;">
            Aşağıdaki tek kullanımlık doğrulama kodu ve bağlantısı yalnızca güvenlik doğrulama ekranında
            kimlik onayı ("Bu Benim" / "Ben Değilim" kararı açılışı) için kullanılır (15 dakika geçerlidir):
          </p>
          ${
            params.verificationCode
              ? `<div style="margin: 12px 0; padding: 12px; border-radius: 10px; background-color: #09090b; border: 1px dashed #dc2626; text-align: center;">
                  <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.08em;">Tek Kullanımlık Doğrulama Kodu</div>
                  <div style="font-size: 24px; font-weight: 800; letter-spacing: 0.25em; color: #ffffff; font-family: monospace; margin-top: 4px;">${params.verificationCode}</div>
                </div>`
              : ""
          }
          ${
            params.verificationUrl
              ? `<div style="margin-top: 14px; text-align: center;">
                  <a href="${params.verificationUrl}" style="display: inline-block; padding: 11px 20px; border-radius: 10px; background-color: #dc2626; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700;">
                    Doğrulama Adımına Git
                  </a>
                </div>`
              : ""
          }
        </div>
      `;
      verificationChallengeText = [
        "",
        "--- GÜVENLİK DOĞRULAMA AKIŞI (TEK KULLANIMLIK) ---",
        params.verificationCode ? `Doğrulama kodu: ${params.verificationCode}` : "",
        params.verificationUrl ? `Doğrulama bağlantısı: ${params.verificationUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  } else if (params.eventType === "verified_login_notification") {
    subject = "RedChat — Hesabınızda Yeni Giriş";
    headline = "Hesabınızda Doğrulanmış Yeni Giriş";
    statusBadgeText = "Doğrulandı — Aktif Oturum";
    accentColor = "#10b981";
    statusNoticeHtml = `
      <div style="margin: 18px 0; padding: 14px; border-radius: 12px; background-color: #052e16; border: 1px solid #166534; font-size: 13px; color: #bbf7d0;">
        Bu giriş doğrulandı ve oturum erişime açıldı. Eğer bu işlemi yetkili kullanıcı gerçekleştirmediyse hemen RedChat yönetimi üzerinden oturumu sonlandırın.
      </div>
    `;
    statusNoticeText = "Oturum durumu: Doğrulandı — Aktif Oturum";
  } else {
    subject = "RedChat ACİL — Şüpheli Oturum Reddedildi (Ben Değilim)";
    headline = "ACİL GÜVENLİK UYARISI — Oturum Reddedildi";
    statusBadgeText = "Hesap Sahibi Tarafından İptal Edildi";
    accentColor = "#dc2626";
    statusNoticeHtml = `
      <div style="margin: 18px 0; padding: 14px; border-radius: 12px; background-color: #450a0a; border: 1px solid #991b1b; font-size: 13px; color: #fecaca;">
        Hesap sahibi bu yeni oturumu "Ben Değilim" olarak işaretledi. Şüpheli oturum derhal iptal edilmiştir. Hesap şifresinin güncellenmesi ve diğer tüm oturumların gözden geçirilmesi önerilir.
      </div>
    `;
    statusNoticeText = "Oturum durumu: Hesap sahibi tarafından reddedildi ve iptal edildi";
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #27272a; border-radius: 16px; background-color: #09090b; color: #f4f4f5;">
      <div style="border-bottom: 1px solid #27272a; padding-bottom: 14px; margin-bottom: 18px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: ${accentColor}; font-weight: 700;">
          RedChat Oturum Güvenliği
        </div>
        <h2 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700; color: #ffffff;">
          ${headline}
        </h2>
      </div>

      ${statusNoticeHtml}

      <div style="margin: 18px 0 0 0; padding: 16px; border-radius: 14px; background-color: #121215; border: 1px solid #27272a;">
        <div style="font-size: 11px; color: #a1a1aa; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px;">
          Bölüm 1 · Şüpheli Oturum ve Giriş Bilgileri
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tbody>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b; width: 42%;">Kullanıcı adı</td>
              <td style="padding: 9px 0; color: #ffffff; font-weight: 600; border-bottom: 1px solid #18181b;">@${params.username} (${params.displayName})</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Hesap kimliği (UID)</td>
              <td style="padding: 9px 0; color: #d4d4d8; font-family: monospace; font-size: 12px; border-bottom: 1px solid #18181b;">${params.userId}</td>
            </tr>
            ${
              params.previousCountryName
                ? `<tr>
                    <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Önceki bilinen ülke</td>
                    <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${params.previousCountryName}</td>
                  </tr>`
                : ""
            }
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Giriş yapılan ülke</td>
              <td style="padding: 9px 0; color: #fbbf24; font-weight: 700; border-bottom: 1px solid #18181b;">${params.countryName} ${params.countryFlag} (${params.countryCode})</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Şehir</td>
              <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${cityText}</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Cihaz bilgisi</td>
              <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${deviceLabel}</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">İşletim sistemi & Tarayıcı</td>
              <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${params.osName} · ${params.browserName}</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa; border-bottom: 1px solid #18181b;">Oturum açılma zamanı</td>
              <td style="padding: 9px 0; color: #e4e4e7; border-bottom: 1px solid #18181b;">${params.loginTimeFormatted}</td>
            </tr>
            <tr>
              <td style="padding: 9px 0; color: #a1a1aa;">Oturum durumu</td>
              <td style="padding: 9px 0; color: #ffffff; font-weight: 700;">${statusBadgeText}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${verificationChallengeHtml}

      <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #27272a; font-size: 12px; color: #71717a;">
        RedChat Güvenlik Sistemi · Oturum No: ${params.sessionId}
      </div>
    </div>
  `;

  const text = [
    headline,
    "",
    "--- ŞÜPHELİ OTURUM VE GİRİŞ BİLGİLERİ ---",
    `Kullanıcı adı: @${params.username} (${params.displayName})`,
    `Hesap kimliği (UID): ${params.userId}`,
    params.previousCountryName ? `Önceki bilinen ülke: ${params.previousCountryName}` : "",
    `Giriş yapılan ülke: ${params.countryName} ${params.countryFlag} (${params.countryCode})`,
    `Şehir: ${cityText}`,
    `Cihaz bilgisi: ${deviceLabel}`,
    `İşletim sistemi & Tarayıcı: ${params.osName} · ${params.browserName}`,
    `Oturum açılma zamanı: ${params.loginTimeFormatted}`,
    statusNoticeText,
    `Oturum No: ${params.sessionId}`,
    verificationChallengeText,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const toList = [fixedRecipient];

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey.trim()}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to: toList,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (resp.ok) {
      sentEmailEventsCache.add(dedupKey);
      return { sent: true, status: "sent", recipient: fixedRecipient, subject };
    }

    const errText = await resp.text();
    console.warn(`⚠️ [Security Resend] HTTP ${resp.status}:`, errText);
    return {
      sent: false,
      status: "failed",
      recipient: fixedRecipient,
      subject,
      error: `Resend HTTP ${resp.status}: ${errText}`,
    };
  } catch (err: any) {
    console.error("❌ [Security Resend] Exception:", err);
    return {
      sent: false,
      status: "failed",
      recipient: fixedRecipient,
      subject,
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

function buildAdminLogData(params: {
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
}) {
  const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    logId,
    doc: {
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
  };
}

/**
 * Sıkı Sunucu Tarafı Ana Yönetici Doğrulaması:
 * - İstemciden gelen email/role verisine ASLA güvenmez.
 * - Doğrulanmış Firebase JWT e-postası, UID ve Firestore role bilgisini kontrol eder.
 * - Muse Moderatörünü ve normal kullanıcıları KESİN olarak reddeder.
 */
async function assertMainAdminStrict(tokenUser: VerifiedTokenUser): Promise<{
  isMainAdmin: boolean;
  displayName: string;
  userDoc: Record<string, any> | null;
}> {
  const emailLower = (tokenUser.email || "").trim().toLowerCase();
  const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token).catch(() => null);

  if (
    tokenUser.uid === MUSE_MODERATOR_UID ||
    emailLower === MUSE_MODERATOR_EMAIL ||
    userDoc?.role === "moderator"
  ) {
    return {
      isMainAdmin: false,
      displayName: userDoc?.displayName || "Moderatör",
      userDoc,
    };
  }

  const isEmailInMainAdminList = MAIN_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(
    emailLower
  );
  const isMainAdmin = isEmailInMainAdminList || userDoc?.role === "admin";

  return {
    isMainAdmin,
    displayName: userDoc?.displayName || userDoc?.username || tokenUser.email || "Ana Yönetici",
    userDoc,
  };
}

function isFreshReauth(tokenUser: VerifiedTokenUser): boolean {
  if (!tokenUser.authTime) return false;
  const ageSec = Math.floor(Date.now() / 1000) - tokenUser.authTime;
  return ageSec >= -30 && ageSec <= REAUTH_MAX_AGE_SECONDS;
}

/**
 * Bekleyen oturumdan Ana Yönetici işlem yapıyorsa ek güvenlik geçidini doğrular:
 * Aktif oturumda doğrudan geçer; pending_verification oturumda ise son 5 dakikada
 * yenilenmiş kimlik doğrulama (auth_time) veya doğrulanmış email challengeProof zorunludur.
 */
async function assertAdminActionAllowedOnCurrentSession(
  req: Request,
  tokenUser: VerifiedTokenUser,
  challengeProof?: string
): Promise<{ allowed: boolean; error?: string; code?: string }> {
  const sessionId = String(req.headers["x-redchat-session-id"] || "").trim();
  const sessionProof = String(req.headers["x-redchat-session-proof"] || "").trim();

  if (!sessionId || !sessionProof) {
    // Taze reauth varsa izin ver, aksi halde aktif oturum bilgisi bekle
    if (isFreshReauth(tokenUser)) return { allowed: true };
    return {
      allowed: false,
      error: "Yönetici oturumu güvenlik doğrulaması eksik.",
      code: "SESSION_REQUIRED",
    };
  }

  const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token).catch(
    () => null
  );
  if (!session || (session.uid || session.userId) !== tokenUser.uid) {
    return { allowed: false, error: "Yönetici oturumu bulunamadı.", code: "SESSION_NOT_FOUND" };
  }

  const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
    () => null
  );
  if (!verifyProofAgainstSession(sessionProof, session, networkDoc)) {
    return { allowed: false, error: "Geçersiz yönetici oturum kanıtı.", code: "INVALID_PROOF" };
  }

  const effStatus = session.sessionStatus || session.status;
  if (effStatus === "revoked" || session.status === "revoked" || session.revokedAt) {
    return { allowed: false, error: "İptal edilmiş yönetici oturumu.", code: "SESSION_REVOKED" };
  }

  if (effStatus === "active" && session.trusted === true) {
    return { allowed: true };
  }

  // Pending Ana Yönetici oturumu: Güvenli kurtarma / inceleme modu yalnızca taze re-auth veya geçerli challengeProof ile açılır
  if (
    isFreshReauth(tokenUser) ||
    (challengeProof && verifyChallengeProof(challengeProof, sessionId, tokenUser.uid))
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: "Beklemedeki Ana Yönetici oturumundan işlem yapmak için yeniden kimlik doğrulama (şifre veya e-posta kodu) gereklidir.",
    code: "ADMIN_REAUTH_REQUIRED",
  };
}

// =========================================================================
// 🛡️ EXPRESS SECURITY ROUTES
// =========================================================================

export function registerSessionSecurityRoutes(app: Express) {
  // 0. Yönetici Yetki Durumu (İstemci rol sinyali değil, sunucu doğrulaması)
  app.get("/api/security/sessions/admin-status", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const check = await assertMainAdminStrict(tokenUser);
      return res.json({
        uid: tokenUser.uid,
        isMainAdmin: check.isMainAdmin,
        recentReauthValid: isFreshReauth(tokenUser),
        authAgeSeconds: tokenUser.authTime
          ? Math.max(0, Math.floor(Date.now() / 1000) - tokenUser.authTime)
          : null,
      });
    } catch {
      return res.status(500).json({ isMainAdmin: false });
    }
  });

  // 1. Oturum Kaydı ve Yeni Ülke + Yeni Cihaz Kontrolü
  app.post("/api/security/sessions/register", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const {
        deviceId,
        deviceSignals,
        userAgent,
        existingSessionId,
        existingSessionProof,
        clientPublicIp,
        isFreshLogin,
      } = req.body || {};

      if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length < 4) {
        return res.status(400).json({ error: "Geçerli cihaz kimliği (deviceId) gerekli." });
      }

      const clientHwid = deviceId.trim().slice(0, 140);
      const uaString = typeof userAgent === "string" ? userAgent : req.headers["user-agent"] || "";
      const uaInfo = parseUserAgentInfo(uaString);

      const cookies = parseCookies(req);
      const cookieDeviceId = verifyDeviceCookie(
        cookies[DEVICE_COOKIE_NAME],
        uaInfo.osName,
        uaInfo.deviceType
      );

      // Sunucunun gizliliğe uygun ürettiği kriptografik cihaz imzası
      const deviceSignature = computePrivacySafeDeviceSignature(
        tokenUser.uid,
        uaInfo,
        deviceSignals,
        clientHwid
      );

      // Sunucu tarafından doğrulanan cihaz kimliği (mevcut imzalı çerez varsa koru, yoksa sunucu imzalı üret)
      const attestedDeviceId =
        cookieDeviceId || `RCD-${crypto.createHash("sha256").update(`${tokenUser.uid}:${deviceSignature}`).digest("hex").slice(0, 20).toUpperCase()}`;

      setSignedDeviceCookie(req, res, attestedDeviceId, uaInfo.osName, uaInfo.deviceType);

      const clientIp = await extractRealClientIp(req, clientPublicIp);
      const geo = await lookupGeoIp(clientIp, req);
      const now = new Date();

      const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token).catch(() => null);
      const username = userDoc?.username || tokenUser.email?.split("@")[0] || "kullanici";
      const displayName = userDoc?.displayName || username;
      const photoURL = userDoc?.photoURL || null;
      const ownerVerifiedEmail = (tokenUser.email || userDoc?.email || "").trim();

      // Mevcut oturum yenilemesi (sayfa reload / session resume - ASLA giriş e-postası tetiklemez!)
      if (
        !isFreshLogin &&
        typeof existingSessionId === "string" &&
        existingSessionId.trim().length > 0 &&
        typeof existingSessionProof === "string"
      ) {
        const existingSession = await dbGetDoc(
          "securitySessions",
          existingSessionId.trim(),
          tokenUser.token
        ).catch(() => null);

        if (
          existingSession &&
          (existingSession.uid || existingSession.userId) === tokenUser.uid
        ) {
          const networkDoc = await dbGetDoc(
            "securitySessionNetwork",
            existingSessionId.trim(),
            tokenUser.token
          ).catch(() => null);

          if (verifyProofAgainstSession(existingSessionProof, existingSession, networkDoc)) {
            const expMs = parseTimestampMs(existingSession.expiresAt);
            if (expMs !== null && expMs <= now.getTime()) {
              const expiredUpdate = {
                status: "revoked",
                sessionStatus: "revoked",
                verificationStatus: "expired",
                trusted: false,
                revokedAt: now,
                revokedReason: "session_expired",
              };
              await dbSetDoc("securitySessions", existingSession.sessionId, expiredUpdate, tokenUser.token);
              return res.json({
                success: true,
                session: { ...existingSession, ...expiredUpdate },
                sessionProof: existingSessionProof,
                geoSummary: {
                  countryCode: existingSession.countryCode,
                  countryName: existingSession.countryName,
                  flagEmoji: existingSession.flagEmoji,
                },
              });
            }

            if (existingSession.status === "active") {
              await dbSetDoc(
                "securitySessions",
                existingSession.sessionId,
                { lastActiveAt: now, lastSeenAt: now },
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
      const secProfile = await dbGetDoc("userSecurityProfiles", tokenUser.uid, tokenUser.token).catch(
        () => null
      );
      const knownCountryCodes: string[] = Array.isArray(secProfile?.knownCountryCodes)
        ? secProfile.knownCountryCodes
        : [];
      const knownDeviceIds: string[] = Array.isArray(secProfile?.knownDeviceIds)
        ? secProfile.knownDeviceIds
        : [];
      const knownDeviceSignatures: string[] = Array.isArray(secProfile?.knownDeviceSignatures)
        ? secProfile.knownDeviceSignatures
        : [];

      const hasBaseline =
        knownCountryCodes.length > 0 ||
        knownDeviceIds.length > 0 ||
        knownDeviceSignatures.length > 0;
      const detectedCode = geo.countryCode;
      const isNewCountry =
        detectedCode !== "UNKNOWN" && !knownCountryCodes.includes(detectedCode);

      // Güvenilir cihaz doğrulaması:
      // İstemcinin düz body ile gönderdiği clientHwid tek başına GÜVENİLMEZ.
      // Ya sunucunun imzalı HTTP-only çerezi (cookieDeviceId) + cihaz listesi eşleşmeli
      // ya da sunucunun hesapladığı deviceSignature knownDeviceSignatures içinde olmalı!
      const matchesSignedCookie =
        Boolean(cookieDeviceId) && knownDeviceIds.includes(cookieDeviceId as string);
      const matchesServerSignature = knownDeviceSignatures.includes(deviceSignature);
      const legacyCompatMatch =
        knownDeviceSignatures.length === 0 &&
        Boolean(cookieDeviceId) &&
        knownDeviceIds.includes(clientHwid);

      const isKnownTrustedDevice =
        matchesSignedCookie || matchesServerSignature || legacyCompatMatch;
      const isNewDevice = !isKnownTrustedDevice;

      // KRİTİK KURAL: Şüpheli giriş doğrulaması yeni/tanınmayan cihaz tespit edildiğinde tetiklenir.
      // Tanınan (kayıtlı çerez veya sunucu imzası eşleşen) cihazlarda yeni ülke olsa dahi e-posta gönderilmez.
      const shouldTriggerCheck = hasBaseline && isNewDevice;

      const sessionId = `sess_${crypto.randomBytes(12).toString("hex")}`;
      const sessionProof = buildSessionProof(sessionId, tokenUser.uid, attestedDeviceId);
      const proofHash = computeProofHash(sessionProof);

      const expiresAt = new Date(
        now.getTime() + (shouldTriggerCheck ? PENDING_SESSION_TTL_MS : ACTIVE_SESSION_TTL_MS)
      );

      const previousCountryCode = secProfile?.lastKnownCountryCode || knownCountryCodes[0] || null;
      const previousCountryName =
        secProfile?.lastKnownCountryName ||
        (previousCountryCode ? getCountryNameTurkish(previousCountryCode) : "Bilinmiyor");

      const sessionData: Record<string, any> = {
        id: sessionId,
        sessionId,
        uid: tokenUser.uid,
        userId: tokenUser.uid,
        username,
        displayName,
        photoURL,
        deviceId: attestedDeviceId,
        deviceSignature,
        deviceType: uaInfo.deviceType,
        browserName: uaInfo.browserName,
        osName: uaInfo.osName,
        countryCode: geo.countryCode,
        countryName: geo.countryName,
        flagEmoji: geo.flagEmoji,
        city: geo.city || null,
        previousCountryCode,
        previousCountryName,
        isSuspicious: shouldTriggerCheck,
        trusted: !shouldTriggerCheck,
        status: shouldTriggerCheck ? "pending_verification" : "active",
        sessionStatus: shouldTriggerCheck ? "pending_verification" : "active",
        verificationStatus: shouldTriggerCheck ? "pending" : "verified",
        userResponse: shouldTriggerCheck ? "pending" : "not_required",
        adminDecision: shouldTriggerCheck ? "pending" : "auto_trusted",
        emailSent: false,
        emailStatus: "skipped",
        emailError: null,
        emailDispatches: {},
        createdAt: now,
        lastActiveAt: now,
        lastSeenAt: now,
        verifiedAt: shouldTriggerCheck ? null : now,
        expiresAt,
      };

      const networkData: Record<string, any> = {
        id: sessionId,
        sessionId,
        uid: tokenUser.uid,
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
        deviceSignature,
        createdAt: now,
        updatedAt: now,
      };

      // İlk baseline veya tanınan cihazla yeni ülkeden giriş -> profil bilgisini güvenli biçimde güncelle
      if (!hasBaseline) {
        await dbSetDoc(
          "userSecurityProfiles",
          tokenUser.uid,
          {
            uid: tokenUser.uid,
            knownCountryCodes: detectedCode !== "UNKNOWN" ? [detectedCode] : [],
            knownDeviceIds: [attestedDeviceId],
            knownDeviceSignatures: [deviceSignature],
            lastKnownCountryCode: detectedCode !== "UNKNOWN" ? detectedCode : null,
            lastKnownCountryName: detectedCode !== "UNKNOWN" ? geo.countryName : null,
            createdAt: now,
            updatedAt: now,
          },
          tokenUser.token
        );
      } else if (!shouldTriggerCheck && hasBaseline && isNewCountry && detectedCode !== "UNKNOWN") {
        const nextCountries = Array.from(new Set([...knownCountryCodes, detectedCode])).slice(-30);
        await dbSetDoc(
          "userSecurityProfiles",
          tokenUser.uid,
          {
            uid: tokenUser.uid,
            knownCountryCodes: nextCountries,
            lastKnownCountryCode: detectedCode,
            lastKnownCountryName: geo.countryName,
            updatedAt: now,
          },
          tokenUser.token
        ).catch((err) => {
          console.warn("[Security Register] knownCountryCodes update skipped:", err?.message || err);
        });
      }

      let emailResult: {
        sent: boolean;
        status: "sent" | "failed" | "not_configured" | "skipped";
        recipient?: string | null;
        error?: string;
      } = {
        sent: false,
        status: "skipped",
      };

      if (shouldTriggerCheck) {
        // Tek kullanımlık doğrulama kodu & URL token üretimi (yalnızca salt + sha256 hash saklanır)
        const rawToken = crypto.randomBytes(24).toString("base64url");
        const rawOtp = generateOtpCode();
        const salt = crypto.randomBytes(16).toString("hex");
        const tokenHash = computeSaltedSha256(rawToken, salt);
        const otpHash = computeSaltedSha256(rawOtp, salt);
        const challengeExpiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

        const commitSecret = deriveDeterministicCommitSecret(
          sessionId,
          tokenUser.uid,
          tokenHash
        );
        const commitHash = crypto.createHash("sha256").update(commitSecret, "utf8").digest("hex");

        sessionData.challengeExpiresAt = challengeExpiresAt;

        await dbSetDoc(
          "securityVerificationTokens",
          sessionId,
          {
            sessionId,
            uid: tokenUser.uid,
            tokenHash,
            otpHash,
            salt,
            commitHash,
            decisionCommitKey: "",
            used: false,
            usedAt: null,
            attempts: 0,
            expiresAt: challengeExpiresAt,
            createdAt: now,
          },
          tokenUser.token
        );

        const appOrigin = resolveAppOrigin(req);
        const verificationUrl = `${appOrigin}/#/?secSession=${encodeURIComponent(sessionId)}&secToken=${encodeURIComponent(rawToken)}`;

        emailResult = await sendSecurityResendEmailOnce({
          sessionId,
          eventType: "unverified_suspicious_login",
          recipientEmail: SECURITY_NOTIFY_EMAIL,
          username,
          displayName,
          userId: tokenUser.uid,
          countryName: geo.countryName,
          countryCode: geo.countryCode,
          countryFlag: geo.flagEmoji,
          city: geo.city,
          deviceType: uaInfo.deviceType,
          osName: uaInfo.osName,
          browserName: uaInfo.browserName,
          loginTimeFormatted: formatTrDateTime(now),
          previousCountryName,
          verificationUrl,
          verificationCode: rawOtp,
          sessionDataForDedup: sessionData,
        });

        sessionData.emailSent = emailResult.sent;
        sessionData.emailStatus = emailResult.status;
        sessionData.emailError = emailResult.error || null;
        sessionData.emailRecipient = SECURITY_NOTIFY_EMAIL;
        sessionData.emailDispatches = {
          unverified_suspicious_login: {
            sent: emailResult.sent,
            status: emailResult.status,
            recipient: SECURITY_NOTIFY_EMAIL,
            subject: "RedChat — Yeni Oturum Açıldı",
            sentAt: now,
            error: emailResult.error || null,
          },
        };

        await writeAdminLog(
          {
            category: "security_session",
            action: isNewCountry ? "new_country_detected" : "new_device_detected",
            severity: "warning",
            actorUid: tokenUser.uid,
            actorEmail: ownerVerifiedEmail || tokenUser.email,
            actorName: displayName,
            targetUid: tokenUser.uid,
            targetUsername: username,
            sessionId,
            details: isNewCountry
              ? `Yeni cihaz ve yeni ülkeden giriş algılandı: ${geo.countryName} (${geo.countryCode}). Oturum 'pending_verification' durumuna alındı.`
              : `Yeni/tanınmayan cihazdan giriş algılandı: ${geo.countryName} (${geo.countryCode}). Oturum 'pending_verification' durumuna alındı.`,
            metadata: {
              countryCode: geo.countryCode,
              countryName: geo.countryName,
              city: geo.city || null,
              previousCountryName,
              isNewCountry,
              isNewDevice,
              emailStatus: emailResult.status,
              emailRecipient: SECURITY_NOTIFY_EMAIL,
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
          city: geo.city,
        },
      });
    } catch (err: any) {
      console.error("❌ [Security Register] Error:", err);
      return res.status(500).json({
        error: err?.message || "Oturum güvenlik kontrolü tamamlanamadı.",
      });
    }
  });

  // 2A. Tek Kullanımlık E-Posta Doğrulama Kodu veya Bağlantı Tokenını Doğrula
  app.post("/api/security/sessions/verify-challenge", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { sessionId, challengeToken, otpCode } = req.body || {};
      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "Geçersiz oturum kimliği." });
      }
      if (!challengeToken && !otpCode) {
        return res.status(400).json({ error: "Doğrulama kodu veya bağlantısı gereklidir." });
      }

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || (session.uid || session.userId) !== tokenUser.uid) {
        return res.status(404).json({ error: "İlgili oturum kaydı bulunamadı." });
      }

      if (session.status === "revoked" || session.sessionStatus === "revoked") {
        return res.status(403).json({ error: "Bu oturum zaten iptal edilmiştir." });
      }
      if (session.status === "active" && session.trusted === true) {
        return res.status(400).json({ error: "Bu oturum zaten doğrulanmış durumda." });
      }

      const challengeDoc = await dbGetDoc("securityVerificationTokens", sessionId, tokenUser.token);
      if (!challengeDoc || challengeDoc.uid !== tokenUser.uid) {
        return res.status(404).json({
          error: "Bu oturum için aktif bir e-posta doğrulama talebi bulunamadı.",
        });
      }

      if (challengeDoc.used === true) {
        return res.status(409).json({
          error: "Bu doğrulama kodu/bağlantısı daha önce kullanılmıştır (tek kullanımlıktır).",
          code: "CHALLENGE_ALREADY_USED",
        });
      }

      const expMs = parseTimestampMs(challengeDoc.expiresAt);
      if (expMs !== null && expMs <= Date.now()) {
        await dbSetDoc(
          "securitySessions",
          sessionId,
          { verificationStatus: "expired" },
          tokenUser.token
        ).catch(() => {});
        return res.status(410).json({
          error: "Doğrulama kodu veya bağlantısının süresi dolmuştur.",
          code: "CHALLENGE_EXPIRED",
        });
      }

      const attempts = Number(challengeDoc.attempts || 0);
      if (attempts >= 5) {
        return res.status(429).json({
          error: "Çok fazla hatalı doğrulama denemesi yapıldı. Lütfen yeni kod isteyin.",
          code: "TOO_MANY_ATTEMPTS",
        });
      }

      let matched = false;
      if (typeof challengeToken === "string" && challengeToken.trim()) {
        const computed = computeSaltedSha256(challengeToken.trim(), String(challengeDoc.salt));
        matched = safeTimingEqual(computed, String(challengeDoc.tokenHash || ""));
      } else if (typeof otpCode === "string" && otpCode.trim()) {
        const normOtp = otpCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const computed = computeSaltedSha256(normOtp, String(challengeDoc.salt));
        matched = safeTimingEqual(computed, String(challengeDoc.otpHash || ""));
      }

      if (!matched) {
        await dbSetDoc(
          "securityVerificationTokens",
          sessionId,
          { attempts: attempts + 1 },
          tokenUser.token
        ).catch(() => {});
        return res.status(403).json({
          error: "Doğrulama kodu veya bağlantısı geçersiz.",
          remainingAttempts: Math.max(0, 4 - attempts),
        });
      }

      const proofExpMs = Date.now() + CHALLENGE_PROOF_TTL_MS;
      const challengeProof = buildVerifiedChallengeProof(sessionId, tokenUser.uid, proofExpMs);
      verifiedChallengeCache.set(sessionId, {
        sessionId,
        uid: tokenUser.uid,
        verifiedAtMs: Date.now(),
        expiresAtMs: proofExpMs,
      });

      return res.json({
        success: true,
        verified: true,
        challengeProof,
        expiresAtMs: proofExpMs,
      });
    } catch (err: any) {
      console.error("❌ [Verify Challenge] Error:", err);
      return res.status(500).json({ error: err?.message || "Doğrulama işlemi başarısız." });
    }
  });

  // 2B. Hesap Sahibi Kararı ("Bu Benim" / "Ben Değilim" — YALNIZCA doğrulama sonrası!)
  app.post("/api/security/sessions/owner-decide", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { sessionId, challengeProof, decision } = req.body || {};
      if (!sessionId || !["confirmed_me", "denied_not_me"].includes(decision)) {
        return res.status(400).json({ error: "Geçersiz güvenlik kararı parametresi." });
      }

      if (!verifyChallengeProof(String(challengeProof || ""), sessionId, tokenUser.uid)) {
        return res.status(403).json({
          error: "Bu işlemi gerçekleştirmek için önce e-postanıza gönderilen tek kullanımlık kod veya bağlantıyı doğrulamalısınız.",
          code: "CHALLENGE_VERIFICATION_REQUIRED",
        });
      }

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || (session.uid || session.userId) !== tokenUser.uid) {
        return res.status(404).json({ error: "Oturum bulunamadı." });
      }

      if (session.status === "revoked" || session.sessionStatus === "revoked") {
        return res.status(400).json({ error: "Bu oturum zaten iptal edilmiş." });
      }

      const challengeDoc = await dbGetDoc("securityVerificationTokens", sessionId, tokenUser.token);
      if (!challengeDoc || challengeDoc.used === true) {
        return res.status(409).json({
          error: "Bu doğrulama kodu/bağlantısı zaten kullanılmış.",
          code: "CHALLENGE_ALREADY_USED",
        });
      }

      const expMs = parseTimestampMs(challengeDoc.expiresAt);
      if (expMs !== null && expMs <= Date.now()) {
        return res.status(410).json({ error: "Doğrulama süresi dolmuş." });
      }

      // Sunucu commit anahtarı (değişmez tokenHash üzerinden HMAC ile yalnızca sunucu türetir)
      const commitSecret = deriveDeterministicCommitSecret(
        sessionId,
        tokenUser.uid,
        String(challengeDoc.tokenHash || "")
      );

      const now = new Date();
      const isConfirmedMe = decision === "confirmed_me";
      const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
        () => null
      );
      const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token).catch(() => null);
      const ownerVerifiedEmail = (tokenUser.email || userDoc?.email || "").trim();

      const sessionUpdates: Record<string, any> = isConfirmedMe
        ? {
            status: "active",
            sessionStatus: "active",
            verificationStatus: "verified",
            trusted: true,
            userResponse: "confirmed_me",
            adminDecision: "approved",
            userRespondedAt: now,
            verifiedAt: now,
            lastActiveAt: now,
            lastSeenAt: now,
          }
        : {
            status: "revoked",
            sessionStatus: "revoked",
            verificationStatus: "denied",
            trusted: false,
            userResponse: "denied_not_me",
            adminDecision: "revoked",
            userRespondedAt: now,
            revokedAt: now,
            revokedBy: tokenUser.uid,
            revokedReason: "owner_denied_not_me",
            lastActiveAt: now,
            lastSeenAt: now,
          };

      const logBundle = buildAdminLogData({
        category: "security_session",
        action: isConfirmedMe ? "owner_verified_session" : "owner_denied_login_urgent",
        severity: isConfirmedMe ? "info" : "critical",
        actorUid: tokenUser.uid,
        actorEmail: ownerVerifiedEmail,
        actorName: session.displayName,
        targetUid: tokenUser.uid,
        targetUsername: session.username,
        sessionId,
        details: isConfirmedMe
          ? `@${session.username} e-posta doğrulaması ile ${session.countryName} oturumunu onayladı ve cihaz güvenilir listesine eklendi.`
          : `ACİL: @${session.username} e-posta doğrulaması sonrasında ${session.countryName} oturumunu "Ben Değilim" olarak reddetti. Oturum iptal edildi.`,
        metadata: {
          countryCode: session.countryCode,
          countryName: session.countryName,
          city: session.city || networkDoc?.city || null,
        },
      });

      const ops: AtomicWriteOp[] = [
        {
          colPath: "securityVerificationTokens",
          docId: sessionId,
          mustExist: true,
          data: {
            used: true,
            usedAt: now,
            decisionCommitKey: commitSecret,
          },
        },
        {
          colPath: "securitySessions",
          docId: sessionId,
          mustExist: true,
          data: sessionUpdates,
        },
        {
          colPath: "adminLogs",
          docId: logBundle.logId,
          data: logBundle.doc,
        },
      ];

      if (isConfirmedMe) {
        const secProfile = await dbGetDoc(
          "userSecurityProfiles",
          tokenUser.uid,
          tokenUser.token
        ).catch(() => null);
        const existingCountries: string[] = Array.isArray(secProfile?.knownCountryCodes)
          ? secProfile.knownCountryCodes
          : [];
        const existingDevices: string[] = Array.isArray(secProfile?.knownDeviceIds)
          ? secProfile.knownDeviceIds
          : [];
        const existingSigs: string[] = Array.isArray(secProfile?.knownDeviceSignatures)
          ? secProfile.knownDeviceSignatures
          : [];

        const nextCountries =
          session.countryCode && session.countryCode !== "UNKNOWN"
            ? Array.from(new Set([...existingCountries, session.countryCode]))
            : existingCountries;
        const nextDevices = session.deviceId
          ? Array.from(new Set([...existingDevices, session.deviceId])).slice(-25)
          : existingDevices;
        const nextSigs = session.deviceSignature
          ? Array.from(new Set([...existingSigs, session.deviceSignature])).slice(-25)
          : existingSigs;

        ops.push({
          colPath: "userSecurityProfiles",
          docId: tokenUser.uid,
          data: {
            uid: tokenUser.uid,
            knownCountryCodes: nextCountries,
            knownDeviceIds: nextDevices,
            knownDeviceSignatures: nextSigs,
            lastKnownCountryCode:
              session.countryCode !== "UNKNOWN"
                ? session.countryCode
                : secProfile?.lastKnownCountryCode || null,
            lastKnownCountryName:
              session.countryCode !== "UNKNOWN"
                ? session.countryName
                : secProfile?.lastKnownCountryName || null,
            lastVerifiedSessionId: sessionId,
            updatedAt: now,
          },
        });
      }

      await dbAtomicCommit(ops, tokenUser.token);
      verifiedChallengeCache.delete(sessionId);

      // E-posta bildirimi gönder (tekilleştirilmiş)
      const emailEvent: SecurityEmailEventType = isConfirmedMe
        ? "verified_login_notification"
        : "owner_denied_alert";

      const emailResult = await sendSecurityResendEmailOnce({
        sessionId,
        eventType: emailEvent,
        recipientEmail: SECURITY_NOTIFY_EMAIL,
        username: session.username,
        displayName: session.displayName,
        userId: tokenUser.uid,
        countryName: session.countryName,
        countryCode: session.countryCode,
        countryFlag: session.flagEmoji || "🌐",
        city: session.city || networkDoc?.city || null,
        deviceType: session.deviceType || "unknown",
        osName: session.osName || "Bilinmiyor",
        browserName: session.browserName || "Bilinmiyor",
        loginTimeFormatted: formatTrDateTime(now),
        previousCountryName: session.previousCountryName || undefined,
        sessionDataForDedup: session,
      });

      const nextDispatches = {
        ...(session.emailDispatches || {}),
        [emailEvent]: {
          sent: emailResult.sent,
          status: emailResult.status,
          recipient: emailResult.recipient,
          subject: emailResult.subject,
          sentAt: now,
          error: emailResult.error || null,
        },
      };

      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          emailSent: emailResult.sent || Boolean(session.emailSent),
          emailStatus: emailResult.status,
          emailError: emailResult.error || null,
          emailDispatches: nextDispatches,
        },
        tokenUser.token
      ).catch(() => {});

      return res.json({
        success: true,
        session: {
          ...session,
          ...sessionUpdates,
          emailSent: emailResult.sent || Boolean(session.emailSent),
          emailStatus: emailResult.status,
          emailError: emailResult.error || null,
          emailDispatches: nextDispatches,
        },
        emailResult,
      });
    } catch (err: any) {
      console.error("❌ [Owner Decide] Error:", err);
      return res.status(500).json({ error: err?.message || "Güvenlik kararı işlenemedi." });
    }
  });

  // Eski doğrulamasız /respond ucunu güvenlik nedeniyle kapat (self-approval bypass engeli)
  app.post("/api/security/sessions/respond", async (_req: Request, res: Response) => {
    return res.status(403).json({
      error:
        "Doğrudan cihaz üzerinden tek tuşla onay devre dışıdır. Lütfen e-posta doğrulama kodu veya bağlantısı ile kimliğinizi doğrulayın.",
      code: "OUT_OF_BAND_VERIFICATION_REQUIRED",
    });
  });

  // 2C. Doğrulama Kodunu Yeniden Gönder (Rate-limited)
  app.post("/api/security/sessions/resend-challenge", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || (session.uid || session.userId) !== tokenUser.uid) {
        return res.status(404).json({ error: "Oturum bulunamadı." });
      }
      if (session.status !== "pending_verification") {
        return res.status(400).json({ error: "Bu oturum doğrulama beklemiyor." });
      }

      const prevTokenDoc = await dbGetDoc("securityVerificationTokens", sessionId, tokenUser.token).catch(
        () => null
      );
      const prevCreatedMs = parseTimestampMs(prevTokenDoc?.createdAt);
      if (prevCreatedMs && Date.now() - prevCreatedMs < 60 * 1000) {
        return res.status(429).json({
          error: "Yeni kod isteyebilmek için lütfen 60 saniye bekleyin.",
        });
      }

      const now = new Date();
      const rawToken = crypto.randomBytes(24).toString("base64url");
      const rawOtp = generateOtpCode();
      const salt = crypto.randomBytes(16).toString("hex");
      const tokenHash = computeSaltedSha256(rawToken, salt);
      const otpHash = computeSaltedSha256(rawOtp, salt);
      const challengeExpiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
      const commitSecret = deriveDeterministicCommitSecret(
        sessionId,
        tokenUser.uid,
        tokenHash
      );
      const commitHash = crypto.createHash("sha256").update(commitSecret, "utf8").digest("hex");

      await dbSetDoc(
        "securityVerificationTokens",
        sessionId,
        {
          sessionId,
          uid: tokenUser.uid,
          tokenHash,
          otpHash,
          salt,
          commitHash,
          decisionCommitKey: "",
          used: false,
          usedAt: null,
          attempts: 0,
          expiresAt: challengeExpiresAt,
          createdAt: now,
        },
        tokenUser.token
      );

      const appOrigin = resolveAppOrigin(req);
      const verificationUrl = `${appOrigin}/#/?secSession=${encodeURIComponent(sessionId)}&secToken=${encodeURIComponent(rawToken)}`;

      // Resend yeniden gönderimi için bellek kilidini aç
      sentEmailEventsCache.delete(`${sessionId}:unverified_suspicious_login`);

      const emailResult = await sendSecurityResendEmailOnce({
        sessionId,
        eventType: "unverified_suspicious_login",
        recipientEmail: SECURITY_NOTIFY_EMAIL,
        username: session.username,
        displayName: session.displayName,
        userId: tokenUser.uid,
        countryName: session.countryName,
        countryCode: session.countryCode,
        countryFlag: session.flagEmoji || "🌐",
        city: session.city,
        deviceType: session.deviceType,
        osName: session.osName,
        browserName: session.browserName,
        loginTimeFormatted: formatTrDateTime(now),
        previousCountryName: session.previousCountryName || undefined,
        verificationUrl,
        verificationCode: rawOtp,
        sessionDataForDedup: null,
      });

      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          challengeExpiresAt,
          verificationStatus: "pending",
          emailSent: emailResult.sent,
          emailStatus: emailResult.status,
          emailRecipient: SECURITY_NOTIFY_EMAIL,
          emailError: emailResult.error || null,
          emailDispatches: {
            ...(session.emailDispatches || {}),
            unverified_suspicious_login: {
              sent: emailResult.sent,
              status: emailResult.status,
              recipient: SECURITY_NOTIFY_EMAIL,
              subject: "RedChat — Yeni Oturum Açıldı",
              sentAt: now,
              error: emailResult.error || null,
            },
          },
        },
        tokenUser.token
      );

      return res.json({ success: true, emailResult });
    } catch (err: any) {
      console.error("❌ [Resend Challenge] Error:", err);
      return res.status(500).json({ error: err?.message || "Doğrulama kodu yeniden gönderilemedi." });
    }
  });

  // 3. Kullanıcı İsteğiyle Diğer Tüm Oturumları Kapat ("Ben Değilim" Sonrası veya aktif hesapta)
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
        (callerSession.uid || callerSession.userId) !== tokenUser.uid ||
        !verifyProofAgainstSession(sessionProof, callerSession, networkDoc)
      ) {
        return res.status(403).json({ error: "Yetkisiz oturum işlemi." });
      }

      const allUserSessions = await dbQueryByUserId(
        "securitySessions",
        tokenUser.uid,
        tokenUser.token
      );
      const now = new Date();
      let revokedCount = 0;

      for (const s of allUserSessions) {
        if (s.status !== "revoked") {
          await dbSetDoc(
            "securitySessions",
            s.sessionId || s.id,
            {
              status: "revoked",
              sessionStatus: "revoked",
              verificationStatus: s.verificationStatus === "pending" ? "denied" : s.verificationStatus,
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

  // 4. Oturumun Aktifliğini Sunucuda Doğrula (Süre dolması ve iptal dahil)
  app.post("/api/security/sessions/verify-active", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res, true);
      if (!tokenUser) return;

      const { sessionId, sessionProof } = req.body || {};
      if (!sessionId || !sessionProof) {
        return res.status(400).json({ active: false, reason: "MISSING_SESSION" });
      }

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || (session.uid || session.userId) !== tokenUser.uid) {
        return res.status(401).json({ active: false, reason: "SESSION_NOT_FOUND" });
      }

      const networkDoc = await dbGetDoc("securitySessionNetwork", sessionId, tokenUser.token).catch(
        () => null
      );
      if (!verifyProofAgainstSession(sessionProof, session, networkDoc)) {
        return res.status(403).json({ active: false, reason: "INVALID_PROOF" });
      }

      const expMs = parseTimestampMs(session.expiresAt);
      if (expMs !== null && expMs <= Date.now()) {
        await dbSetDoc(
          "securitySessions",
          sessionId,
          {
            status: "revoked",
            sessionStatus: "revoked",
            verificationStatus: "expired",
            trusted: false,
            revokedAt: new Date(),
            revokedReason: "session_expired",
          },
          tokenUser.token
        ).catch(() => {});

        return res.status(401).json({
          active: false,
          status: "revoked",
          sessionStatus: "revoked",
          verificationStatus: "expired",
          reason: "SESSION_EXPIRED",
        });
      }

      const effStatus = session.sessionStatus || session.status;
      const isActive =
        session.status === "active" &&
        effStatus === "active" &&
        session.trusted === true &&
        !session.revokedAt;

      return res.json({
        active: isActive,
        status: session.status,
        sessionStatus: effStatus,
        verificationStatus: session.verificationStatus || (isActive ? "verified" : "pending"),
      });
    } catch {
      return res.status(500).json({ active: false, reason: "SERVER_ERROR" });
    }
  });

  // 5. ADMIN: Şüpheli Oturumlar Listesi & Detay (Moderatör erişemez)
  app.get("/api/admin/security/sessions/list", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({ error: "Bu işlem yalnızca Ana Yönetici yetkisindedir." });
      }

      const challengeProof = String(req.headers["x-redchat-challenge-proof"] || "");
      const gate = await assertAdminActionAllowedOnCurrentSession(req, tokenUser, challengeProof);
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.error, code: gate.code });
      }

      const sessions = await dbListRecent("securitySessions", 150, tokenUser.token);
      const networks = await dbListRecent("securitySessionNetwork", 150, tokenUser.token).catch(
        () => []
      );
      const networkMap: Record<string, any> = {};
      networks.forEach((n) => {
        if (n.sessionId || n.id) networkMap[n.sessionId || n.id] = n;
      });

      return res.json({ sessions, networkMap });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Oturum listesi alınamadı." });
    }
  });

  // 6. ADMIN: Kullanıcının Tüm Oturum Geçmişini İncele
  app.get("/api/admin/security/sessions/history/:targetUid", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({ error: "Bu işlem yalnızca Ana Yönetici yetkisindedir." });
      }

      const challengeProof = String(req.headers["x-redchat-challenge-proof"] || "");
      const gate = await assertAdminActionAllowedOnCurrentSession(req, tokenUser, challengeProof);
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.error, code: gate.code });
      }

      const targetUid = String(req.params.targetUid || "").trim();
      if (!targetUid) return res.status(400).json({ error: "targetUid gerekli." });

      const sessions = await dbQueryByUserId("securitySessions", targetUid, tokenUser.token);
      const sorted = [...sessions].sort(
        (a, b) => (parseTimestampMs(b.createdAt) || 0) - (parseTimestampMs(a.createdAt) || 0)
      );

      const networks = await dbQueryByUserId(
        "securitySessionNetwork",
        targetUid,
        tokenUser.token
      ).catch(() => []);
      const networkMap: Record<string, any> = {};
      networks.forEach((n) => {
        networkMap[n.sessionId || n.id] = n;
      });

      return res.json({
        targetUid,
        sessions: sorted,
        networkMap,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Oturum geçmişi alınamadı." });
    }
  });

  // 7. ANA YÖNETİCİ KURTARMA: Pending Oturumu Güvenli Re-Auth / Email Kodu ile Doğrula
  app.post("/api/admin/security/recover-self", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({
          error: "Kurtarma modu yalnızca doğrulanmış Ana Yöneticiler içindir.",
        });
      }

      const { sessionId, challengeProof } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session || (session.uid || session.userId) !== tokenUser.uid) {
        return res.status(404).json({ error: "Yönetici oturumu bulunamadı." });
      }

      if (session.status === "revoked" || session.sessionStatus === "revoked") {
        return res.status(403).json({ error: "İptal edilmiş oturum kurtarılamaz." });
      }

      const hasValidReauth = isFreshReauth(tokenUser);
      const hasValidChallenge =
        typeof challengeProof === "string" &&
        verifyChallengeProof(challengeProof, sessionId, tokenUser.uid);

      if (!hasValidReauth && !hasValidChallenge) {
        return res.status(403).json({
          error:
            "Ana Yönetici kurtarması için taze kimlik doğrulama (şifre yenileme/doğrulama) veya tek kullanımlık e-posta doğrulama kodu gereklidir.",
          code: "ADMIN_REAUTH_REQUIRED",
        });
      }

      const now = new Date();
      const updates = {
        status: "active",
        sessionStatus: "active",
        verificationStatus: "verified",
        trusted: true,
        userResponse: "confirmed_me",
        adminDecision: "approved",
        adminReviewedAt: now,
        adminReviewedBy: tokenUser.email || tokenUser.uid,
        verifiedAt: now,
        lastActiveAt: now,
        lastSeenAt: now,
      };

      await dbSetDoc("securitySessions", sessionId, updates, tokenUser.token);

      const secProfile = await dbGetDoc("userSecurityProfiles", tokenUser.uid, tokenUser.token).catch(
        () => null
      );
      const existingCountries: string[] = Array.isArray(secProfile?.knownCountryCodes)
        ? secProfile.knownCountryCodes
        : [];
      const existingDevices: string[] = Array.isArray(secProfile?.knownDeviceIds)
        ? secProfile.knownDeviceIds
        : [];
      const existingSigs: string[] = Array.isArray(secProfile?.knownDeviceSignatures)
        ? secProfile.knownDeviceSignatures
        : [];

      await dbSetDoc(
        "userSecurityProfiles",
        tokenUser.uid,
        {
          uid: tokenUser.uid,
          knownCountryCodes:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? Array.from(new Set([...existingCountries, session.countryCode]))
              : existingCountries,
          knownDeviceIds: session.deviceId
            ? Array.from(new Set([...existingDevices, session.deviceId])).slice(-25)
            : existingDevices,
          knownDeviceSignatures: session.deviceSignature
            ? Array.from(new Set([...existingSigs, session.deviceSignature])).slice(-25)
            : existingSigs,
          lastKnownCountryCode:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? session.countryCode
              : secProfile?.lastKnownCountryCode || null,
          lastKnownCountryName:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? session.countryName
              : secProfile?.lastKnownCountryName || null,
          updatedAt: now,
        },
        tokenUser.token
      );

      const emailResult = await sendSecurityResendEmailOnce({
        sessionId,
        eventType: "verified_login_notification",
        recipientEmail: SECURITY_NOTIFY_EMAIL,
        username: session.username,
        displayName: session.displayName,
        userId: tokenUser.uid,
        countryName: session.countryName,
        countryCode: session.countryCode,
        countryFlag: session.flagEmoji || "🌐",
        city: session.city,
        deviceType: session.deviceType,
        osName: session.osName,
        browserName: session.browserName,
        loginTimeFormatted: formatTrDateTime(now),
        previousCountryName: session.previousCountryName || undefined,
        sessionDataForDedup: session,
      });

      await writeAdminLog(
        {
          category: "security_session",
          action: "main_admin_self_recovery",
          severity: "warning",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: adminCheck.displayName,
          targetUid: tokenUser.uid,
          targetUsername: session.username,
          sessionId,
          details: `Ana Yönetici (${adminCheck.displayName}) güvenli yeniden doğrulama (${hasValidReauth ? "Şifre Re-Auth" : "E-posta Kodu"}) ile ${session.countryName} oturumunu doğruladı.`,
          metadata: { method: hasValidReauth ? "firebase_reauth" : "email_challenge", emailStatus: emailResult.status },
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        session: { ...session, ...updates },
        emailResult,
      });
    } catch (err: any) {
      console.error("❌ [Admin Recover Self] Error:", err);
      return res.status(500).json({ error: err?.message || "Yönetici kurtarma işlemi başarısız." });
    }
  });

  // 8. ADMIN: Oturuma İzin Ver
  app.post("/api/admin/security/sessions/approve", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({ error: "Bu işlem için Ana Yönetici yetkisi gerekli." });
      }

      const { sessionId, challengeProof } = req.body || {};
      const gate = await assertAdminActionAllowedOnCurrentSession(req, tokenUser, challengeProof);
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.error, code: gate.code });
      }

      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session) return res.status(404).json({ error: "Oturum bulunamadı." });

      const ownerUid = session.uid || session.userId;
      const now = new Date();
      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          status: "active",
          sessionStatus: "active",
          verificationStatus: "verified",
          trusted: true,
          adminDecision: "approved",
          adminReviewedAt: now,
          adminReviewedBy: tokenUser.email || tokenUser.uid,
          verifiedAt: now,
          lastActiveAt: now,
          lastSeenAt: now,
        },
        tokenUser.token
      );

      const secProfile = await dbGetDoc("userSecurityProfiles", ownerUid, tokenUser.token).catch(
        () => null
      );
      const existingCountries: string[] = Array.isArray(secProfile?.knownCountryCodes)
        ? secProfile.knownCountryCodes
        : [];
      const existingDevices: string[] = Array.isArray(secProfile?.knownDeviceIds)
        ? secProfile.knownDeviceIds
        : [];
      const existingSigs: string[] = Array.isArray(secProfile?.knownDeviceSignatures)
        ? secProfile.knownDeviceSignatures
        : [];

      await dbSetDoc(
        "userSecurityProfiles",
        ownerUid,
        {
          uid: ownerUid,
          knownCountryCodes:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? Array.from(new Set([...existingCountries, session.countryCode]))
              : existingCountries,
          knownDeviceIds: session.deviceId
            ? Array.from(new Set([...existingDevices, session.deviceId])).slice(-25)
            : existingDevices,
          knownDeviceSignatures: session.deviceSignature
            ? Array.from(new Set([...existingSigs, session.deviceSignature])).slice(-25)
            : existingSigs,
          lastKnownCountryCode:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? session.countryCode
              : secProfile?.lastKnownCountryCode || null,
          lastKnownCountryName:
            session.countryCode && session.countryCode !== "UNKNOWN"
              ? session.countryName
              : secProfile?.lastKnownCountryName || null,
          updatedAt: now,
        },
        tokenUser.token
      );

      // Onaylanan oturum için sabit güvenlik bildirim adresine tekilleştirilmiş "Hesabınızda Yeni Giriş" e-postası gönder
      const emailResult = await sendSecurityResendEmailOnce({
        sessionId,
        eventType: "verified_login_notification",
        recipientEmail: SECURITY_NOTIFY_EMAIL,
        username: session.username,
        displayName: session.displayName,
        userId: ownerUid,
        countryName: session.countryName,
        countryCode: session.countryCode,
        countryFlag: session.flagEmoji || "🌐",
        city: session.city,
        deviceType: session.deviceType,
        osName: session.osName,
        browserName: session.browserName,
        loginTimeFormatted: formatTrDateTime(now),
        previousCountryName: session.previousCountryName || undefined,
        sessionDataForDedup: session,
      });

      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          emailSent: emailResult.sent || Boolean(session.emailSent),
          emailStatus: emailResult.status,
          emailRecipient: SECURITY_NOTIFY_EMAIL,
          emailError: emailResult.error || null,
          emailDispatches: {
            ...(session.emailDispatches || {}),
            verified_login_notification: {
              sent: emailResult.sent,
              status: emailResult.status,
              recipient: SECURITY_NOTIFY_EMAIL,
              subject: "RedChat — Hesabınızda Yeni Giriş",
              sentAt: now,
              error: emailResult.error || null,
            },
          },
        },
        tokenUser.token
      ).catch(() => {});

      await writeAdminLog(
        {
          category: "security_session",
          action: "admin_approved_session",
          severity: "info",
          actorUid: tokenUser.uid,
          actorEmail: tokenUser.email,
          actorName: adminCheck.displayName,
          targetUid: ownerUid,
          targetUsername: session.username,
          sessionId,
          details: `Admin (${adminCheck.displayName}), @${session.username} kullanıcısının ${session.countryName} oturumuna izin verdi.`,
          metadata: {
            countryCode: session.countryCode,
            countryName: session.countryName,
            deviceId: session.deviceId,
            emailStatus: emailResult.status,
          },
        },
        tokenUser.token
      );

      return res.json({ success: true, emailResult });
    } catch (err: any) {
      console.error("❌ [Admin Approve Session] Error:", err);
      return res.status(500).json({ error: err?.message || "Oturum onaylanamadı." });
    }
  });

  // 9. ADMIN: Yalnızca Seçilen Tek Oturumu Kapat (Diğer cihazlara dokunmaz, revokeRefreshTokens ÇAĞIRMAZ)
  app.post("/api/admin/security/sessions/revoke-single", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({ error: "Bu işlem için Ana Yönetici yetkisi gerekli." });
      }

      const { sessionId, challengeProof } = req.body || {};
      const gate = await assertAdminActionAllowedOnCurrentSession(req, tokenUser, challengeProof);
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.error, code: gate.code });
      }

      if (!sessionId) return res.status(400).json({ error: "sessionId gerekli." });

      const session = await dbGetDoc("securitySessions", sessionId, tokenUser.token);
      if (!session) return res.status(404).json({ error: "Oturum bulunamadı." });

      const ownerUid = session.uid || session.userId;
      const now = new Date();
      await dbSetDoc(
        "securitySessions",
        sessionId,
        {
          status: "revoked",
          sessionStatus: "revoked",
          verificationStatus:
            session.verificationStatus === "pending" ? "denied" : session.verificationStatus,
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
          targetUid: ownerUid,
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

  // 10. ADMIN: Kullanıcının Tüm Oturumlarını Kapat
  app.post("/api/admin/security/sessions/revoke-all", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const adminCheck = await assertMainAdminStrict(tokenUser);
      if (!adminCheck.isMainAdmin) {
        return res.status(403).json({ error: "Bu işlem için Ana Yönetici yetkisi gerekli." });
      }

      const { targetUid, targetUsername, challengeProof } = req.body || {};
      const gate = await assertAdminActionAllowedOnCurrentSession(req, tokenUser, challengeProof);
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.error, code: gate.code });
      }

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
              sessionStatus: "revoked",
              verificationStatus:
                s.verificationStatus === "pending" ? "denied" : s.verificationStatus,
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
