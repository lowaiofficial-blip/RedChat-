import type { UserProfile, ChatMessage } from '../types';

export const REDCHAT_AI_UID = 'system_redchat_ai';
export const REDCHAT_AI_USERNAME = 'deepred_ai';
export const REDCHAT_AI_DISPLAY_NAME = 'DeepRed AI';

// Geliştirici kolaylığı için DeepRed AI takma adları
export const DEEPRED_AI_UID = REDCHAT_AI_UID;
export const DEEPRED_AI_USERNAME = REDCHAT_AI_USERNAME;
export const DEEPRED_AI_DISPLAY_NAME = REDCHAT_AI_DISPLAY_NAME;
export const getDeepRedAIProfile = getRedChatAIProfile;
export const isDeepRedAI = isRedChatAI;

/**
 * DeepRed AI için varsayılan profil nesnesi üretir.
 */
export function getRedChatAIProfile(customPhotoUrl?: string | null): UserProfile {
  return {
    uid: REDCHAT_AI_UID,
    username: REDCHAT_AI_USERNAME,
    usernameLower: REDCHAT_AI_USERNAME,
    displayName: REDCHAT_AI_DISPLAY_NAME,
    email: 'ai@redchat.internal',
    photoURL: customPhotoUrl || null,
    bio: 'DeepRed AI — RedChat Resmi Yapay Zeka Asistanı',
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
 * Belirtilen kullanıcının veya ID'nin DeepRed AI olup olmadığını kontrol eder.
 */
export function isRedChatAI(userOrUid?: UserProfile | string | null): boolean {
  if (!userOrUid) return false;
  if (typeof userOrUid === 'string') {
    const s = userOrUid.toLowerCase();
    return (
      userOrUid === REDCHAT_AI_UID ||
      s === 'deepred_ai' ||
      s === 'deepred ai' ||
      s === 'deepred' ||
      s === 'redchat_ai' ||
      s === 'redchat ai'
    );
  }
  const uLower = userOrUid.username?.toLowerCase();
  return (
    userOrUid.uid === REDCHAT_AI_UID ||
    userOrUid.isSystemAI === true ||
    uLower === 'deepred_ai' ||
    uLower === 'deepred' ||
    uLower === 'redchat_ai' ||
    userOrUid.displayName === 'DeepRed AI' ||
    userOrUid.displayName === 'DeepRed' ||
    userOrUid.displayName === 'RedChat AI'
  );
}

/**
 * Server-side AI endpoint'ine güvenli istek atarak yanıt alır.
 * API key browser'a asla sızdırılmaz.
 */
export async function requestAIChatResponse(
  userMessage: string,
  chatHistory: ChatMessage[] = [],
  userId?: string
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
        userId
      }),
    });

    if (!response.ok) {
      let errDetail = 'DeepRed AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.';
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
      throw new Error('DeepRed AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
    }

    return data.text.trim();
  } catch (error: any) {
    console.error('requestAIChatResponse error:', error);
    throw new Error(error?.message || 'DeepRed AI şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
  }
}

export async function requestAIChatStream(
  userMessage: string,
  chatHistory: ChatMessage[] = [],
  userId?: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const cleanMessage = userMessage.trim();
  
  const formattedHistory = chatHistory.slice(-10).map((m) => ({
    role: m.senderId === REDCHAT_AI_UID ? 'assistant' : 'user',
    text: m.text,
    senderId: m.senderId,
  }));

  try {
    const response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userMessage: cleanMessage,
        messages: formattedHistory,
        userId
      }),
    });

    if (!response.ok || !response.body) {
      console.warn('Stream yanıt vermedi, standart istek deneniyor...');
      const fallbackText = await requestAIChatResponse(cleanMessage, chatHistory, userId);
      if (onChunk) onChunk(fallbackText);
      return fallbackText;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          if (dataStr === "[DONE]") {
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            if (data.error) {
              throw new Error(data.error);
            }
            if (data.chunk) {
              fullResponse += data.chunk;
              if (onChunk) {
                onChunk(fullResponse);
              }
            }
          } catch (e) {
            // ignore JSON parse error for partial lines
          }
        }
      }
    }
    return fullResponse;
  } catch (error: any) {
    console.error('requestAIChatStream error:', error);
    try {
      const fallback = await requestAIChatResponse(cleanMessage, chatHistory, userId);
      if (onChunk) onChunk(fallback);
      return fallback;
    } catch (fbErr: any) {
      throw new Error(fbErr?.message || 'DeepRed AI şu anda yanıt veremiyor.');
    }
  }
}
