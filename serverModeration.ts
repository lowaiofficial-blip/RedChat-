import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { requireActiveSecuritySession } from "./serverSecurity";

const PROJECT_ID = "redchat-7c1db";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export const MAIN_ADMIN_EMAILS = ["robloxenes930@gmail.com", "gg00cat73@gmail.com"];
export const MUSE_MODERATOR_UID = "GnQk5MbPQdS4GDl4cohFzRlKNw22";
export const MUSE_MODERATOR_EMAIL = "muse@gmail.com";

const MAX_TEMP_DURATION_MINUTES = 43200; // 30 gün

let cachedCerts: Record<string, string> = {};
let cachedCertsExpiry = 0;

interface VerifiedTokenUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  token: string;
}

interface VerifiedAuthority {
  uid: string;
  email: string | null;
  username: string;
  displayName: string;
  isMainAdmin: boolean;
  isModerator: boolean;
  role: "admin" | "moderator" | "user";
  grantActive: boolean;
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
    console.warn("[Moderation] Fallback ID token verification failed:", err);
    return null;
  }
}

async function authenticateRequest(req: Request, res: Response): Promise<VerifiedTokenUser | null> {
  try {
    const tokenUser = await verifyBearerIdToken(req);
    if (!tokenUser) {
      res.status(401).json({ error: "Kimlik doğrulama gerekli." });
      return null;
    }
    return tokenUser;
  } catch (err: any) {
    if (err?.message === "TOKEN_REVOKED") {
      res.status(401).json({ error: "Oturum jetonu iptal edilmiş.", code: "TOKEN_REVOKED" });
      return null;
    }
    res.status(401).json({ error: "Kimlik doğrulama başarısız." });
    return null;
  }
}

function toRestValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toRestValue) } };
  if (typeof val === "object") {
    if (typeof val.toDate === "function") {
      return { timestampValue: val.toDate().toISOString() };
    }
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toRestValue(v);
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
  if ("arrayValue" in val) return (val.arrayValue?.values || []).map(fromRestValue);
  if ("mapValue" in val) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
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
    signal: AbortSignal.timeout(6000),
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
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST setDoc failed (${resp.status}): ${errText}`);
  }
}

async function dbListCollection(
  colPath: string,
  idToken?: string,
  pageSize = 300
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const snap = await getFirestore().collection(colPath).limit(pageSize).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const resp = await fetch(`${FIRESTORE_BASE}/${colPath}?pageSize=${pageSize}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST list failed (${resp.status}): ${errText}`);
  }
  const json: any = await resp.json();
  const docs = Array.isArray(json.documents) ? json.documents : [];
  return docs.map(fromRestDoc).filter(Boolean) as Record<string, any>[];
}

async function dbListConversationMessages(
  conversationId: string,
  idToken?: string,
  limitCount = 200
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const snap = await getFirestore()
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .orderBy("createdAt", "asc")
      .limitToLast(limitCount)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const resp = await fetch(`${FIRESTORE_BASE}/conversations/${encodeURIComponent(conversationId)}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "messages" }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
        limit: limitCount,
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST messages query failed (${resp.status}): ${errText}`);
  }
  const rows = (await resp.json()) as any[];
  return rows
    .filter((r) => r.document)
    .map((r) => fromRestDoc(r.document))
    .filter(Boolean) as Record<string, any>[];
}

function toTimestampMs(val: any): number | null {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val?.toDate === "function") return val.toDate().getTime();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (typeof val === "string") {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof val === "number") return val;
  return null;
}

async function resolveVerifiedAuthority(tokenUser: VerifiedTokenUser): Promise<VerifiedAuthority> {
  const emailLower = (tokenUser.email || "").trim().toLowerCase();
  const userDoc = await dbGetDoc("users", tokenUser.uid, tokenUser.token).catch(() => null);
  const grantDoc = await dbGetDoc("moderatorGrants", tokenUser.uid, tokenUser.token).catch(() => null);

  const isMainAdmin =
    MAIN_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(emailLower) ||
    userDoc?.role === "admin";

  const isIdentityMatchedMuse =
    tokenUser.uid === MUSE_MODERATOR_UID && emailLower === MUSE_MODERATOR_EMAIL;

  const isGrantActive =
    Boolean(grantDoc) &&
    grantDoc?.active === true &&
    grantDoc?.role === "moderator" &&
    grantDoc?.uid === tokenUser.uid;

  const isVerifiedModerator =
    !isMainAdmin &&
    isIdentityMatchedMuse &&
    isGrantActive &&
    userDoc?.role === "moderator";

  const role: "admin" | "moderator" | "user" = isMainAdmin
    ? "admin"
    : isVerifiedModerator
    ? "moderator"
    : "user";

  return {
    uid: tokenUser.uid,
    email: tokenUser.email,
    username: userDoc?.username || emailLower.split("@")[0] || "kullanici",
    displayName: userDoc?.displayName || userDoc?.username || tokenUser.email || "Kullanıcı",
    isMainAdmin,
    isModerator: isVerifiedModerator,
    role,
    grantActive: isGrantActive,
  };
}

async function writeModerationLog(
  entry: {
    actorUid: string;
    actorEmail?: string | null;
    actorUsername?: string | null;
    actorRole: "admin" | "moderator" | "system";
    targetUid: string;
    targetUsername?: string | null;
    actionType:
      | "temp_mute"
      | "unmute"
      | "temp_ban"
      | "unban"
      | "perm_ban"
      | "auto_mute_expired"
      | "auto_ban_expired"
      | "moderator_role_granted"
      | "moderator_role_revoked"
      | "report_reviewed";
    reason: string;
    startsAt: Date;
    endsAt: Date | null;
    durationMinutes?: number | null;
    reportId?: string | null;
  },
  idToken?: string
) {
  const logId = `modlog_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date();
  await dbSetDoc(
    "moderationLogs",
    logId,
    {
      id: logId,
      actorUid: entry.actorUid,
      actorEmail: entry.actorEmail || null,
      actorUsername: entry.actorUsername || null,
      actorRole: entry.actorRole,
      targetUid: entry.targetUid,
      targetUsername: entry.targetUsername || null,
      actionType: entry.actionType,
      reason: entry.reason,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      durationMinutes: entry.durationMinutes ?? null,
      reportId: entry.reportId ?? null,
      createdAt: now,
    },
    idToken
  );

  // Admin paneli genel denetim günlüğüne de özet düş
  const adminLogId = `log_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  try {
    await dbSetDoc(
      "adminLogs",
      adminLogId,
      {
        id: adminLogId,
        category: "moderation",
        action: entry.actionType,
        severity:
          entry.actionType === "perm_ban" || entry.actionType === "temp_ban"
            ? "critical"
            : entry.actionType === "temp_mute"
            ? "warning"
            : "info",
        actorUid: entry.actorUid,
        actorEmail: entry.actorEmail || null,
        actorName: entry.actorUsername || entry.actorRole,
        targetUid: entry.targetUid,
        targetUsername: entry.targetUsername || null,
        sessionId: null,
        details: `[${entry.actorRole.toUpperCase()}] @${entry.targetUsername || entry.targetUid} -> ${entry.actionType}: ${entry.reason}`,
        metadata: {
          actionType: entry.actionType,
          durationMinutes: entry.durationMinutes ?? null,
          endsAt: entry.endsAt ? entry.endsAt.toISOString() : null,
        },
        createdAt: now,
      },
      idToken
    );
  } catch (err) {
    console.warn("[Moderation] adminLogs aynalama uyarısı:", err);
  }

  return logId;
}

function isTargetMainAdmin(targetDoc: Record<string, any> | null, targetUid: string): boolean {
  if (!targetDoc) return false;
  const email = (targetDoc.email || "").trim().toLowerCase();
  return (
    targetDoc.role === "admin" ||
    MAIN_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email) ||
    targetUid === "system_redchat_ai"
  );
}

async function expireUserPenaltiesIfDue(
  targetUid: string,
  idToken?: string
): Promise<{ banExpired: boolean; muteExpired: boolean }> {
  const userDoc = await dbGetDoc("users", targetUid, idToken).catch(() => null);
  if (!userDoc) return { banExpired: false, muteExpired: false };

  const now = new Date();
  const nowMs = now.getTime();
  let banExpired = false;
  let muteExpired = false;

  const updates: Record<string, any> = {};

  if (userDoc.isBanned && userDoc.banType === "temporary") {
    const banEndMs = toTimestampMs(userDoc.banExpiresAt);
    if (banEndMs !== null && banEndMs <= nowMs) {
      banExpired = true;
      updates.isBanned = false;
      updates.banType = null;
      updates.banReason = null;
      updates.bannedAt = null;
      updates.banExpiresAt = null;
      updates.bannedByUid = null;
      updates.updatedAt = now;
    }
  }

  if (userDoc.isMuted && userDoc.muteType === "temporary") {
    const muteEndMs = toTimestampMs(userDoc.muteExpiresAt);
    if (muteEndMs !== null && muteEndMs <= nowMs) {
      muteExpired = true;
      updates.isMuted = false;
      updates.muteType = null;
      updates.muteReason = null;
      updates.mutedAt = null;
      updates.muteExpiresAt = null;
      updates.mutedByUid = null;
      updates.updatedAt = now;
    }
  }

  if (banExpired || muteExpired) {
    await dbSetDoc("users", targetUid, updates, idToken);
    if (banExpired) {
      await writeModerationLog(
        {
          actorUid: targetUid,
          actorRole: "system",
          actorUsername: "system_auto_expiry",
          targetUid,
          targetUsername: userDoc.username || null,
          actionType: "auto_ban_expired",
          reason: "Geçici ban süresi otomatik olarak doldu.",
          startsAt: new Date(toTimestampMs(userDoc.bannedAt) || nowMs),
          endsAt: now,
        },
        idToken
      ).catch((err) => console.warn("[AutoExpiry] ban log warn:", err));
    }
    if (muteExpired) {
      await writeModerationLog(
        {
          actorUid: targetUid,
          actorRole: "system",
          actorUsername: "system_auto_expiry",
          targetUid,
          targetUsername: userDoc.username || null,
          actionType: "auto_mute_expired",
          reason: "Geçici susturma süresi otomatik olarak doldu.",
          startsAt: new Date(toTimestampMs(userDoc.mutedAt) || nowMs),
          endsAt: now,
        },
        idToken
      ).catch((err) => console.warn("[AutoExpiry] mute log warn:", err));
    }
  }

  return { banExpired, muteExpired };
}

async function computeModeratorAllowedConversationIds(
  idToken?: string
): Promise<Map<string, string>> {
  const scopeReasons = new Map<string, string>();
  const [reports, conversations] = await Promise.all([
    dbListCollection("userReports", idToken, 300).catch(() => []),
    dbListCollection("conversations", idToken, 300).catch(() => []),
  ]);

  const reportedUids = new Set<string>();
  for (const r of reports) {
    if (r.status === "dismissed") continue;
    if (r.conversationId) {
      scopeReasons.set(r.conversationId, `Şikâyet Kapsamı (#${String(r.id || "").slice(-6)})`);
    }
    if (r.reportedUid) {
      reportedUids.add(r.reportedUid);
    }
  }

  for (const c of conversations) {
    const cid = c.id;
    if (!cid) continue;
    if (c.securityStatus === "terminated" || (Number(c.abusiveCount) || 0) > 0) {
      if (!scopeReasons.has(cid)) {
        scopeReasons.set(cid, "Güvenlik İhlali / Kötüye Kullanım Bayrağı");
      }
      continue;
    }
    const pIds: string[] = Array.isArray(c.participantIds) ? c.participantIds : [];
    const matchedReported = pIds.find((uid) => reportedUids.has(uid));
    if (matchedReported && !scopeReasons.has(cid)) {
      scopeReasons.set(cid, "Şikâyet Edilen Kullanıcı Kapsamı");
    }
  }

  return scopeReasons;
}

