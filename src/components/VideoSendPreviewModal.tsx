import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Pause, Send, Film } from 'lucide-react';
import { formatVideoDuration } from '../services/videoUploadService';

interface VideoSendPreviewModalProps {
  isOpen: boolean;
  file: File | null;
  duration: number;
  onClose: () => void;
  onSend: (caption: string) => void;
  isSending?: boolean;
}

export const VideoSendPreviewModal: React.FC<VideoSendPreviewModalProps> = ({
  isOpen,
  file,
  duration,
  onClose,
  onSend,
  isSending = false,
}) => {
  const [caption, setCaption] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoObjectUrl(url);
      setCaption('');
      setIsPlaying(false);
      return () => {
        URL.revokeObjectURL(url);
        setVideoObjectUrl(null);
      };
    }
  }, [file]);

  if (!isOpen || !file || !videoObjectUrl) return null;

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSend = () => {
    if (isSending) return;
    onSend(caption.trim());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-fade-in">
      <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/90">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold text-sm sm:text-base">
            <Film className="w-5 h-5 text-red-500" />
            <span>Video Önizleme</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-mono">
              {formatVideoDuration(duration)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Container */}
        <div className="relative bg-black flex-1 min-h-[220px] max-h-[420px] flex items-center justify-center overflow-hidden group">
          <video
            ref={videoRef}
            src={videoObjectUrl}
            className="w-full h-full object-contain max-h-[420px]"
            playsInline
            onEnded={() => setIsPlaying(false)}
            onClick={togglePlay}
          />

          {/* Play/Pause Center Overlay Button */}
          <button
            type="button"
            onClick={togglePlay}
            className={`absolute p-4 rounded-full bg-red-600 text-white shadow-xl hover:scale-105 active:scale-95 transition-all ${
              isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
            }`}
          >
            {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1 fill-white" />}
          </button>
        </div>

        {/* Caption & Controls Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/95 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isSending) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Açıklama veya mesaj ekle..."
              disabled={isSending}
              className="w-full bg-zinc-800/90 text-zinc-100 placeholder-zinc-500 text-sm px-4 py-2.5 rounded-xl border border-zinc-700/60 focus:outline-none focus:border-red-500/80 transition-colors"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 active:scale-95 transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{isSending ? 'Gönderiliyor...' : 'Gönder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
