import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Conversation, ChatMessage, UserProfile } from '../types';
import {
  subscribeToMessages,
  sendMessage,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  formatLastSeen,
} from '../services/chatService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { EmojiPicker } from './EmojiPicker';
import { GroupInfoModal } from './GroupInfoModal';
import { VerifiedBadge } from './VerifiedBadge';
import { RadialPulseLoader } from './RadialPulseLoader';
import { MarkdownMessage } from './MarkdownMessage';
import { isRedChatAI, requestAIChatResponse, getRedChatAIProfile, REDCHAT_AI_UID } from '../services/aiService';
import {
  Send,
  ArrowLeft,
  MessageSquare,
  Info,
  Check,
  CheckCheck,
  MoreVertical,
  Edit2,
  Trash2,
  X,
  Check as CheckIcon,
  Loader2,
  Copy,
  AlertTriangle,
  Image as ImageIcon,
  Maximize2,
  Download,
  AlertCircle,
  Reply,
  Smile,
  Users,
  Crown,
  Shield,
  UserPlus,
  UserMinus,
  Ban,
  VolumeX,
} from 'lucide-react';

interface ChatWindowProps {
  conversation: Conversation | null;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  badgeUrl?: string | null;
  aiProfilePhotoUrl?: string | null;
  onBack: () => void;
  onOpenProfile: (user: UserProfile) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  currentUser,
  allUsers,
  badgeUrl,
  aiProfilePhotoUrl,
  onBack,
  onOpenProfile,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);



  // Fotoğraf Gönderme State'leri
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ↩️ Yanıt Verme (Reply) State'leri
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // 😀 Emoji Seçici (Composer) & Hızlı Tepkiler
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hoveredReactionMessageId, setHoveredReactionMessageId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  // Büyük Fotoğraf Görüntüleme (Lightbox Modal)
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption?: string } | null>(null);

  // Seçili mesaj ve açılan aksiyon menüsü
  const [selectedActionMessage, setSelectedActionMessage] = useState<ChatMessage | null>(null);

  // Silme Onay Modalı
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Düzenleme durumu
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Kopyalandı bildirimi
  const [copiedNotification, setCopiedNotification] = useState(false);

  // 🤖 RedChat AI Düşünme / Yanıt Üretme Durumu
  const [isAiThinking, setIsAiThinking] = useState(false);

  // 👥 Grup Bilgisi Modal State'i
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);

  // 💬 @ Mention Sistemi State'leri
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionSuggestionsRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressActiveRef = useRef(false);

  // Karşıdaki kullanıcının bilgileri
  const otherParticipantId = useMemo(
    () => conversation?.participantIds.find((id) => id !== currentUser.uid),
    [conversation?.participantIds, currentUser.uid]
  );
  const otherUserObj = useMemo(
    () => allUsers.find((u) => u.uid === otherParticipantId),
    [allUsers, otherParticipantId]
  );
  const otherParticipantInfo = useMemo(
    () => (otherParticipantId && conversation?.participants ? conversation.participants[otherParticipantId] : null),
    [otherParticipantId, conversation?.participants]
  );

  // Karşı tarafın RedChat AI olup olmadığını kontrol et
  const isDirectAIChat = useMemo(() => {
    if (conversation?.isGroup) return false;
    return isRedChatAI(otherUserObj || otherParticipantId);
  }, [conversation?.isGroup, otherUserObj, otherParticipantId]);

  const displayName = isDirectAIChat
    ? 'RedChat AI'
    : (otherUserObj?.displayName ||
       otherParticipantInfo?.displayName ||
       otherParticipantInfo?.username ||
       'Kullanıcı');
  const username = isDirectAIChat
    ? 'redchat_ai'
    : (otherUserObj?.username || otherParticipantInfo?.username || '');
  const photoURL = otherUserObj?.photoURL || otherParticipantInfo?.photoURL || null;
  const isOnline = isDirectAIChat ? true : (otherUserObj?.isOnline ?? false);

  // Karşı tarafın banlı olup olmadığı (Birebir sohbetlerde)
  const isOtherUserBanned = useMemo(() => {
    if (conversation?.isGroup || isDirectAIChat) return false;
    return Boolean(otherUserObj?.isBanned);
  }, [conversation?.isGroup, isDirectAIChat, otherUserObj?.isBanned]);

  // ObjectURL bellek temizliği
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  // ESC tuşu ile Lightbox kapatma
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxImage(null);
        setSelectedActionMessage(null);
        setDeleteConfirmMessage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Mesajları dinle
  useEffect(() => {
    if (!conversation?.id) {
      setMessages([]);
      return;
    }

    const unsubscribe = subscribeToMessages(conversation.id, (fetchedMessages) => {
      setMessages(fetchedMessages);
    });

    return () => unsubscribe();
  }, [conversation?.id]);

  // Sohbet açıkken gelen/var olan okunmamış mesajları okundu olarak işaretle
  useEffect(() => {
    if (!conversation?.id || messages.length === 0) return;

    const hasUnread = messages.some(
      (m) => m.senderId !== currentUser.uid && (!m.isRead || m.status !== 'read')
    );

    if (hasUnread) {
      markMessagesAsRead(conversation.id, currentUser.uid);
    }
  }, [conversation?.id, messages, currentUser.uid]);

  // Otomatik aşağı kaydırma
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Fotoğraf Seçimi
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setImageUploadError('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setImageUploadError('Görsel boyutu en fazla 10MB olabilir.');
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedImageFile(file);
    setImagePreviewUrl(objectUrl);
    setImageUploadError(null);
  };

  // Seçili Fotoğrafı Kaldır
  const handleRemoveSelectedImage = () => {
    if (isUploadingImage) return;
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 밖 Click to Close Emoji Picker & Mention Suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('#emoji-toggle-btn')
      ) {
        setShowEmojiPicker(false);
      }
      if (
        mentionSuggestionsRef.current &&
        !mentionSuggestionsRef.current.contains(event.target as Node)
      ) {
        setShowMentionSuggestions(false);
      }
    }
    if (showEmojiPicker || showMentionSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker, showMentionSuggestions]);

  // 👥 Mention Öneri Listesi (RedChat AI + Grup Üyeleri)
  const mentionCandidates = useMemo(() => {
    const candidates: Array<{
      uid: string;
      displayName: string;
      username: string;
      photoURL?: string | null;
      isAi?: boolean;
      isVerified?: boolean;
    }> = [];

    // 1. RedChat AI her zaman önerilerde yer alır (Admin AI fotoğrafıyla, online dot olmadan)
    const aiPhoto = aiProfilePhotoUrl || null;
    candidates.push({
      uid: REDCHAT_AI_UID,
      displayName: 'RedChat AI',
      username: 'redchat_ai',
      photoURL: aiPhoto,
      isAi: true,
      isVerified: true,
    });

    // 2. Grup üyeleri (kendisi hariç)
    if (conversation?.isGroup && conversation.participantIds) {
      const memberUids = conversation.participantIds.filter(
        (id) => id !== currentUser.uid && id !== REDCHAT_AI_UID
      );
      for (const mUid of memberUids) {
        const uObj = allUsers.find((u) => u.uid === mUid);
        const pInfo = conversation.participants?.[mUid];
        if (uObj || pInfo) {
          candidates.push({
            uid: mUid,
            displayName:
              uObj?.displayName || pInfo?.displayName || uObj?.username || pInfo?.username || 'Kullanıcı',
            username: uObj?.username || pInfo?.username || '',
            photoURL: uObj?.photoURL || pInfo?.photoURL || null,
            isAi: false,
            isVerified: Boolean(uObj?.isVerified),
          });
        }
      }
    }

    // Arama filtreleme
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return candidates;

    return candidates.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        (c.isAi && ('redchat ai'.includes(q) || 'ai'.includes(q) || 'flashlite'.includes(q)))
    );
  }, [allUsers, aiProfilePhotoUrl, conversation, currentUser.uid, mentionQuery]);

  // 💬 Input Metni Değişimi & Mention Algılama
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    const cursor = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\s]*)$/);

    if (match) {
      const atIdx = match.index ?? -1;
      if (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1])) {
        setMentionQuery(match[1]);
        setShowMentionSuggestions(true);
        return;
      }
    }
    setShowMentionSuggestions(false);
  };

  // 💬 Mention Seçimi (@RedChat AI veya @kullanıcı ekler)
  const handleSelectMention = (candidate: { displayName: string; username: string; isAi?: boolean }) => {
    const inputEl = inputRef.current;
    const cursor = inputEl?.selectionStart ?? inputText.length;
    const textBeforeCursor = inputText.slice(0, cursor);
    const textAfterCursor = inputText.slice(cursor);

    const match = textBeforeCursor.match(/@([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\s]*)$/);
    if (match && match.index !== undefined) {
      const mentionTag = candidate.isAi ? '@RedChat AI ' : `@${candidate.username} `;
      const newText = textBeforeCursor.slice(0, match.index) + mentionTag + textAfterCursor;
      setInputText(newText);
      setShowMentionSuggestions(false);
      setTimeout(() => {
        inputEl?.focus();
        const newPos = match.index + mentionTag.length;
        inputEl?.setSelectionRange(newPos, newPos);
      }, 0);
    }
  };

  // 🔵 Mesaj İçeriğinde Markdown (Kalın metin, Tablo, Liste, Kod) & @RedChat AI Mention Desteği
  const renderMessageText = (text?: string, isMe?: boolean) => {
    if (!text) return null;
    return <MarkdownMessage content={text} isMe={isMe} />;
  };

  // 😀 Input Alanına Emoji Ekle (Cursor korumalı, mevcut metni veya fotoğrafı bozmaz)
  const handleSelectEmoji = (emoji: string) => {
    const inputEl = inputRef.current;
    if (inputEl) {
      const start = inputEl.selectionStart ?? inputText.length;
      const end = inputEl.selectionEnd ?? inputText.length;
      const newText = inputText.substring(0, start) + emoji + inputText.substring(end);
      setInputText(newText);
      setTimeout(() => {
        inputEl.focus();
        inputEl.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setInputText((prev) => prev + emoji);
    }
  };

  // 👍 Mesaja Emoji Tepkisi Ekle / Kaldır (Toggle)
  const handleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!conversation?.id || !currentUser.uid) return;
    try {
      await toggleMessageReaction(conversation.id, msg.id, currentUser.uid, emoji);
      setHoveredReactionMessageId(null);
    } catch (err) {
      console.error('Tepki kaydedilemedi:', err);
    }
  };

  // ↩️ Yanıt Başlat (Hem mobil hem PC)
  const handleStartReply = (msg: ChatMessage) => {
    setReplyingToMessage(msg);
    setSelectedActionMessage(null);
    setEditingMessage(null);
  };

  // ↩️ Yanıta Tıklayınca Orijinal Mesaja Kaydır ve Vurgula
  const handleScrollToMessage = (messageId: string) => {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      setTimeout(() => {
        setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
      }, 2000);
    }
  };

  // Mesaj Gönderme (Metin, Fotoğraf, Fotoğraf + Metin, veya Yanıt)
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversation?.id || sending || isUploadingImage) return;

    if (currentUser.isBanned) {
      setImageUploadError('Hesabınız askıya alınmıştır (Banlandınız). Mesaj gönderemezsiniz.');
      return;
    }

    if (isOtherUserBanned) {
      setImageUploadError('Bu hesap askıya alındığı için mesaj gönderilemez.');
      return;
    }

    if (currentUser.isMuted) {
      setImageUploadError('Hesabınız susturulmuştur. Mesaj gönderemezsiniz.');
      return;
    }

    const textToSend = inputText.trim();
    if (!textToSend && !selectedImageFile) return;

    setSending(true);
    setImageUploadError(null);

    try {
      let uploadedImageUrl: string | null = null;

      // Eğer fotoğraf seçilmişse önce gerçek ImgBB'ye yükle
      if (selectedImageFile) {
        setIsUploadingImage(true);
        uploadedImageUrl = await uploadImageToImgBB(selectedImageFile);
      }

      // Yanıt referansı hazırla
      const replyRef = replyingToMessage
        ? {
            messageId: replyingToMessage.id,
            senderId: replyingToMessage.senderId,
            senderName: replyingToMessage.senderName || replyingToMessage.senderUsername || 'Kullanıcı',
            text: replyingToMessage.text || '',
            imageUrl: replyingToMessage.imageUrl || null,
          }
        : null;

      // Firestore'a tek bir mesaj dokümanı olarak kaydet (replyTo dahil)
      await sendMessage(conversation.id, currentUser, textToSend, uploadedImageUrl, replyRef);

      // Gönderim başarılı olduysa form alanlarını ve yanıt modunu temizle
      setInputText('');
      setReplyingToMessage(null);
      handleRemoveSelectedImage();

      // 🤖 Eğer birebir RedChat AI sohbeti ise VEYA grup sohbetinde @RedChat AI etiketlenmişse yapay zeka yanıtını tetikle
      const isGroupChat = Boolean(conversation?.isGroup);
      const isAiMentioned = /@RedChat\s+AI|@redchat_ai|@RedChatAI/i.test(textToSend);

      if ((isDirectAIChat || (isGroupChat && isAiMentioned)) && textToSend) {
        // AI Yanıtını arka planda asenkron olarak üret ve gönder (yalnızca 1 kez üretilir)
        (async () => {
          setIsAiThinking(true);
          try {
            const aiPhoto = aiProfilePhotoUrl || photoURL || null;
            const aiProfile = getRedChatAIProfile(aiPhoto);

            // Grupta mention etiketi temizlenerek yapay zekaya aktarılır
            const cleanPrompt = isGroupChat
              ? textToSend.replace(/@RedChat\s+AI|@redchat_ai|@RedChatAI/gi, '').trim() || textToSend
              : textToSend;

            const aiResponseText = await requestAIChatResponse(cleanPrompt, messages);

            // AI mesajını Firestore sohbetine kaydet
            await sendMessage(conversation.id, aiProfile, aiResponseText, null, null);
          } catch (aiErr: any) {
            console.error('RedChat AI yanıt hatası:', aiErr);
            setImageUploadError(aiErr?.message || 'RedChat AI şu anda yanıt veremiyor.');
          } finally {
            setIsAiThinking(false);
          }
        })();
      }
    } catch (err: any) {
      console.error('Mesaj gönderim hatası:', err);
      setImageUploadError(err?.message || 'Mesaj gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsUploadingImage(false);
      setSending(false);
    }
  };

  // Düzenleme Başlat
  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessage(msg);
    setEditText(msg.text || '');
    setSelectedActionMessage(null);
  };

  // Düzenlemeyi Kaydet (Fotoğraf varsa fotoğraf korunur, sadece açıklama güncellenir)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMessage || !conversation?.id || savingEdit) return;

    const textToSend = editText.trim();
    if (!textToSend && !editingMessage.imageUrl) return;

    setSavingEdit(true);
    const isLast = messages[messages.length - 1]?.id === editingMessage.id;
    try {
      await editMessage(
        conversation.id,
        editingMessage.id,
        textToSend,
        isLast,
        Boolean(editingMessage.imageUrl)
      );
      setEditingMessage(null);
      setEditText('');
    } catch (err) {
      console.error('Mesaj düzenlenemedi:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  // Silme Onayına Gönder
  const handleRequestDelete = (msg: ChatMessage) => {
    setSelectedActionMessage(null);
    setDeleteConfirmMessage(msg);
  };

  // Onaylı Mesaj Silme (Fotoğraf ve metin birlikte Firestore'dan silinir)
  const handleConfirmDelete = async () => {
    if (!conversation?.id || !deleteConfirmMessage || deleting) return;

    setDeleting(true);
    const isLast = messages[messages.length - 1]?.id === deleteConfirmMessage.id;
    let prevText = '';
    let prevHasImage = false;
    let prevImageUrl: string | null = null;

    if (messages.length > 1) {
      const prevMsg = messages[messages.length - 2];
      prevHasImage = Boolean(prevMsg.imageUrl);
      prevImageUrl = prevMsg.imageUrl || null;
      prevText = prevMsg.text ? prevMsg.text : (prevHasImage ? 'Fotoğraf' : '');
    }

    try {
      await deleteMessage(
        conversation.id,
        deleteConfirmMessage.id,
        isLast,
        prevText,
        prevHasImage,
        prevImageUrl
      );
      setDeleteConfirmMessage(null);
    } catch (err) {
      console.error('Mesaj silinemedi:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Metin Kopyalama
  const handleCopyText = (text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setSelectedActionMessage(null);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  // Zaman formatlama (18:42)
  const formatMsgTime = (timestamp: any): string => {
    if (!timestamp) return 'şimdi';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Uzun basma (Long-press) ve Sağ Tık kontrolü
  const handleTouchStart = (msg: ChatMessage) => {
    isLongPressActiveRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      setSelectedActionMessage(msg);
    }, 450);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    setSelectedActionMessage(msg);
  };

  // Hiçbir sohbet seçili değilse boş durum
  if (!conversation) {
    return (
      <div className="flex-1 hidden md:flex flex-col items-center justify-center p-8 text-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-16 h-16 rounded-2xl bg-red-600/10 dark:bg-red-600/20 text-red-600 flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
          RedChat'e Hoş Geldiniz
        </h2>
        <p className="text-xs text-zinc-500 max-w-sm">
          Sohbet etmek için soldaki listeden bir konuşma seçin veya <strong>Kullanıcılar</strong> sekmesinden yeni bir sohbet başlatın.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 relative">
      {/* Kopyalandı Bildirimi */}
      {copiedNotification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-zinc-900/90 text-white text-xs px-3.5 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-in fade-in zoom-in-95">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>Mesaj kopyalandı</span>
        </div>
      )}

      {/* Chat Top Header */}
      <div className="h-16 px-4 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Back Button */}
          <button
            onClick={onBack}
            className="md:hidden p-2 -ml-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer shrink-0"
            title="Geri Dön"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Group Header vs User Info Header */}
          {conversation?.isGroup ? (
            <button
              onClick={() => setShowGroupInfoModal(true)}
              className="flex items-center gap-3 text-left hover:opacity-90 transition-opacity cursor-pointer min-w-0"
            >
              <div className="relative flex-shrink-0">
                {conversation.photoURL ? (
                  <UserAvatar
                    photoURL={conversation.photoURL}
                    name={conversation.name || 'Grup'}
                    size="md"
                    shape="rounded"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-600 to-red-700 text-white flex items-center justify-center shadow-xs">
                    <Users className="w-5 h-5" />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                    {conversation.name || 'Grup'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 font-semibold shrink-0">
                    Grup
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 truncate">
                  <span>{conversation.participantIds?.length || 0} üye</span>
                  <span>•</span>
                  <span className="text-red-600 dark:text-red-400 font-medium">Grup Detayı</span>
                </div>
              </div>
            </button>
          ) : (
            <button
              onClick={() => {
                if (otherUserObj) {
                  onOpenProfile(otherUserObj);
                }
              }}
              className="flex items-center gap-3 text-left hover:opacity-90 transition-opacity cursor-pointer min-w-0"
            >
              <div className="relative flex-shrink-0">
                <UserAvatar
                  photoURL={photoURL}
                  name={displayName}
                  username={username}
                  size="md"
                  shape="circle"
                />
                {!isDirectAIChat && (
                  <span
                    className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${
                      isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {displayName}
                    </span>
                    <VerifiedBadge
                      isVerified={isDirectAIChat || otherUserObj?.isVerified}
                      badgeUrl={badgeUrl}
                      size="sm"
                      user={{
                        displayName,
                        username,
                        photoURL,
                      }}
                    />
                    {isOtherUserBanned && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400 rounded">
                        Askıya Alındı
                      </span>
                    )}
                  </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 truncate">
                  <span className="font-mono text-red-600">@{username}</span>
                  {isOtherUserBanned ? (
                    <>
                      <span>•</span>
                      <span className="text-red-500 font-medium">Bu hesap askıya alındı</span>
                    </>
                  ) : !isDirectAIChat && (
                    <>
                      <span>•</span>
                      <span className={isOnline ? 'text-emerald-600 font-medium' : 'text-zinc-400'}>
                        {formatLastSeen(isOnline, otherUserObj?.lastSeen)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Action Button (Group Info or Profile Info) */}
        {conversation?.isGroup ? (
          <button
            onClick={() => setShowGroupInfoModal(true)}
            className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Grup Bilgilerini Görüntüle"
          >
            <Users className="w-5 h-5" />
          </button>
        ) : otherUserObj ? (
          <button
            onClick={() => onOpenProfile(otherUserObj)}
            className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Kullanıcı Profilini Görüntüle"
          >
            <Info className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-1.5 space-y-1">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center mb-2">
              <MessageSquare className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Bu sohbet henüz yeni
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Aşağıdaki alandan ilk mesajınızı veya fotoğrafınızı gönderin.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            // 🔔 Gerçek Firestore Sistem Mesajı (Örn: "Test1, Test2'yi gruba ekledi", "Test1 kuruculuğu Test2'ye devretti")
            if (msg.isSystemMessage) {
              const isOwnership = msg.systemType === 'ownership_transfer' || msg.text?.includes('kuruculuğu');
              const isRole = msg.systemType === 'role_change' || msg.text?.includes('yönetici');
              const isJoin = msg.systemType === 'join' || msg.text?.includes('ekledi');
              const isLeave = msg.systemType === 'leave' || msg.text?.includes('ayrıldı') || msg.text?.includes('çıkardı');
              const isCreate = msg.systemType === 'create' || msg.text?.includes('oluşturdu');

              return (
                <div
                  key={msg.id}
                  id={`message-${msg.id}`}
                  className="w-full flex justify-center my-1 select-none"
                >
                  <div
                    className={`px-3 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5 shadow-2xs ${
                      isOwnership
                        ? 'bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-900/60 text-amber-700 dark:text-amber-300'
                        : isRole
                        ? 'bg-blue-50 dark:bg-blue-950/50 border border-blue-200/80 dark:border-blue-900/60 text-blue-700 dark:text-blue-300'
                        : isJoin
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                        : isLeave
                        ? 'bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300'
                        : 'bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {isOwnership && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    {isRole && <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                    {isJoin && <UserPlus className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                    {isLeave && <UserMinus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                    {isCreate && <Users className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    <span>{msg.text}</span>
                    <span className="text-[9px] font-mono text-zinc-400 opacity-75 ml-0.5">
                      {formatMsgTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            }

            const isMe = msg.senderId === currentUser.uid;
            const isRead = msg.isRead || msg.status === 'read';
            const hasImage = Boolean(msg.imageUrl && msg.imageUrl.trim().length > 0);
            const hasText = Boolean(msg.text && msg.text.trim().length > 0);
            const isHighlighted = highlightedMessageId === msg.id;

            // Gerçek gönderen profil bilgileri (Firestore users/{uid} & participants haritasından)
            const senderUser = allUsers.find((u) => u.uid === msg.senderId) || (isMe ? currentUser : null);
            const senderParticipant = conversation?.participants?.[msg.senderId];
            const senderPhotoURL = senderUser?.photoURL || senderParticipant?.photoURL || null;
            const senderDisplayName =
              senderUser?.displayName ||
              senderParticipant?.displayName ||
              msg.senderName ||
              senderUser?.username ||
              senderParticipant?.username ||
              msg.senderUsername ||
              'Kullanıcı';
            const senderUsername =
              senderUser?.username ||
              senderParticipant?.username ||
              msg.senderUsername ||
              '';

            return (
              <div
                key={msg.id}
                id={`message-${msg.id}`}
                className={`group relative flex items-end gap-1.5 transition-all duration-300 ${
                  isMe ? 'justify-end' : 'justify-start'
                } ${
                  isHighlighted
                    ? 'p-1 -m-1 rounded-2xl ring-2 ring-red-500 bg-red-500/10 scale-[1.01]'
                    : ''
                }`}
              >
                {/* 👤 Gelen mesajlarda gönderen profil avatarı */}
                {!isMe && (
                  <div
                    className="shrink-0 mb-0.5 cursor-pointer self-end"
                    onClick={() => {
                      if (senderUser) {
                        onOpenProfile(senderUser);
                      }
                    }}
                    title={senderDisplayName}
                  >
                    <UserAvatar
                      photoURL={senderPhotoURL}
                      name={senderDisplayName}
                      username={senderUsername}
                      size="sm"
                      shape="circle"
                    />
                  </div>
                )}

                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[420px]`}>
                  {/* Balon ve Masaüstü Aksiyon Butonları Satırı */}
                  <div
                    className={`relative flex items-center gap-1 ${
                      isMe ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Mesaj Balonu (DOM'da ilk sıra - Avatar ile bitişik) */}
                    <div
                      onTouchStart={() => handleTouchStart(msg)}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchEnd}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      }}
                      className={`relative rounded-2xl text-xs leading-relaxed break-words shadow-xs select-none transition-transform active:scale-[0.99] ${
                        hasImage
                          ? 'w-56 sm:w-68 max-w-[72vw] p-1 pb-1.5'
                          : 'w-fit max-w-full px-3 py-1.5'
                      } ${
                        isMe
                          ? 'bg-red-600 text-white rounded-br-xs'
                          : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200/80 dark:border-zinc-700/80 rounded-bl-xs'
                      }`}
                    >
                      {/* 👥 Grup Sohbetinde Gönderen İsmi */}
                      {conversation?.isGroup && !isMe && (
                        <div className="text-[11px] font-bold text-red-600 dark:text-red-400 mb-0.5 px-0.5 truncate flex items-center gap-1">
                          <span className="truncate">{senderDisplayName}</span>
                          <VerifiedBadge
                            isVerified={senderUser?.isVerified}
                            badgeUrl={badgeUrl}
                            size="sm"
                            user={{
                              displayName: senderDisplayName,
                              username: senderUser?.username || msg.senderUsername,
                              photoURL: senderUser?.photoURL || null,
                            }}
                          />
                        </div>
                      )}

                      {/* ↩️ Yanıt Kartı (Mesaj Balonu İçi) */}
                      {msg.replyTo && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isLongPressActiveRef.current) return;
                            handleScrollToMessage(msg.replyTo!.messageId);
                          }}
                          className={`mb-1 p-1.5 rounded-xl text-left cursor-pointer transition-all border-l-4 select-none ${
                            isMe
                              ? 'bg-red-700/50 hover:bg-red-700/70 border-white text-white'
                              : 'bg-zinc-100 dark:bg-zinc-700/60 hover:bg-zinc-200 dark:hover:bg-zinc-700 border-red-600 dark:border-red-500 text-zinc-800 dark:text-zinc-200'
                          }`}
                          title="Orijinal mesaja git"
                        >
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span
                              className={`text-[10px] font-bold truncate flex items-center gap-1 ${
                                isMe ? 'text-red-100' : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              <Reply className="w-3 h-3 shrink-0" />
                              {msg.replyTo.senderId === currentUser.uid
                                ? 'Siz'
                                : msg.replyTo.senderName || 'Kullanıcı'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {msg.replyTo.imageUrl && (
                              <img
                                src={msg.replyTo.imageUrl}
                                alt="Yanıtlanan görsel"
                                referrerPolicy="no-referrer"
                                className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-black/10"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              {msg.replyTo.imageUrl && !msg.replyTo.text ? (
                                <span
                                  className={`text-[11px] flex items-center gap-1 italic ${
                                    isMe ? 'text-red-100/80' : 'text-zinc-500 dark:text-zinc-400'
                                  }`}
                                >
                                  <ImageIcon className="w-3 h-3 shrink-0" />
                                  Fotoğraf
                                </span>
                              ) : msg.replyTo.imageUrl && msg.replyTo.text ? (
                                <div className="text-[11px] flex items-center gap-1 truncate">
                                  <ImageIcon className="w-3 h-3 shrink-0 opacity-80" />
                                  <span className="truncate">{msg.replyTo.text}</span>
                                </div>
                              ) : (
                                <p className="text-[11px] truncate opacity-90">
                                  {msg.replyTo.text || 'Bu mesaj artık kullanılamıyor.'}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 🖼️ Fotoğraf İçeriği veya Metin + Saat (Kompakt Tek Akış) */}
                      {!hasImage ? (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span className="whitespace-pre-wrap select-none text-xs leading-relaxed break-words flex-1 min-w-[32px]">
                            {renderMessageText(msg.text, isMe)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-[10px] select-none shrink-0 self-end ml-auto ${
                              isMe ? 'text-red-100/80' : 'text-zinc-400 dark:text-zinc-400'
                            }`}
                          >
                            {msg.isEdited && (
                              <span className="italic text-[9px] opacity-75 mr-0.5">
                                (düzenlendi)
                              </span>
                            )}
                            <span>{formatMsgTime(msg.createdAt)}</span>
                            {isMe && (
                              <span
                                className="inline-flex items-center ml-0.5"
                                title={isRead ? 'Okundu' : 'Gönderildi'}
                              >
                                {isRead ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-white font-bold" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 text-red-200" />
                                )}
                              </span>
                            )}
                          </span>
                        </div>
                      ) : (
                        <>
                          {/* 🖼️ Fotoğraf */}
                          <div
                            className="relative group/img overflow-hidden rounded-xl cursor-pointer bg-black/10 dark:bg-black/30 flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isLongPressActiveRef.current) return;
                              setLightboxImage({
                                url: msg.imageUrl!,
                                caption: msg.text || undefined,
                              });
                            }}
                          >
                            <img
                              src={msg.imageUrl!}
                              alt="Fotoğraf"
                              referrerPolicy="no-referrer"
                              className="w-full h-auto max-h-60 sm:max-h-68 object-cover rounded-xl transition-transform duration-200 group-hover/img:scale-[1.02] block"
                              loading="lazy"
                            />
                            {/* Hover Zoom Göstergesi */}
                            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                              <span className="p-1.5 rounded-full bg-black/60 text-white backdrop-blur-xs shadow-md">
                                <Maximize2 className="w-3.5 h-3.5" />
                              </span>
                            </div>
                          </div>

                          {/* Fotoğraf Altı Metin + Saat */}
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-1 pt-1">
                            {hasText && (
                              <span className="whitespace-pre-wrap select-none text-xs leading-relaxed break-words flex-1 min-w-[60px]">
                                {renderMessageText(msg.text, isMe)}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 font-mono text-[10px] select-none shrink-0 self-end ml-auto ${
                                isMe ? 'text-red-100/80' : 'text-zinc-400 dark:text-zinc-400'
                              }`}
                            >
                              {msg.isEdited && (
                                <span className="italic text-[9px] opacity-75 mr-0.5">
                                  (düzenlendi)
                                </span>
                              )}
                              <span>{formatMsgTime(msg.createdAt)}</span>
                              {isMe && (
                                <span
                                  className="inline-flex items-center ml-0.5"
                                  title={isRead ? 'Okundu' : 'Gönderildi'}
                                >
                                  {isRead ? (
                                    <CheckCheck className="w-3.5 h-3.5 text-white font-bold" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5 text-red-200" />
                                  )}
                                </span>
                              )}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Masaüstü Hover Menü Butonları (Yalnızca masaüstünde hover durumunda görünür, mobilde gizlidir ve asla boşluk kaplamaz) */}
                    <div className="hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0 items-center gap-0.5 relative">
                      {/* Hızlı Tepki Butonu ve Açılır Emoji Çubuğu */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHoveredReactionMessageId((prev) => (prev === msg.id ? null : msg.id));
                          }}
                          className="p-1 rounded-full text-zinc-400 hover:text-amber-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                          title="Tepki Ekle"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>

                        {hoveredReactionMessageId === msg.id && (
                          <div
                            className={`absolute bottom-full mb-1 z-30 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-full px-2 py-1 flex items-center gap-1 animate-in zoom-in-90 ${
                              isMe ? 'right-0' : 'left-0'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {QUICK_REACTIONS.map((emoji) => {
                              const userList = msg.reactions?.[emoji] || [];
                              const hasReacted = userList.includes(currentUser.uid);
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReaction(msg, emoji);
                                  }}
                                  className={`w-7 h-7 text-sm rounded-full flex items-center justify-center transition-all hover:scale-125 active:scale-95 cursor-pointer ${
                                    hasReacted
                                      ? 'bg-red-100 dark:bg-red-950/80 ring-1 ring-red-500'
                                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'
                                  }`}
                                  title={`${emoji} tepkisi ver / kaldır`}
                                >
                                  {emoji}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleStartReply(msg)}
                        className="p-1 rounded-full text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Yanıtla"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setSelectedActionMessage(msg)}
                        className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Seçenekler"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 💬 Mesaj Emoji Tepki Rozetleri */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div
                      className={`flex flex-wrap items-center gap-1 mt-1 px-0.5 ${
                        isMe ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {(Object.entries(msg.reactions) as [string, string[]][])
                        .filter(([_, uids]) => Array.isArray(uids) && uids.length > 0)
                        .map(([emoji, uids]) => {
                          const count = uids.length;
                          const hasReacted = uids.includes(currentUser.uid);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReaction(msg, emoji);
                              }}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none active:scale-90 ${
                                hasReacted
                                  ? 'bg-red-100 dark:bg-red-950/80 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 font-bold shadow-xs'
                                  : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 shadow-xs'
                              }`}
                              title={`${count} kişi ${emoji} tepkisi verdi${
                                hasReacted ? ' (Kendi tepkinizi kaldırmak için tıklayın)' : ''
                              }`}
                            >
                              <span>{emoji}</span>
                              {count > 1 && (
                                <span className="text-[10px] font-semibold">{count}</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* 🤖 REDCHAT AI DÜŞÜNME / YAZIYOR ANİMASYONU (7 Parçalı Radial Pulse Loader) */}
        {isAiThinking && (
          <div className="flex items-start gap-2.5 max-w-[85%] sm:max-w-md animate-in fade-in slide-in-from-bottom-2">
            <div className="flex-shrink-0 mt-0.5">
              <UserAvatar
                photoURL={aiProfilePhotoUrl || photoURL}
                name="RedChat AI"
                username="redchat_ai"
                size="sm"
                shape="circle"
              />
            </div>
            <div className="bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-xs">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  RedChat AI
                  <VerifiedBadge
                    isVerified={true}
                    badgeUrl={badgeUrl}
                    size="xs"
                    user={{
                      displayName: 'RedChat AI',
                      username: 'redchat_ai',
                      photoURL: aiProfilePhotoUrl || photoURL,
                    }}
                  />
                </span>
                <span className="text-[10px] text-red-600 dark:text-red-400 font-mono">
                  yazıyor...
                </span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <RadialPulseLoader statusText="RedChat AI yanıt hazırlıyor..." />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 🔴 REDCHAT FOTOĞRAF BÜYÜTME (LIGHTBOX) MODALI */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in"
          onClick={() => setLightboxImage(null)}
        >
          {/* Top Bar: Kapatma & İndirme */}
          <div className="flex items-center justify-between z-10 w-full max-w-5xl mx-auto">
            <span className="text-xs font-semibold text-zinc-300">
              Fotoğraf Önizleme
            </span>
            <div className="flex items-center gap-2">
              <a
                href={lightboxImage.url}
                target="_blank"
                rel="noreferrer"
                download
                onClick={(e) => e.stopPropagation()}
                className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-white transition-colors cursor-pointer"
                title="Orijinal Fotoğrafı İndir / Aç"
              >
                <Download className="w-4 h-4" />
              </a>
              <button
                onClick={() => setLightboxImage(null)}
                className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-white transition-colors cursor-pointer"
                title="Kapat (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Centered Image */}
          <div
            className="flex-1 flex items-center justify-center p-2 min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxImage.url}
              alt="Büyük Önizleme"
              className="max-h-[75vh] max-w-[90vw] sm:max-w-4xl object-contain rounded-xl shadow-2xl animate-in zoom-in-95"
            />
          </div>

          {/* Bottom Caption (Varsa) */}
          {lightboxImage.caption ? (
            <div
              className="w-full max-w-xl mx-auto text-center z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="inline-block px-4 py-2 bg-zinc-900/90 text-white text-xs font-medium rounded-2xl border border-zinc-800 shadow-xl max-w-full truncate">
                {lightboxImage.caption}
              </div>
            </div>
          ) : (
            <div className="h-6" />
          )}
        </div>
      )}

      {/* ÖZEL REDCHAT MESAJ AKSİYON MENÜSÜ (Mobil & PC) */}
      {selectedActionMessage && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
          onClick={() => setSelectedActionMessage(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-xs p-3 shadow-2xl space-y-1.5 animate-in slide-in-from-bottom-3 sm:zoom-in-95"
          >
            {/* Önizleme: Fotoğraf veya Metin */}
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl mb-2 text-xs text-zinc-600 dark:text-zinc-300 border border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
              {selectedActionMessage.imageUrl && (
                <img
                  src={selectedActionMessage.imageUrl}
                  alt="Önizleme"
                  className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                />
              )}
              {selectedActionMessage.text ? (
                <span className="truncate italic">{selectedActionMessage.text}</span>
              ) : selectedActionMessage.imageUrl ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
                  Fotoğraf
                </span>
              ) : null}
            </div>

            {/* 👍 Hızlı Emoji Tepkileri */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl mb-1.5">
              {QUICK_REACTIONS.map((emoji) => {
                const userList = selectedActionMessage.reactions?.[emoji] || [];
                const hasReacted = userList.includes(currentUser.uid);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      handleReaction(selectedActionMessage, emoji);
                      setSelectedActionMessage(null);
                    }}
                    className={`w-9 h-9 text-lg rounded-xl flex items-center justify-center transition-all cursor-pointer hover:scale-125 active:scale-95 ${
                      hasReacted
                        ? 'bg-red-100 dark:bg-red-950/80 ring-2 ring-red-500 scale-105'
                        : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                    title={`${emoji} tepkisi ver / kaldır`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>

            {/* ↩️ Yanıtla Seçeneği (Hem kendi hem karşı tarafın mesajı için) */}
            <button
              onClick={() => handleStartReply(selectedActionMessage)}
              className="w-full px-3 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Reply className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span>Yanıtla</span>
            </button>

            {/* Fotoğrafı Görüntüle */}
            {selectedActionMessage.imageUrl && (
              <button
                onClick={() => {
                  setLightboxImage({
                    url: selectedActionMessage.imageUrl!,
                    caption: selectedActionMessage.text || undefined,
                  });
                  setSelectedActionMessage(null);
                }}
                className="w-full px-3 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Maximize2 className="w-4 h-4 text-zinc-400" />
                <span>Fotoğrafı Büyüt</span>
              </button>
            )}

            {/* Metni Kopyala (Varsa) */}
            {selectedActionMessage.text && (
              <button
                onClick={() => handleCopyText(selectedActionMessage.text)}
                className="w-full px-3 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4 text-zinc-400" />
                <span>Metni Kopyala</span>
              </button>
            )}

            {/* Kendi Mesajı İse: Düzenle & Sil */}
            {selectedActionMessage.senderId === currentUser.uid && (
              <>
                <button
                  onClick={() => handleStartEdit(selectedActionMessage)}
                  className="w-full px-3 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-4 h-4 text-amber-500" />
                  <span>{selectedActionMessage.imageUrl ? 'Açıklamayı Düzenle' : 'Mesajı Düzenle'}</span>
                </button>

                <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

                <button
                  onClick={() => handleRequestDelete(selectedActionMessage)}
                  className="w-full px-3 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Mesajı Sil</span>
                </button>
              </>
            )}

            <button
              onClick={() => setSelectedActionMessage(null)}
              className="w-full mt-2 py-2 text-center text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* ÖZEL REDCHAT SİLME ONAY MODALI (Fotoğraf ve Metin birlikte silinir) */}
      {deleteConfirmMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center animate-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1">
              Mesajı Sil
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5">
              {deleteConfirmMessage.imageUrl
                ? 'Bu fotoğraf ve açıklaması sohbetten tamamen silinecektir. Emin misiniz?'
                : 'Bu mesajı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.'}
            </p>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirmMessage(null)}
                disabled={deleting}
                className="flex-1 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/20 cursor-pointer disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Sil</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Editing Banner (Fotoğraf varsa fotoğrafı gösterir, yalnızca metin düzenlenir) */}
      {editingMessage && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200/60 dark:border-amber-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {editingMessage.imageUrl ? (
              <img
                src={editingMessage.imageUrl}
                alt="Fotoğraf"
                className="w-7 h-7 rounded-md object-cover flex-shrink-0 ring-1 ring-amber-400/50"
              />
            ) : (
              <Edit2 className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            )}
            <span className="text-xs text-amber-800 dark:text-amber-300 font-medium truncate">
              {editingMessage.imageUrl
                ? 'Fotoğraf açıklamasını düzenliyorsunuz'
                : `Mesajı düzenliyorsunuz: "${editingMessage.text}"`}
            </span>
          </div>
          <button
            onClick={() => {
              setEditingMessage(null);
              setEditText('');
            }}
            className="p-1 text-amber-700 hover:text-amber-900 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
            title="Vazgeç"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 🔴 SEÇİLEN FOTOĞRAF ÖNİZLEME ÇUBUĞU (Göndermeden önce kaldırma / önizleme) */}
      {imagePreviewUrl && !editingMessage && (
        <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative group/prev w-14 h-14 rounded-xl overflow-hidden bg-black/10 border border-zinc-300 dark:border-zinc-600 flex-shrink-0 shadow-xs">
              <img
                src={imagePreviewUrl}
                alt="Seçilen görsel önizleme"
                className="w-full h-full object-cover"
              />
              {isUploadingImage && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-red-600" />
                Fotoğraf eklendi
              </span>
              <p className="text-[11px] text-zinc-500 truncate max-w-xs">
                {selectedImageFile?.name} ({(selectedImageFile ? selectedImageFile.size / 1024 : 0).toFixed(0)} KB)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRemoveSelectedImage}
            disabled={isUploadingImage}
            className="px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
            title="Fotoğrafı Kaldır"
          >
            <X className="w-4 h-4" />
            <span>Kaldır</span>
          </button>
        </div>
      )}

      {/* ↩️ YANIT MODU ÖNİZLEME ÇUBUĞU */}
      {replyingToMessage && !editingMessage && (
        <div className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800/95 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-1 h-8 bg-red-600 rounded-full shrink-0" />
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {replyingToMessage.imageUrl && (
                <img
                  src={replyingToMessage.imageUrl}
                  alt="Yanıtlanan görsel"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-zinc-300 dark:border-zinc-700"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                  <Reply className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {replyingToMessage.senderId === currentUser.uid
                      ? 'Kendinize yanıt veriyorsunuz'
                      : `${replyingToMessage.senderName || replyingToMessage.senderUsername || 'Kullanıcı'} yanıtlanıyor`}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate flex items-center gap-1">
                  {replyingToMessage.imageUrl && !replyingToMessage.text ? (
                    <span className="flex items-center gap-1 italic text-zinc-500 dark:text-zinc-400">
                      <ImageIcon className="w-3 h-3 text-red-500 shrink-0" />
                      Fotoğraf
                    </span>
                  ) : replyingToMessage.imageUrl && replyingToMessage.text ? (
                    <>
                      <ImageIcon className="w-3 h-3 text-red-500 shrink-0" />
                      <span className="truncate">{replyingToMessage.text}</span>
                    </>
                  ) : (
                    <span className="truncate">{replyingToMessage.text || 'Mesaj'}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setReplyingToMessage(null)}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer shrink-0 ml-2"
            title="Yanıtı İptal Et (×)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Yükleme / Hata Uyarısı */}
      {imageUploadError && (
        <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/50 border-t border-rose-200 dark:border-rose-900/60 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{imageUploadError}</span>
          </div>
          <button
            onClick={() => setImageUploadError(null)}
            className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900 rounded-md cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Message Input Form */}
      <div className="relative p-3 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex-shrink-0">
        {/* 😀 EMOJİ SEÇİCİ PANELİ (WhatsApp Tarzı Floating Panel) */}
        {showEmojiPicker && (
          <div
            ref={emojiPickerRef}
            className="absolute bottom-16 left-3 sm:left-4 z-50 shadow-2xl"
          >
            <EmojiPicker
              onSelectEmoji={handleSelectEmoji}
              onClose={() => setShowEmojiPicker(false)}
            />
          </div>
        )}

        {/* 👥 @ MENTION ÖNERİ AÇILIR LİSTESİ */}
        {showMentionSuggestions && mentionCandidates.length > 0 && (
          <div
            ref={mentionSuggestionsRef}
            className="absolute bottom-16 left-3 sm:left-14 right-3 sm:right-auto sm:w-80 max-h-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2"
          >
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
                Kullanıcı Etiketle (@)
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {mentionCandidates.length} öneri
              </span>
            </div>
            <div className="max-h-52 overflow-y-auto p-1.5 space-y-1">
              {mentionCandidates.map((candidate) => (
                <button
                  key={candidate.uid}
                  type="button"
                  onClick={() => handleSelectMention(candidate)}
                  className="w-full p-2 rounded-xl flex items-center gap-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <UserAvatar
                    photoURL={candidate.photoURL}
                    name={candidate.displayName}
                    username={candidate.username}
                    size="sm"
                    shape="circle"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {candidate.displayName}
                      </span>
                      <VerifiedBadge
                        isVerified={candidate.isVerified || candidate.isAi}
                        badgeUrl={badgeUrl}
                        size="xs"
                        user={{
                          displayName: candidate.displayName,
                          username: candidate.username,
                          photoURL: candidate.photoURL,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono truncate block">
                      @{candidate.username}
                    </span>
                  </div>
                  {candidate.isAi ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-md shrink-0">
                      Flash Lite 1.0
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Gizli Dosya Seçici */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

        {isOtherUserBanned ? (
          <div className="flex items-center justify-center gap-2.5 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl text-red-600 dark:text-red-400 text-xs font-semibold text-center">
            <Ban className="w-4 h-4 shrink-0 text-red-600" />
            <span>Bu hesap askıya alındı</span>
          </div>
        ) : currentUser.isBanned ? (
          <div className="flex items-center justify-center gap-2.5 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl text-red-600 dark:text-red-400 text-xs font-semibold text-center">
            <Ban className="w-4 h-4 shrink-0 text-red-600" />
            <span>Hesabınız askıya alınmıştır (Banlandınız). Mesaj gönderemezsiniz.</span>
          </div>
        ) : currentUser.isMuted ? (
          <div className="flex items-center justify-center gap-2.5 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl text-amber-600 dark:text-amber-400 text-xs font-semibold text-center">
            <VolumeX className="w-4 h-4 shrink-0 text-amber-600" />
            <span>Hesabınız susturulmuştur. Sohbetleri okuyabilirsiniz ancak mesaj gönderemezsiniz.</span>
          </div>
        ) : editingMessage ? (
          <form onSubmit={handleSaveEdit} className="flex items-center gap-2">
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder={editingMessage.imageUrl ? 'Açıklamayı düzenle (isteğe bağlı)...' : 'Mesajı düzenle...'}
              autoFocus
              className="flex-1 px-4 py-2.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null);
                setEditText('');
              }}
              className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={(!editText.trim() && !editingMessage.imageUrl) || savingEdit}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              {savingEdit ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckIcon className="w-4 h-4" />
                  <span>Güncelle</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSend} className="flex items-center gap-2">
            {/* 😀 Emoji Butonu */}
            <button
              id="emoji-toggle-btn"
              type="button"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              disabled={sending || isUploadingImage}
              className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50 ${
                showEmojiPicker
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
              title="Emoji seç"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* 🖼️ Fotoğraf Ekleme Butonu */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || isUploadingImage}
              className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50 ${
                selectedImageFile
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
              title="Fotoğraf ekle (Galeri / Kamera)"
            >
              <ImageIcon className="w-4 h-4" />
            </button>

            {/* Metin / Açıklama Inputu */}
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowMentionSuggestions(false);
                }
              }}
              disabled={sending || isUploadingImage}
              placeholder={
                selectedImageFile
                  ? 'Bir açıklama yaz... (isteğe bağlı)'
                  : replyingToMessage
                  ? 'Yanıtınızı yazın...'
                  : conversation?.isGroup
                  ? `${conversation.name || 'Grup'} grubuna mesaj yaz...`
                  : `${displayName} ile mesajlaş...`
              }
              className="flex-1 px-4 py-2.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 disabled:opacity-60"
            />

            {/* Gönder Butonu */}
            <button
              type="submit"
              disabled={(!inputText.trim() && !selectedImageFile) || sending || isUploadingImage}
              className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              {isUploadingImage || sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden sm:inline">
                    {isUploadingImage ? 'Fotoğraf yükleniyor…' : 'Gönderiliyor…'}
                  </span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Gönder</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* 👥 Grup Bilgileri Modalı */}
      {showGroupInfoModal && conversation?.isGroup && (
        <GroupInfoModal
          conversation={conversation}
          currentUser={currentUser}
          allUsers={allUsers}
          badgeUrl={badgeUrl}
          onClose={() => setShowGroupInfoModal(false)}
          onLeftGroup={() => {
            setShowGroupInfoModal(false);
            onBack();
          }}
        />
      )}
    </div>
  );
};
