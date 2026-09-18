import React from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';

interface SecurityTerminationAlertProps {
  id?: string;
  className?: string;
  showAiHeader?: boolean;
}

export const SECURITY_TERMINATION_MESSAGE_TEXT =
  "Uh-oh! Sohbet güvenliği uyarısı: Bu oturum, topluluk kuralları ve uygunsuz içerik (hakaret/küfür) ihlali nedeniyle sistem tarafından sonlandırılmıştır.";

/**
 * DeepRed AI — Sohbet Güvenliği / Oturum Sonlandırma Kırmızı Uyarı Kutusu
 * Flash Lite 2.0 tarzı:
 * - Üstte AI model başlığı (DeepRed AI • Flash Lite 2.0)
 * - Koyu bordo-kırmızı arkaplan, ince kırmızı çerçeve
 * - Emoji yerine Lucide AlertCircle SVG vektör ikonu
 * - Otomatik satır bölen, mobilde taşmayan modern metin
 */
export const SecurityTerminationAlert: React.FC<SecurityTerminationAlertProps> = ({
  id = 'security-termination-box',
  className = '',
  showAiHeader = true,
}) => {
  return (
    <div className={`w-full max-w-xl mx-auto my-2.5 transition-all text-left ${className}`}>
      {/* 🤖 Üstteki AI Başlığı (DeepRed AI • Flash Lite 2.0) */}
      {showAiHeader && (
        <div className="flex items-center gap-2 mb-2 px-1 select-none">
          <div className="w-5 h-5 rounded-lg bg-red-600/20 dark:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
            DeepRed AI <span className="font-normal text-zinc-500 dark:text-zinc-400">• Flash Lite 2.0</span>
          </span>
        </div>
      )}

      {/* Kırmızı güvenlik kutusu tasarımı */}
      <div
        id={id}
        role="alert"
        aria-live="assertive"
        className="px-4 py-3.5 sm:px-5 sm:py-4 bg-[#2b1216] dark:bg-[#230d11] border border-red-900/60 dark:border-red-900/80 rounded-2xl shadow-sm text-left select-none"
      >
        <div className="flex items-start gap-3 sm:gap-3.5">
          {/* Sol tarafta SVG Lucide AlertCircle İkonu (Emoji değil, temiz SVG vektör) */}
          <div id="security-alert-icon" className="shrink-0 mt-0.5" aria-hidden="true">
            <AlertCircle className="w-5 h-5 text-red-400 dark:text-red-400 stroke-[2]" />
          </div>

          {/* Sağ tarafta güvenlik metni */}
          <div className="flex-1 min-w-0">
            <p
              id="security-alert-text"
              className="text-xs sm:text-[13.5px] font-normal text-zinc-100 dark:text-zinc-100 leading-relaxed break-words"
            >
              {SECURITY_TERMINATION_MESSAGE_TEXT}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
