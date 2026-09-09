import React, { useState } from 'react';
import {
  registerWithEmailAndUsername,
  loginWithEmail,
  validateUsername,
  isUsernameTaken,
} from '../services/authService';
import {
  User,
  AtSign,
  Mail,
  Lock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Flame,
  ArrowRight,
} from 'lucide-react';

interface AuthCardProps {
  onAuthSuccess: () => void;
}

export const AuthCard: React.FC<AuthCardProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  const handleUsernameBlur = async () => {
    if (isLogin || !username.trim()) {
      setUsernameAvailable(null);
      return;
    }
    const validation = validateUsername(username);
    if (!validation.valid) {
      setError(validation.error || 'Geçersiz kullanıcı adı');
      setUsernameAvailable(false);
      return;
    }

    setUsernameChecking(true);
    setError(null);
    try {
      const taken = await isUsernameTaken(username);
      setUsernameAvailable(!taken);
      if (taken) {
        setError(`@${username} kullanıcı adı zaten alınmış.`);
      }
    } catch (err: any) {
      console.error('Username check error:', err);
    } finally {
      setUsernameChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        if (!email.trim() || !password) {
          throw new Error('Lütfen e-posta ve şifrenizi girin.');
        }
        await loginWithEmail(email, password);
        onAuthSuccess();
      } else {
        if (!username.trim() || !email.trim() || !password) {
          throw new Error('Lütfen tüm alanları doldurun.');
        }
        if (password.length < 6) {
          throw new Error('Şifreniz en az 6 karakter olmalıdır.');
        }
        
        await registerWithEmailAndUsername({
          email,
          password,
          username,
          displayName: displayName.trim() || username.trim(),
        });

        onAuthSuccess();
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = err?.message || 'Bir hata oluştu.';
      if (msg.includes('auth/email-already-in-use')) {
        msg = 'Bu e-posta adresi ile zaten bir hesap bulunuyor.';
      } else if (msg.includes('auth/invalid-email')) {
        msg = 'Lütfen geçerli bir e-posta adresi girin.';
      } else if (msg.includes('auth/wrong-password') || msg.includes('auth/invalid-credential')) {
        msg = 'E-posta veya şifre hatalı.';
      } else if (msg.includes('auth/user-not-found')) {
        msg = 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.';
      } else if (msg.includes('auth/weak-password')) {
        msg = 'Şifre çok zayıf. En az 6 karakter olmalı.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="auth-card" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-8 shadow-xl max-w-md w-full mx-auto">
      {/* Brand & Title Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-red-600 to-red-500 text-white shadow-lg shadow-red-600/25 mb-4">
          <Flame className="w-8 h-8 fill-white" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
          {isLogin ? 'RedChat’e Giriş Yap' : 'RedChat’e katıl'}
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {isLogin ? 'Sohbetlerine kaldığın yerden devam et.' : 'Arkadaşlarınla sohbet etmeye başla.'}
        </p>
      </div>

      {/* Feedback Alert */}
      {error && (
        <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/50 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isLogin && (
          <>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Görünen ad
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                <input
                  id="input-displayname"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Adın"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Kullanıcı adı
                </label>
                {usernameChecking && (
                  <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-red-500" /> Kontrol ediliyor...
                  </span>
                )}
                {usernameAvailable === true && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Uygun
                  </span>
                )}
              </div>
              <div className="relative">
                <AtSign className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                <input
                  id="input-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                    setUsernameAvailable(null);
                  }}
                  onBlur={handleUsernameBlur}
                  placeholder="Bir kullanıcı adı seç"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs font-mono border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
            E-posta
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
            <input
              id="input-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-posta adresin"
              className="w-full pl-10 pr-3.5 py-2.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
            Şifre
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
            <input
              id="input-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifren"
              className="w-full pl-10 pr-3.5 py-2.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          id="auth-submit-btn"
          disabled={loading}
          className="w-full mt-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md shadow-red-600/20 cursor-pointer disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Lütfen bekleyin...</span>
            </>
          ) : (
            <>
              <span>{isLogin ? 'Giriş Yap' : 'Kayıt Ol'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Switch Form Action */}
      <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800 text-center">
        {isLogin ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hesabın yok mu?{' '}
            <button
              type="button"
              onClick={() => {
                setIsLogin(false);
                setError(null);
              }}
              className="text-red-600 hover:text-red-700 font-bold hover:underline cursor-pointer"
            >
              Kayıt Ol
            </button>
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Zaten hesabın var mı?{' '}
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                setError(null);
              }}
              className="text-red-600 hover:text-red-700 font-bold hover:underline cursor-pointer"
            >
              Giriş Yap
            </button>
          </p>
        )}
      </div>
    </div>
  );
};
