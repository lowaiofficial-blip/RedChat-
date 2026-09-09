import React, { useState, useEffect } from 'react';
import type { ChatMessage, UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import {
  Check,
  CheckCheck,
  ImageIcon,
  Reply,
  MoreVertical,
  Smile,
  Maximize2,
} from 'lucide-react';

const QUICK_REACTIONS = ['❤️', '👍', '😂', '🔥', '👏'];

export interface ChatMessageItemProps {
  msg: ChatMessage;
  isMe: boolean;
  currentUserUid: string;
  isGroup: boolean;
  isHighlighted: boolean;
  badgeUrl?: string | null;
  senderUser?: UserProfile;
  senderDisplayName: string;
  senderUsername: string;
  senderPhotoURL: string | null;
  isHoveredReaction: boolean;
  isStreaming?: boolean;
  onFinishStreaming?: (messageId: string) => void;
  onOpenProfile: (user: UserProfile) => void;
  onSelectImage: (data: { url: string; caption?: string }) => void;
  onStartReply: (msg: ChatMessage) => void;
  onSelectActionMessage: (msg: ChatMessage) => void;
  onReaction: (msg: ChatMessage, emoji: string) => void;
  onToggleHoverReaction: (msgId: string) => void;
  onScrollToMessage: (messageId: string) => void;
  onTouchStart: (msg: ChatMessage) => void;
  onTouchEnd: () => void;
  onContextMenu: (e: React.MouseEvent, msg: ChatMessage) => void;
  renderMessageText: (text?: string, isMe?: boolean) => React.ReactNode;
  formatMsgTime: (timestamp: any) => string;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo((props) => {
  const {
    msg,
    isMe,
    currentUserUid,
    isGroup,
    isHighlighted,
    badgeUrl,
    senderUser,
    senderDisplayName,
    senderUsername,
    senderPhotoURL,
    isHoveredReaction,
    isStreaming = false,
    onFinishStreaming,
    onOpenProfile,
    onSelectImage,
    onStartReply,
    onSelectActionMessage,
    onReaction,
    onToggleHoverReaction,
    onScrollToMessage,
    onTouchStart,
    onTouchEnd,
    onContextMenu,
    renderMessageText,
    formatMsgTime,
  } = props;

  const fullText = msg.text || '';
  const [displayedLength, setDisplayedLength] = useState(() => (isStreaming ? 0 : fullText.length));
  const [isActivelyStreaming, setIsActivelyStreaming] = useState(isStreaming);

  // Sync isActivelyStreaming when isStreaming prop changes
  useEffect(() => {
    if (isStreaming) {
      setIsActivelyStreaming(true);
      setDisplayedLength(0);
    } else {
      setIsActivelyStreaming(false);
      setDisplayedLength(fullText.length);
    }
  }, [isStreaming, fullText.length]);

  useEffect(() => {
    if (!isActivelyStreaming) return;

    if (displayedLength < fullText.length) {
      // Dynamic speed between 12ms and 34ms per character as requested
      const dynamicSpeed = Math.floor(Math.random() * 23) + 12;
      const timer = setTimeout(() => {
        setDisplayedLength((prev) => prev + 1);
      }, dynamicSpeed);
      return () => clearTimeout(timer);
    } else if (displayedLength >= fullText.length && fullText.length > 0) {
      setIsActivelyStreaming(false);
      if (onFinishStreaming) {
        onFinishStreaming(msg.id);
      }
    }
  }, [isActivelyStreaming, displayedLength, fullText, msg.id, onFinishStreaming]);

  const isDoneStreaming = !isActivelyStreaming;
  const currentText = isActivelyStreaming ? fullText.slice(0, displayedLength) : fullText;

  const hasImage = Boolean(msg.imageUrl);
  const hasText = Boolean(msg.text && msg.text.trim());
  const isRead = msg.isRead || msg.status === 'read';

  return (
    <div
      id={`message-${msg.id}`}
      className={`group relative flex items-end gap-1.5 transition-all duration-300 w-full max-w-full min-w-0 ${
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

      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[calc(100%-2.5rem)] sm:max-w-[420px] min-w-0`}>
        {/* Balon ve Masaüstü Aksiyon Butonları Satırı */}
        <div
          className={`relative flex items-center gap-1 max-w-full min-w-0 ${
            isMe ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          {/* Mesaj Balonu (DOM'da ilk sıra - Avatar ile bitişik) */}
          <div
            onTouchStart={() => onTouchStart(msg)}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchEnd}
            onContextMenu={(e) => onContextMenu(e, msg)}
            style={{
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            className={`relative rounded-2xl text-xs leading-relaxed break-words break-all [overflow-wrap:anywhere] [word-break:break-word] shadow-xs select-none transition-transform active:scale-[0.99] min-w-0 overflow-hidden ${
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
            {isGroup && !isMe && (
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
                  onScrollToMessage(msg.replyTo!.messageId);
                }}
                className={`mb-1.5 p-1.5 rounded-xl text-left cursor-pointer transition-all border-l-4 select-none w-full max-w-full min-w-0 overflow-hidden ${
                  isMe
                    ? 'bg-red-700/50 hover:bg-red-700/70 border-white text-white'
                    : 'bg-zinc-100 dark:bg-zinc-700/60 hover:bg-zinc-200 dark:hover:bg-zinc-700 border-red-600 dark:border-red-500 text-zinc-800 dark:text-zinc-200'
                }`}
                title="Orijinal mesaja git"
              >
                <div className="flex items-center justify-between gap-2 mb-0.5 min-w-0 max-w-full overflow-hidden">
                  <span
                    className={`text-[10px] font-bold truncate min-w-0 max-w-full flex items-center gap-1 ${
                      isMe ? 'text-red-100' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    <Reply className="w-3 h-3 shrink-0" />
                    <span className="truncate min-w-0">
                      {msg.replyTo.senderId === currentUserUid
                        ? 'Siz'
                        : msg.replyTo.senderName || 'Kullanıcı'}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2 min-w-0 max-w-full overflow-hidden">
                  {msg.replyTo.imageUrl && (
                    <img
                      src={msg.replyTo.imageUrl}
                      alt="Yanıtlanan görsel"
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-black/10"
                    />
                  )}
                  <div className="min-w-0 max-w-full flex-1 overflow-hidden">
                    {msg.replyTo.imageUrl && !msg.replyTo.text ? (
                      <span
                        className={`text-[11px] flex items-center gap-1 italic truncate min-w-0 max-w-full ${
                          isMe ? 'text-red-100/80' : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        <ImageIcon className="w-3 h-3 shrink-0" />
                        <span>Fotoğraf</span>
                      </span>
                    ) : msg.replyTo.imageUrl && msg.replyTo.text ? (
                      <div className="text-[11px] flex items-center gap-1 truncate min-w-0 max-w-full">
                        <ImageIcon className="w-3 h-3 shrink-0 opacity-80" />
                        <span className="truncate min-w-0 max-w-full">{msg.replyTo.text.replace(/\s+/g, ' ')}</span>
                      </div>
                    ) : (
                      <p className="text-[11px] truncate break-all [overflow-wrap:anywhere] opacity-90 min-w-0 max-w-full block">
                        {(msg.replyTo.text || 'Bu mesaj artık kullanılamıyor.').replace(/\s+/g, ' ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 🖼️ Fotoğraf İçeriği veya Metin + Saat (Kompakt Tek Akış) */}
            {!hasImage ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 max-w-full min-w-0">
                <div className="whitespace-pre-wrap select-none text-xs leading-relaxed break-words break-all [overflow-wrap:anywhere] [word-break:break-word] flex-1 min-w-0 max-w-full inline">
                  {renderMessageText(currentText, isMe)}
                  {!isDoneStreaming && (
                    <span id="ai-cursor" className="cursor font-semibold text-zinc-900 dark:text-white ml-0.5">
                      |
                    </span>
                  )}
                </div>
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
                    onSelectImage({
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-1 pt-1 max-w-full min-w-0">
                  {hasText && (
                    <span className="whitespace-pre-wrap select-none text-xs leading-relaxed break-words break-all [overflow-wrap:anywhere] [word-break:break-word] flex-1 min-w-0 max-w-full">
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

          {/* Masaüstü Hover Menü Butonları */}
          <div className="hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0 items-center gap-0.5 relative">
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHoverReaction(msg.id);
                }}
                className="p-1 rounded-full text-zinc-400 hover:text-amber-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Tepki Ekle"
              >
                <Smile className="w-3.5 h-3.5" />
              </button>

              {isHoveredReaction && (
                <div
                  className={`absolute bottom-full mb-1 z-30 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-full px-2 py-1 flex items-center gap-1 animate-in zoom-in-90 ${
                    isMe ? 'right-0' : 'left-0'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {QUICK_REACTIONS.map((emoji) => {
                    const userList = msg.reactions?.[emoji] || [];
                    const hasReacted = userList.includes(currentUserUid);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReaction(msg, emoji);
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
              onClick={() => onStartReply(msg)}
              className="p-1 rounded-full text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Yanıtla"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onSelectActionMessage(msg)}
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
                const hasReacted = uids.includes(currentUserUid);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReaction(msg, emoji);
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
});
