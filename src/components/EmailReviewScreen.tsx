import React, { useState } from 'react';
import type { UserProfile } from '../types';
import { LogOut, RotateCw, ShieldAlert, Mail, Headphones } from 'lucide-react';

interface EmailReviewScreenProps {
  user: UserProfile;
  onLogout: () => void;
}

export const EmailReviewScreen: React.FC<EmailReviewScreenProps> = ({ user, onLogout }) => {
  const [checking, setChecking] = useState(false);

  const handleRefresh = () => {
    setChecking(true);
    setTimeout(() => {
      window.location.reload();
    }, 600);
  };

  const handleSupportClick = () => {
    const email = 'redchatbusiness@outlook.com';
    const subject = encodeURIComponent('RedChat Hesap İncelemesi');
    const body = encodeURIComponent(
      `Merhaba RedChat Destek Ekibi,\n\nHesabım (${user.displayName || user.username} - @${user.username} - ${user.email}) manuel e-posta incelemesine alınmıştır.\n\nKonu hakkında bilgilendirme ve doğrulama yapılmasını rica ederim.\n\nKullanıcı ID (UID): ${user.uid}`
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  };

  return (
    <div
      id="email-review-screen-container"
      className="fixed inset-0 z-[999] bg-[#0c1317] text-[#e9edef] flex flex-col items-center justify-between p-6 sm:p-10 select-none overflow-y-auto"
    >
      {/* Üst Logo & Güvenlik Bildirimi Rozeti */}
      <div className="w-full flex items-center justify-center pt-4">
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold tracking-wider uppercase">
          <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
          <span>RedChat Güvenlik Bildirimi</span>
        </div>
      </div>

      {/* Orta İçerik Kartı */}
      <div className="flex flex-col items-center text-center max-w-md my-auto py-8">
        {/* Soft İllüstrasyon / İkon Zemin */}
        <div className="relative mb-8">
          <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-amber-950/40 border border-amber-800/40 flex items-center justify-center shadow-2xl shadow-amber-950/50">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center backdrop-blur-md">
              <Mail className="w-10 h-10 sm:w-12 sm:h-12 text-amber-400 shrink-0" />
            </div>
          </div>
          <div className="absolute -bottom-1 -right-1 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-amber-500 border-4 border-[#0c1317] flex items-center justify-center shadow-xl">
            <ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6 text-[#0c1317]" />
          </div>
        </div>

        {/* Ana Başlık */}
        <h1 className="text-2xl sm:text-[26px] font-bold text-white tracking-tight mb-3 leading-snug">
          Hesabınız incelemeye alındı!
        </h1>

        {/* Açıklama Metni */}
        <div className="space-y-3 text-[14px] sm:text-[15px] text-[#8696a0] leading-relaxed max-w-sm mb-6 text-center">
          <p>
            Hesabınızın otomatik veya şüpheli bir hesap olabileceğine dair bazı işaretler tespit ettik.
          </p>
          <p>
            Kayıt sırasında kullandığınız e-posta adresiyle ilgili doğrulama gerekiyor.
          </p>
          <div className="pt-2 text-zinc-300 font-medium text-xs sm:text-sm">
            Bir hata olduğunu mu düşünüyorsunuz?
          </div>
        </div>

        {/* E-posta Adresi Kutusu */}
        <div className="w-full max-w-xs px-4 py-3 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 text-amber-400 font-mono text-xs sm:text-sm flex items-center justify-center gap-2 mb-6 shadow-inner">
          <Mail className="w-4 h-4 text-amber-400/80 shrink-0" />
          <span className="select-all font-semibold">redchatbusiness@outlook.com</span>
        </div>
      </div>

      {/* Alt Butonlar */}
      <div className="w-full max-w-sm flex flex-col gap-2.5 pb-4">
        <button
          onClick={handleSupportClick}
          className="w-full px-5 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-sm transition-all shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
        >
          <Headphones className="w-4 h-4 shrink-0" />
          <span>Destek Ekibine Ulaş</span>
        </button>

        <div className="grid grid-cols-2 gap-2.5 w-full">
          <button
            onClick={handleRefresh}
            disabled={checking}
            className="w-full px-4 py-3 rounded-2xl bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 font-medium text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-zinc-700/50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin text-amber-400' : ''}`} />
            <span>Durumu Kontrol Et</span>
          </button>

          <button
            onClick={onLogout}
            className="w-full px-4 py-3 rounded-2xl bg-red-950/40 hover:bg-red-900/60 text-red-400 font-semibold text-xs transition-all border border-red-900/40 flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Çıkış Yap</span>
          </button>
        </div>
      </div>
    </div>
  );
};
