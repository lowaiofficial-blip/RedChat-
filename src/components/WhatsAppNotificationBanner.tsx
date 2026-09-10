import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, X, MessageSquare, ArrowRight } from 'lucide-react';
import type { GroupedNotificationData } from '../types';

interface WhatsAppNotificationBannerProps {
  notification: GroupedNotificationData | null;
  onOpenChat: (conversationId: string) => void;
  onDismiss: () => void;
}

// Zarif WhatsApp tarzı hafif bildirim sesi (Web Audio API - harici dosya indirme gerektirmez)
function playWhatsAppChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    // Çift tonlu yumuşak bildirim sinyali
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now); // E5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1318.51, now + 0.08); // E6

    gainNode.gain.setValueAtTime(0.08, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.08);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);
  } catch {
    // Ses çalınamazsa sessizce devam et
  }
}

export const WhatsAppNotificationBanner: React.FC<WhatsAppNotificationBannerProps> = ({
  notification,
  onOpenChat,
  onDismiss,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const lastPlayedAtRef = useRef<number>(0);

  // Yeni bildirim veya yeni mesaj geldiğinde hafif chime çal
  useEffect(() => {
    if (notification && notification.messages.length > 0) {
      const now = Date.now();
      if (now - lastPlayedAtRef.current > 1000) {
        lastPlayedAtRef.current = now;
        playWhatsAppChime();
      }
    }
  }, [notification?.updatedAt, notification?.messages.length]);

  // Otomatik kapanma sayacı (Genişletildiğinde veya üzerine gelindiğinde duraklar)
  useEffect(() => {
    if (!notification) return;
    if (isHovered || isExpanded) return;

    const timeout = setTimeout(() => {
      onDismiss();
    }, 7500);

    return () => clearTimeout(timeout);
  }, [notification, isHovered, isExpanded, onDismiss]);

  if (!notification) return null;

  const { conversationId, senderName, senderPhoto, isGroup, groupName, messages } = notification;
  const count = messages.length;
  const primaryMessage = messages[messages.length - 1] || { text: 'Yeni mesaj', time: '' };
  const firstMessage = messages[0] || primaryMessage;
  const displayName = isGroup && groupName ? groupName : senderName;

  return (
    <AnimatePresence>
      <motion.div
        key={conversationId}
        initial={{ opacity: 0, y: -28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onOpenChat(conversationId)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-md cursor-pointer select-none"
        role="alert"
        aria-live="assertive"
      >
        <div className="relative overflow-hidden rounded-2xl bg-[#202c33]/95 dark:bg-[#1f2c34]/95 text-zinc-100 border border-emerald-500/30 shadow-2xl backdrop-blur-xl p-3.5 transition-all duration-200 hover:border-emerald-500/50">
          {/* Üst Satır: Avatar, İsim, Rozet, Açma/Kapama Oku ve Kapat Butonu */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Profil / Grup Fotoğrafı */}
              <div className="relative flex-shrink-0">
                {senderPhoto ? (
                  <img
                    src={senderPhoto}
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover border border-emerald-500/40"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-bold text-sm border border-emerald-400/30 shadow-sm">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                {/* WhatsApp tarzı yeşil minik durum noktası */}
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#202c33]" />
              </div>

              {/* İsim ve Başlık */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-sm text-zinc-100 truncate">
                    {displayName}
                  </span>
                  {count > 1 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
                      {count} yeni mesaj
                    </span>
                  )}
                </div>
                {isGroup && senderName && (
                  <p className="text-[11px] text-zinc-400 truncate">
                    {senderName}
                  </p>
                )}
              </div>
            </div>

            {/* Sağ Kontroller: Aşağı Bakan Ok (< / v) ve Kapat (X) */}
            <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              {/* 🟢 Kullanıcının istediği: "aşağı bakan <" (Açınca tüm mesajları gösteren ok) */}
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className={`p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-white/10 active:scale-95 transition-all duration-200 flex items-center gap-0.5 ${
                  isExpanded ? 'text-emerald-400 bg-emerald-500/10' : ''
                }`}
                title={isExpanded ? 'Mesajları daralt' : 'Tüm mesajları aç'}
                aria-label={isExpanded ? 'Mesajları daralt' : 'Tüm mesajları aç'}
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-300 ${
                    isExpanded ? 'rotate-180 text-emerald-400' : 'text-zinc-300'
                  }`}
                />
              </button>

              {/* Bildirimi Kapat */}
              <button
                type="button"
                onClick={onDismiss}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 active:scale-95 transition-all duration-150"
                title="Kapat"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 💬 Daraltılmış Görünüm: Tek satır mesaj + sağında saati */}
          {!isExpanded && (
            <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-zinc-200 truncate font-normal">
                  {count > 1 ? firstMessage.text : primaryMessage.text}
                </span>
                {count > 1 && (
                  <span className="text-[11px] text-emerald-400/90 font-medium whitespace-nowrap">
                    +{count - 1} daha
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0">
                {primaryMessage.time}
              </span>
            </div>
          )}

          {/* 📂 Genişletilmiş Görünüm: "Aşağı baki açınca öbür kullanıcının yazdığı bütün mesajlar gözükcek" */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-2.5 border-t border-white/10 space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {messages.map((msg, idx) => (
                    <div
                      key={msg.id || idx}
                      className="flex items-baseline justify-between gap-3 text-xs bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-xl border border-white/5 transition-colors"
                    >
                      <span className="text-zinc-100 break-words flex-1 leading-snug">
                        {msg.text}
                      </span>
                      {/* WhatsApp gibi yanındaki saat */}
                      <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0 select-none">
                        {msg.time}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Alt Aksiyon Butonu */}
                <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-xs text-emerald-400 font-medium">
                  <span className="text-[11px] text-zinc-400">
                    Sohbete gitmek için tıklayın
                  </span>
                  <div className="flex items-center gap-1 hover:underline">
                    <span>Sohbeti Aç</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
