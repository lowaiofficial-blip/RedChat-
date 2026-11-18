export type GroupRole = 'owner' | 'admin' | 'member';

export type AccountType = 'personal' | 'business';

export type BusinessCategory =
  | 'Mağaza'
  | 'Teknoloji'
  | 'Yazılım'
  | 'Oyun'
  | 'Eğitim'
  | 'Yiyecek & İçecek'
  | 'Hizmet'
  | 'Sağlık'
  | 'Giyim'
  | 'Medya'
  | 'İçerik Üreticisi'
  | 'Diğer';

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  'Mağaza',
  'Teknoloji',
  'Yazılım',
  'Oyun',
  'Eğitim',
  'Yiyecek & İçecek',
  'Hizmet',
  'Sağlık',
  'Giyim',
  'Medya',
  'İçerik Üreticisi',
  'Diğer',
];

export interface BusinessProfile {
  businessName?: string;
  category?: BusinessCategory | string;
  description?: string;
  website?: string;
  email?: string;
  phone?: string;
  location?: string;
  hours?: string;
  photoURL?: string | null;
  updatedAt?: any;
}

export interface BusinessVerificationState {
  currentStep?: 1 | 2 | 3; // 1: Kayıt e-postası, 2: İşletme iletişim e-postası, 3: Doğrulandı / Etkinleştirmeye hazır
  step1Email?: string;
  step1Verified?: boolean;
  step1VerifiedAt?: any;
  step2Email?: string;
  step2Verified?: boolean;
  step2VerifiedAt?: any;
  draftProfile?: BusinessProfile;
  updatedAt?: any;
}

export interface UserProfile {
  uid: string;
  username: string;
  usernameLower: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  bio: string;
  createdAt: any;
  updatedAt: any;
  isOnline: boolean;
  lastSeen: any;
  role?: 'admin' | 'moderator' | 'user';
  isVerified?: boolean;
  isBanned?: boolean;
  banType?: 'permanent' | 'temporary' | null;
  banReason?: string | null;
  bannedAt?: any;
  banExpiresAt?: any;
  bannedByUid?: string | null;
  isMuted?: boolean;
  muteType?: 'permanent' | 'temporary' | null;
  muteReason?: string | null;
  mutedAt?: any;
  muteExpiresAt?: any;
  mutedByUid?: string | null;
  // ✉️ Manuel E-Posta İnceleme Alanları
  isEmailInReview?: boolean;
  emailInReviewAt?: any;
  emailInReviewBy?: string;
  isSystemAI?: boolean;

  // 🏢 İşletme Hesabı Alanları
  accountType?: AccountType;
  businessProfile?: BusinessProfile;
  businessVerification?: BusinessVerificationState;
  // 🤖 DeepRed AI Erişim Durumu (Yalnızca AI sohbetini kısıtlar, hesap banı değildir)
  aiAccess?: 'allowed' | 'blocked';
  aiAccessUpdatedAt?: any;
  aiAccessUpdatedBy?: string;
  securityStatus?: 'active' | 'terminated';
  // 🔒 Gizlilik Ayarları
  allowDirectMessages?: 'everyone' | 'none';
  allowGroupAdditions?: 'everyone' | 'none';
  // Cihaz ve Donanım Bilgileri
  lastIp?: string;
  lastDeviceId?: string;
  deviceType?: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  lastUserAgent?: string;
}

export interface BannedDevice {
  id: string; // Firestore document ID
  ip?: string | null;
  deviceId: string; // Hardware ID / Cihaz Parmak İzi
  hardwareFingerprint?: string;
  deviceType: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  targetUid?: string | null;
  targetUsername?: string | null;
  targetDisplayName?: string | null;
  targetEmail?: string | null;
  bannedBy: string; // Admin adı / email
  bannedByUid?: string;
  reason: string;
  bannedAt: any;
  isActive: boolean;
}

export interface AppSettings {
  verifiedBadgeUrl?: string | null;
  aiProfilePhotoUrl?: string | null;
  updatedAt?: any;
  updatedBy?: string;
}

export interface ConversationParticipant {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string | null;
  role?: GroupRole;
  isOnline?: boolean;
  isVerified?: boolean;
}

