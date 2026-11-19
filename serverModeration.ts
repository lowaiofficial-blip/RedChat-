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
  pageSize = 300,
  maxDocs = 50000
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const results: Record<string, any>[] = [];
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    while (results.length < maxDocs) {
      const take = Math.min(pageSize, maxDocs - results.length);
      if (take <= 0) break;
      let q: FirebaseFirestore.Query = getFirestore()
        .collection(colPath)
        .limit(take);
      if (lastDoc) {
        q = q.startAfter(lastDoc);
      }
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        results.push({ id: d.id, ...d.data() });
      }
      if (snap.docs.length < take) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return results;
  }

  const results: Record<string, any>[] = [];
  let pageToken: string | undefined = undefined;
  const seenPageTokens = new Set<string>();

  while (results.length < maxDocs) {
    const remaining = Math.min(pageSize, maxDocs - results.length);
    if (remaining <= 0) break;
    const qs = new URLSearchParams({ pageSize: String(remaining) });
    if (pageToken) qs.set("pageToken", pageToken);

    const resp = await fetch(`${FIRESTORE_BASE}/${colPath}?${qs.toString()}`, {
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Firestore REST list failed (${resp.status}): ${errText}`);
    }
    const json: any = await resp.json();
    const docs = Array.isArray(json.documents) ? json.documents : [];
    for (const raw of docs) {
      const parsed = fromRestDoc(raw);
      if (parsed) results.push(parsed);
    }
    if (!json.nextPageToken || docs.length === 0) break;
    const nextTk = String(json.nextPageToken);
    if (seenPageTokens.has(nextTk) || nextTk === pageToken) break;
    seenPageTokens.add(nextTk);
    pageToken = nextTk;
  }
  return results;
}

async function dbListConversationMessages(
  conversationId: string,
  idToken?: string,
  maxMessages = 10000
): Promise<Record<string, any>[]> {
  if (getApps().length > 0) {
    const snap = await getFirestore()
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .orderBy("createdAt", "asc")
      .limit(maxMessages)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const rawDocs = await dbListCollection(
    `conversations/${encodeURIComponent(conversationId)}/messages`,
    idToken,
    300,
    maxMessages
  );

  return rawDocs.sort((a, b) => {
    const aMs = toTimestampMs(a.createdAt) ?? 0;
    const bMs = toTimestampMs(b.createdAt) ?? 0;
    if (aMs !== bMs) return aMs - bMs;
    return compareDocIds(String(a.id || ""), String(b.id || ""));
  });
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
      | "perm_mute"
      | "unmute"
      | "temp_ban"
      | "unban"
      | "perm_ban"
      | "auto_mute_expired"
      | "auto_ban_expired"
      | "moderator_role_granted"
      | "moderator_role_revoked"
      | "report_reviewed"
      | "email_in_review"
      | "email_review_released"
      | "verification_rejected"
      | "verification_approved"
      | "user_verified"
      | "user_unverified"
      | "abusive_chat_flagged"
      | "channel_disabled"
      | "channel_enabled"
      | "channel_deleted"
      | "post_deleted";
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

async function recordModerationAccessLog(
  authority: VerifiedAuthority,
  entry: {
    action: "view_conversation_messages" | "view_channel_posts";
    targetType: "conversation" | "channel";
    targetId: string;
    targetName?: string | null;
  },
  idToken?: string
): Promise<void> {
  const logId = `acc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date();
  await dbSetDoc(
    "moderationAccessLogs",
    logId,
    {
      id: logId,
      moderatorUid: authority.uid,
      moderatorEmail: authority.email || null,
      moderatorUsername: authority.username || null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName || null,
      readOnly: true,
      accessedAt: now,
    },
    idToken
  ).catch((err) => {
    console.warn("[ModerationAccessLog] Access audit log write error:", err?.message || err);
  });
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

const IGNORED_SCOPE_UIDS = new Set(["system_redchat_ai"]);

function compareDocIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ModeratorScopeEntry {
  reason: string;
  signalMs: number;
}

function getConversationSortTimestampMs(conv: Record<string, any>, signalMs: number = 0): number {
  const lastMsgMs = toTimestampMs(conv.lastMessageTimestamp) ?? 0;
  const updatedMs = toTimestampMs(conv.updatedAt) ?? 0;
  const createdMs = toTimestampMs(conv.createdAt) ?? 0;
  return Math.max(lastMsgMs, updatedMs, createdMs, signalMs);
}

async function computeModeratorConversationScope(
  idToken?: string,
  preloadedConversations?: Record<string, any>[]
): Promise<{
  scopeEntries: Map<string, ModeratorScopeEntry>;
  conversations: Record<string, any>[];
}> {
  const scopeEntries = new Map<string, ModeratorScopeEntry>();

  const setScope = (cid: string, reason: string, signalMs: number, overwrite: boolean = false) => {
    if (!cid) return;
    const prev = scopeEntries.get(cid);
    if (!prev) {
      scopeEntries.set(cid, { reason, signalMs });
    } else {
      scopeEntries.set(cid, {
        reason: overwrite ? reason : prev.reason,
        signalMs: Math.max(prev.signalMs, signalMs),
      });
    }
  };

  const safeList = (col: string) =>
    dbListCollection(col, idToken, 300, 10000).catch((err) => {
      console.warn(`[ModerationScope] ${col} list warning:`, err?.message || err);
      return [] as Record<string, any>[];
    });

  const [userReports, moderationReports, usersList, bannedDevicesList, conversations] =
    await Promise.all([
      safeList("userReports"),
      safeList("moderationReports"),
      safeList("users"),
      safeList("banned_devices"),
      preloadedConversations ? Promise.resolve(preloadedConversations) : safeList("conversations"),
    ]);

  const reportedUids = new Map<string, number>();
  for (const r of userReports) {
    if (r.status === "dismissed") continue;
    const sigMs = toTimestampMs(r.updatedAt || r.createdAt) ?? 0;
    if (r.conversationId) {
      setScope(
        String(r.conversationId),
        `Şikâyet Kapsamı (#${String(r.id || "").slice(-6)})`,
        sigMs,
        true
      );
    }
    const repUid = String(r.reportedUid || "").trim();
    if (repUid && !IGNORED_SCOPE_UIDS.has(repUid)) {
      reportedUids.set(repUid, Math.max(reportedUids.get(repUid) ?? 0, sigMs));
    }
  }

  const modReportedUids = new Map<string, number>();
  for (const mr of moderationReports) {
    const sigMs = toTimestampMs(mr.createdAt) ?? 0;
    if (mr.conversationId) {
      setScope(
        String(mr.conversationId),
        `Moderasyon Raporu (#${String(mr.id || "").slice(-6)})`,
        sigMs
      );
    }
    const targetUid = String(mr.targetUid || "").trim();
    if (targetUid && !IGNORED_SCOPE_UIDS.has(targetUid)) {
      modReportedUids.set(targetUid, Math.max(modReportedUids.get(targetUid) ?? 0, sigMs));
    }
  }

  const moderatedUserSignals = new Map<string, number>();
  const aiBlockedUserSignals = new Map<string, number>();
  const protectedStaffUids = new Set<string>();

  for (const u of usersList) {
    const uid = String(u.id || u.uid || "").trim();
    if (!uid || IGNORED_SCOPE_UIDS.has(uid)) continue;
    const emailLower = String(u.email || "").trim().toLowerCase();
    if (
      u.role === "admin" ||
      u.role === "moderator" ||
      MAIN_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(emailLower)
    ) {
      protectedStaffUids.add(uid);
      continue;
    }
    if (
      u.isBanned === true ||
      u.isMuted === true ||
      u.isEmailInReview === true ||
      u.securityStatus === "terminated"
    ) {
      const sigMs =
        toTimestampMs(u.bannedAt || u.mutedAt || u.emailInReviewAt || u.terminatedAt || u.updatedAt) ??
        0;
      moderatedUserSignals.set(uid, Math.max(moderatedUserSignals.get(uid) ?? 0, sigMs));
    } else if (u.aiAccess === "blocked") {
      const sigMs = toTimestampMs(u.aiAccessUpdatedAt || u.updatedAt) ?? 0;
      aiBlockedUserSignals.set(uid, Math.max(aiBlockedUserSignals.get(uid) ?? 0, sigMs));
    }
  }

  for (const b of bannedDevicesList) {
    if (b.isActive === false) continue;
    const targetUid = String(b.targetUid || "").trim();
    if (!targetUid || IGNORED_SCOPE_UIDS.has(targetUid) || protectedStaffUids.has(targetUid)) {
      continue;
    }
    const sigMs = toTimestampMs(b.bannedAt || b.createdAt) ?? 0;
    moderatedUserSignals.set(targetUid, Math.max(moderatedUserSignals.get(targetUid) ?? 0, sigMs));
  }

  for (const c of conversations) {
    const cid = String(c.id || "").trim();
    if (!cid) continue;

    if (
      c.securityStatus === "terminated" ||
      (Number(c.abusiveCount) || 0) > 0 ||
      Boolean(c.terminatedReason)
    ) {
      const flagMs = toTimestampMs(c.terminatedAt || c.updatedAt || c.lastMessageTimestamp) ?? 0;
      setScope(cid, "Güvenlik İhlali / Kötüye Kullanım Bayrağı", flagMs);
    }

    const participantUnion = new Set<string>();
    if (Array.isArray(c.participantIds)) {
      for (const pid of c.participantIds) {
        if (typeof pid === "string" && pid.trim()) participantUnion.add(pid.trim());
      }
    }
    if (c.participants && typeof c.participants === "object") {
      for (const pid of Object.keys(c.participants)) {
        if (pid.trim()) participantUnion.add(pid.trim());
      }
    }

    const hasAiParticipant = participantUnion.has("system_redchat_ai");
    for (const uid of participantUnion) {
      if (!uid || IGNORED_SCOPE_UIDS.has(uid)) continue;
      if (reportedUids.has(uid)) {
        setScope(cid, "Şikâyet Edilen Kullanıcı Kapsamı", reportedUids.get(uid) ?? 0);
      } else if (modReportedUids.has(uid)) {
        setScope(cid, "Moderasyon Raporlu Kullanıcı Kapsamı", modReportedUids.get(uid) ?? 0);
      } else if (moderatedUserSignals.has(uid)) {
        setScope(cid, "Cezalı / İncelemedeki Kullanıcı Kapsamı", moderatedUserSignals.get(uid) ?? 0);
      } else if (hasAiParticipant && aiBlockedUserSignals.has(uid)) {
        setScope(cid, "AI Erişimi Kısıtlı Kullanıcı Kapsamı", aiBlockedUserSignals.get(uid) ?? 0);
      }
    }
  }

  return { scopeEntries, conversations };
}

async function computeModeratorAllowedConversationIds(
  idToken?: string
): Promise<Map<string, string>> {
  const { scopeEntries } = await computeModeratorConversationScope(idToken);
  const reasons = new Map<string, string>();
  scopeEntries.forEach((entry, cid) => {
    reasons.set(cid, entry.reason);
  });
  return reasons;
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
    photoURL: conv.photoURL || null,
    participantIds: Array.isArray(conv.participantIds) ? conv.participantIds : [],
    participants: sanitizedParticipants,
    lastMessageText: conv.lastMessageText || "",
    lastMessageHasImage: Boolean(conv.lastMessageHasImage),
    lastMessageHasVideo: Boolean(conv.lastMessageHasVideo),
    lastMessageTimestamp: conv.lastMessageTimestamp || null,
    securityStatus: conv.securityStatus || "active",
    abusiveCount: conv.abusiveCount || 0,
    updatedAt: conv.updatedAt || null,
    createdAt: conv.createdAt || null,
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
      if (authority.isMainAdmin || authority.isModerator) {
        void ensureHistoricalModerationSynced(tokenUser.token, authority.isMainAdmin).catch(() => {});
      }
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
          canTempMute: authority.isMainAdmin,
          canTempBan: authority.isMainAdmin,
          canPermBan: authority.isMainAdmin,
          canManageRoles: authority.isMainAdmin,
          canDeleteUsers: authority.isMainAdmin,
          canDeleteMessagesOrLogs: authority.isMainAdmin,
          canManageSecuritySessions: authority.isMainAdmin,
          canManageSystemSettings: authority.isMainAdmin,
          canInspectScopedChats: authority.isMainAdmin || authority.isModerator,
          canInspectAllPrivateChats: authority.isMainAdmin || authority.isModerator,
          canInspectChannels: authority.isMainAdmin || authority.isModerator,
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
      if (!authority.isMainAdmin) {
        return res.status(403).json({
          error: "Bu işlem yalnızca Ana Yönetici yetkisindedir. Muse moderatör hesabı salt okunur inceleme yetkisine sahiptir.",
        });
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
      if (!authority.isMainAdmin) {
        return res.status(403).json({
          error: "Bu işlem yalnızca Ana Yönetici yetkisindedir. Muse moderatör hesabı salt okunur inceleme yetkisine sahiptir.",
        });
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
      if (!authority.isMainAdmin) {
        return res.status(403).json({
          error: "Bu işlem yalnızca Ana Yönetici yetkisindedir. Muse moderatör hesabı salt okunur inceleme yetkisine sahiptir.",
        });
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
      if (!authority.isMainAdmin) {
        return res.status(403).json({
          error: "Bu işlem yalnızca Ana Yönetici yetkisindedir. Muse moderatör hesabı salt okunur inceleme yetkisine sahiptir.",
        });
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

      const parsedLimit = Number(req.query.limit);
      const pageLimit =
        Number.isFinite(parsedLimit) && parsedLimit >= 1
          ? Math.min(Math.floor(parsedLimit), 100)
          : 30;

      const rawCursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
      let cursorSortMs: number | null = null;
      let cursorId: string | null = null;
      if (rawCursor.includes("::")) {
        const sepIdx = rawCursor.indexOf("::");
        const msPart = Number(rawCursor.slice(0, sepIdx));
        const idPart = rawCursor.slice(sepIdx + 2).trim();
        if (Number.isFinite(msPart) && idPart) {
          cursorSortMs = msPart;
          cursorId = idPart;
        }
      }

      const paginateScoped = (
        entries: Array<{ conv: Record<string, any>; reason: string; sortMs: number }>
      ) => {
        const dedupedMap = new Map<string, { conv: Record<string, any>; reason: string; sortMs: number }>();
        for (const item of entries) {
          const cid = String(item.conv?.id || "").trim();
          if (!cid) continue;
          const prev = dedupedMap.get(cid);
          if (!prev || item.sortMs > prev.sortMs) {
            dedupedMap.set(cid, item);
          }
        }

        const ordered = Array.from(dedupedMap.values()).sort((a, b) => {
          if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs;
          return compareDocIds(String(a.conv.id), String(b.conv.id));
        });

        const afterCursor =
          cursorSortMs !== null && cursorId !== null
            ? ordered.filter(
                (item) =>
                  item.sortMs < cursorSortMs! ||
                  (item.sortMs === cursorSortMs! &&
                    compareDocIds(String(item.conv.id), cursorId!) > 0)
              )
            : ordered;

        const pageSlice = afterCursor.slice(0, pageLimit);
        const hasMore = afterCursor.length > pageSlice.length;
        const lastItem = pageSlice.length > 0 ? pageSlice[pageSlice.length - 1] : null;
        const nextCursor =
          hasMore && lastItem ? `${lastItem.sortMs}::${String(lastItem.conv.id)}` : null;

        return {
          totalCount: ordered.length,
          hasMore,
          nextCursor,
          conversations: pageSlice.map((item) =>
            sanitizeConversationForModerator(item.conv, item.reason)
          ),
        };
      };

      const conversations = await dbListCollection("conversations", tokenUser.token, 300, 50000);
      const mapped = conversations.map((c) => {
        let reason = "Birebir DM Sohbeti";
        if (
          c.securityStatus === "terminated" ||
          (Number(c.abusiveCount) || 0) > 0 ||
          Boolean(c.terminatedReason)
        ) {
          reason = "Güvenlik İhlali / Kötüye Kullanım Bayrağı";
        } else {
          const participantUnion = new Set<string>();
          if (Array.isArray(c.participantIds)) {
            for (const pid of c.participantIds) {
              if (typeof pid === "string" && pid.trim()) participantUnion.add(pid.trim());
            }
          }
          if (c.participants && typeof c.participants === "object") {
            for (const pid of Object.keys(c.participants)) {
              if (pid.trim()) participantUnion.add(pid.trim());
            }
          }
          if (participantUnion.has("system_redchat_ai")) {
            reason = "DeepRed AI Sohbeti";
          } else if (Boolean(c.isGroup)) {
            reason = `Özel Grup Sohbeti (${c.name || "Grup"})`;
          }
        }
        return {
          conv: c,
          reason: authority.isMainAdmin ? "Tam Yönetici Erişimi" : reason,
          sortMs: getConversationSortTimestampMs(c, 0),
        };
      });

      const page = paginateScoped(mapped);
      return res.json({
        scope: authority.isMainAdmin ? "all" : "full_moderator_inspection",
        ...page,
      });
    } catch (err: any) {
      console.error("❌ [Scoped Conversations] Error:", err);
      return res.status(500).json({ error: err?.message || "Kapsamlı sohbet listesi alınamadı." });
    }
  });

  // 9. MESAJ İNCELEME (Moderatör & Admin tüm mesajları okuyabilir; moderatör erişimi denetim günlüğüne kaydedilir)
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

      // Denetlenebilir erişim kaydı (canlı yenilemelerde çift kayıt yazılmaması için refresh !== 1 kontrol edilir)
      if (authority.isModerator && req.query.refresh !== "1") {
        const convDoc = await dbGetDoc("conversations", conversationId, tokenUser.token).catch(() => null);
        const convTitle = convDoc?.isGroup ? convDoc?.name || "Grup Sohbeti" : convDoc?.id || conversationId;
        await recordModerationAccessLog(
          authority,
          {
            action: "view_conversation_messages",
            targetType: "conversation",
            targetId: conversationId,
            targetName: convTitle,
          },
          tokenUser.token
        );
      }

      const rawMessages = await dbListConversationMessages(
        conversationId,
        tokenUser.token,
        10000
      );

      const safeMessages = rawMessages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName || m.senderUsername || "Kullanıcı",
        senderUsername: m.senderUsername || "kullanici",
        text: m.text || "",
        imageUrl: m.imageUrl || null,
        videoUrl: m.videoUrl || null,
        videoDuration: m.videoDuration ?? null,
        replyTo: m.replyTo || null,
        reactions: m.reactions || null,
        isEdited: Boolean(m.isEdited),
        isSystemMessage: Boolean(m.isSystemMessage),
        isSecurityWarning: Boolean(m.isSecurityWarning),
        systemType: m.systemType || null,
        createdAt: m.createdAt || null,
      }));

      return res.json({
        conversationId,
        scope: "full",
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

  // 11. KANALLAR LİSTESİ (Moderatör & Admin salt okunur / yönetim amaçlı)
  app.get("/api/moderation/channels", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;
      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }
      const channels = await dbListCollection("channels", tokenUser.token, 300, 2000);
      const safeChannels = channels.map((c) => ({
        id: c.id,
        name: c.name || "Kanal",
        description: c.description || "",
        photoURL: c.photoURL || null,
        bannerUrl: c.bannerUrl || null,
        isVerified: Boolean(c.isVerified),
        disabled: Boolean(c.disabled),
        followerCount: Number(c.followerCount) || 0,
        postCount: Number(c.postCount) || 0,
        createdAt: c.createdAt || null,
        updatedAt: c.updatedAt || null,
      }));
      return res.json({ channels: safeChannels });
    } catch (err: any) {
      console.error("❌ [Moderation Channels] Error:", err);
      return res.status(500).json({ error: err?.message || "Kanallar listelenemedi." });
    }
  });

  // 12. KANAL GÖNDERİLERİ İNCELEME (Moderatör için erişim kaydı tutulur)
  app.get("/api/moderation/channel-posts/:channelId", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;
      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin && !authority.isModerator) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }
      const channelId = String(req.params.channelId || "").trim();
      if (!channelId) {
        return res.status(400).json({ error: "channelId gerekli." });
      }
      const channelDoc = await dbGetDoc("channels", channelId, tokenUser.token).catch(() => null);
      if (authority.isModerator && req.query.refresh !== "1") {
        await recordModerationAccessLog(
          authority,
          {
            action: "view_channel_posts",
            targetType: "channel",
            targetId: channelId,
            targetName: channelDoc?.name || channelId,
          },
          tokenUser.token
        );
      }
      const rawPosts = await dbListCollection(
        `channels/${encodeURIComponent(channelId)}/posts`,
        tokenUser.token,
        300,
        2000
      );
      const sorted = rawPosts.sort((a, b) => {
        const aMs = toTimestampMs(a.createdAt) ?? 0;
        const bMs = toTimestampMs(b.createdAt) ?? 0;
        return aMs - bMs;
      });
      const safePosts = sorted.map((p) => ({
        id: p.id,
        channelId: p.channelId || channelId,
        text: p.text || "",
        imageUrl: p.imageUrl || null,
        videoUrl: p.videoUrl || null,
        videoDuration: p.videoDuration ?? null,
        createdAt: p.createdAt || null,
        reactions: p.reactions || null,
        viewCount: p.viewCount || 0,
      }));
      return res.json({ channelId, posts: safePosts });
    } catch (err: any) {
      console.error("❌ [Moderation Channel Posts] Error:", err);
      return res.status(500).json({ error: err?.message || "Kanal gönderileri okunamadı." });
    }
  });

  // 13. MODERASYON ERİŞİM GÜNLÜĞÜ (Yalnızca Ana Yönetici denetimi için)
  app.get("/api/admin/moderation/access-logs", async (req: Request, res: Response) => {
    try {
      const tokenUser = await authenticateRequest(req, res);
      if (!tokenUser) return;
      const authority = await resolveVerifiedAuthority(tokenUser);
      if (!authority.isMainAdmin) {
        return res.status(403).json({ error: "Bu kayıtları yalnızca Ana Yönetici inceleyebilir." });
      }
      const logs = await dbListCollection("moderationAccessLogs", tokenUser.token, 100, 2000);
      const sorted = logs.sort((a, b) => {
        const aMs = toTimestampMs(a.accessedAt) ?? 0;
        const bMs = toTimestampMs(b.accessedAt) ?? 0;
        return bMs - aMs;
      });
      return res.json({ logs: sorted });
    } catch (err: any) {
      console.error("❌ [Moderation Access Logs] Error:", err);
      return res.status(500).json({ error: err?.message || "Erişim kayıtları alınamadı." });
    }
  });
}

