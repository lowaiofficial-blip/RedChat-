import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
  isMe?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, isMe = false }) => {
  // Pre-process text to style @RedChat AI and @user mentions if present
  // We replace @RedChat AI with markdown-safe token or render directly
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);

  const handleCopyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeIndex(index);
    setTimeout(() => {
      setCopiedCodeIndex(null);
    }, 2000);
  };

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
            <blockquote className={`pl-3 my-2 border-l-2 italic ${isMe ? 'border-white/50 text-white/90' : 'border-red-500 text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 py-1 rounded-r-lg'}`}>
              {children}
            </blockquote>
          ),

          // 📊 TABLOLAR: Yatay scroll özellikli, taşmayan, modern tablo tasarımı
          table: ({ children }) => (
            <div className="my-3 w-full overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700/80 shadow-xs bg-white dark:bg-zinc-900/80">
              <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700/80 text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2 text-left font-semibold text-[11px] tracking-wide text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 text-zinc-700 dark:text-zinc-200 whitespace-normal text-xs">
              {children}
            </td>
          ),

          // Kod ve Kod Blokları
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !String(children).includes('\n');
            const codeContent = String(children).replace(/\n$/, '');

            if (isInline) {
              return (
                <code
                  className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold ${
                    isMe
                      ? 'bg-black/25 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-red-600 dark:text-red-400 border border-zinc-200/60 dark:border-zinc-700/60'
                  }`}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            const currentIdx = ++codeBlockCounter;
            const language = match ? match[1] : '';

            return (
              <div className="my-2.5 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700/80 bg-zinc-900 text-zinc-100 shadow-md">
                {/* Kod Başlığı & Kopyalama Butonu */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/90 text-zinc-400 text-[10px] font-mono border-b border-zinc-700/60">
                  <span className="uppercase font-bold tracking-wider">{language || 'kod'}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(codeContent, currentIdx)}
                    className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                    title="Kodu kopyala"
                  >
                    {copiedCodeIndex === currentIdx ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">Kopyalandı</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopyala</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 overflow-x-auto text-[11px] font-mono leading-relaxed selection:bg-red-500 selection:text-white">
                  <pre className="m-0">
                    <code>{codeContent}</code>
                  </pre>
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
};
