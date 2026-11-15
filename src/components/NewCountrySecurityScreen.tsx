import React, { useState } from 'react';
import { updatePassword } from 'firebase/auth';
import type { SecuritySession, UserProfile } from '../types';
import { auth } from '../services/firebase';
import {
  respondToSuspiciousSession,
  revokeAllOtherUserSessions,
  formatSessionDateTime,
} from '../services/sessionSecurityService';
import { requestPasswordReset } from '../services/passwordResetService';
import {
  ShieldAlert,
  ShieldCheck,
  Globe,
  MapPin,
  Smartphone,
  Monitor,
  LogOut,
  CheckCircle,
  XCircle,
  KeyRound,
  Loader2,
  Lock,
} from 'lucide-react';

interface NewCountrySecurityScreenProps {
  user: UserProfile;
  session: SecuritySession;
  onSessionUpdated: (updated: SecuritySession) => void;
  onLogout: () => Promise<void> | void;
}

export const NewCountrySecurityScreen: React.FC<NewCountrySecurityScreenProps> = ({
  user,
  session,
  onSessionUpdated,
  onLogout,
}) => {
  const [submittingChoice, setSubmittingChoice] = useState<'confirmed_me' | 'denied_not_me' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // "Ben Değilim" sonrası hesap kurtarma ve şifre değiştirme durumları
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [revokingAllOthers, setRevokingAllOthers] = useState(false);
  const [revokedAllMessage, setRevokedAllMessage] = useState<string | null>(null);

  const isMobileOrTablet = session.deviceType === 'mobile' || session.deviceType === 'tablet';

  const handleDecision = async (choice: 'confirmed_me' | 'denied_not_me') => {
    if (submittingChoice) return;
    setErrorMsg(null);
    setSubmittingChoice(choice);

    try {
      const updated = await respondToSuspiciousSession(session.sessionId, choice);
      onSessionUpdated(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Güvenlik yanıtınız iletilemedi. Lütfen tekrar deneyin.');
    } finally {
      setSubmittingChoice(null);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'Yeni şifreniz en az 6 karakter olmalıdır.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Girilen şifreler birbiriyle eşleşmiyor.' });
      return;
    }

    setPasswordLoading(true);
    try {
      if (!auth?.currentUser) {
        throw new Error('Oturum aktif değil.');
      }
      await updatePassword(auth.currentUser, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback({
        type: 'success',
        text: 'Hesap şifreniz başarıyla güncellendi.',
      });
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        setPasswordFeedback({
          type: 'error',
          text: 'Doğrudan şifre güncellemesi için yeniden giriş veya aşağıdaki kurtarma bağlantısı gereklidir.',
        });
      } else {
        setPasswordFeedback({
          type: 'error',
          text: err?.message || 'Şifre güncellenemedi.',
        });
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleRequestRecoveryReset = async () => {
    if (!user.email) return;
    setPasswordLoading(true);
    setPasswordFeedback(null);
    try {
      const res = await requestPasswordReset(user.email);
      setPasswordFeedback({
        type: 'success',
        text: res.message || 'Güvenli şifre sıfırlama talebiniz yönetime iletildi.',
      });
    } catch (err: any) {
      setPasswordFeedback({
        type: 'error',
        text: err?.message || 'Şifre sıfırlama talebi oluşturulamadı.',
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleRevokeAllOthers = async () => {
    if (revokingAllOthers) return;
    setRevokingAllOthers(true);
    setErrorMsg(null);
    try {
      const result = await revokeAllOtherUserSessions(session.sessionId);
      setRevokedAllMessage(
        `Diğer aktif oturumlarınız kapatıldı (${result.revokedCount} oturum sonlandırıldı).`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Diğer oturumlar kapatılırken hata oluştu.');
    } finally {
      setRevokingAllOthers(false);
    }
  };

  return (
    <div
      id="new-country-security-screen"
      className="fixed inset-0 z-[999] bg-[#0c1317] text-[#e9edef] flex flex-col items-center justify-between p-5 sm:p-10 overflow-y-auto antialiased"
    >
      {/* Üst Başlık */}
      <div className="w-full max-w-lg flex items-center justify-center pt-2">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-zinc-300 uppercase">
          {session.status === 'awaiting_admin_approval' ? (
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
          )}
          <span>RedChat Güvenlik Kontrolü</span>
        </div>
      </div>

      {/* Ana İçerik */}
      <div className="w-full max-w-md my-auto py-6">
        {session.status === 'pending_verification' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-red-950/60 border border-red-900/50 flex items-center justify-center">
                <ShieldAlert className="w-8 h-8 text-red-500" />
              </div>

              <h1 className="text-2xl font-bold text-white tracking-tight">
                Bu siz miydiniz?
              </h1>

              <p className="text-sm text-[#8696a0] leading-relaxed">
                Hesabınıza daha önce giriş yapmadığınız bir ülkeden erişim algılandı.
              </p>
            </div>

            {/* Tespit Edilen Ülke ve Oturum Bilgileri (Zero-Pill sade satırlar) */}
            <div className="border-t border-b border-zinc-800 py-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Globe className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Tespit edilen ülke:</span>
                </div>
                <div className="font-semibold text-white text-right">
                  {session.countryName} {session.flagEmoji}
                </div>
              </div>

              {session.previousCountryName && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Önceki bilinen ülke</span>
                  </div>
                  <span className="text-zinc-300">{session.previousCountryName}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-zinc-400">
                  {isMobileOrTablet ? (
                    <Smartphone className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  ) : (
                    <Monitor className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  )}
                  <span>Cihaz ve tarayıcı</span>
                </div>
                <span className="text-zinc-300 text-right truncate max-w-[210px]">
                  {session.browserName} · {session.osName}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-zinc-400">Oturum zamanı</span>
                <span className="text-zinc-300 font-mono tabular-nums">
                  {formatSessionDateTime(session.createdAt)}
                </span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-zinc-300 text-center font-medium">
              Bu oturumun size ait olup olmadığını belirtin.
            </p>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-900/60 text-red-300 text-xs flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={Boolean(submittingChoice)}
                onClick={() => handleDecision('confirmed_me')}
                className="min-h-[46px] px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {submittingChoice === 'confirmed_me' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 shrink-0" />
                )}
                <span>Bu Benim</span>
              </button>

              <button
                type="button"
                disabled={Boolean(submittingChoice)}
                onClick={() => handleDecision('denied_not_me')}
                className="min-h-[46px] px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {submittingChoice === 'denied_not_me' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>Ben Değilim</span>
              </button>
            </div>
          </div>
        )}

        {session.status === 'awaiting_admin_approval' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-950/60 border border-amber-800/50 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-amber-400" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-white tracking-tight">
                Admin Onayı Bekleniyor
              </h1>
              <p className="text-sm text-[#8696a0] leading-relaxed">
                Girişin size ait olduğuna dair onay bilginiz RedChat yönetimine iletildi.
                Güvenlik nedeniyle bu oturum yönetici onaylayana kadar sohbetlere erişemezsiniz.
              </p>
            </div>

            <div className="border-t border-b border-zinc-800 py-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Tespit edilen ülke</span>
                <span className="text-zinc-200 font-semibold">
                  {session.countryName} {session.flagEmoji}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Bildirilen yanıt</span>
                <span className="text-emerald-400 font-semibold">Bu Benim</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Oturum durumu</span>
                <span className="text-amber-400 font-semibold">İncelemede</span>
              </div>
            </div>

            <p className="text-xs text-zinc-500">
              Yönetici oturuma izin verdiğinde bu ekran otomatik olarak açılacaktır.
            </p>
          </div>
        )}

        {session.status === 'revoked' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-5">
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="w-14 h-14 rounded-2xl bg-red-950/70 border border-red-900/60 flex items-center justify-center">
                <Lock className="w-7 h-7 text-red-500" />
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Şüpheli Oturum İptal Edildi
              </h1>
              <p className="text-xs sm:text-sm text-[#8696a0] leading-relaxed">
                Bu oturum erişime kapatıldı ve RedChat yönetimine acil bildirim iletildi.
                Hesabınızı güvence altına almak için aşağıdaki adımları kullanabilirsiniz.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-900/60 text-red-300 text-xs flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 1. Hesap Kurtarma & Şifre Değiştirme */}
            <div className="border-t border-zinc-800 pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Hesap Kurtarma ve Şifre Değiştirme</span>
              </div>

              <form onSubmit={handlePasswordChange} className="space-y-2.5">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Yeni şifreniz (en az 6 karakter)"
                  className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Yeni şifre tekrar"
                  className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="submit"
                    disabled={passwordLoading || !newPassword}
                    className="min-h-[42px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Şifreyi Güncelle
                  </button>
                  <button
                    type="button"
                    disabled={passwordLoading}
                    onClick={handleRequestRecoveryReset}
                    className="min-h-[42px] px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Kurtarma Bağlantısı İste
                  </button>
                </div>
              </form>

              {passwordFeedback && (
                <div
                  className={`p-2.5 rounded-xl text-xs border ${
                    passwordFeedback.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-300'
                      : 'bg-red-950/40 border-red-900/50 text-red-300'
                  }`}
                >
                  {passwordFeedback.text}
                </div>
              )}
            </div>

            {/* 2. İsteğe Bağlı Tek Tıkla Diğer Tüm Oturumları Kapat */}
            <div className="border-t border-zinc-800 pt-4 space-y-2.5">
              <button
                type="button"
                disabled={revokingAllOthers || Boolean(revokedAllMessage)}
                onClick={handleRevokeAllOthers}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/70 disabled:opacity-60 border border-red-900/60 text-red-300 text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {revokingAllOthers ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                <span>Diğer Tüm Oturumları Kapat</span>
              </button>
              {revokedAllMessage && (
                <p className="text-xs text-emerald-400 text-center">{revokedAllMessage}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Alt Çıkış Butonu */}
      <div className="w-full max-w-md pb-2">
        <button
          type="button"
          onClick={onLogout}
          className="w-full min-h-[46px] px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0 text-zinc-400" />
          <span>Güvenli Çıkış Yap</span>
        </button>
      </div>
    </div>
  );
};
