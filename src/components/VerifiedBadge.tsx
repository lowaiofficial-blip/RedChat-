import React, { useState, useEffect, useCallback } from 'react';
import { UserAvatar } from './UserAvatar';
import { X, BadgeCheck, ShieldCheck } from 'lucide-react';

// 🚀 Global in-memory badge image cache & preload registry
const globalLoadedBadgeUrls = new Set<string>();
const globalBadgeLoadingPromises = new Map<string, Promise<boolean>>();

/**
 * Mavi Tik PNG görselini belleğe ön yükler ve decode eder.
 * Bu sayede görsel ilk defa render edildiğinde çeyrek/yarım yüklenme veya progressive çizim oluşmaz.
 */
export function preloadBadgeImage(url: string | null | undefined): Promise<boolean> {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return Promise.resolve(false);
  }

  const cleanUrl = url.trim();
  if (globalLoadedBadgeUrls.has(cleanUrl)) {
    return Promise.resolve(true);
  }

  if (globalBadgeLoadingPromises.has(cleanUrl)) {
    return globalBadgeLoadingPromises.get(cleanUrl)!;
  }

  const promise = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';

    img.onload = () => {
      // Decode API desteği varsa görseli hafızada tam çöz
      if ('decode' in img && typeof img.decode === 'function') {
        img
          .decode()
          .then(() => {
            globalLoadedBadgeUrls.add(cleanUrl);
            resolve(true);
          })
          .catch(() => {
            // decode başarısız olsa bile onload oldu
            globalLoadedBadgeUrls.add(cleanUrl);
            resolve(true);
          });
      } else {
        globalLoadedBadgeUrls.add(cleanUrl);
        resolve(true);
      }
    };

    img.onerror = () => {
      resolve(false);
    };

    img.src = cleanUrl;
  });

  globalBadgeLoadingPromises.set(cleanUrl, promise);
  return promise;
}

export interface VerifiedUserInfo {
  displayName?: string;
  username?: string;
  photoURL?: string | null;
}

export interface VerifiedBadgeProps {
  isVerified?: boolean;
  badgeUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  user?: VerifiedUserInfo;
  interactive?: boolean; // Tıklanınca RedChat Verified kartı açılsın mı (varsayılan: true)
  title?: string;
}

const sizeConfig = {
  xs: {
    container: 'w-3.5 h-3.5 min-w-[14px] min-h-[14px]',
    icon: 'w-3.5 h-3.5',
  },
  sm: {
    container: 'w-4 h-4 min-w-[16px] min-h-[16px]',
    icon: 'w-4 h-4',
  },
  md: {
    container: 'w-4.5 h-4.5 min-w-[18px] min-h-[18px]',
    icon: 'w-4.5 h-4.5',
  },
  lg: {
    container: 'w-5 h-5 min-w-[20px] min-h-[20px]',
    icon: 'w-5 h-5',
  },
  xl: {
    container: 'w-6 h-6 min-w-[24px] min-h-[24px]',
    icon: 'w-6 h-6',
  },
};

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  isVerified = true,
  badgeUrl,
  size = 'sm',
  className = '',
  user,
  interactive = true,
  title = 'Doğrulanmış Hesap',
}) => {
  const [imgError, setImgError] = useState(false);
  const [showVerifiedModal, setShowVerifiedModal] = useState(false);

  // URL değiştiğinde hata durumunu sıfırla
  useEffect(() => {
    setImgError(false);
  }, [badgeUrl]);

  if (!isVerified) return null;

  const validUrl =
    badgeUrl &&
    typeof badgeUrl === 'string' &&
    badgeUrl.trim().length > 0 &&
    !imgError
      ? badgeUrl.trim()
      : null;

  const currentSize = sizeConfig[size] || sizeConfig.sm;

  // Rozete tıklama handler'ı (Event propagation kesin olarak engellenir)
  const handleClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    setShowVerifiedModal(true);
  };

  // Uzun basma ve context menü engellemesi
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <span
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        title={title}
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'manipulation',
        }}
        className={`inline-flex items-center justify-center shrink-0 align-middle select-none ${
          interactive
            ? 'cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-150 focus:outline-none'
            : ''
        } ${currentSize.container} ${className}`}
      >
        {validUrl ? (
          <img
            src={validUrl}
            alt="RedChat Verified"
            referrerPolicy="no-referrer"
            draggable={false}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onError={() => {
              console.warn('Mavi tik rozet görseli yüklenemedi:', validUrl);
              setImgError(true);
            }}
            className={`w-full h-full object-contain aspect-square select-none pointer-events-none ${currentSize.icon}`}
          />
        ) : (
          // Temiz, modern Mavi Onay Rozeti (SVG Fallback)
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            onContextMenu={handleContextMenu}
            className={`w-full h-full text-blue-500 select-none pointer-events-none ${currentSize.icon}`}
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.1 14.2l-4.2-4.2 1.4-1.4 2.8 2.8 6.4-6.4 1.4 1.4-7.8 7.8z" />
          </svg>
        )}
      </span>

      {/* 🔵 REDCHAT VERIFIED BİLGİ KARTI MODALI */}
      {showVerifiedModal && (
        <RedChatVerifiedCardModal
          user={user}
          badgeUrl={validUrl}
          onClose={() => setShowVerifiedModal(false)}
        />
      )}
    </>
  );
};

interface RedChatVerifiedCardModalProps {
  user?: VerifiedUserInfo;
  badgeUrl?: string | null;
  onClose: () => void;
}

export const RedChatVerifiedCardModal: React.FC<RedChatVerifiedCardModalProps> = ({
  user,
  badgeUrl,
  onClose,
}) => {
  // ESC tuşu ile kapatma
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        onClick={handleCardClick}
        className="w-full max-w-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-5 shadow-2xl relative animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-zinc-100"
      >
        {/* Kapat Butonu */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className="absolute top-3.5 right-3.5 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer"
          title="Kapat"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center space-y-3 pt-1">
          {/* Kullanıcı Profili (Varsa) */}
          {user && (user.displayName || user.username) ? (
            <div className="flex flex-col items-center mb-1">
              <div className="relative mb-2">
                <UserAvatar
                  photoURL={user.photoURL}
                  name={user.displayName}
                  username={user.username}
                  size="lg"
                />
                <span className="absolute -bottom-1 -right-1">
                  <VerifiedBadge
                    isVerified={true}
                    badgeUrl={badgeUrl}
                    size="sm"
                    interactive={false}
                  />
                </span>
              </div>

              <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">
                {user.displayName || user.username}
              </div>
              {user.username && (
                <div className="text-xs font-mono text-red-600 dark:text-red-400 font-medium">
                  @{user.username}
                </div>
              )}
            </div>
          ) : (
            // Sadece Rozet İkonu
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-xs">
              <VerifiedBadge
                isVerified={true}
                badgeUrl={badgeUrl}
                size="lg"
                interactive={false}
              />
            </div>
          )}

          {/* Kart Ana Başlığı */}
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 font-black text-sm text-zinc-900 dark:text-white">
              <span>🔵</span>
              <span>RedChat Verified</span>
            </div>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              Bu hesap RedChat tarafından doğrulanmıştır.
            </p>
          </div>

          {/* Açıklama Metni */}
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Doğrulanmış hesap rozeti, hesabın RedChat tarafından doğrulandığını gösterir.
          </div>

          {/* Anladım / Kapat Butonu */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="w-full py-2 px-4 bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs"
          >
            Anladım
          </button>
        </div>
      </div>
    </div>
  );
};
