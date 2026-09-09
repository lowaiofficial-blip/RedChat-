import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, Smile, ThumbsUp, Heart, Flame, Utensils, Plane } from 'lucide-react';

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'İfadeler',
    icon: <Smile className="w-4 h-4" />,
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥹', '😊',
      '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙',
      '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎',
      '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁',
      '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
      '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥',
      '😓', '🤗', '🤔', '🫣', '🤭', '🤫', '🤥', '😶', '😐', '😑',
      '😬', '🫨', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴',
      '🤤', '😪', '😵', '😵‍💫', '🤐', '🥴', '🤢', '🤮', '🤧', '😷',
      '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩'
    ],
  },
  {
    id: 'gestures',
    name: 'Jestler & İnsanlar',
    icon: <ThumbsUp className="w-4 h-4" />,
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
      '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
      '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️',
      '👅', '👄', '🫦', '🤞', '✌️', '🫰', '🤟', '🤘', '👌', '🤌',
      '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖',
      '👋', '🤙', '🫲', '🫱', '🫳', '🫴', '🫰', '🫶', '🙋', '🤷'
    ],
  },
  {
    id: 'hearts',
    name: 'Kalpler & Duygular',
    icon: <Heart className="w-4 h-4" />,
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
      '💟', '💌', '💐', '🌸', '💮', '🌹', '🥀', '🌺', '🌻', '🌼',
      '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️'
    ],
  },
  {
    id: 'popular',
    name: 'Popüler & Ateş',
    icon: <Flame className="w-4 h-4" />,
    emojis: [
      '🔥', '⭐', '🌟', '✨', '💥', '💯', '🎉', '🎊', '🚀', '🏆',
      '🥇', '🥈', '🥉', '🎯', '💡', '⚡', '🔔', '💎', '👑', '🎈',
      '🎁', '🪄', '🔮', '🧿', '💰', '💸', '💵', '🎲', '🧩', '🧸'
    ],
  },
  {
    id: 'food',
    name: 'Yiyecek & İçecek',
    icon: <Utensils className="w-4 h-4" />,
    emojis: [
      '☕', '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🥃',
      '🍸', '🍹', '🧉', '🍾', '🍕', '🍔', '🍟', '🌭', '🥪', '🌮',
      '🌯', '🥙', '🧆', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖',
      '🍜', '🍝', '🍣', '🍱', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂'
    ],
  },
  {
    id: 'travel',
    name: 'Seyahat & Doğa',
    icon: <Plane className="w-4 h-4" />,
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐',
      '🚲', '🛵', '🏍️', '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '⛵',
      '🚢', '🏖️', '🏝️', '🏕️', '⛺', '🏠', '🏡', '🏢', '🏛️', '🗼'
    ],
  },
];

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose?: () => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelectEmoji, onClose }) => {
  const [activeTab, setActiveTab] = useState<string>('smileys');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Tüm kategorilerdeki emojiler
  const allEmojis = useMemo(() => {
    const list: string[] = [];
    EMOJI_CATEGORIES.forEach((cat) => {
      list.push(...cat.emojis);
    });
    return Array.from(new Set(list));
  }, []);

  // Arama filtresi
  const filteredEmojis = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase().trim();
    // Emojiler içinde eşleşme veya arama
    return allEmojis.filter((emoji) => emoji.includes(q));
  }, [searchQuery, allEmojis]);

  const currentCategory = useMemo(() => {
    return EMOJI_CATEGORIES.find((cat) => cat.id === activeTab) || EMOJI_CATEGORIES[0];
  }, [activeTab]);

  return (
    <div
      ref={pickerRef}
      className="w-72 sm:w-80 bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col z-50 animate-in zoom-in-95 duration-150 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Üst Kategori Sekmeleri */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800/90 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {EMOJI_CATEGORIES.map((cat) => {
            const isActive = activeTab === cat.id && !searchQuery;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveTab(cat.id);
                  setSearchQuery('');
                }}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isActive
                    ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 font-bold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60'
                }`}
                title={cat.name}
              >
                {cat.icon}
              </button>
            );
          })}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors ml-1 cursor-pointer"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Emoji Grid Alanı */}
      <div className="p-2 max-h-56 overflow-y-auto overscroll-contain">
        {filteredEmojis ? (
          <div>
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider px-1.5 mb-1.5">
              Arama Sonuçları ({filteredEmojis.length})
            </div>
            {filteredEmojis.length > 0 ? (
              <div className="grid grid-cols-8 gap-1">
                {filteredEmojis.map((emoji, idx) => (
                  <button
                    key={`${emoji}-${idx}`}
                    type="button"
                    onClick={() => onSelectEmoji(emoji)}
                    className="h-8 w-8 text-xl flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 active:scale-125 transition-all cursor-pointer select-none"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-zinc-400">
                Emoji bulunamadı
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-400 uppercase tracking-wider px-1.5 mb-1.5">
              {currentCategory.name}
            </div>
            <div className="grid grid-cols-8 gap-1">
              {currentCategory.emojis.map((emoji, idx) => (
                <button
                  key={`${emoji}-${idx}`}
                  type="button"
                  onClick={() => onSelectEmoji(emoji)}
                  className="h-8 w-8 text-xl flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 active:scale-125 transition-all cursor-pointer select-none"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
