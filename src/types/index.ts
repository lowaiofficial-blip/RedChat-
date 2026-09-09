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
  isEdited?: boolean;
  editedAt?: any;
  replyTo?: ChatReplyReference | null;
  reactions?: {
    [emoji: string]: string[];
  };
  isSystemMessage?: boolean;
  systemType?: 'leave' | 'join' | 'create' | 'info' | 'role_change' | 'ownership_transfer' | 'name_change' | 'photo_change';
}