function sanitizePublicModerationReason(raw: any, fallback: string): string {
  const str = typeof raw === "string" ? raw.trim() : "";
  if (!str) return fallback;
  // IPv4, IPv6 ve HWID sızıntı kalıplarını temizle
  const cleaned = str
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[gizli-ağ]")
    .replace(/\bHWID[:\s-]*[A-Za-z0-9_-]{4,}\b/gi, "[gizli-cihaz]")
    .trim();
  return cleaned || fallback;
}

function toDateValue(val: any, fallback: Date = new Date()): Date {
  const ms = toTimestampMs(val);
  return ms !== null ? new Date(ms) : fallback;
}

let inFlightHistoricalSync: Promise<boolean> | null = null;
let lastHistoricalSyncAtMs = 0;
const HISTORICAL_SYNC_TTL_MS = 3 * 60_000;

export async function ensureHistoricalModerationSynced(
  idToken?: string,
  isMainAdmin: boolean = false
): Promise<boolean> {
  if (getApps().length === 0 && (!isMainAdmin || !idToken)) {
    return false;
  }
  const nowMs = Date.now();
  if (nowMs - lastHistoricalSyncAtMs < HISTORICAL_SYNC_TTL_MS) {
    return true;
  }
  if (inFlightHistoricalSync) {
    return inFlightHistoricalSync;
  }
  inFlightHistoricalSync = syncHistoricalModerationRecords(idToken, isMainAdmin)
    .then((ok) => {
      if (ok) lastHistoricalSyncAtMs = Date.now();
      return ok;
    })
    .finally(() => {
      inFlightHistoricalSync = null;
    });
  return inFlightHistoricalSync;
}