function sanitizeConversationForModerator(conv: Record<string, any>, scopeReason: string) {
  const sanitizedParticipants: Record<string, any> = {};
  if (conv.participants && typeof conv.participants === "object") {
    for (const [uid, p] of Object.entries<any>(conv.participants)) {
      sanitizedParticipants[uid] = {
        displayName: p?.displayName || p?.username || "Kullanıcı",
        username: p?.username || "kullanici",
        photoURL: p?.photoURL || null,
        role: p?.role || "member",
      };
    }
  }
  return {
    id: conv.id,
    isGroup: Boolean(conv.isGroup),
    name: conv.name || null,
    participantIds: Array.isArray(conv.participantIds) ? conv.participantIds : [],
    participants: sanitizedParticipants,
    lastMessageText: conv.lastMessageText || "",
    lastMessageTimestamp: conv.lastMessageTimestamp || null,
    securityStatus: conv.securityStatus || "active",
    abusiveCount: conv.abusiveCount || 0,
    updatedAt: conv.updatedAt || null,
    scopeReason,
  };
}

export function registerModerationRoutes(app: Express) {
  // 1. Oturum açıldığında veya panel açıldığında Muse / Admin rolünü sunucuda doğrula
  app.post("/api/moderation/verify-role", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      return res.json({
        uid: authority.uid,
        email: authority.email,
        role: authority.role,
        isMainAdmin: authority.isMainAdmin,
        isModerator: authority.isModerator,
        grantActive: authority.grantActive,
        verifiedAt: new Date().toISOString(),
        permissions: {
          canViewUsers: authority.isMainAdmin || authority.isModerator,
          canTempMute: authority.isMainAdmin || authority.isModerator,
          canTempBan: authority.isMainAdmin || authority.isModerator,
          canPermBan: authority.isMainAdmin,
          canManageRoles: authority.isMainAdmin,
          canDeleteUsers: authority.isMainAdmin,
          canDeleteMessagesOrLogs: authority.isMainAdmin,
          canManageSecuritySessions: authority.isMainAdmin,
          canManageSystemSettings: authority.isMainAdmin,
          canInspectScopedChats: authority.isMainAdmin || authority.isModerator,
          canInspectAllPrivateChats: authority.isMainAdmin,
        },
      });
    } catch (err: any) {
      console.error("❌ [Moderation Verify Role] Error:", err);
      return res.status(500).json({ error: err?.message || "Yetki doğrulanamadı." });
    }
  });

  // 2. ANA YÖNETİCİ ONLY: Muse hesabına Moderatör rolü ver / kaldır
  app.post("/api/admin/moderation/set-moderator-role", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin) {
        return res.status(403).json({
          error: "Bu yetkiyi yalnızca Ana Yönetici tanımlayabilir veya kaldırabilir.",
        });
      }

      const { targetUid, action, reason } = req.body || {};
      const resolvedUid = typeof targetUid === "string" && targetUid.trim() ? targetUid.trim() : MUSE_MODERATOR_UID;

      if (resolvedUid !== MUSE_MODERATOR_UID) {
        return res.status(400).json({
          error: `Yalnızca doğrulanmış Muse hesabına (${MUSE_MODERATOR_UID}) moderatör yetkisi atanabilir.`,
        });
      }
      if (action !== "grant" && action !== "revoke") {
        return res.status(400).json({ error: "Geçersiz işlem türü ('grant' veya 'revoke' olmalı)." });
      }

      const targetDoc = await dbGetDoc("users", resolvedUid, tokenUser.token);
      if (!targetDoc) {
        return res.status(404).json({ error: "Muse kullanıcı profili Firestore'da bulunamadı." });
      }
      const targetEmail = (targetDoc.email || "").trim().toLowerCase();
      if (targetEmail !== MUSE_MODERATOR_EMAIL) {
        return res.status(403).json({
          error: "Hedef hesabın e-postası doğrulanmış Muse hesabı ile eşleşmiyor.",
        });
      }

      const now = new Date();
      const isGrant = action === "grant";

      await dbSetDoc(
        "moderatorGrants",
        resolvedUid,
        {
          id: resolvedUid,
          uid: resolvedUid,
          email: MUSE_MODERATOR_EMAIL,
          role: "moderator",
          active: isGrant,
          grantedByUid: authority.uid,
          grantedByEmail: authority.email || null,
          ...(isGrant ? { grantedAt: now, revokedAt: null, revokedByUid: null } : { revokedAt: now, revokedByUid: authority.uid }),
          updatedAt: now,
        },
        tokenUser.token
      );

      await dbSetDoc(
        "users",
        resolvedUid,
        {
          role: isGrant ? "moderator" : "user",
          updatedAt: now,
        },
        tokenUser.token
      );

      if (getApps().length > 0) {
        try {
          await getAuth().setCustomUserClaims(resolvedUid, isGrant ? { role: "moderator" } : {});
        } catch (claimErr) {
          console.warn("[SetModeratorRole] setCustomUserClaims warning:", claimErr);
        }
      }

      await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: "admin",
          targetUid: resolvedUid,
          targetUsername: targetDoc.username || "muse",
          actionType: isGrant ? "moderator_role_granted" : "moderator_role_revoked",
          reason:
            (typeof reason === "string" && reason.trim()) ||
            (isGrant
              ? "Ana yönetici tarafından Muse hesabına sınırlı moderatör yetkisi verildi."
              : "Ana yönetici tarafından Muse hesabının moderatör yetkisi kaldırıldı."),
          startsAt: now,
          endsAt: null,
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        targetUid: resolvedUid,
        role: isGrant ? "moderator" : "user",
        active: isGrant,
      });
    } catch (err: any) {
      console.error("❌ [Set Moderator Role] Error:", err);
      return res.status(500).json({ error: err?.message || "Moderatör rolü güncellenemedi." });
    }
  });

  // 3. KULLANICIYI SUSTUR (Moderatör: Yalnızca geçici | Admin: Geçici veya süresiz)
  app.post("/api/moderation/mute", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Bu işlem için moderatör veya yönetici yetkisi gerekli." });
      }

      const { targetUid, reason, durationMinutes, muteType } = req.body || {};
      if (!targetUid || typeof targetUid !== "string") {
        return res.status(400).json({ error: "Hedef kullanıcı kimliği (targetUid) gerekli." });
      }
      if (targetUid === authority.uid) {
        return res.status(400).json({ error: "Kendi hesabınızı susturamazsınız." });
      }
      const cleanReason = typeof reason === "string" ? reason.trim() : "";
      if (cleanReason.length < 3) {
        return res.status(400).json({ error: "Geçerli bir işlem gerekçesi (en az 3 karakter) girin." });
      }

      const targetDoc = await dbGetDoc("users", targetUid, tokenUser.token);
      if (!targetDoc) {
        return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
      }
      if (isTargetMainAdmin(targetDoc, targetUid)) {
        return res.status(403).json({ error: "Ana yönetici veya sistem hesapları susturulamaz." });
      }
      if (authority.isModerator && targetDoc.role === "moderator") {
        return res.status(403).json({ error: "Başka bir moderatör hesabına işlem yapamazsınız." });
      }

      const requestedPermanent = muteType === "permanent" || durationMinutes === null || durationMinutes === 0;
      if (authority.isModerator && requestedPermanent) {
        return res.status(403).json({
          error: "Moderatörler yalnızca süreli (geçici) susturma uygulayabilir.",
        });
      }

      let parsedMinutes: number | null = null;
      if (!requestedPermanent) {
        parsedMinutes = Number(durationMinutes);
        if (!Number.isFinite(parsedMinutes) || parsedMinutes < 1 || parsedMinutes > MAX_TEMP_DURATION_MINUTES) {
          return res.status(400).json({
            error: `Susturma süresi 1 dakika ile ${MAX_TEMP_DURATION_MINUTES} dakika (30 gün) arasında olmalıdır.`,
          });
        }
        parsedMinutes = Math.round(parsedMinutes);
      }

      const startsAt = new Date();
      const endsAt = parsedMinutes ? new Date(startsAt.getTime() + parsedMinutes * 60_000) : null;
      const effectiveMuteType: "temporary" | "permanent" = endsAt ? "temporary" : "permanent";

      await dbSetDoc(
        "users",
        targetUid,
        {
          isMuted: true,
          muteType: effectiveMuteType,
          muteReason: cleanReason,
          mutedAt: startsAt,
          muteExpiresAt: endsAt,
          mutedByUid: authority.uid,
          updatedAt: startsAt,
        },
        tokenUser.token
      );

      const logId = await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: authority.isMainAdmin ? "admin" : "moderator",
          targetUid,
          targetUsername: targetDoc.username || null,
          actionType: "temp_mute",
          reason: cleanReason,
          startsAt,
          endsAt,
          durationMinutes: parsedMinutes,
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        logId,
        targetUid,
        muteType: effectiveMuteType,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null,
      });
    } catch (err: any) {
      console.error("❌ [Moderation Mute] Error:", err);
      return res.status(500).json({ error: err?.message || "Susturma işlemi başarısız." });
    }
  });

  // 4. SUSTURMAYI KALDIR
  app.post("/api/moderation/unmute", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Bu işlem için moderatör veya yönetici yetkisi gerekli." });
      }

      const { targetUid, reason } = req.body || {};
      if (!targetUid || typeof targetUid !== "string") {
        return res.status(400).json({ error: "targetUid gerekli." });
      }

      const targetDoc = await dbGetDoc("users", targetUid, tokenUser.token);
      if (!targetDoc) {
        return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
      }
      if (isTargetMainAdmin(targetDoc, targetUid)) {
        return res.status(403).json({ error: "Ana yönetici hesabına işlem yapılamaz." });
      }

      const now = new Date();
      const cleanReason =
        typeof reason === "string" && reason.trim().length >= 3
          ? reason.trim()
          : "Moderatör/Yönetici tarafından susturma kaldırıldı.";

      await dbSetDoc(
        "users",
        targetUid,
        {
          isMuted: false,
          muteType: null,
          muteReason: null,
          mutedAt: null,
          muteExpiresAt: null,
          mutedByUid: null,
          updatedAt: now,
        },
        tokenUser.token
      );

      const logId = await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: authority.isMainAdmin ? "admin" : "moderator",
          targetUid,
          targetUsername: targetDoc.username || null,
          actionType: "unmute",
          reason: cleanReason,
          startsAt: now,
          endsAt: null,
        },
        tokenUser.token
      );

      return res.json({ success: true, logId, targetUid });
    } catch (err: any) {
      console.error("❌ [Moderation Unmute] Error:", err);
      return res.status(500).json({ error: err?.message || "Susturma kaldırılamadı." });
    }
  });

  // 5. KULLANICIYI BANLA (Moderatör: YALNIZCA geçici | Admin: Geçici veya kalıcı)
  app.post("/api/moderation/ban", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Bu işlem için moderatör veya yönetici yetkisi gerekli." });
      }

      const { targetUid, reason, durationMinutes, banType } = req.body || {};
      if (!targetUid || typeof targetUid !== "string") {
        return res.status(400).json({ error: "Hedef kullanıcı kimliği (targetUid) gerekli." });
      }
      if (targetUid === authority.uid) {
        return res.status(400).json({ error: "Kendi hesabınızı banlayamazsınız." });
      }
      const cleanReason = typeof reason === "string" ? reason.trim() : "";
      if (cleanReason.length < 3) {
        return res.status(400).json({ error: "Geçerli bir ban gerekçesi (en az 3 karakter) girin." });
      }

      const targetDoc = await dbGetDoc("users", targetUid, tokenUser.token);
      if (!targetDoc) {
        return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
      }
      if (isTargetMainAdmin(targetDoc, targetUid)) {
        return res.status(403).json({ error: "Ana yönetici veya sistem hesapları banlanamaz." });
      }
      if (authority.isModerator && targetDoc.role === "moderator") {
        return res.status(403).json({ error: "Başka bir moderatör hesabına işlem yapamazsınız." });
      }

      const requestedPermanent = banType === "permanent" || durationMinutes === null || durationMinutes === 0;
      if (authority.isModerator && requestedPermanent) {
        return res.status(403).json({
          error: "Moderatörler kalıcı ban uygulayamaz. Yalnızca geçici ban yetkiniz vardır.",
        });
      }

      let parsedMinutes: number | null = null;
      if (!requestedPermanent) {
        parsedMinutes = Number(durationMinutes);
        if (!Number.isFinite(parsedMinutes) || parsedMinutes < 1 || parsedMinutes > MAX_TEMP_DURATION_MINUTES) {
          return res.status(400).json({
            error: `Geçici ban süresi 1 dakika ile ${MAX_TEMP_DURATION_MINUTES} dakika (30 gün) arasında olmalıdır.`,
          });
        }
        parsedMinutes = Math.round(parsedMinutes);
      }

      const startsAt = new Date();
      const endsAt = parsedMinutes ? new Date(startsAt.getTime() + parsedMinutes * 60_000) : null;
      const effectiveBanType: "temporary" | "permanent" = endsAt ? "temporary" : "permanent";

      await dbSetDoc(
        "users",
        targetUid,
        {
          isBanned: true,
          banType: effectiveBanType,
          banReason: cleanReason,
          bannedAt: startsAt,
          banExpiresAt: endsAt,
          bannedByUid: authority.uid,
          isOnline: false,
          updatedAt: startsAt,
        },
        tokenUser.token
      );

      const logId = await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: authority.isMainAdmin ? "admin" : "moderator",
          targetUid,
          targetUsername: targetDoc.username || null,
          actionType: effectiveBanType === "permanent" ? "perm_ban" : "temp_ban",
          reason: cleanReason,
          startsAt,
          endsAt,
          durationMinutes: parsedMinutes,
        },
        tokenUser.token
      );

      return res.json({
        success: true,
        logId,
        targetUid,
        banType: effectiveBanType,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null,
      });
    } catch (err: any) {
      console.error("❌ [Moderation Ban] Error:", err);
      return res.status(500).json({ error: err?.message || "Ban işlemi başarısız." });
    }
  });

  // 6. BANI KALDIR (Moderatör: YALNIZCA geçici banı kaldırabilir | Admin: Tümünü kaldırabilir)
  app.post("/api/moderation/unban", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Bu işlem için moderatör veya yönetici yetkisi gerekli." });
      }

      const { targetUid, reason } = req.body || {};
      if (!targetUid || typeof targetUid !== "string") {
        return res.status(400).json({ error: "targetUid gerekli." });
      }

      const targetDoc = await dbGetDoc("users", targetUid, tokenUser.token);
      if (!targetDoc) {
        return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
      }
      if (isTargetMainAdmin(targetDoc, targetUid)) {
        return res.status(403).json({ error: "Ana yönetici hesabına işlem yapılamaz." });
      }

      const targetIsPermanentBan =
        Boolean(targetDoc.isBanned) &&
        (targetDoc.banType !== "temporary" || !targetDoc.banExpiresAt);

      if (authority.isModerator && targetIsPermanentBan) {
        return res.status(403).json({
          error: "Kalıcı banı yalnızca Ana Yönetici kaldırabilir. Moderatör sadece geçici banları kaldırabilir.",
        });
      }

      const now = new Date();
      const cleanReason =
        typeof reason === "string" && reason.trim().length >= 3
          ? reason.trim()
          : "Geçici ban moderasyon tarafından kaldırıldı.";

      await dbSetDoc(
        "users",
        targetUid,
        {
          isBanned: false,
          banType: null,
          banReason: null,
          bannedAt: null,
          banExpiresAt: null,
          bannedByUid: null,
          updatedAt: now,
        },
        tokenUser.token
      );

      const logId = await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: authority.isMainAdmin ? "admin" : "moderator",
          targetUid,
          targetUsername: targetDoc.username || null,
          actionType: "unban",
          reason: cleanReason,
          startsAt: now,
          endsAt: null,
        },
        tokenUser.token
      );

      return res.json({ success: true, logId, targetUid });
    } catch (err: any) {
      console.error("❌ [Moderation Unban] Error:", err);
      return res.status(500).json({ error: err?.message || "Ban kaldırılamadı." });
    }
  });

  // 7. SÜRESİ DOLAN GEÇİCİ BAN & SUSTURMALARI OTOMATİK SONLANDIR
  app.post("/api/moderation/check-expiry", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const { targetUid } = req.body || {};
      let resolvedTargetUid = tokenUser.uid;

      if (targetUid && typeof targetUid === "string" && targetUid !== tokenUser.uid) {
        const authority = await resolveVerifiedAuthority(tokenUser);
        if (!authority.isMainAdmin && !authority.isModerator) {
          return res.status(403).json({ error: "Başka kullanıcının süre kontrolünü tetikleme yetkiniz yok." });
        }
        resolvedTargetUid = targetUid;
      }

      const result = await expireUserPenaltiesIfDue(resolvedTargetUid, tokenUser.token);
      return res.json({ success: true, targetUid: resolvedTargetUid, ...result });
    } catch (err: any) {
      console.error("❌ [Moderation Expiry Check] Error:", err);
      return res.status(500).json({ error: err?.message || "Süre kontrolü yapılamadı." });
    }
  });

  // 8. GİZLİLİK-SINIRLI KAPSAMLI SOHBET LİSTESİ (Moderatör yalnızca şikayet/güvenlik kapsamındakileri görür)
  app.get("/api/moderation/scoped-conversations", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }

      const conversations = await dbListCollection("conversations", tokenUser.token, 300);

      if (authority.isMainAdmin) {
        return res.json({
          scope: "all",
          conversations: conversations.map((c) => sanitizeConversationForModerator(c, "Tam Yönetici Erişimi")),
        });
      }

      const scopeMap = await computeModeratorAllowedConversationIds(tokenUser.token);
      const scopedList = conversations
        .filter((c) => scopeMap.has(c.id))
        .map((c) => sanitizeConversationForModerator(c, scopeMap.get(c.id)!));

      return res.json({
        scope: "moderation_only",
        conversations: scopedList,
      });
    } catch (err: any) {
      console.error("❌ [Scoped Conversations] Error:", err);
      return res.status(500).json({ error: err?.message || "Kapsamlı sohbet listesi alınamadı." });
    }
  });

  // 9. GİZLİLİK-SINIRLI MESAJ İNCELEME (Moderatör yalnızca kapsam içi sohbetin mesajlarını okuyabilir)
  app.get("/api/moderation/scoped-messages/:conversationId", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }

      const conversationId = String(req.params.conversationId || "").trim();
      if (!conversationId) {
        return res.status(400).json({ error: "conversationId gerekli." });
      }

      if (authority.isModerator) {
        const scopeMap = await computeModeratorAllowedConversationIds(tokenUser.token);
        if (!scopeMap.has(conversationId)) {
          return res.status(403).json({
            error: "Gizlilik sınırı: Bu özel sohbet aktif şikâyet veya güvenlik moderasyon kapsamınızda değil.",
          });
        }
      }

      const rawMessages = await dbListConversationMessages(
        conversationId,
        tokenUser.token,
        authority.isMainAdmin ? 500 : 120
      );

      const safeMessages = rawMessages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName || m.senderUsername || "Kullanıcı",
        senderUsername: m.senderUsername || "kullanici",
        text: m.text || "",
        imageUrl: m.imageUrl || null,
        videoUrl: m.videoUrl || null,
        isSystemMessage: Boolean(m.isSystemMessage),
        isSecurityWarning: Boolean(m.isSecurityWarning),
        createdAt: m.createdAt || null,
      }));

      return res.json({
        conversationId,
        scope: authority.isMainAdmin ? "full" : "moderation_scoped",
        messages: safeMessages,
      });
    } catch (err: any) {
      console.error("❌ [Scoped Messages] Error:", err);
      return res.status(500).json({ error: err?.message || "Kapsamlı mesajlar okunamadı." });
    }
  });

  // 10. MODERASYON İNCELEME & ŞÜPHELİ DAVRANIŞ RAPORU OLUŞTURMA + ŞİKÂYET GÜNCELLEME
  app.post("/api/moderation/reports", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;

      const secGate = await requireActiveSecuritySession(req, res, tokenUser as any, {
        requireSessionHeaders: true,
      });
      if (!secGate.ok) return;

      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }

      const {
        targetUid,
        conversationId,
        userReportId,
        title,
        summary,
        riskLevel,
        recommendedAction,
        messageCountReviewed,
        nextUserReportStatus,
      } = req.body || {};

      if (!targetUid || typeof targetUid !== "string") {
        return res.status(400).json({ error: "Hedef kullanıcı (targetUid) gerekli." });
      }
      const cleanTitle = typeof title === "string" ? title.trim() : "";
      const cleanSummary = typeof summary === "string" ? summary.trim() : "";
      if (cleanTitle.length < 3 || cleanSummary.length < 5) {
        return res.status(400).json({ error: "Rapor başlığı ve özeti doldurulmalıdır." });
      }

      const allowedRisks = ["low", "medium", "high", "critical"];
      const safeRisk = allowedRisks.includes(riskLevel) ? riskLevel : "medium";
      const targetDoc = await dbGetDoc("users", targetUid, tokenUser.token).catch(() => null);

      const now = new Date();
      const reportId = `modrep_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      const reportPayload = {
        id: reportId,
        authorUid: authority.uid,
        authorUsername: authority.username,
        authorRole: authority.isMainAdmin ? "admin" : "moderator",
        targetUid,
        targetUsername: targetDoc?.username || null,
        conversationId: conversationId || null,
        userReportId: userReportId || null,
        title: cleanTitle.slice(0, 140),
        summary: cleanSummary.slice(0, 3000),
        riskLevel: safeRisk,
        recommendedAction: typeof recommendedAction === "string" ? recommendedAction.trim().slice(0, 400) : null,
        messageCountReviewed: Number.isFinite(Number(messageCountReviewed))
          ? Number(messageCountReviewed)
          : null,
        createdAt: now,
      };

      await dbSetDoc("moderationReports", reportId, reportPayload, tokenUser.token);

      if (userReportId && typeof userReportId === "string") {
        const validStatuses = ["pending", "reviewing", "resolved", "dismissed"];
        const nextStatus = validStatuses.includes(nextUserReportStatus)
          ? nextUserReportStatus
          : "resolved";

        await dbSetDoc(
          "userReports",
          userReportId,
          {
            status: nextStatus,
            reviewedByUid: authority.uid,
            resolutionNote: cleanSummary.slice(0, 500),
            updatedAt: now,
          },
          tokenUser.token
        ).catch((err) => console.warn("[ModerationReport] userReport update warn:", err));
      }

      await writeModerationLog(
        {
          actorUid: authority.uid,
          actorEmail: authority.email,
          actorUsername: authority.username,
          actorRole: authority.isMainAdmin ? "admin" : "moderator",
          targetUid,
          targetUsername: targetDoc?.username || null,
          actionType: "report_reviewed",
          reason: `[${safeRisk.toUpperCase()}] ${cleanTitle}`,
          startsAt: now,
          endsAt: null,
          reportId,
        },
        tokenUser.token
      );

      return res.json({ success: true, report: reportPayload });
    } catch (err: any) {
      console.error("❌ [Moderation Reports] Error:", err);
      return res.status(500).json({ error: err?.message || "Moderasyon raporu kaydedilemedi." });
    }
  });
}

// Sunucu arka planında süresi dolan geçici ban ve susturmaları temizle (Admin SDK aktifse)
export function startModerationExpirySweep() {
  if (getApps().length === 0) return;

  const runSweep = async () => {
    try {
      const db = getFirestore();
      const now = new Date();

      const [bannedSnap, mutedSnap] = await Promise.all([
        db
          .collection("users")
          .where("isBanned", "==", true)
          .where("banType", "==", "temporary")
          .limit(50)
          .get(),
        db
          .collection("users")
          .where("isMuted", "==", true)
          .where("muteType", "==", "temporary")
          .limit(50)
          .get(),
      ]);

      const candidateUids = new Set<string>();
      bannedSnap.docs.forEach((d) => {
        const expMs = toTimestampMs(d.data()?.banExpiresAt);
        if (expMs !== null && expMs <= now.getTime()) {
          candidateUids.add(d.id);
        }
      });
      mutedSnap.docs.forEach((d) => {
        const expMs = toTimestampMs(d.data()?.muteExpiresAt);
        if (expMs !== null && expMs <= now.getTime()) {
          candidateUids.add(d.id);
        }
      });

      for (const uid of candidateUids) {
        await expireUserPenaltiesIfDue(uid);
      }
    } catch (err) {
      console.warn("[Moderation Sweep] warning:", err);
    }
  };

  setTimeout(runSweep, 5000);
  setInterval(runSweep, 60_000);
}
