import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import {
  applyModerationMute,
  liftModerationMute,
  applyModerationBan,
  liftModerationBan,
  formatRemainingTime,
} from '../services/moderationService';
import { X, Ban, VolumeX, Volume2, ShieldCheck, Clock, Loader2, AlertTriangle } from 'lucide-react';

interface ModerationActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: UserProfile | null;
  mode: 'mute' | 'unmute' | 'ban' | 'unban';
  isMainAdmin: boolean;
  onSuccess: (updatedFields: Partial<UserProfile>, message: string) => void;
}

const DURATION_PRESETS = [
  { label: '15 Dk', minutes: 15 },
  { label: '1 Saat', minutes: 60 },
  { label: '6 Saat', minutes: 360 },
  { label: '24 Saat', minutes: 1440 },
  { label: '7 Gün', minutes: 10080 },
];

export const ModerationActionModal: React.FC<ModerationActionModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  mode,
  isMainAdmin,
  onSuccess,
}) => {
  const [penaltyType, setPenaltyType] = useState<'temporary' | 'permanent'>('temporary');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [customMinutes, setCustomMinutes] = useState<string>('60');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPenaltyType('temporary');
      setDurationMinutes(60);
      setCustomMinutes('60');
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, mode, targetUser?.uid]);

  if (!isOpen || !targetUser) return null;

  const isApply = mode === 'mute' || mode === 'ban';
  const isBanAction = mode === 'ban' || mode === 'unban';

  const effectiveType: 'temporary' | 'permanent' = isMainAdmin ? penaltyType : 'temporary';

  const handleSelectPreset = (mins: number) => {
    setPenaltyType('temporary');
    setDurationMinutes(mins);
    setCustomMinutes(String(mins));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const cleanReason = reason.trim();
    if (isApply && cleanReason.length < 3) {
      setError('Lütfen en az 3 karakterlik geçerli bir moderasyon sebebi girin.');
      return;
    }

    const parsedMins = Math.round(Number(customMinutes));
    if (isApply && effectiveType === 'temporary' && (!Number.isFinite(parsedMins) || parsedMins < 1 || parsedMins > 43200)) {
      setError('Geçici işlem süresi 1 ile 43200 dakika (30 gün) arasında olmalıdır.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const targetDisplay = targetUser.displayName || targetUser.username || targetUser.uid;
      if (mode === 'mute') {
        const res = await applyModerationMute({
          targetUid: targetUser.uid,
          reason: cleanReason,
          muteType: effectiveType,
          durationMinutes: effectiveType === 'temporary' ? parsedMins : undefined,
        });
        onSuccess(
          {
            isMuted: true,
            muteReason: cleanReason,
            muteType: effectiveType,
            muteExpiresAt: res.endsAt || null,
          },
          `✓ ${targetDisplay} ${effectiveType === 'temporary' ? `${parsedMins} dakika` : 'kalıcı olarak'} susturuldu.`
        );
      } else if (mode === 'unmute') {
        await liftModerationMute(targetUser.uid, cleanReason || 'Susturma kaldırıldı');
        onSuccess(
          {
            isMuted: false,
            muteReason: null,
            muteType: null,
            muteExpiresAt: null,
            mutedByUid: null,
          },
          `✓ ${targetDisplay} kullanıcısının susturması kaldırıldı.`
        );
      } else if (mode === 'ban') {
        const res = await applyModerationBan({
          targetUid: targetUser.uid,
          reason: cleanReason,
          banType: effectiveType,
          durationMinutes: effectiveType === 'temporary' ? parsedMins : undefined,
        });
        onSuccess(
          {
            isBanned: true,
            banReason: cleanReason,
            banType: effectiveType,
            banExpiresAt: res.endsAt || null,
            isOnline: false,
          },
          `✓ ${targetDisplay} ${effectiveType === 'temporary' ? `${parsedMins} dakika geçici olarak` : 'kalıcı olarak'} banlandı.`
        );
      } else if (mode === 'unban') {
        await liftModerationBan(targetUser.uid, cleanReason || 'Ban kaldırıldı');
        onSuccess(
          {
            isBanned: false,
            banReason: null,
            banType: null,
            banExpiresAt: null,
            bannedByUid: null,
          },
          `✓ ${targetDisplay} kullanıcısının banı kaldırıldı.`
        );
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Moderasyon işlemi tamamlanamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={() => !submitting && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-md p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                mode === 'ban'
                  ? 'bg-red-500/10 border-red-500/20 text-red-600'
                  : mode === 'mute'
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
              }`}
            >
              {mode === 'ban' ? (
                <Ban className="w-5 h-5" />
              ) : mode === 'mute' ? (
                <VolumeX className="w-5 h-5" />
              ) : mode === 'unmute' ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {mode === 'mute'
                  ? 'Kullanıcıyı Sustur'
                  : mode === 'unmute'
                  ? 'Susturmayı Kaldır'
                  : mode === 'ban'
                  ? 'Kullanıcıyı Banla'
                  : 'Banı Kaldır'}
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono truncate">
                @{targetUser.username} • {targetUser.displayName || targetUser.username}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isMainAdmin && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-300 font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 shrink-0" />
            <span>
              Moderatör yetkisi ile yalnızca <strong>geçici (süreli)</strong> {isBanAction ? 'ban' : 'susturma'} işlemleri yapılabilir; süre bitiminde ceza otomatik kaldırılır.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {isApply && (
            <>
              {isMainAdmin && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPenaltyType('temporary')}
                    className={`py-2 rounded-lg font-bold transition-all cursor-pointer ${
                      penaltyType === 'temporary'
                        ? 'bg-white dark:bg-zinc-900 text-amber-600 dark:text-amber-400 shadow-xs'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Geçici (Süreli)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPenaltyType('permanent')}
                    className={`py-2 rounded-lg font-bold transition-all cursor-pointer ${
                      penaltyType === 'permanent'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Kalıcı (Süresiz)
                  </button>
                </div>
              )}

              {effectiveType === 'temporary' && (
                <div className="space-y-2">
                  <label className="block font-semibold text-zinc-700 dark:text-zinc-300">
                    Süre Seçin
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {DURATION_PRESETS.map((preset) => (
                      <button
                        key={preset.minutes}
                        type="button"
                        onClick={() => handleSelectPreset(preset.minutes)}
                        className={`py-1.5 px-1 rounded-xl font-bold border text-[11px] transition-all cursor-pointer ${
                          durationMinutes === preset.minutes && customMinutes === String(preset.minutes)
                            ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                            : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-amber-500'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="number"
                      min={1}
                      max={43200}
                      value={customMinutes}
                      onChange={(e) => {
                        setCustomMinutes(e.target.value);
                        const num = Number(e.target.value);
                        if (Number.isFinite(num)) setDurationMinutes(num);
                      }}
                      className="w-28 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                    <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                      dakika (1 – 43200 dk)
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {!isApply && (targetUser.banExpiresAt || targetUser.muteExpiresAt) && (
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300">
              {mode === 'unban' && targetUser.banType === 'temporary' && targetUser.banExpiresAt ? (
                <span>
                  Mevcut geçici ban kalan süresi: <strong>{formatRemainingTime(targetUser.banExpiresAt)}</strong>
                </span>
              ) : mode === 'unmute' && targetUser.muteType === 'temporary' && targetUser.muteExpiresAt ? (
                <span>
                  Mevcut geçici susturma kalan süresi: <strong>{formatRemainingTime(targetUser.muteExpiresAt)}</strong>
                </span>
              ) : (
                <span>Mevcut kısıtlamayı kaldırmak istediğinize emin misiniz?</span>
              )}
            </div>
          )}

          <div>
            <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Sebep {isApply ? <span className="text-red-500">*</span> : '(İsteğe bağlı)'}
            </label>
            <textarea
              rows={2}
              maxLength={400}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder={
                isApply
                  ? 'Moderasyon kaydına işlenecek gerekçeyi yazın...'
                  : 'Kaldırma sebebi (isteğe bağlı)...'
              }
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={submitting || (isApply && reason.trim().length < 3)}
              className={`px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                mode === 'ban'
                  ? 'bg-red-600 hover:bg-red-700'
                  : mode === 'mute'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Onayla ve Uygula</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