// Geçmiş ve harici ban/susturma/doğrulama/kanal/şikayet/yetki moderasyon işlemlerini moderationLogs koleksiyonuna senkronize et
export async function syncHistoricalModerationRecords(
  idToken?: string,
  isMainAdmin: boolean = false
): Promise<boolean> {
  const hasAdminSdk = getApps().length > 0;
  if (!hasAdminSdk && (!isMainAdmin || !idToken)) {
    return false;
  }

  const effectiveToken = hasAdminSdk ? undefined : idToken;

  try {
    const existingLogs = await dbListCollection("moderationLogs", effectiveToken, 300, 5000).catch(
      () => []
    );
    const existingDocIds = new Set<string>();
    const existingActionKeys = new Set<string>();
    const existingReportIds = new Set<string>();
    const existingMirrorIndex = new Map<string, number[]>();

    for (const data of existingLogs) {
      if (data.id) existingDocIds.add(String(data.id));
      if (data.targetUid && data.actionType) {
        existingActionKeys.add(`${data.targetUid}__${data.actionType}`);
      }
      if (data.reportId) {
        existingReportIds.add(String(data.reportId));
      }
      if (data.id && !String(data.id).startsWith("modlog_sync_")) {
        const mirrorKey = `${data.targetUid || ""}__${data.actionType || ""}`;
        const ms = toTimestampMs(data.createdAt);
        if (ms !== null) {
          const list = existingMirrorIndex.get(mirrorKey) || [];
          list.push(ms);
          existingMirrorIndex.set(mirrorKey, list);
        }
      }
    }

    const pendingWrites: Array<{ docId: string; payload: Record<string, any> }> = [];

    const queueLog = (docId: string, payload: Record<string, any>) => {
      if (existingDocIds.has(docId)) return;
      existingDocIds.add(docId);
      if (payload.targetUid && payload.actionType) {
        existingActionKeys.add(`${payload.targetUid}__${payload.actionType}`);
      }
      if (payload.reportId) {
        existingReportIds.add(String(payload.reportId));
      }
      pendingWrites.push({ docId, payload });
    };

    const [
      usersList,
      convsList,
      verifsList,
      grantsList,
      channelsList,
      userReportsList,
      modReportsList,
      bannedDevicesList,
      adminLogsList,
    ] = await Promise.all([
      dbListCollection("users", effectiveToken, 300, 3000).catch(() => []),
      dbListCollection("conversations", effectiveToken, 300, 3000).catch(() => []),
      dbListCollection("verificationRequests", effectiveToken, 300, 2000).catch(() => []),
      dbListCollection("moderatorGrants", effectiveToken, 100, 500).catch(() => []),
      dbListCollection("channels", effectiveToken, 300, 2000).catch(() => []),
      dbListCollection("userReports", effectiveToken, 300, 3000).catch(() => []),
      dbListCollection("moderationReports", effectiveToken, 300, 3000).catch(() => []),
      dbListCollection("banned_devices", effectiveToken, 300, 2000).catch(() => []),
      dbListCollection("adminLogs", effectiveToken, 300, 5000).catch(() => []),
    ]);

    // 1. users koleksiyonu: aktif banlı, susturulmuş ve e-posta incelemesindeki kullanıcılar
    for (const u of usersList) {
      const uid = String(u.id || u.uid || "");
      if (!uid) continue;

      if (u.isBanned) {
        const actionType = u.banType === "temporary" ? "temp_ban" : "perm_ban";
        const docId = `modlog_legacy_ban_${uid}`;
        const key = `${uid}__${actionType}`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(key)) {
          const bannedTime = toDateValue(u.bannedAt || u.updatedAt || u.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: u.bannedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: uid,
            targetUsername: u.username || uid,
            actionType,
            reason: sanitizePublicModerationReason(u.banReason, "Admin tarafından askıya alındı"),
            startsAt: bannedTime,
            endsAt: u.banExpiresAt ? toDateValue(u.banExpiresAt) : null,
            durationMinutes: null,
            reportId: null,
            createdAt: bannedTime,
          });
        }
      }

      if (u.isMuted) {
        const actionType = u.muteType === "temporary" ? "temp_mute" : "perm_mute";
        const docId = `modlog_legacy_mute_${uid}`;
        const key = `${uid}__${actionType}`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(key)) {
          const mutedTime = toDateValue(u.mutedAt || u.updatedAt || u.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: u.mutedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: uid,
            targetUsername: u.username || uid,
            actionType,
            reason: sanitizePublicModerationReason(u.muteReason, "Admin tarafından susturuldu"),
            startsAt: mutedTime,
            endsAt: u.muteExpiresAt ? toDateValue(u.muteExpiresAt) : null,
            durationMinutes: null,
            reportId: null,
            createdAt: mutedTime,
          });
        }
      }

      if (u.isEmailInReview) {
        const docId = `modlog_legacy_email_review_${uid}`;
        const key = `${uid}__email_in_review`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(key)) {
          const reviewTime = toDateValue(u.emailInReviewAt || u.updatedAt || u.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: u.emailInReviewBy || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: uid,
            targetUsername: u.username || uid,
            actionType: "email_in_review",
            reason: "Şüpheli alan adı / tek kullanımlık e-posta incelemesi",
            startsAt: reviewTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: reviewTime,
          });
        }
      }
    }

    // 2. Kötüye kullanım / güvenlik bayrağı bulunan sohbetler
    for (const c of convsList) {
      const cid = String(c.id || "");
      if (!cid) continue;
      if (c.securityStatus === "terminated" || (Number(c.abusiveCount) || 0) > 0) {
        const docId = `modlog_legacy_abuse_${cid}`;
        const pIds: string[] = Array.isArray(c.participantIds) ? c.participantIds : [];
        const targetUid = pIds.find((uid) => uid !== "system_redchat_ai") || cid;
        const key = `${targetUid}__abusive_chat_flagged`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(key)) {
          const flagTime = toDateValue(c.updatedAt || c.lastMessageTimestamp || c.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: "system_redchat_ai",
            actorEmail: null,
            actorUsername: "DeepRed AI Moderatör",
            actorRole: "system",
            targetUid,
            targetUsername: targetUid.slice(0, 12),
            actionType: "abusive_chat_flagged",
            reason: `Sohbette otomatik güvenlik ihlali ve kötüye kullanım tespiti (${c.abusiveCount || 1} ihlal)`,
            startsAt: flagTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: flagTime,
          });
        }
      }
    }

    // 3. Onaylanan ve reddedilen doğrulama (Mavi Tik) başvuruları
    for (const v of verifsList) {
      const vid = String(v.id || "");
      if (!vid) continue;
      if (v.status === "rejected" || v.status === "approved") {
        const actionType =
          v.status === "approved" ? "verification_approved" : "verification_rejected";
        const docId = `modlog_legacy_verif_${v.status === "approved" ? "app" : "rej"}_${vid}`;
        const targetUid = String(v.userId || v.channelId || vid);
        if (!existingDocIds.has(docId)) {
          const reqTime = toDateValue(v.reviewedAt || v.updatedAt || v.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: v.reviewedBy || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid,
            targetUsername: v.username || v.channelName || targetUid.slice(0, 12),
            actionType,
            reason: sanitizePublicModerationReason(
              v.rejectionReason,
              v.status === "approved"
                ? `${v.type === "channel" ? "Kanal" : "Kullanıcı"} mavi tik doğrulama başvurusu onaylandı`
                : `${v.type === "channel" ? "Kanal" : "Kullanıcı"} doğrulama kriterleri karşılanmadı`
            ),
            startsAt: reqTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: reqTime,
          });
        }
      }
    }

    // 4. Moderatör yetki verme ve kaldırma geçmişi (moderatorGrants)
    for (const g of grantsList) {
      const gid = String(g.id || g.uid || "");
      if (!gid) continue;
      if (g.grantedAt) {
        const docId = `modlog_legacy_grant_${gid}`;
        const grantKey = `${gid}__moderator_role_granted`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(grantKey)) {
          const grantedTime = toDateValue(g.grantedAt || g.updatedAt);
          queueLog(docId, {
            id: docId,
            actorUid: g.grantedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: g.grantedByEmail || "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: gid,
            targetUsername: g.email ? String(g.email).split("@")[0] : gid,
            actionType: "moderator_role_granted",
            reason: "Ana yönetici tarafından moderatör yetkisi verildi",
            startsAt: grantedTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: grantedTime,
          });
        }
      }
      if (g.revokedAt || g.active === false) {
        const docId = `modlog_legacy_revoke_${gid}`;
        const revokeKey = `${gid}__moderator_role_revoked`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(revokeKey)) {
          const revokedTime = toDateValue(g.revokedAt || g.updatedAt);
          queueLog(docId, {
            id: docId,
            actorUid: g.revokedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: gid,
            targetUsername: g.email ? String(g.email).split("@")[0] : gid,
            actionType: "moderator_role_revoked",
            reason: "Ana yönetici tarafından moderatör yetkisi kaldırıldı",
            startsAt: revokedTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: revokedTime,
          });
        }
      }
    }

    // 5. Devre dışı bırakılmış kanallar
    for (const ch of channelsList) {
      const chId = String(ch.id || "");
      if (!chId) continue;
      if (ch.disabled === true) {
        const docId = `modlog_legacy_ch_dis_${chId}`;
        const key = `${chId}__channel_disabled`;
        if (!existingDocIds.has(docId) && !existingActionKeys.has(key)) {
          const chTime = toDateValue(ch.updatedAt || ch.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: ch.disabledByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Sukuna (Admin)",
            actorRole: "admin",
            targetUid: chId,
            targetUsername: ch.name || chId,
            actionType: "channel_disabled",
            reason: `Kanal yönetici tarafından devre dışı bırakıldı: ${ch.name || chId}`,
            startsAt: chTime,
            endsAt: null,
            durationMinutes: null,
            reportId: null,
            createdAt: chTime,
          });
        }
      }
    }

    // 6. İncelenmiş kullanıcı şikâyetleri ve moderasyon raporları
    for (const r of userReportsList) {
      const rid = String(r.id || "");
      if (!rid) continue;
      if (r.status === "resolved" || r.status === "dismissed" || Boolean(r.reviewedByUid)) {
        const docId = `modlog_legacy_urep_${rid}`;
        if (!existingDocIds.has(docId) && !existingReportIds.has(rid)) {
          const repTime = toDateValue(r.updatedAt || r.createdAt);
          queueLog(docId, {
            id: docId,
            actorUid: r.reviewedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
            actorEmail: null,
            actorUsername: "Moderasyon",
            actorRole: r.reviewedByUid === MUSE_MODERATOR_UID ? "moderator" : "admin",
            targetUid: String(r.reportedUid || rid),
            targetUsername: r.reportedUsername || null,
            actionType: "report_reviewed",
            reason: sanitizePublicModerationReason(
              r.resolutionNote || r.reason,
              `Kullanıcı şikâyeti incelendi (${r.status})`
            ),
            startsAt: repTime,
            endsAt: null,
            durationMinutes: null,
            reportId: rid,
            createdAt: repTime,
          });
        }
      }
    }

    for (const mr of modReportsList) {
      const mrid = String(mr.id || "");
      if (!mrid) continue;
      const docId = `modlog_legacy_mrep_${mrid}`;
      if (!existingDocIds.has(docId) && !existingReportIds.has(mrid)) {
        const repTime = toDateValue(mr.createdAt);
        const riskPrefix = mr.riskLevel ? `[${String(mr.riskLevel).toUpperCase()}] ` : "";
        queueLog(docId, {
          id: docId,
          actorUid: mr.authorUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
          actorEmail: null,
          actorUsername: mr.authorUsername || "Moderasyon",
          actorRole: mr.authorRole === "moderator" ? "moderator" : "admin",
          targetUid: String(mr.targetUid || mrid),
          targetUsername: mr.targetUsername || null,
          actionType: "report_reviewed",
          reason: sanitizePublicModerationReason(
            `${riskPrefix}${mr.title || mr.summary || "Moderasyon inceleme raporu"}`,
            "Moderasyon inceleme raporu"
          ),
          startsAt: repTime,
          endsAt: null,
          durationMinutes: null,
          reportId: mrid,
          createdAt: repTime,
        });
      }
    }

    // 7. Kalıcı engellenen cihaz/hesap kayıtları (IP, HWID ve donanım kimliği KESİNLİKLE kopyalanmaz!)
    for (const b of bannedDevicesList) {
      const bid = String(b.id || "");
      if (!bid) continue;
      const docId = `modlog_legacy_devban_${bid}`;
      if (!existingDocIds.has(docId)) {
        const banTime = toDateValue(b.bannedAt || b.createdAt);
        queueLog(docId, {
          id: docId,
          actorUid: b.bannedByUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
          actorEmail: null,
          actorUsername: b.bannedBy || "Sukuna (Admin)",
          actorRole: "admin",
          targetUid: String(b.targetUid || `device_${bid}`),
          targetUsername: b.targetUsername || b.targetDisplayName || null,
          actionType: "perm_ban",
          reason: sanitizePublicModerationReason(b.reason, "Kalıcı hesap ve erişim engeli"),
          startsAt: banTime,
          endsAt: null,
          durationMinutes: null,
          reportId: null,
          createdAt: banTime,
        });
      }
    }

    // 8. adminLogs içindeki YALNIZCA category === 'moderation' kayıtlarını aktar
    // (security_session, IP, e-posta inceleme sistem detayları KESİNLİKLE aktarılmaz)
    for (const al of adminLogsList) {
      if (al.category !== "moderation") continue;
      const alId = String(al.id || "");
      if (!alId) continue;

      const docId = `modlog_sync_${alId}`;
      if (existingDocIds.has(docId)) continue;

      const actionType = al.metadata?.actionType || al.action || "report_reviewed";
      const targetUid = String(al.targetUid || "system");
      const createdAt = toDateValue(al.createdAt);

      // Eğer canlı moderationLogs kaydının exact birebir aynasıysa (+/- 15sn), çift göstermeyi önle
      const mirrorKey = `${targetUid}__${actionType}`;
      const timestamps = existingMirrorIndex.get(mirrorKey) || [];
      const isLiveMirror = timestamps.some((ts) => Math.abs(ts - createdAt.getTime()) <= 15_000);
      if (isLiveMirror) continue;

      queueLog(docId, {
        id: docId,
        actorUid: al.actorUid || "CHYM2vRB8aTyu3a8iPzbGD31Fj63",
        actorEmail: null,
        actorUsername: al.actorName || "admin",
        actorRole: "admin",
        targetUid,
        targetUsername: al.targetUsername || null,
        actionType,
        reason: sanitizePublicModerationReason(
          al.details || al.reason,
          "Yönetici moderasyon işlemi"
        ),
        startsAt: createdAt,
        endsAt: al.metadata?.endsAt ? toDateValue(al.metadata.endsAt) : null,
        durationMinutes: al.metadata?.durationMinutes ?? null,
        reportId: null,
        createdAt,
      });
    }

    // Bekleyen tüm senkronizasyon kayıtlarını güvenli paketler halinde yaz
    const BATCH_SIZE = 20;
    for (let i = 0; i < pendingWrites.length; i += BATCH_SIZE) {
      const slice = pendingWrites.slice(i, i + BATCH_SIZE);
      await Promise.all(
        slice.map((item) => dbSetDoc("moderationLogs", item.docId, item.payload, effectiveToken))
      );
    }

    return true;
  } catch (err) {
    console.warn("[Moderation Sync] warning:", err);
    return false;
  }
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

  // Başlangıçta geçmiş kayıtları senkronize et ve süresi dolanları tara
  setTimeout(async () => {
    await syncHistoricalModerationRecords();
    await runSweep();
  }, 3000);

  setInterval(runSweep, 60_000);
}