export interface Conversation {
  id: string; // deterministik: örn. [uid1, uid2].sort().join('_') veya grup için benzersiz ID
  isGroup?: boolean;
  name?: string;
  photoURL?: string | null;
  groupOwnerId?: string;
  participantIds: string[];
  participants: {
    [uid: string]: {
      displayName: string;
      username: string;
      photoURL: string | null;
      role?: GroupRole;
    };
  };
  memberRoles?: {
    [uid: string]: GroupRole;
  };
  lastMessageText?: string;
  lastMessageImageUrl?: string | null;
  lastMessageHasImage?: boolean;
  lastMessageVideoUrl?: string | null;
  lastMessageHasVideo?: boolean;
  lastMessageTimestamp?: any;
  lastMessageSenderId?: string;
  unreadCounts?: {
    [uid: string]: number;
  };
  typingUsers?: {
    [uid: string]: number;
  };
  securityStatus?: 'active' | 'terminated';
  terminatedAt?: any;
  terminatedReason?: string;
  abusiveCount?: number;
  blockedBy?: {
    [uid: string]: boolean;
  };
  blockedUserIds?: string[];
  createdAt: any;
  updatedAt: any;
}

export interface BlockedUserRecord {
  blockedUserId: string;
  createdAt: any;
}

export interface ChatReplyReference {
  messageId: string;
  senderId: string;
  senderName: string;
  text?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  videoDuration?: number | null;
  createdAt: any;
  status?: 'sent' | 'delivered' | 'read';
  isRead?: boolean;
  readAt?: any;
  readBy?: {
    [uid: string]: any;
  };
  isEdited?: boolean;
  editedAt?: any;
  replyTo?: ChatReplyReference | null;
  reactions?: {
    [emoji: string]: string[];
  };
  isSystemMessage?: boolean;
  systemType?: 'leave' | 'join' | 'create' | 'info' | 'role_change' | 'ownership_transfer' | 'name_change' | 'photo_change';
  isThinking?: boolean;
  isStreaming?: boolean;
  isGeneratingImage?: boolean;
  imagePrompt?: string;
  imageQuotaRemaining?: number;
  isSecurityWarning?: boolean;
  securityType?: 'terminated' | 'warning';
}

export interface GroupedNotificationMessage {
  id?: string;
  text: string;
  time: string;
}

export interface GroupedNotificationData {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string | null;
  isGroup?: boolean;
  groupName?: string;
  messages: GroupedNotificationMessage[];
  updatedAt: number;
}

// ==========================================
// 📢 KANAL SİSTEMİ VERİ MODELLERİ (CHANNELS)
// ==========================================

export interface Channel {
  id: string;
  name: string;
  description: string;
  photoURL?: string | null;
  bannerUrl?: string | null;
  isVerified?: boolean;
  followerCount: number;
  postCount?: number;
  lastPostText?: string | null;
  lastPostVideoUrl?: string | null;
  lastPostHasVideo?: boolean;
  lastPostImageUrl?: string | null;
  lastPostHasImage?: boolean;
  lastPostTimestamp?: any;
  disabled?: boolean;
  createdAt: any;
  updatedAt?: any;
}

export interface ChannelPost {
  id: string;
  channelId: string;
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  videoDuration?: number | null;
  viewsCount: number;
  reactions?: { [emoji: string]: string[] };
  createdAt: any;
}

export interface ChannelFollower {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string | null;
  followedAt: any;
}

export interface ChannelOwnerPrivate {
  ownerId: string;
  coOwnerIds?: string[];
  createdAt: any;
  updatedAt?: any;
}

export interface ChannelNotification {
  id: string;
  channelId: string;
  channelName: string;
  channelPhotoURL?: string | null;
  postId: string;
  text: string;
  imageUrl?: string | null;
  createdAt: any;
  read: boolean;
}


export interface PasswordResetRequest {
  id: string;
  userId?: string;
  username?: string;
  displayName?: string;
  email: string;
  accountType?: 'personal' | 'business';
  status: 'pending' | 'completed' | 'rejected';
  createdAt: any;
  processedAt?: any;
  processedBy?: string;
  resetLink?: string;
  ip?: string;
}

export interface VerificationRequest {
  id: string;
  type: 'user' | 'channel';
  userId?: string;
  username?: string;
  displayName?: string;
  accountType?: string;
  channelId?: string;
  channelName?: string;
  category?: string;
  links?: string;
  reason: string;
  extraInfo?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: any;
  updatedAt?: any;
}

// ==========================================
// 🌍 YENİ ÜLKE & OTURUM GÜVENLİĞİ VERİ MODELLERİ
// ==========================================

