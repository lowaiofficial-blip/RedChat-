import React, { useState, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
  isMe?: boolean;
}

// Markdown sözdizimi tespiti (Önbellek/Bypass için hızlı regex kontrolü)
const MARKDOWN_REGEX = /[`*_~#|\[\]<>\\]|https?:\/\/|@(?:RedChat\s+AI|[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/i;

export const MarkdownMessage: React.FC<MarkdownMessageProps> = React.memo(({ content, isMe = false }) => {
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);

  const handleCopyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeIndex(index);
    setTimeout(() => {
      setCopiedCodeIndex(null);
    }, 2000);
  };

  // Performans Optimizasyonu: Eğer metinde markdown sembolü veya link yoksa
  // Ağır react-markdown AST ayrıştırıcısını çalıştırmadan ultra-hızlı doğrudan DOM render et
  const hasFormatting = useMemo(() => {
    return MARKDOWN_REGEX.test(content);
  }, [content]);

  if (!hasFormatting) {
    return (
      <span className={`text-xs leading-relaxed whitespace-pre-wrap break-words break-all [overflow-wrap:anywhere] [word-break:break-word] min-w-0 max-w-full ${isMe ? 'text-white' : 'text-zinc-800 dark:text-zinc-100'}`}>
        {content}
      </span>
    );
  }

  let codeBlockCounter = 0;

  return (
    <div className={`markdown-body text-xs leading-relaxed break-words [overflow-wrap:anywhere] [word-break:break-word] min-w-0 max-w-full ${isMe ? 'text-white' : 'text-zinc-800 dark:text-zinc-100'}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Bold / Kalın Metinler
          strong: ({ children }) => (
            <strong className={`font-bold break-words [overflow-wrap:anywhere] ${isMe ? 'text-white' : 'text-zinc-950 dark:text-white'}`}>
              {children}
            </strong>
          ),

          // Vurgulu / İtalik
          em: ({ children }) => (
            <em className="italic break-words [overflow-wrap:anywhere]">{children}</em>
          ),

          // Paragraf
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] min-w-0">{children}</p>
          ),

          // Başlıklar
          h1: ({ children }) => (
            <h1 className={`text-base font-bold mt-3 mb-1.5 break-words [overflow-wrap:anywhere] ${isMe ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-sm font-bold mt-2.5 mb-1 break-words [overflow-wrap:anywhere] ${isMe ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-xs font-bold mt-2 mb-1 break-words [overflow-wrap:anywhere] ${isMe ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
              {children}
            </h3>
          ),

          // Listeler
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-2 space-y-1 min-w-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-2 space-y-1 min-w-0">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed break-words [overflow-wrap:anywhere] [word-break:break-word]">{children}</li>
          ),

          // Alıntılar
          blockquote: ({ children }) => (
            <blockquote
              className={`border-l-2 pl-3 py-1 my-2 text-xs italic ${
                isMe
                  ? 'border-white/60 text-white/90 bg-white/10'
                  : 'border-red-500 text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50'
              } rounded-r-lg`}
            >
              {children}
            </blockquote>
          ),

          // Tablolar (GFM)
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-zinc-200 dark:border-zinc-700/60 max-w-full">
              <table className="w-full text-left border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={isMe ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-800'}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="p-2 font-semibold border-b border-zinc-200 dark:border-zinc-700/60">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="p-2 border-b border-zinc-100 dark:border-zinc-800/80">
              {children}
            </td>
          ),

          // Satır içi Kod
          code: ({ children, className }) => {
            const isCodeBlock = className?.includes('language-');
            if (!isCodeBlock) {
              return (
                <code
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                    isMe
                      ? 'bg-black/25 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-red-600 dark:text-red-400 border border-zinc-200 dark:border-zinc-700/60'
                  }`}
                >
                  {children}
                </code>
              );
            }
            return <code>{children}</code>;
          },

          // Çok Satırlı Kod Blokları
          pre: ({ children }) => {
            codeBlockCounter++;
            const currentBlockIndex = codeBlockCounter;
            
            // Extract raw text from pre children for copying
            let rawCode = '';
            React.Children.forEach(children, (child) => {
              if (React.isValidElement(child) && (child.props as any)?.children) {
                rawCode += String((child.props as any).children);
              } else if (typeof child === 'string') {
                rawCode += child;
              }
            });

            return (
              <div className="relative group my-2 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700/60 bg-zinc-900 text-zinc-100 text-xs shadow-sm">
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 text-[10px] text-zinc-400 font-mono border-b border-zinc-700/50">
                  <span>Kod</span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(rawCode, currentBlockIndex)}
                    className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-zinc-700/50"
                  >
                    {copiedCodeIndex === currentBlockIndex ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Kopyalandı</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopyala</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 overflow-x-auto font-mono text-[11px] leading-relaxed select-text">
                  {children}
                </div>
              </div>
            );
          },

          // Bağlantılar
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline font-medium hover:opacity-80 transition-opacity ${
                isMe ? 'text-white' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
