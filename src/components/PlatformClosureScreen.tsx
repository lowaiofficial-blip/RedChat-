import React, { useEffect } from 'react';
import { Flame } from 'lucide-react';

export const PlatformClosureScreen: React.FC = () => {
  useEffect(() => {
    try {
      if (
        typeof window !== 'undefined' &&
        (window.location.pathname !== '/' ||
          window.location.search !== '' ||
          window.location.hash !== '')
      ) {
        window.history.replaceState(null, '', '/');
      }
    } catch {
      // Kısıtlı ortamlarda history güncellemesi sessizce atlanır
    }
  }, []);

  return (
    <div
      className="relative h-full w-full overflow-y-auto bg-[#202124] text-[#F1F3F4] antialiased selection:bg-[#FF9100]/30 selection:text-white"
      style={{
        fontFamily:
          "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Yumuşak arka plan ışık katmanı (Firebase marka tonları) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-36 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(255, 196, 0, 0.08) 0%, rgba(255, 145, 0, 0.06) 40%, rgba(221, 44, 0, 0.04) 70%, transparent 100%)',
          }}
        />
      </div>

      <main className="relative z-10 flex min-h-full w-full items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
        <article
          aria-labelledby="closure-heading"
          className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#27292D] shadow-[0_24px_60px_-15px_rgba(0,0,0,0.65)]"
        >
          {/* Üst marka çizgisi (#FFC400 -> #FF9100 -> #DD2C00) */}
          <div
            aria-hidden="true"
            className="h-[3px] w-full"
            style={{
              background:
                'linear-gradient(90deg, #FFC400 0%, #FF9100 50%, #DD2C00 100%)',
            }}
          />

          <div className="p-6 sm:p-10">
            {/* Marka Başlığı: Sade beyaz Lucide Flame amblemi + RedChat */}
            <header className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#DD2C00]">
                  <Flame
                    className="h-6 w-6 text-[#FFFFFF] fill-[#FFFFFF]"
                    color="#FFFFFF"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <span className="block text-lg font-bold tracking-tight text-white">
                    RedChat
                  </span>
                </div>
              </div>

              <span className="text-xs font-medium tracking-wide text-[#9AA0A6]">
                2026
              </span>
            </header>

            {/* Ana Duyuru Alanı */}
            <section className="py-7 sm:py-8">
              <p className="text-xs font-semibold tracking-wide text-[#FFC400]">
                Resmî Kapanış Duyurusu · RedChat Yönetimi Kararı
              </p>

              <h1
                id="closure-heading"
                className="mt-3 text-2xl font-bold leading-tight tracking-tight text-white [text-wrap:balance] sm:text-3xl"
              >
                RedChat kalıcı olarak kapatıldı.
              </h1>

              <div className="mt-5 space-y-4 text-[15px] leading-[1.7] tracking-[0.01em] text-[#D2D5D9] sm:text-base">
                <p>
                  RedChat platformunun hizmetleri sona ermiştir. Alınan karar
                  doğrultusunda platform artık kullanıma açık değildir.
                </p>

                <p className="text-sm leading-[1.7] text-[#9AA0A6]">
                  Bu işlem geçici bir bakım çalışması değildir; platformun
                  faaliyetlerinin kalıcı olarak sonlandırılması kararı RedChat
                  yönetimi tarafından alınmıştır.
                </p>

                <p className="border-t border-white/[0.08] pt-5 text-[#E8EAED]">
                  RedChat'i kullanan, destekleyen ve geliştirme sürecinde
                  yanımızda olan herkese teşekkür ederiz.
                </p>
              </div>
            </section>

            {/* Kapanış İmzası */}
            <footer className="flex flex-col gap-1.5 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold tracking-wide text-[#FF9100]">
                RedChat Ekibi — 2026
              </p>
              <p className="text-xs tracking-wide text-[#9AA0A6]">
                Platform erişimi kalıcı olarak sonlandırılmıştır
              </p>
            </footer>
          </div>
        </article>
      </main>
    </div>
  );
};
