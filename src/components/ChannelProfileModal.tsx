import React from 'react';
import type { Channel } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { X, Radio, Users, MessageSquare } from 'lucide-react';

interface ChannelProfileModalProps {
  channel: Channel;
  badgeUrl?: string | null;
  onClose: () => void;
}

export const ChannelProfileModal: React.FC<ChannelProfileModalProps> = ({
  channel,
  badgeUrl,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="absolute inset-0"
        onClick={onClose}
      />
      
      <div className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Kapat Butonu */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-md transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Banner */}
        <div className="w-full h-32 sm:h-40 bg-zinc-200 dark:bg-zinc-800 relative">
          {channel.bannerUrl ? (
            <img 
              src={channel.bannerUrl} 
              alt="Banner" 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-tr from-red-500/20 to-orange-500/20" />
          )}
        </div>

        {/* İçerik */}
        <div className="px-5 pb-6">
          {/* Avatar (Banner üzerine taşan) */}
          <div className="relative -mt-12 mb-3">
            <div className="w-24 h-24 rounded-2xl bg-white dark:bg-zinc-900 p-1">
              <div className="w-full h-full rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                {channel.photoURL ? (
                  <img
                    src={channel.photoURL}
                    alt={channel.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Radio className="w-10 h-10 text-red-600" />
                )}
              </div>
            </div>
          </div>

          {/* İsim ve Badge */}
          <div className="flex items-center gap-1.5 mb-1">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              {channel.name}
            </h2>
            {channel.isVerified && (
              <VerifiedBadge 
                isVerified={true} 
                type="channel" 
                channel={{ id: channel.id, name: channel.name, photoURL: channel.photoURL, description: channel.description }}
                badgeUrl={badgeUrl}
                size="sm"
              />
            )}
          </div>

          {/* İstatistikler */}
          <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400 mb-4 mt-2">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{channel.followerCount || 0}</span>
              <span>Takipçi</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4" />
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{channel.postCount || 0}</span>
              <span>Gönderi</span>
            </div>
          </div>

          {/* Açıklama */}
          <div className="text-[15px] text-zinc-700 dark:text-zinc-300 leading-relaxed bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-100 dark:border-zinc-800">
            {channel.description || 'Bu kanal için henüz bir açıklama girilmemiş.'}
          </div>
        </div>
      </div>
    </div>
  );
};
