import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Image as ImageIcon, AlertCircle } from 'lucide-react';

interface AiDrawingAnimationProps {
  imageUrl?: string | null;
  isLoading?: boolean;
  error?: string | null;
  prompt?: string;
  remainingQuota?: number | null;
  quotaMessage?: string | null;
  onImageClick?: (url: string) => void;
  className?: string;
}

/**
 * 🎨 DeepRed AI Özel Çizim ve Görsel Yükleme Animasyonu
 * Kullanıcının sağladığı strokeDasharray / strokeDashoffset ve requestAnimationFrame/animate tabanlı
 * döngüsel SVG çizim mantığını React yaşam döngüsüne entegre eder.
 * Görsel hazır olduğunda çizim tamamen durur ve gerçek görsel aynı karede pürüzsüzce belirir.
 */
export const AiDrawingAnimation: React.FC<AiDrawingAnimationProps> = ({
  imageUrl,
  isLoading = false,
  error = null,
  prompt,
  remainingQuota,
  quotaMessage,
  onImageClick,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const loadingBannerRef = useRef<HTMLDivElement>(null);

  const [imageLoaded, setImageLoaded] = useState<boolean>(Boolean(imageUrl));
  const animationStateRef = useRef<{
    running: boolean;
    gen: number;
    timeoutId: any;
  }>({
    running: false,
    gen: 0,
    timeoutId: null,
  });

  // Animasyonu başlatır (startLoading mantığı)
  const startLoading = () => {
    const im = imgRef.current;
    const svg = svgRef.current;
    const lb = loadingBannerRef.current;
    const state = animationStateRef.current;

    state.running = true;
    state.gen++;
    const currentGen = state.gen;

    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }

    if (im) {
      im.style.opacity = '0';
      if (!imageUrl) {
        im.removeAttribute('src');
      }
    }

    setImageLoaded(false);

    if (svg) {
      svg.getAnimations().forEach((a) => a.cancel());
      svg.style.display = '';
      svg.style.opacity = '1';
    }

    if (lb) {
      lb.style.display = '';
      lb.style.opacity = '1';
    }

    const runSequence = () => {
      if (!state.running || state.gen !== currentGen || !svgRef.current) return;
      const svgEl = svgRef.current;
      const elements = svgEl.querySelectorAll<SVGGeometryElement>('path, line, polyline, circle, rect');

      let t = 0;
      elements.forEach((el, index) => {
        let L = 100;
        try {
          if (typeof el.getTotalLength === 'function') {
            L = el.getTotalLength() || 100;
          }
        } catch {
          L = 100;
        }

        el.style.strokeDasharray = `${L}`;
        el.style.strokeDashoffset = `${L}`;

        const dur = Math.max(300, Math.min(1200, L * 5));
        try {
          el.animate(
            [{ strokeDashoffset: `${L}` }, { strokeDashoffset: '0' }],
            {
              duration: dur,
              delay: t,
              fill: 'forwards',
              easing: 'ease-in-out',
            }
          );
        } catch {
          // Desteklenmeyen ortamlarda fallback
        }
        t += dur + 70;
      });

      if (state.timeoutId) clearTimeout(state.timeoutId);
      state.timeoutId = setTimeout(() => {
        if (!state.running || state.gen !== currentGen || !svgRef.current) return;
        try {
          const fadeAnim = svgEl.animate([{ opacity: '1' }, { opacity: '0.2' }], {
            duration: 400,
            fill: 'forwards',
          });
          fadeAnim.onfinish = () => {
            if (!state.running || state.gen !== currentGen || !svgRef.current) return;
            svgEl.getAnimations().forEach((a) => a.cancel());
            svgEl.style.opacity = '1';
            runSequence();
          };
        } catch {
          runSequence();
        }
      }, t + 700);
    };

    runSequence();
  };

  // Görsel hazır olduğunda animasyonu durdurur ve resmi gösterir (showImage mantığı)
  const showImage = (src: string) => {
    const state = animationStateRef.current;
    state.running = false;
    state.gen++;
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }

    const svg = svgRef.current;
    const lb = loadingBannerRef.current;
    const im = imgRef.current;

    if (svg) {
      svg.getAnimations().forEach((a) => a.cancel());
      svg.style.display = 'none';
    }

    if (lb) {
      lb.style.display = 'none';
    }

    if (im) {
      im.onload = () => {
        if (svg) svg.style.display = 'none';
        if (lb) lb.style.display = 'none';
        im.style.opacity = '1';
        setImageLoaded(true);
      };
      im.onerror = () => {
        if (svg) svg.style.display = 'none';
        if (lb) lb.style.display = 'none';
        setImageLoaded(false);
      };
      im.src = src;
    }
  };

  // Props değişimlerine göre startLoading / showImage tetikleme
  useEffect(() => {
    if (imageUrl) {
      showImage(imageUrl);
    } else if (isLoading) {
      startLoading();
    } else {
      // Bekleme durumu bitti ama resim yok
      const state = animationStateRef.current;
      state.running = false;
      if (state.timeoutId) clearTimeout(state.timeoutId);
      if (svgRef.current) {
        svgRef.current.getAnimations().forEach((a) => a.cancel());
      }
    }

    return () => {
      const state = animationStateRef.current;
      state.running = false;
      if (state.timeoutId) clearTimeout(state.timeoutId);
      if (svgRef.current) {
        svgRef.current.getAnimations().forEach((a) => a.cancel());
      }
    };
  }, [imageUrl, isLoading]);

  return (
    <div className={`flex flex-col gap-2 my-2 select-none ${className}`}>
      {/* 🖼️ Çizim & Görsel Ana Çerçevesi */}
      <div
        ref={containerRef}
        onClick={() => {
          if (imageUrl && onImageClick) {
            onImageClick(imageUrl);
          }
        }}
        className={`relative w-full max-w-[340px] aspect-square rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center transition-all ${
          imageUrl ? 'cursor-zoom-in hover:brightness-105 shadow-md hover:shadow-lg' : 'shadow-sm'
        }`}
      >
        {/* 🎨 Özel SVG Çizim Animasyonu (Yükleme süresince çizilir) */}
        <svg
          ref={svgRef}
          viewBox="0 0 400 400"
          className="w-full h-full p-8 absolute inset-0 z-10 transition-opacity pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="fluxRedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#dc2626" />
            </linearGradient>
            <linearGradient id="fluxGlowGradient" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fb7185" />
              <stop offset="100%" stopColor="#e11d48" />
            </linearGradient>
          </defs>

          {/* Dış Sanatsal Tuval ve Çerçeve Çizgileri */}
          <rect
            x="30"
            y="30"
            width="340"
            height="340"
            rx="24"
            fill="none"
            stroke="url(#fluxRedGradient)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Sanatsal Dağ ve Manzara Çizgileri */}
          <path
            d="M 50 310 Q 130 180 200 250 T 350 220"
            fill="none"
            stroke="url(#fluxGlowGradient)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 80 320 Q 170 120 260 210 T 350 280"
            fill="none"
            stroke="#f87171"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />

          {/* Gökyüzü / Güneş / Işık Çizgisi */}
          <circle
            cx="270"
            cy="110"
            r="38"
            fill="none"
            stroke="url(#fluxRedGradient)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 270 55 L 270 40 M 270 165 L 270 180 M 200 110 L 215 110 M 325 110 L 340 110"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Fırça ve Yaratıcılık Dalgaları */}
          <path
            d="M 60 140 C 120 180, 140 80, 200 120 S 280 180, 340 150"
            fill="none"
            stroke="currentColor"
            className="text-zinc-400 dark:text-zinc-600"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M 70 330 L 330 330"
            fill="none"
            stroke="url(#fluxRedGradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>

        {/* ⏳ Çizim Bilgilendirme Rozeti (StartLoading ile görünür, ShowImage ile kaybolur) */}
        <div
          ref={loadingBannerRef}
          id="lb"
          className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between px-3.5 py-2 rounded-xl bg-zinc-900/90 dark:bg-black/90 backdrop-blur-md border border-red-500/30 text-white shadow-lg pointer-events-none transition-opacity"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-red-500 animate-spin" style={{ animationDuration: '3s' }} />
            <span className="text-xs font-medium tracking-tight">FLUX.2-dev Çiziyor...</span>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">Canlı Çizim</span>
        </div>

        {/* 🖼️ Gerçek Üretilen Görsel (Hazır olunca pürüzsüzce opacity: 1 olur) */}
        <img
          ref={imgRef}
          id="res"
          alt={prompt || 'DeepRed AI Görseli'}
          className="w-full h-full object-cover transition-opacity duration-500 opacity-0 z-10"
        />

        {/* ⚠️ Hata Durumu */}
        {error && !isLoading && !imageUrl && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-zinc-100/90 dark:bg-zinc-900/90 backdrop-blur-sm">
            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{error}</p>
          </div>
        )}
      </div>

      {/* 🔢 Kota Bilgilendirme Metni */}
      {remainingQuota !== undefined && remainingQuota !== null && (
        <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
          <span>
            {remainingQuota > 0 ? (
              <>3 görsel hakkından <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{remainingQuota}</strong> tanesi kaldı.</>
            ) : (
              <span className="text-red-500 dark:text-red-400 font-medium">Görsel hakkın doldu</span>
            )}
          </span>
          {remainingQuota === 0 && (
            <span className="text-zinc-400 dark:text-zinc-500">Yenilenme: 00:00</span>
          )}
        </div>
      )}

      {/* Özel Limit Doldu Uyarısı (Eğer aktarılmışsa) */}
      {quotaMessage && (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-medium">
          {quotaMessage}
        </p>
      )}
    </div>
  );
};
export default AiDrawingAnimation;
