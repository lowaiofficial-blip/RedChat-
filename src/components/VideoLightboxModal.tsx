import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize, RotateCcw } from 'lucide-react';
import { formatVideoDuration } from '../services/videoUploadService';

interface VideoLightboxModalProps {
  isOpen: boolean;
  videoUrl: string | null;
  videoDuration?: number | null;
  caption?: string | null;
  senderName?: string | null;
  timeString?: string | null;
  onClose: () => void;
}

export const VideoLightboxModal: React.FC<VideoLightboxModalProps> = ({
  isOpen,
  videoUrl,
  videoDuration,
  caption,
  senderName,
  timeString,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(videoDuration || 0);

  useEffect(() => {
    if (isOpen && videoUrl) {
      setIsPlaying(false);
      setCurrentTime(0);
      if (videoDuration) setDuration(videoDuration);
    }
  }, [isOpen, videoUrl, videoDuration]);

  if (!isOpen || !videoUrl) return null;

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

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (!duration && videoRef.current.duration) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[110] flex flex-col justify-between bg-black/95 backdrop-blur-lg animate-fade-in text-white select-none overflow-hidden"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-10">
        <div className="flex flex-col">
          {senderName && (
            <span className="font-semibold text-sm text-zinc-100">{senderName}</span>
          )}
          {timeString && (
            <span className="text-xs text-zinc-400">{timeString}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white transition-colors"
          title="Kapat"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Video Viewport */}
      <div className="relative flex-1 flex items-center justify-center p-2 sm:p-6 overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-w-full max-h-full object-contain rounded-xl shadow-2xl cursor-pointer"
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current && videoRef.current.duration) {
              setDuration(videoRef.current.duration);
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onClick={togglePlay}
        />

        {/* Center Big Overlay Button - removed backdrop-blur to eliminate unwanted blur spot */}
        {!isPlaying && (
          <button
            type="button"
            onClick={togglePlay}
            className="absolute p-5 rounded-full bg-red-600 text-white shadow-2xl hover:scale-110 active:scale-95 transition-all z-20"
          >
            <Play className="w-10 h-10 ml-1 fill-white" />
          </button>
        )}
      </div>

      {/* Caption & Controls Bottom Bar */}
      <div className="p-4 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col gap-3 z-10">
        {caption && (
          <p className="text-sm text-zinc-200 px-2 text-center max-w-2xl mx-auto break-words font-medium">
            {caption}
          </p>
        )}

        {/* Video Control Bar */}
        <div className="max-w-2xl mx-auto w-full bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-3 flex flex-col gap-2 backdrop-blur-md">
          {/* Timeline slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-400 w-10 text-right">
              {formatVideoDuration(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              style={{
                background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%, #3f3f46 ${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%, #3f3f46 100%)`,
              }}
              className="video-range-slider flex-1 h-1.5 rounded-lg cursor-pointer accent-red-600"
            />
            <span className="text-xs font-mono text-zinc-400 w-10">
              {formatVideoDuration(duration)}
            </span>
          </div>

          {/* Buttons row */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                title={isPlaying ? 'Durdur' : 'Oynat'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5 fill-white" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = 0;
                    setCurrentTime(0);
                  }
                }}
                className="p-2 rounded-xl bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 transition-colors"
                title="Baştan Başlat"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                title={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                title="Tam Ekran"
              >
                <Maximize className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