export type SecuritySessionStatus =
  | 'active'
  | 'pending_verification'
  | 'awaiting_admin_approval'
  | 'revoked';

export type SecuritySessionUserResponse =
  | 'pending'
  | 'confirmed_me'
  | 'denied_not_me'
  | 'not_required';

export type SecuritySessionAdminDecision =
  | 'pending'
  | 'approved'
  | 'revoked'
  | 'auto_trusted';

export interface SecuritySession {
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  deviceId: string;
  deviceType: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  browserName: string;
  osName: string;
  countryCode: string;
  countryName: string;
  flagEmoji: string;
  previousCountryCode?: string | null;
  previousCountryName?: string | null;
  isSuspicious: boolean;
  trusted: boolean;
  status: SecuritySessionStatus;
  userResponse: SecuritySessionUserResponse;
  adminDecision: SecuritySessionAdminDecision;
  emailSent?: boolean;
  emailStatus?: 'sent' | 'failed' | 'not_configured' | 'skipped';
  emailError?: string | null;
  createdAt: any;
  lastActiveAt: any;
  userRespondedAt?: any;
  adminReviewedAt?: any;
  adminReviewedBy?: string | null;
  revokedAt?: any;
  revokedBy?: string | null;
  revokedReason?: string | null;
}

export interface SecuritySessionNetwork {
  id: string;
  sessionId: string;
  userId: string;
  ip: string;
  city?: string | null;
  region?: string | null;
  isp?: string | null;
  countryCode: string;
  countryName: string;
  userAgentRaw?: string;
  proofHash?: string;
  createdAt: any;
  updatedAt?: any;
}

export interface UserSecurityProfile {
  uid: string;
  knownCountryCodes: string[];
  knownDeviceIds: string[];
  lastKnownCountryCode?: string | null;
  lastKnownCountryName?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface AdminLogEntry {
  id: string;
  category: 'security_session' | 'email_review' | 'moderation' | 'system';
  action: string;
  severity: 'info' | 'warning' | 'critical';
  actorUid: string;
  actorEmail?: string | null;
  actorName?: string | null;
  targetUid?: string | null;
  targetUsername?: string | null;
  sessionId?: string | null;
  details: string;
  metadata?: Record<string, any>;
  createdAt: any;
}

// ==========================================
// 🛡️ MODERASYON & YETKİLENDİRME VERİ MODELLERİ
// ==========================================

export interface ModeratorGrant {
  id: string;
  uid: string;
  email: string;
  role: 'moderator';
  active: boolean;
  grantedByUid: string;
  grantedByEmail?: string | null;
  grantedAt: any;
  revokedAt?: any;
  revokedByUid?: string | null;
  updatedAt: any;
}

export type ModerationActionType =
  | 'temp_mute'
  | 'unmute'
  | 'temp_ban'
  | 'unban'
  | 'perm_ban'
  | 'auto_mute_expired'
  | 'auto_ban_expired'
  | 'moderator_role_granted'
  | 'moderator_role_revoked'
  | 'report_reviewed';

export interface ModerationLogEntry {
  id: string;
  actorUid: string;
  actorEmail?: string | null;
  actorUsername?: string | null;
  actorRole: 'admin' | 'moderator' | 'system';
  targetUid: string;
  targetUsername?: string | null;
  actionType: ModerationActionType;
  reason: string;
  startsAt: any;
  endsAt: any | null;
  durationMinutes?: number | null;
  reportId?: string | null;
  createdAt: any;
}

export type UserReportCategory =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'inappropriate'
  | 'impersonation'
  | 'other';

export interface UserReport {
  id: string;
  reporterUid: string;
  reporterUsername: string;
  reportedUid: string;
  reportedUsername: string;
  conversationId?: string | null;
  messageId?: string | null;
  messageExcerpt?: string | null;
  category: UserReportCategory;
  reason: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  assignedModeratorUid?: string | null;
  resolutionNote?: string | null;
  reviewedByUid?: string | null;
  createdAt: any;
  updatedAt?: any;
}

export interface ModerationReport {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorRole: 'admin' | 'moderator';
  targetUid: string;
  targetUsername?: string | null;
  conversationId?: string | null;
  userReportId?: string | null;
  title: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedAction?: string | null;
  messageCountReviewed?: number;
  createdAt: any;
}


