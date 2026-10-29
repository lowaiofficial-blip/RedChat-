import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, AlertCircle, Film, RefreshCw, ChevronDown } from 'lucide-react';

export interface GiphyGifItem {
  id: string;
  title: string;
  images: {
    fixed_height?: {
      url: string;
      width: string;
      height: string;
    };
    downsized_medium?: {
      url: string;
      width: string;
      height: string;
    };
    original?: {
      url: string;
      width: string;
      height: string;
    };
  };
}

interface GiphyPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGif: (gifUrl: string, title?: string) => void;
}

export const GiphyPickerModal: React.FC<GiphyPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectGif,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyGifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch GIFs (Trending or Search)
  const fetchGifs = useCallback(
    async (query: string, currentOffset: number, append: boolean = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const isSearch = query.length > 0;
        const endpoint = isSearch
          ? `/api/giphy/search?q=${encodeURIComponent(query)}&limit=24&offset=${currentOffset}`
          : `/api/giphy/trending?limit=24&offset=${currentOffset}`;

        const response = await fetch(endpoint);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'GIF verileri alınamadı.');
        }

        const newGifs: GiphyGifItem[] = data.data || [];
        const totalCount = data.pagination?.total_count || 0;

        if (append) {
          setGifs((prev) => [...prev, ...newGifs]);
        } else {
          setGifs(newGifs);
        }

        setHasMore(currentOffset + newGifs.length < totalCount && newGifs.length > 0);
      } catch (err: any) {
        console.error('GIPHY Fetch Error:', err);
        setError(err.message || 'GIPHY servisine bağlanırken bir sorun oluştu.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // Trigger initial or query change fetch
  useEffect(() => {
    if (!isOpen) return;
    setOffset(0);
    fetchGifs(debouncedQuery, 0, false);
  }, [isOpen, debouncedQuery, fetchGifs]);

  // Load more GIFs
  const handleLoadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    const nextOffset = offset + 24;
    setOffset(nextOffset);
    fetchGifs(debouncedQuery, nextOffset, true);
  };

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl max-w-lg w-full h-[82vh] sm:h-[620px] shadow-2xl relative flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>GIF Kitaplığı</span>
              </h3>
              <p className="text-[10px] text-zinc-400 font-medium">
                Sohbetinize eğlenceli animasyonlu GIF'ler ekleyin
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Box */}
        <div className="p-3 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="GIF ara… (Örn: Komik, Kedi, Tebrik)"
              className="w-full text-xs pl-9 pr-8 py-2.5 rounded-2xl bg-white dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-all placeholder:text-zinc-400"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Content / GIF Grid */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar"
        >
          {loading && gifs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-red-600 mb-2" />
              <p className="text-xs font-semibold">GIF'ler Yükleniyor…</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-rose-50/40 dark:bg-rose-950/20 rounded-2xl border border-rose-200/60 dark:border-rose-900/50 m-2">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2 shrink-0" />
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-1">
                GIF yüklenemedi
              </p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 max-w-xs leading-relaxed mb-4">
                {error}
              </p>
              <button
                type="button"
                onClick={() => fetchGifs(debouncedQuery, 0, false)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tekrar Deneyin</span>
              </button>
            </div>
          ) : gifs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
              <Film className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mb-2" />
              <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                Hiç GIF bulunamadı
              </p>
              <p className="text-[11px] text-zinc-400 mt-1">
                Farklı bir arama kelimesi yazmayı deneyin.
              </p>
            </div>
          ) : (
            <>
              {/* GIF Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {gifs.map((gif) => {
                  const gifUrl =
                    gif.images.fixed_height?.url ||
                    gif.images.downsized_medium?.url ||
                    gif.images.original?.url;

                  if (!gifUrl) return null;

                  return (
                    <div
                      key={gif.id}
                      onClick={() => onSelectGif(gifUrl, gif.title)}
                      className="relative group aspect-square rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 cursor-pointer border border-zinc-200/50 dark:border-zinc-800 transition-all hover:scale-[1.02] hover:shadow-lg hover:border-red-500/50 active:scale-95"
                    >
                      <img
                        src={gifUrl}
                        alt={gif.title || 'GIF'}
                        className="w-full h-full object-cover rounded-2xl"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2 pointer-events-none">
                        <span className="text-[10px] font-medium text-white truncate drop-shadow-md">
                          {gif.title || 'GIF Gönder'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="pt-2 text-center pb-1">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Daha Fazla Yükleniyor…</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Daha Fazla GIF Yükle</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer / Powered by GIPHY */}
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 flex items-center justify-between shrink-0 text-[10px] text-zinc-400 font-semibold">
          <span>{searchQuery ? `Arama: "${searchQuery}"` : 'Popüler GIF\'ler'}</span>
          <span className="text-zinc-400 tracking-wider uppercase text-[9px] font-mono">
            Powered by GIPHY
          </span>
        </div>
      </div>
    </div>
  );
};
