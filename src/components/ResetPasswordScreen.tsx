import React, { useState, useEffect } from 'react';
import { verifyResetCode, confirmResetPassword } from '../services/passwordResetService';
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  ShieldCheck,
  Flame,
  ArrowRight,
} from 'lucide-react';

interface ResetPasswordScreenProps {
  oobCode: string;
  emailParam?: string | null;
  onNavigateToLogin: () => void;
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({
  oobCode,
  emailParam,
  onNavigateToLogin,
}) => {
  const [email, setEmail] = useState<string>(emailParam || '');
  const [verifyingCode, setVerifyingCode] = useState(true);
  const [codeValid, setCodeValid] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Form State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // oobCode doğrulaması
  useEffect(() => {
    if (!oobCode) {
      setCodeError('Geçersiz veya eksik şifre sıfırlama kodu.');
      setVerifyingCode(false);
      return;
    }

    const checkCode = async () => {
      try {
        setVerifyingCode(true);
        const verifiedEmail = await verifyResetCode(oobCode);
        setEmail(verifiedEmail);
        setCodeValid(true);
        setCodeError(null);
      } catch (err: any) {
        console.error('Verify reset code error:', err);
        setCodeValid(false);
        setCodeError(
          'Bu şifre sıfırlama bağlantısının süresi dolmuş, geçersiz veya zaten kullanılmış.'
        );
      } finally {
        setVerifyingCode(false);
      }
    };

    checkCode();
  }, [oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (newPassword.length < 6) {
      setFormError('Yeni şifreniz en az 6 karakter olmalıdır.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Şifreler birbiriyle eşleşmiyor.');
      return;
    }

    setSaving(true);
    try {
      await confirmResetPassword(oobCode, newPassword);
      setSuccess(true);
    } catch (err: any) {
      console.error('Confirm password reset error:', err);
      setFormError(err?.message || 'Şifre güncellenemedi. Bağlantı süresi dolmuş olabilir.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 selection:bg-red-500 selection:text-white relative overflow-hidden">
      {/* Background Decorative Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10 animate-in fade-in zoom-in-95">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-600/30 mb-3">
            <Flame className="w-7 h-7 fill-white" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-zinc-100 flex items-center gap-1.5">
            <span>REDCHAT</span>
            <span className="text-red-500">.</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">Güvenli Şifre Sıfırlama</p>
        </div>

        {verifyingCode ? (
          <div className="flex flex-col items-center text-center py-8 space-y-3">
            <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
            <p className="text-xs text-zinc-400 font-medium">
              Şifre sıfırlama bağlantısı doğrulanıyor…
            </p>
          </div>
        ) : codeError ? (
          <div className="flex flex-col items-center text-center py-4 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-800/60 text-rose-400 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">Bağlantı Geçersiz</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed px-2">
                {codeError}
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
            >
              Giriş Ekranına Dön
            </button>
          </div>
        ) : success ? (
          <div className="flex flex-col items-center text-center py-4 space-y-4 animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-lg font-black text-zinc-100">Şifren başarıyla güncellendi.</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Yeni şifreniz ile hesabınıza hemen giriş yapabilirsiniz.
              </p>
            </div>

            <button
              type="button"
              onClick={onNavigateToLogin}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Giriş Yap</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="pb-1 border-b border-zinc-800 text-center">
              <h2 className="text-lg font-extrabold text-zinc-100">Şifreni Yenile</h2>
              {email && (
                <p className="text-xs font-mono text-zinc-400 mt-1 truncate">
                  {email}
                </p>
              )}
            </div>

            {formError && (
              <div className="p-3 bg-rose-950/40 border border-rose-900/60 text-rose-400 text-xs rounded-xl flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Yeni Şifre */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                Yeni Şifre
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="En az 6 karakter"
                  required
                  autoFocus
                  className="w-full text-xs pl-9 pr-10 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Yeni Şifre Tekrar */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                Yeni Şifre Tekrar
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Yeni şifrenizi tekrar girin"
                  required
                  className="w-full text-xs pl-9 pr-10 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !newPassword || !confirmPassword}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Şifre Güncelleniyor…</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Şifreyi Güncelle</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
