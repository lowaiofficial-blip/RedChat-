import React, { useState } from 'react';
import { requestPasswordReset } from '../services/passwordResetService';
import {
  Mail,
  Lock,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Send,
} from 'lucide-react';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Lütfen geçerli bir e-posta adresi girin.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await requestPasswordReset(email.trim());
      setSuccessMessage(
        res.message ||
          'Şifre sıfırlama talebiniz RedChat Yönetimi\'ne iletildi. Hesabınız doğrulandıktan sonra sıfırlama bağlantısı tarafınıza gönderilecektir.'
      );
    } catch (err: any) {
      console.error('Password reset request error:', err);
      setError(err?.message || 'Şifre sıfırlama talebi iletilemedi. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetState = () => {
    setEmail('');
    setError(null);
    setSuccessMessage(null);
    onClose();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          handleResetState();
        }
      }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs select-none overflow-y-auto animate-in fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-sm w-full p-5 sm:p-6 shadow-2xl relative my-auto max-h-[calc(100dvh-2rem)] flex flex-col overflow-y-auto animate-in zoom-in-95"
      >
        {/* Kapat Butonu */}
        <button
          type="button"
          onClick={handleResetState}
          disabled={loading}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50 z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {successMessage ? (
          /* Başarılı Talep Gönderim Ekranı */
          <div className="flex flex-col items-center text-center space-y-4 py-3 animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-md shadow-emerald-500/10">
              <ShieldCheck className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-base font-black text-zinc-900 dark:text-zinc-100">
                Talep Yönetime İletildi
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-2 leading-relaxed px-1">
                {successMessage}
              </p>
            </div>

            <div className="w-full p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 text-left space-y-1">
              <span className="font-bold text-zinc-700 dark:text-zinc-200 block">
                Bilgilendirme:
              </span>
              <p>
                Güvenliğiniz için doğrudan otomatik sıfırlama postası gönderilmez. Kimlik teyidinin ardından bağlantı manuel olarak iletilecektir.
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetState}
              className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-600/20 cursor-pointer"
            >
              Giriş Ekranına Dön
            </button>
          </div>
        ) : (
          /* Şifre Sıfırlama Formu */
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <div className="flex items-center gap-2.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  Şifremi Unuttum
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Şifre sıfırlama talebi oluşturun
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Kayıtlı e-posta adresinizi girin. RedChat Yönetimi hesabınızı doğruladıktan sonra gerçek sıfırlama bağlantısını iletecektir.
            </p>

            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1.5">
                Kayıtlı E-posta Adresi
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ornek@email.com"
                  required
                  autoFocus
                  className="w-full text-xs pl-9 pr-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Talebiniz İletiliyor…</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Sıfırlama Talebi Gönder</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
