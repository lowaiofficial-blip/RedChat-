import React, { useState, useMemo } from 'react';
import { X, Copy, Check, Download, Layers, FileText, ArrowRight } from 'lucide-react';
import { splitTextIntoChunks, downloadTextFile } from '../utils/fileUtils';

export interface ChunkCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  text: string;
}

export const ChunkCopyModal: React.FC<ChunkCopyModalProps> = ({
  isOpen,
  onClose,
  title = 'Parçalı Log / Metin Kopyalama',
  text,
}) => {
  const [chunkSize, setChunkSize] = useState<number>(1500);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedLast, setCopiedLast] = useState(false);

  const chunks = useMemo(() => {
    return splitTextIntoChunks(text, chunkSize);
  }, [text, chunkSize]);

  if (!isOpen || !text) return null;

  const totalChars = text.length;
  const totalWords = text.trim() ? text.trim().split(/\s+/).length : 0;

  const handleCopyChunk = (chunkText: string, index: number) => {
    navigator.clipboard?.writeText(chunkText);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAll = () => {
    navigator.clipboard?.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopyLastChunk = () => {
    if (chunks.length === 0) return;
    const lastChunk = chunks[chunks.length - 1];
    navigator.clipboard?.writeText(lastChunk);
    setCopiedLast(true);
    setTimeout(() => setCopiedLast(false), 2000);
  };

  const handleDownloadTxt = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadTextFile(`RedChat_Log_${timestamp}.txt`, text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Modal Başlığı */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-900/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {title}
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {totalChars.toLocaleString()} Karakter • {totalWords.toLocaleString()} Kelime • {chunks.length} Parça
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Üst İşlem Çubuğu ve Parça Boyutu Seçici */}
        <div className="p-4 bg-zinc-100/60 dark:bg-zinc-800/40 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Parça Boyutu Seçimi */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">
              Parça Sınırı:
            </span>
            {[1000, 1500, 2000, 3000].map((size) => (
              <button
                key={size}
                onClick={() => setChunkSize(size)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  chunkSize === size
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {size} kr.
              </button>
            ))}
          </div>

          {/* Aksiyon Butonları (İndir & Tümünü / Son Parçayı Kopyala) */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownloadTxt}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>TXT İndir</span>
            </button>

            <button
              onClick={handleCopyAll}
              className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-100 font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-500">Tümü Kopyalandı</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Tümünü Kopyala</span>
                </>
              )}
            </button>

            {chunks.length > 1 && (
              <button
                onClick={handleCopyLastChunk}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                title="Sadece son eklenen devam logunu / parçasını kopyala"
              >
                {copiedLast ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    <span>Son Parça Kopyalandı</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>Sadece Devamını Kopyala</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Parça Listesi */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 min-h-0 select-text">
          {chunks.map((chunk, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 overflow-hidden shadow-xs"
            >
              <div className="px-3.5 py-2 bg-zinc-100 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 font-bold text-[11px]">
                    Parça {idx + 1} / {chunks.length}
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                    ({chunk.length.toLocaleString()} karakter)
                  </span>
                </div>

                <button
                  onClick={() => handleCopyChunk(chunk, idx)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    copiedIndex === idx
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Bu Parçayı Kopyala</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-white/50 dark:bg-zinc-900/50">
                {chunk}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Alt Bilgisi */}
        <div className="px-5 py-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-zinc-400" />
            <span>Karakter sınırına takılmadan parçalar halinde kopyalayabilirsiniz.</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
