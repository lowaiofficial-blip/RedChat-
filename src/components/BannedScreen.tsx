import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { formatRemainingTime, toTimestampMs } from '../services/moderationService';
import { LogOut, RotateCw, ShieldAlert, Clock } from 'lucide-react';

interface BannedScreenProps {
  user: UserProfile;
  onCheckExpiry?: () => Promise<void> | void;
  onLogout: () => void;
}

export const BannedScreen: React.FC<BannedScreenProps> = ({ user, onCheckExpiry, onLogout }) => {
  const [checking, setChecking] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const autoCheckedRef = React.useRef(false);
  const onCheckExpiryRef = React.useRef(onCheckExpiry);
  onCheckExpiryRef.current = onCheckExpiry;

  const isTemporaryBan = user.banType === 'temporary' && Boolean(user.banExpiresAt);
  const banExpiresMs = isTemporaryBan ? toTimestampMs(user.banExpiresAt) : 0;

  useEffect(() => {
    if (!isTemporaryBan || banExpiresMs <= 0) return;

    const tick = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= banExpiresMs && !autoCheckedRef.current) {
        autoCheckedRef.current = true;
        onCheckExpiryRef.current?.();
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [isTemporaryBan, banExpiresMs]);

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await onCheckExpiry?.();
    } catch {
      // Ignore transient error before reload
    }
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  return (
    <div
      id="banned-screen-container"
      className="fixed inset-0 z-[999] bg-[#0c1317] text-[#e9edef] flex flex-col items-center justify-between p-6 sm:p-10 select-none overflow-y-auto"
    >
      {/* Üst Boşluk & Küçük Logo */}
      <div className="w-full flex items-center justify-center pt-4">
        <div className="flex items-center gap-2 text-zinc-400 text-xs font-semibold tracking-wider uppercase">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>RedChat Güvenlik Sistemi</span>
        </div>
      </div>

      {/* Orta Görsel & Metin Alanı */}
      <div className="flex flex-col items-center text-center max-w-md my-auto py-8">
        <div className="relative mb-8">
          <div className="w-32 h-32 rounded-full bg-[#0d3329]/90 border border-[#1b4d40]/40 flex items-center justify-center shadow-2xl">
            <div className="w-14 h-22 rounded-xl border-[3px] border-[#00a884] bg-[#0c1f1b] flex flex-col items-center justify-center p-1.5 shadow-inner relative">
              <div className="w-4 h-0.5 bg-[#00a884]/60 rounded-full mb-2" />
              <div className="w-6 h-6 rounded-full bg-[#00a884] mb-1 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-[#0c1f1b]" />
              </div>
              <div className="w-8 h-3 rounded-t-full bg-[#00a884]" />
            </div>
          </div>

          <div className="absolute -bottom-1 -right-1 w-12 h-12 rounded-full bg-[#ea0038] border-4 border-[#0c1317] flex items-center justify-center shadow-xl">
            <svg
              className="w-6 h-6 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl sm:text-[26px] font-bold text-white tracking-tight mb-4 leading-snug">
          {isTemporaryBan ? 'Hesabınız geçici olarak askıya alındı' : "Bu hesap RedChat'i kullanamaz"}
        </h1>

        <p className="text-[15px] sm:text-base text-[#8696a0] leading-relaxed max-w-sm mb-6">
          {isTemporaryBan
            ? 'Hesabınız moderasyon ekibi tarafından geçici olarak kısıtlandı. Süre dolduğunda erişiminiz otomatik olarak yeniden açılacaktır.'
            : "Gözden geçirme işlemimizi tamamladık ve bu hesaba ait hareketlerin RedChat'in hizmet koşullarına aykırı olduğunu belirledik."}
        </p>

        {isTemporaryBan && banExpiresMs > 0 && (
          <div className="w-full max-w-xs mb-5 p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 text-amber-300 space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wide">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Kalan Süre: {formatRemainingTime(banExpiresMs, nowMs)}</span>
            </div>
            <div className="text-[11px] text-amber-400/80">
              Bitiş: {new Date(banExpiresMs).toLocaleString('tr-TR')}
            </div>
          </div>
        )}

        {user.banReason && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-950/40 border border-red-900/40 text-red-400 text-xs font-medium mb-6">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Sebep: {user.banReason}</span>
          </div>
        )}

        <div className="text-xs text-zinc-500 max-w-xs leading-normal">
          Hesabınızın yanlışlıkla askıya alındığını düşünüyorsanız lütfen platform yöneticisi ile iletişime geçin.
        </div>
      </div>

      {/* Alt Butonlar */}
      <div className="w-full max-w-sm flex flex-col sm:flex-row items-center justify-center gap-3 pb-4">
        <button
          onClick={handleRefresh}
          disabled={checking}
          className="w-full sm:w-auto flex-1 px-5 py-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-[#e9edef] font-medium text-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-zinc-700/60"
        >
          <RotateCw className={`w-4 h-4 ${checking ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Durumu Kontrol Et</span>
        </button>

        <button
          onClick={onLogout}
          className="w-full sm:w-auto flex-1 px-5 py-3 rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-all shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
        >
          <LogOut className="w-4 h-4" />
          <span>Çıkış Yap</span>
        </button>
      </div>
    </div>
  );
};
