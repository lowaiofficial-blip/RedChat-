import React from 'react';

export interface RadialPulseLoaderProps {
  className?: string;
  statusText?: string;
  showText?: boolean;
}

/**
 * 🌸 Meta AI Mini 3D Typing Loader
 * - 24px mini boyutta döner ana kapsayıcı
 * - Dairesel 7 adet mini 3D degrade tomurcuk
 * - Mavi -> Pembe/Mor degrade ve ışık yansımaları
 */
export const RadialPulseLoader: React.FC<RadialPulseLoaderProps> = ({
  className = '',
  statusText = 'RedChat AI düşünüyor...',
  showText = true,
}) => {
  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* 24px Meta 3D Loader Kapsayıcısı */}
      <div className="meta-3d-loader shrink-0">
        <div className="petal" style={{ '--i': 0 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 1 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 2 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 3 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 4 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 5 } as React.CSSProperties} />
        <div className="petal" style={{ '--i': 6 } as React.CSSProperties} />
      </div>

      {/* Kompakt Durum Metni */}
      {showText && statusText && (
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 italic truncate">
          {statusText}
        </span>
      )}
    </div>
  );
};
