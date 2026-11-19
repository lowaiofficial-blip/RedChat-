import React, { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import type { SecuritySession, UserProfile } from '../types';
import { auth } from '../services/firebase';
import {
  verifySecurityChallenge,
  submitOwnerSessionDecision,
  resendSecurityChallenge,
  checkServerMainAdminStatus,
  recoverMainAdminSession,
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
  Mail,
  RefreshCw,
  Shield,
} from 'lucide-react';

interface NewCountrySecurityScreenProps {
  user: UserProfile;
  session: SecuritySession;
  onSessionUpdated: (updated: SecuritySession) => void;
  onEnterAdminSecurityReview?: () => void;
  onLogout: () => Promise<void> | void;
}

export const NewCountrySecurityScreen: React.FC<NewCountrySecurityScreenProps> = ({
  user,
  session,
  onSessionUpdated,
  onEnterAdminSecurityReview,
  onLogout,
}) => {
  const [otpInput, setOtpInput] = useState('');
  const [challengeProof, setChallengeProof] = useState<string | null>(null);
  const [verifyingChallenge, setVerifyingChallenge] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const [submittingChoice, setSubmittingChoice] = useState<'confirmed_me' | 'denied_not_me' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Ana Yönetici güvenli kurtarma & inceleme modu
  const [isServerMainAdmin, setIsServerMainAdmin] = useState(false);
  const [recentReauthValid, setRecentReauthValid] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminReauthLoading, setAdminReauthLoading] = useState(false);
  const [adminRecovering, setAdminRecovering] = useState(false);

  // "Ben Değilim" sonrası hesap kurtarma ve şifre değiştirme durumları
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [revokingAllOthers, setRevokingAllOthers] = useState(false);
  const [revokedAllMessage, setRevokedAllMessage] = useState<string | null>(null);

  const isMobileOrTablet = session.deviceType === 'mobile' || session.deviceType === 'tablet';

  // URL bağlantısında secSession & secToken varsa otomatik tek kullanımlık link doğrulaması yap
  useEffect(() => {
    if (session.status !== 'pending_verification' || challengeProof) return;

    const searchParams = new URLSearchParams(window.location.search);
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
    const hashParams = new URLSearchParams(hashQuery);

    const secSession = searchParams.get('secSession') || hashParams.get('secSession');
    const secToken = searchParams.get('secToken') || hashParams.get('secToken');

    if (secSession === session.sessionId && secToken) {
      setVerifyingChallenge(true);
      setErrorMsg(null);
      verifySecurityChallenge(session.sessionId, { challengeToken: secToken })
        .then((res) => {
          setChallengeProof(res.challengeProof);
          // URL'deki tek kullanımlık token'ı temizle
          window.history.replaceState({}, document.title, window.location.pathname + '#/');
        })
        .catch((err: any) => {
          setErrorMsg(err?.message || 'Doğrulama bağlantısı geçersiz veya süresi dolmuş.');
        })
        .finally(() => {
          setVerifyingChallenge(false);
        });
    }
  }, [session.sessionId, session.status, challengeProof]);

  // Sunucu taraflı Ana Yönetici yetki kontrolü
  useEffect(() => {
    let active = true;
    checkServerMainAdminStatus()
      .then((res) => {
        if (!active) return;
        setIsServerMainAdmin(res.isMainAdmin);
        setRecentReauthValid(res.recentReauthValid);
      })
      .catch(() => {
        if (!active) return;
        setIsServerMainAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [user.uid, session.sessionId]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = otpInput.trim().toUpperCase();
    if (cleanCode.length < 4) {
      setErrorMsg('Lütfen güvenlik bildirimi ile iletilen tek kullanımlık doğrulama kodunu girin.');
      return;
    }

    setVerifyingChallenge(true);
    setErrorMsg(null);
    try {
      const res = await verifySecurityChallenge(session.sessionId, { otpCode: cleanCode });
      setChallengeProof(res.challengeProof);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Doğrulama kodu geçersiz.');
    } finally {
      setVerifyingChallenge(false);
    }
  };

  const handleResendChallenge = async () => {
    if (resendingEmail) return;
    setResendingEmail(true);
    setErrorMsg(null);
    setResendMessage(null);
    try {
      const res = await resendSecurityChallenge(session.sessionId);
      if (res.sent) {
        setResendMessage('Yeni tek kullanımlık doğrulama kodu ve bağlantısı güvenlik e-posta adresine (redchatbusiness@outlook.com) gönderildi.');
      } else {
        setErrorMsg(
          res.error ||
            'Doğrulama e-postası gönderilemedi; oturum güvenliğiniz için kısıtlı modda tutulmaktadır.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kod yeniden gönderilemedi.');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleDecision = async (choice: 'confirmed_me' | 'denied_not_me') => {
    if (submittingChoice || !challengeProof) return;
    setErrorMsg(null);
    setSubmittingChoice(choice);

    try {
      const updated = await submitOwnerSessionDecision(session.sessionId, challengeProof, choice);
      onSessionUpdated(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Güvenlik kararınız işlenemedi. Lütfen tekrar deneyin.');
    } finally {
      setSubmittingChoice(null);
    }
  };

  const handleAdminReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !user.email || !adminPassword) return;
    setAdminReauthLoading(true);
    setErrorMsg(null);
    try {
      const cred = EmailAuthProvider.credential(user.email, adminPassword);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await auth.currentUser.getIdToken(true);
      const status = await checkServerMainAdminStatus();
      setIsServerMainAdmin(status.isMainAdmin);
      setRecentReauthValid(status.recentReauthValid);
      setAdminPassword('');
    } catch (err: any) {
      setErrorMsg(
        err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential'
          ? 'Yönetici şifresi doğrulanamadı.'
          : err?.message || 'Yeniden kimlik doğrulama başarısız.'
      );
    } finally {
      setAdminReauthLoading(false);
    }
  };

  const handleRecoverMainAdminSelf = async () => {
    if (adminRecovering) return;
    setAdminRecovering(true);
    setErrorMsg(null);
    try {
      const updated = await recoverMainAdminSession(
        session.sessionId,
        challengeProof || undefined
      );
      onSessionUpdated(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Yönetici oturumu doğrulanamadı.');
    } finally {
      setAdminRecovering(false);
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

  const emailFailedOrNotConfigured =
    session.emailStatus === 'failed' || session.emailStatus === 'not_configured';

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
      <div className="w-full max-w-md my-auto py-6 space-y-4">
        {session.status === 'pending_verification' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-red-950/60 border border-red-900/50 flex items-center justify-center">
                <ShieldAlert className="w-8 h-8 text-red-500" />
              </div>

              <h1 className="text-2xl font-bold text-white tracking-tight">
                {challengeProof ? 'Bu siz miydiniz?' : 'Oturum Doğrulaması Gerekli'}
              </h1>

              <p className="text-sm text-[#8696a0] leading-relaxed">
                Hesabınızda daha önce doğrulanmamış veya tanınmayan bir cihazdan erişim algılandı.
                <strong className="block text-amber-400 mt-1">
                  Bu oturum henüz doğrulanmadı.
                </strong>
              </p>
            </div>

            {/* Oturum Detayları */}
            <div className="border-t border-b border-zinc-800 py-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Globe className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Konum</span>
                </div>
                <div className="font-semibold text-white text-right">
                  {session.countryName} {session.flagEmoji}
                  {session.city ? ` · ${session.city}` : ''}
                </div>
              </div>

              {session.previousCountryName && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Bilinen son ülke</span>
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
                <span className="text-zinc-300 text-right truncate max-w-[220px]">
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

            {/* E-posta gönderim durumu uyarısı (varsa) */}
            {emailFailedOrNotConfigured ? (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs leading-relaxed space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-400">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>Güvenlik E-postası Gönderilemedi</span>
                </div>
                <p className="text-zinc-300">
                  {session.emailStatus === 'not_configured'
                    ? 'E-posta servisi şu anda yapılandırılmadığı için tek kullanımlık kod iletilemedi.'
                    : `E-posta gönderimi başarısız oldu (${session.emailError || 'Servis hatası'}).`}
                  {' '}Güvenliğiniz için oturum kapalı tutulmaya devam eder; yönetici onayı gereklidir.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 text-xs text-zinc-300 flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Tek kullanımlık doğrulama kodu ve bağlantısı güvenlik bildirim adresine (<span className="font-mono text-zinc-100">redchatbusiness@outlook.com</span>) gönderildi.
                  Karar verebilmek için önce doğrulama adımını tamamlayın.
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-900/60 text-red-300 text-xs flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {resendMessage && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/60 text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <span>{resendMessage}</span>
              </div>
            )}

            {/* Adım 1: E-posta doğrulama kodu/bağlantısı doğrulanmadan karar butonları AÇILMAZ */}
            {!challengeProof ? (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Tek Kullanımlık E-posta Doğrulama Kodu
                  </label>
                  <input
                    id="input-security-otp"
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.toUpperCase())}
                    placeholder="Örn: A7K9P2"
                    maxLength={10}
                    className="w-full px-3.5 py-2.5 text-center font-mono tracking-[0.25em] text-sm uppercase bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="submit"
                    disabled={verifyingChallenge || !otpInput.trim()}
                    className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {verifyingChallenge ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                    )}
                    <span>Kodu Doğrula</span>
                  </button>

                  <button
                    type="button"
                    disabled={resendingEmail}
                    onClick={handleResendChallenge}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {resendingEmail ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>Yeniden Gönder</span>
                  </button>
                </div>
              </form>
            ) : (
              /* Adım 2: Hesap sahibi e-posta ile doğrulandıktan sonra karar butonları açılır */
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>Hesap sahibi doğrulandı. Bu oturumun size ait olup olmadığını seçin:</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    id="btn-owner-confirm-me"
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
                    id="btn-owner-deny-not-me"
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
          </div>
        )}

        {/* Ana Yönetici Özel Güvenli İnceleme & Kurtarma Geçidi (Sadece Ana Yöneticiler İçin) */}
        {isServerMainAdmin && session.status === 'pending_verification' && (
          <div className="bg-zinc-900/95 border border-amber-700/50 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/70 border border-amber-700/60 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-amber-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-white">
                  Ana Yönetici Güvenlik İncelemesi ve Kurtarma
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Ana Yönetici hesabınız tamamen kilitlenmeden şüpheli oturumları inceleyebilir veya
                  yeniden kimlik doğrulaması yaparak bu oturumu güvenli şekilde kurtarabilirsiniz.
                </p>
              </div>
            </div>

            {!recentReauthValid && !challengeProof ? (
              <form onSubmit={handleAdminReauth} className="space-y-2.5">
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Ana Yönetici hesap şifrenizi yeniden girin"
                  className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={adminReauthLoading || !adminPassword}
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {adminReauthLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4 shrink-0" />
                  )}
                  <span>Kimliği Yeniden Doğrula</span>
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {onEnterAdminSecurityReview && (
                  <button
                    type="button"
                    onClick={onEnterAdminSecurityReview}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-700/40 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Güvenlik İnceleme Modu</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={adminRecovering}
                  onClick={handleRecoverMainAdminSelf}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {adminRecovering ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>Bu Oturumu Kurtar</span>
                </button>
              </div>
            )}
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
                Bu oturum yönetici incelemesindedir. Onay verildiğinde erişiminiz otomatik olarak açılacaktır.
              </p>
            </div>
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
                Bu oturum "Ben Değilim" bildiriminiz üzerine güvenlik amacıyla kapatıldı.
                Hesabınızı güvence altına almak için aşağıdaki işlemleri uygulayın.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-900/60 text-red-300 text-xs flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 1. Hesap Kurtarma & Parola Yenileme */}
            <div className="border-t border-zinc-800 pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Parolayı Yenile</span>
              </div>

              <form onSubmit={handlePasswordChange} className="space-y-2.5">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Yeni parolanız (en az 6 karakter)"
                  className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Yeni parola tekrar"
                  className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="submit"
                    disabled={passwordLoading || !newPassword}
                    className="min-h-[42px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Parolayı Güncelle
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

            {/* 2. Diğer Tüm Oturumları Kapat */}
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
