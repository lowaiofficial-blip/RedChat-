import React from 'react';

export interface RadialPulseLoaderProps {
  className?: string;
  statusText?: string;
}

/**
 * 🤖 Premium AI Thinking Animation
 * - ai-loader-wrapper: Gentle pulse effect
 * - ai-thinking-text: Shimmering gradient text
 */
export const RadialPulseLoader: React.FC<RadialPulseLoaderProps> = ({
  className = '',
  statusText = 'Düşünüyorum...',
}) => {
  return (
    <div className={`ai-loader-wrapper inline-flex items-center select-none ${className}`}>
      <div className="ai-thinking-text text-xs sm:text-sm font-medium tracking-tight">
        {statusText}
      </div>
    </div>
  );
};
