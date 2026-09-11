import React from 'react';
import type { ChannelNotification, Channel } from '../types';
import { UserAvatar } from './UserAvatar';
import {
  Bell,
  X,
  CheckCheck,
  Trash2,
  Eye,
  Radio,
  Clock,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

interface ChannelNotificationsModalProps {
  notifications: ChannelNotification[];
  channels: Channel[];
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onMarkAsRead: (notifId: string) => void;
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
}

export const ChannelNotificationsModal: React.FC<ChannelNotificationsModalProps> = ({
  notifications,
  channels,
  onClose,
  onSelectChannel,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAll,
}) => {
  const unreadCount = notifications.filter((n) => !n.read).length;

  const formatNotificationTime = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Az önce';
    if (diffMins < 60) return `${diffMins} dk önce`;
    if (diffHours < 24) return `${diffHours} sa önce`;
    if (diffDays === 1) return 'Dün';
    if (diffDays < 7) return `${diffDays} gün önce`;
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };

  const handleOpenChannel = (notif: ChannelNotification) => {
    onMarkAsRead(notif.id);
    onSelectChannel(notif.channelId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/70 dark:bg-zinc-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Kanal Bildirimleri
                </h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                    {unreadCount} Yeni
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Takip ettiğiniz kanallardan paylaşılan son gönderiler
              </p>
            </div>
          </div>

          <button
            id="close-channel-notifs-modal-btn"
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Bar (Eğer bildirim varsa) */}
        {notifications.length > 0 && (
          <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs bg-white dark:bg-zinc-900">
            <span className="text-zinc-500 font-medium">
              Toplam {notifications.length} bildirim
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllAsRead}
                  className="px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Tümünü Okundu Say</span>
                </button>
              )}
              <button
                onClick={onClearAll}
                className="px-2.5 py-1 text-xs font-semibold text-zinc-500 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Temizle</span>
              </button>
            </div>
          </div>
        )}

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60 p-2 sm:p-3">
          {notifications.length === 0 ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center text-zinc-400">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center mb-3">
                <Bell className="w-6 h-6 text-zinc-400" />
              </div>
              <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                Henüz Kanal Bildirimi Yok
              </h3>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mt-1">
                Takip ettiğiniz kanallarda yeni bir gönderi paylaşıldığında bildirimler burada listelenecektir.
              </p>
            </div>
          ) : (
            notifications.map((notif) => {
              const channel = channels.find((c) => c.id === notif.channelId);
              const channelPhoto = notif.channelPhotoURL || channel?.photoURL;
              const channelName = notif.channelName || channel?.name || 'Kanal';
              const timeString = formatNotificationTime(notif.createdAt);

              return (
                <div
                  key={notif.id}
                  className={`p-3 sm:p-3.5 rounded-xl transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    !notif.read
                      ? 'bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40 border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="relative shrink-0 mt-0.5">
                      <UserAvatar
                        photoURL={channelPhoto}
                        name={channelName}
                        size="md"
                      />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                        <Radio className="w-2.5 h-2.5" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {channelName}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          yeni bir gönderi paylaştı:
                        </span>
                        {!notif.read && (
                          <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
                        )}
                      </div>

                      {/* Paylaşılan İçerik Önizlemesi */}
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 font-medium mt-1 line-clamp-2 break-words">
                        {notif.text || (notif.imageUrl ? '📷 [Fotoğraf]' : 'Yeni Gönderi')}
                      </p>

                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{timeString}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Sağ Taraf: Görüntüle Butonu */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0 w-full sm:w-auto justify-end">
                    <button
                      id={`view-channel-post-${notif.id}`}
                      onClick={() => handleOpenChannel(notif)}
                      className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs shadow-red-600/20"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Görüntüle</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
