import type { UserProfile, ChatMessage } from '../types';

export const REDCHAT_AI_UID = 'system_redchat_ai';
export const REDCHAT_AI_USERNAME = 'redchat_ai';
export const REDCHAT_AI_DISPLAY_NAME = 'RedChat AI';

/**
 * RedChat AI için varsayılan profil nesnesi üretir.
 */
export function getRedChatAIProfile(customPhotoUrl?: string | null): UserProfile {
  return {
    uid: REDCHAT_AI_UID,
    username: REDCHAT_AI_USERNAME,
    usernameLower: REDCHAT_AI_USERNAME,
    displayName: REDCHAT_AI_DISPLAY_NAME,
    email: 'ai@redchat.internal',
    photoURL: customPhotoUrl || null,
    bio: 'RedChat Resmi Yapay Zeka Asistanı • Flash Lite 1.0',
    createdAt: null,
    updatedAt: null,
    isOnline: false,
    lastSeen: null,
    role: 'user',
    isVerified: true,
    isBanned: false,
    isMuted: false,
    isSystemAI: true,
  };
}

/**
 * Belirtilen kullanıcının veya ID'nin RedChat AI olup olmadığını kontrol eder.
 */
export function isRedChatAI(userOrUid?: UserProfile | string | null): boolean {
  if (!userOrUid) return false;
  if (typeof userOrUid === 'string') {
    return userOrUid === REDCHAT_AI_UID || userOrUid.toLowerCase() === REDCHAT_AI_USERNAME;
  }
  return (
    userOrUid.uid === REDCHAT_AI_UID ||
    userOrUid.isSystemAI === true ||
    userOrUid.username?.toLowerCase() === REDCHAT_AI_USERNAME
  );
}

/**
 * Server-side AI endpoint'ine güvenli istek atarak yanıt alır.
 * API key browser'a asla sızdırılmaz.
 */
export async function requestAIChatResponse(
  userMessage: string,
  chatHistory: ChatMessage[] = []
): Promise<string> {
  const cleanMessage = userMessage.trim();
  if (!cleanMessage) {
    throw new Error('Mesaj metni boş olamaz.');
  }

  // Son 10 mesajı formatla (Prompt context)
  const formattedHistory = chatHistory.slice(-10).map((m) => ({
    role: m.senderId === REDCHAT_AI_UID ? 'assistant' : 'user',
    text: m.text,
    senderId: m.senderId,
  }));

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userMessage: cleanMessage,
        messages: formattedHistory,
      }),
    });

    if (!response.ok) {
      let errDetail = 'RedChat AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.';
      try {
        const errorJson = await response.json();
        if (errorJson?.error) {
          errDetail = errorJson.error;
        }
      } catch {
        // Fallback to default
      }
      throw new Error(errDetail);
    }

    const data = await response.json();
    if (!data.text || typeof data.text !== 'string') {
      throw new Error('RedChat AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
    }

    return data.text.trim();
  } catch (error: any) {
    console.error('requestAIChatResponse error:', error);
    throw new Error(error?.message || 'RedChat AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
  }
}
