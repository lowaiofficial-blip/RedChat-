export type GroupRole = 'owner' | 'admin' | 'member';

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
  role?: 'admin' | 'user';
  isVerified?: boolean;
  isBanned?: boolean;
  banReason?: string;
  bannedAt?: any;
  isMuted?: boolean;
  muteReason?: string;
  mutedAt?: any;
  isSystemAI?: boolean;
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
  createdAt: any;
  updatedAt: any;
}

export interface ChatReplyReference {
  messageId: string;
  senderId: string;
  senderName: string;
  text?: string;
  imageUrl?: string | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  text: string;
  imageUrl?: string | null;
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
