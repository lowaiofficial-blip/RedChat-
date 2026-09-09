import React from 'react';

interface SequentialTypingDotsProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Kullanıcı veya AI yazarken üç noktanın sırayla dalgalanarak hareket etmesini sağlayan bileşen.
 */
export const SequentialTypingDots: React.FC<SequentialTypingDotsProps> = ({
  className = 'text-current',
  size = 'sm',
}) => {
  const dotClass =
    size === 'xs'
      ? 'w-1 h-1'
      : size === 'md'
      ? 'w-1.5 h-1.5'
      : 'w-1.25 h-1.25';

  return (
    <span
      className={`inline-flex items-center gap-0.75 translate-y-[1px] ${className}`}
      aria-label="yazıyor..."
    >
      <span className={`${dotClass} rounded-full bg-current typing-dot typing-dot-1`} />
      <span className={`${dotClass} rounded-full bg-current typing-dot typing-dot-2`} />
      <span className={`${dotClass} rounded-full bg-current typing-dot typing-dot-3`} />
    </span>
  );
};
