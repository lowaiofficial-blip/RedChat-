import React from 'react';

interface SecurityTerminationAlertProps {
  id?: string;
  className?: string;
}

export const SECURITY_TERMINATION_MESSAGE_TEXT =
  "Uh-oh! Sohbet güvenliği uyarısı: Bu oturum, topluluk kuralları ve uygunsuz içerik (hakaret/küfür) ihlali nedeniyle sistem tarafından sonlandırılmıştır.";

/**
 * RedChat AI — Sohbet Güvenliği / Oturum Sonlandırma Kırmızı Uyarı Kutusu
 * İhlal durumunda sohbet geçmişinde ve ekranında gösterilen özel ve modern UI bileşeni.
 */
export const SecurityTerminationAlert: React.FC<SecurityTerminationAlertProps> = ({
  id = 'security-termination-box',
  className = '',
}) => {
  return (
    <div
      id={id}
      role="alert"
      aria-live="assertive"
      className={`w-full max-w-2xl mx-auto my-3 px-4 py-3.5 sm:px-5 sm:py-4 bg-red-500/10 dark:bg-red-950/40 border border-red-500/30 dark:border-red-600/40 rounded-2xl shadow-sm backdrop-blur-[2px] transition-all ${className}`}
    >
      <div className="flex items-start gap-3 sm:gap-3.5">
        {/* Sol tarafta yuvarlak kırmızı ünlem simgesi */}
        <div
          id="security-alert-icon"
          className="flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-base sm:text-lg select-none shadow-sm"
          aria-hidden="true"
        >
          ❗
        </div>

        {/* Sağ tarafta güvenlik metni - Otomatik satır böler ve mobilde taşma yapmaz */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p
            id="security-alert-text"
            className="text-xs sm:text-sm font-medium text-red-900 dark:text-red-200 leading-relaxed break-words"
          >
            {SECURITY_TERMINATION_MESSAGE_TEXT}
          </p>
        </div>
      </div>
    </div>
  );
};
