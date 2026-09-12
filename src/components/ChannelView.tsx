import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Channel, ChannelPost, UserProfile } from '../types';
import {
  subscribeToChannelPosts,
  createChannelPost,
  deleteChannelPost,
  deleteChannel,
  recordPostView,
  toggleChannelPostReaction,
  clearChannelPostReactions,
} from '../services/channelService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { VerifiedBadge } from './VerifiedBadge';
import { EmojiPicker } from './EmojiPicker';
import { ChannelProfileModal } from './ChannelProfileModal';
import {
  ArrowLeft,
  Radio,
  Users,
  Eye,
  Settings,
  Send,
  Image as ImageIcon,
  Smile,
  Trash2,
  Loader2,
  X,
  Check,
  Share2,
  ShieldCheck,
  AlertCircle,
  Bell,
  BellOff,
  Sparkles,
  Plus,
  RotateCcw,
} from 'lucide-react';

/**
 * WhatsApp Kalitesinde Metin Formatlayıcı:
 * - Paragraflar ve satır boşluklarını korur
 * - Linkleri (URL) otomatik algılayıp tıklanabilir yapar
 * - *kalın* ve _italik_ vurgularını destekler
 */
function FormattedPostText({ text }: { text: string }) {
  if (!text) return null;

  const urlRegex = /(https?:\/\/[^\s]+)/g;

  const parseInline = (chunk: string, lineKey: number) => {
    // *kalın* ve _italik_ parçalama
    const tokens = chunk.split(/(\*[^*]+\*|_[^_]+_)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
        return (
          <strong key={`${lineKey}-${idx}`} className="font-bold text-zinc-950 dark:text-white">
            {token.slice(1, -1)}
          </strong>
        );
      }
      if (token.startsWith('_') && token.endsWith('_') && token.length > 2) {
        return (
          <em key={`${lineKey}-${idx}`} className="italic">
            {token.slice(1, -1)}
          </em>
        );
      }
      return token;
    });
  };

  const lines = text.split('\n');

  return (
    <div className="space-y-2 text-zinc-900 dark:text-zinc-100 text-[14px] sm:text-[15px] leading-relaxed select-text font-normal">
      {lines.map((line, lineIdx) => {
        if (!line.trim()) {
          return <div key={lineIdx} className="h-2.5" />;
        }

        const parts = line.split(urlRegex);
        return (
          <p key={lineIdx} className="break-words">
            {parts.map((part, pIdx) => {
              if (part.match(urlRegex)) {
                return (
                  <a
                    key={pIdx}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline inline-flex items-baseline break-all"
                  >
                    {part}
                  </a>
                );
              }
              return parseInline(part, lineIdx);
            })}
          </p>
        );
      })}
    </div>
  );
}

interface ChannelViewProps {
  channel: Channel;
  currentUser: UserProfile;
  isOwner: boolean;
  isAdmin?: boolean;
  isFollowing: boolean;
  badgeUrl?: string | null;
  onBack: () => void;
  onFollowToggle: (channelId: string, follow: boolean) => void | Promise<void>;
  onOpenManage: (channel: Channel) => void;
  onDeleteSuccess?: () => void;
}

export const ChannelView: React.FC<ChannelViewProps> = ({
  channel,
  currentUser,
  isOwner,
  isAdmin = false,
  isFollowing,
  badgeUrl,
  onBack,
  onFollowToggle,
  onOpenManage,
  onDeleteSuccess,
}) => {
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [showChannelProfile, setShowChannelProfile] = useState(false);

  // Yeni gönderi state'leri (Kurucu / Admin için)
  const [postText, setPostText] = useState('');
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Lightbox modal state (Görseli büyütme)
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  // Takip Et/Çık Loading ve Spam Koruması State'i
  const [followLoading, setFollowLoading] = useState(false);

  // Gönderi Tepki (Reaction) State'leri
  const [activeReactionPostId, setActiveReactionPostId] = useState<string | null>(null);
  const [showReactionEmojiPickerPostId, setShowReactionEmojiPickerPostId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const postsContainerRef = useRef<HTMLDivElement>(null);
  const postsEndRef = useRef<HTMLDivElement>(null);
  const viewedPostIdsRef = useRef<Set<string>>(new Set());

  // Otomatik en alta (en yeni gönderiye) kaydırma
  useEffect(() => {
    if (posts.length > 0) {
      // İlk yüklemede ve yeni mesaj geldiğinde sohbet gibi en alta kaydır
      postsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [posts.length, channel.id]);

  // Takip Et / Takipten Çık Tıklama İşleyicisi (Spam ve Hızlı Tıklama Korumalı)
  const handleFollowClick = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    try {
      await onFollowToggle(channel.id, !isFollowing);
    } catch (err) {
      console.error('Takip işlemi gerçekleştirilemedi:', err);
    } finally {
      setTimeout(() => {
        setFollowLoading(false);
      }, 500);
    }
  };

  // Tepkiyi Aç/Kapat (Toggle)
  const handleToggleReaction = async (postId: string, emoji: string) => {
    try {
      await toggleChannelPostReaction(channel.id, postId, currentUser.uid, emoji);
    } catch (err) {
      console.error('Kanal gönderisine tepki verilemedi:', err);
    }
  };

  // Gönderileri canlı dinle
  useEffect(() => {
    setLoadingPosts(true);
    const unsubscribe = subscribeToChannelPosts(channel.id, (fetchedPosts) => {
      setPosts(fetchedPosts);
      setLoadingPosts(false);

      // Otomatik görüntülenme sayımı (Her gönderiye bir kez Firestore üzerinden yazılır)
      fetchedPosts.forEach((p) => {
        if (!viewedPostIdsRef.current.has(p.id)) {
          viewedPostIdsRef.current.add(p.id);
          recordPostView(channel.id, p.id, currentUser.uid);
        }
      });
    });

    return () => unsubscribe();
  }, [channel.id, currentUser.uid]);

  // Fotoğraf seçimi
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPostError('Lütfen geçerli bir görsel dosyası seçin.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setPostError('Görsel boyutu en fazla 10MB olabilir.');
      return;
    }

    setPostError(null);
    setSelectedPhotoFile(file);
    const objUrl = URL.createObjectURL(file);
    setPreviewPhotoUrl(objUrl);
  };

  const handleRemovePhoto = () => {
    setSelectedPhotoFile(null);
    if (previewPhotoUrl) {
      URL.revokeObjectURL(previewPhotoUrl);
      setPreviewPhotoUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEmojiSelect = (emoji: string) => {
    setPostText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  // Yeni gönderi yayınla
  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = postText.trim();
    if (!trimmed && !selectedPhotoFile) {
      setPostError('Lütfen bir metin girin veya görsel ekleyin.');
      return;
    }

    try {
      setPosting(true);
      setPostError(null);

      let finalImageUrl: string | null = null;
      if (selectedPhotoFile) {
        finalImageUrl = await uploadImageToImgBB(selectedPhotoFile);
      }

      await createChannelPost(channel.id, trimmed, finalImageUrl, channel.name, currentUser.uid);

      // Formu temizle
      setPostText('');
      handleRemovePhoto();
      setShowEmojiPicker(false);
    } catch (err: any) {
      console.error('Gönderi paylaşılırken hata:', err);
      setPostError(err?.message || 'Gönderi paylaşılırken bir hata oluştu.');
    } finally {
      setPosting(false);
    }
  };

  // Gönderi silme state'i
  const [postToDelete, setPostToDelete] = useState<string | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);

  const handleConfirmDeletePost = async () => {
    if (!postToDelete) return;
    try {
      setDeletingPost(true);
      await deleteChannelPost(channel.id, postToDelete);
      setPostToDelete(null);
    } catch (err: any) {
      console.error('Gönderi silinemedi:', err);
      setPostError(err?.message || 'Gönderi silinirken hata oluştu.');
    } finally {
      setDeletingPost(false);
    }
  };

  // Kanalı doğrudan silme state'i
  const [showDeleteChannelModal, setShowDeleteChannelModal] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState(false);

  const handleConfirmDeleteChannel = async () => {
    try {
      setDeletingChannel(true);
      await deleteChannel(channel.id, currentUser.uid);
      setShowDeleteChannelModal(false);
      onDeleteSuccess?.();
    } catch (err: any) {
      console.error('Kanal silinirken hata:', err);
      setPostError(err?.message || 'Kanal silinirken yetki hatası oluştu.');
      setDeletingChannel(false);
    }
  };

  return (
    <div
      id={`channel-view-${channel.id}`}
      className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden relative"
    >
      {/* 1. ÜST BAŞLIK / HEADER */}
      <div className="h-16 px-4 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobil Geri Butonu */}
          <button
            id="channel-back-button"
            onClick={onBack}
            className="md:hidden p-2 -ml-1 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            title="Geri"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Kanal Avatarı */}
          <button 
            onClick={() => setShowChannelProfile(true)}
            className="relative shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
            title="Kanal Profilini Görüntüle"
          >
            <div className="w-10 h-10 rounded-2xl overflow-hidden bg-zinc-200 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
              {channel.photoURL ? (
                <img
                  src={channel.photoURL}
                  alt={channel.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Radio className="w-5 h-5 text-red-600" />
              )}
            </div>
          </button>

          {/* Kanal Başlığı & Takipçi Bilgisi */}
          <div className="min-w-0 flex-1">
            <button 
              onClick={() => setShowChannelProfile(true)}
              className="flex items-center gap-1.5 leading-tight hover:underline focus:outline-none text-left"
            >
              <h1 className="font-bold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 truncate">
                {channel.name}
              </h1>
              {channel.isVerified && (
                <VerifiedBadge
                  isVerified={true}
                  type="channel"
                  channel={{
                    id: channel.id,
                    name: channel.name,
                    photoURL: channel.photoURL,
                    description: channel.description,
                  }}
                  badgeUrl={badgeUrl}
                  size="sm"
                />
              )}
            </button>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1 font-medium">
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                {channel.followerCount || 0} takipçi
              </span>
              <span>•</span>
              <span className="text-[11px] text-zinc-400">
                {posts.length} gönderi
              </span>
            </div>
          </div>
        </div>

        {/* Sağ Butonlar: Kurucu/Admin için Yönetim ve Silme, Diğerleri için Takip Et */}
        <div className="flex items-center gap-2 shrink-0">
          {(isOwner || isAdmin) ? (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-semibold bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-1.5 shadow-2xs">
                👑 {isAdmin && !isOwner ? 'Yönetici' : 'Kurucu'}
              </span>

              <button
                id="channel-manage-btn"
                onClick={() => onOpenManage(channel)}
                className="px-3 py-1.5 text-xs font-bold bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Kanalı Yönet"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Yönetim</span>
              </button>

              <button
                id="channel-quick-delete-btn"
                onClick={() => setShowDeleteChannelModal(true)}
                disabled={deletingChannel}
                className="px-3 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer border border-red-200 dark:border-red-900/50 disabled:opacity-50"
                title="Kanalı Kalıcı Olarak Sil"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Kanalı Sil</span>
              </button>
            </div>
          ) : (
            <button
              id="channel-follow-toggle-btn"
              onClick={handleFollowClick}
              disabled={followLoading}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-70 disabled:cursor-not-allowed ${
                isFollowing
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400'
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-red-600/20'
              }`}
            >
              {followLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-current" />
                  <span>{isFollowing ? 'Ayrılınıyor...' : 'Takip ediliyor...'}</span>
                </>
              ) : isFollowing ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Takip Ediliyor</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5" />
                  <span>Takip Et</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 2. KANAL BANNERI */}
      {channel.bannerUrl && (
        <div className="w-full h-32 sm:h-48 shrink-0 relative">
          <img
            src={channel.bannerUrl}
            alt="Kanal Bannerı"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
        </div>
      )}

      {/* 3. KANAL AÇIKLAMA VE BİLGİ KARTI */}
      <div className="px-4 py-3 bg-white/50 dark:bg-zinc-900/50 border-b border-zinc-200/60 dark:border-zinc-800/60 shrink-0">
        <div className="max-w-2xl mx-auto flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 flex items-center justify-center shrink-0 mt-0.5">
            <Radio className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">
              {channel.description || 'Bu kanal için henüz açıklama girilmedi.'}
            </p>
          </div>
        </div>
      </div>

      {/* 3. GÖNDERİLER LİSTESİ (FEED) */}
      <div
        ref={postsContainerRef}
        id="channel-posts-feed"
        className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl w-full mx-auto"
      >
        {loadingPosts ? (
          <div className="py-16 flex flex-col items-center justify-center text-zinc-400">
            <Loader2 className="w-7 h-7 animate-spin mb-2.5 text-red-600" />
            <span className="text-xs">Gönderiler yükleniyor...</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-3">
              <Radio className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-1">
              Henüz Paylaşım Yok
            </h3>
            <p className="text-xs text-zinc-500 max-w-xs">
              Bu kanalda henüz bir gönderi paylaşılmadı. Yeni güncellemeler için takipte kalın!
            </p>
          </div>
        ) : (
          posts.map((post) => {
            const postDate = post.createdAt?.toDate
              ? post.createdAt.toDate().toLocaleString('tr-TR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';

            return (
              <article
                key={post.id}
                id={`channel-post-${post.id}`}
                className="bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-xs overflow-hidden transition-all hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                {/* 1. Gönderi Görseli (WhatsApp Tarzı En Üstte Tam Genişlik) */}
                {post.imageUrl && (
                  <div className="relative bg-black/5 dark:bg-black/30 overflow-hidden flex justify-center cursor-pointer group">
                    <img
                      src={post.imageUrl}
                      alt="Kanal Paylaşımı"
                      onClick={() => setLightboxImageUrl(post.imageUrl || null)}
                      className="w-full max-h-[460px] object-cover hover:opacity-95 transition-opacity"
                      loading="lazy"
                    />
                  </div>
                )}

                {/* 2. Gönderi İçeriği: Başlık, WhatsApp Formatlı Metin ve Tepkiler */}
                <div className="p-4 sm:p-5 pt-3.5 pb-3 space-y-3">
                  {/* Başlık: Kanal Adı, Rozet ve Tarih */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <button 
                        onClick={() => setShowChannelProfile(true)}
                        className="w-8 h-8 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
                      >
                        {channel.photoURL ? (
                          <img
                            src={channel.photoURL}
                            alt={channel.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Radio className="w-4 h-4 text-red-600" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => setShowChannelProfile(true)}
                            className="text-xs font-bold text-zinc-900 dark:text-zinc-100 hover:underline focus:outline-none text-left"
                          >
                            {channel.name}
                          </button>
                          {channel.isVerified && (
                            <VerifiedBadge
                              isVerified={true}
                              type="channel"
                              channel={{
                                id: channel.id,
                                name: channel.name,
                                photoURL: channel.photoURL,
                                description: channel.description,
                              }}
                              badgeUrl={badgeUrl}
                              size="xs"
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400">{postDate}</span>
                      </div>
                    </div>

                    {/* Gönderi İşlem Butonları (Sadece Kurucu veya Admin) */}
                    {(isOwner || isAdmin) && (
                      <div className="flex items-center gap-1">
                        {post.reactions && Object.keys(post.reactions).length > 0 && (
                          <button
                            id={`clear-reactions-post-${post.id}`}
                            onClick={() => clearChannelPostReactions(channel.id, post.id)}
                            className="p-1.5 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition-colors cursor-pointer"
                            title="Bu Gönderinin Tepkilerini Sıfırla"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          id={`delete-post-${post.id}`}
                          onClick={() => setPostToDelete(post.id)}
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                          title="Gönderiyi Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* WhatsApp Kalitesinde Gönderi Metni (Geniş Paragraflar ve Tıklanabilir Linkler) */}
                  {post.text && (
                    <div className="pt-0.5">
                      <FormattedPostText text={post.text} />
                    </div>
                  )}

                  {/* 3. Gönderi Alt Çubuğu: Tepkiler (Kullanıcılar ve Kurucu) & Görüntülenme (Sadece Kurucu/Admin) */}
                  <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-2 flex-wrap">
                    {/* Sol: Tepki Ekle ve Mevcut Tepkiler */}
                    <div className="flex items-center gap-1.5 flex-wrap relative">
                      {/* Hızlı Tepki Ekle Butonu */}
                      <div className="relative">
                        <button
                          type="button"
                          id={`post-reaction-btn-${post.id}`}
                          onClick={() => {
                            setActiveReactionPostId(
                              activeReactionPostId === post.id ? null : post.id
                            );
                            setShowReactionEmojiPickerPostId(null);
                          }}
                          className="px-2.5 py-1 text-zinc-500 dark:text-zinc-400 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer flex items-center gap-1 text-xs border border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/50 dark:bg-zinc-800/40"
                          title="Tepki Ekle"
                        >
                          <Smile className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-medium">Tepki</span>
                        </button>

                        {/* Hızlı Tepki Açılır Çubuğu (WhatsApp Stili) */}
                        {activeReactionPostId === post.id && (
                          <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-xl p-1.5 flex items-center gap-1 z-30 animate-in zoom-in-95 duration-150">
                            {['❤️', '👍', '🔥', '👏', '😂', '🎉', '🥊', '🇹🇷'].map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => {
                                  handleToggleReaction(post.id, emoji);
                                  setActiveReactionPostId(null);
                                }}
                                className="w-8 h-8 flex items-center justify-center text-lg hover:scale-125 active:scale-95 transition-transform rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                              >
                                {emoji}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setShowReactionEmojiPickerPostId(post.id);
                                setActiveReactionPostId(null);
                              }}
                              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
                              title="Daha fazla emoji"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        )}

                        {/* Tam Emoji Seçici Açılır Penceresi */}
                        {showReactionEmojiPickerPostId === post.id && (
                          <div className="absolute bottom-full left-0 mb-2 z-50">
                            <EmojiPicker
                              onSelectEmoji={(emoji) => {
                                handleToggleReaction(post.id, emoji);
                                setShowReactionEmojiPickerPostId(null);
                              }}
                              onClose={() => setShowReactionEmojiPickerPostId(null)}
                            />
                          </div>
                        )}
                      </div>

                      {/* Mevcut Tepki Hapları (Pills) */}
                      {post.reactions &&
                        Object.entries(post.reactions).map(([emoji, uids]) => {
                          if (!uids || uids.length === 0) return null;
                          const hasReacted = uids.includes(currentUser.uid);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(post.id, emoji)}
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs transition-all cursor-pointer border ${
                                hasReacted
                                  ? 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-semibold shadow-2xs'
                                  : 'bg-zinc-100/80 dark:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/80 dark:hover:bg-zinc-700'
                              }`}
                              title={`${uids.length} kişi bu tepkiyi verdi`}
                            >
                              <span>{emoji}</span>
                              <span className="text-[10px] font-mono">{uids.length}</span>
                            </button>
                          );
                        })}
                    </div>

                    {/* Sağ: Görüntülenme Sayısı (YALNIZCA Kurucu ve Admin) */}
                    <div className="flex items-center gap-2 ml-auto">
                      {(isOwner || isAdmin) && (
                        <div
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/60 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium"
                          title="Görüntülenme Sayısı (Yalnızca Kurucu ve Yöneticiler görebilir)"
                        >
                          <Eye className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{post.viewsCount || 0}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
        {/* En alta otomatik kaydırma referansı */}
        <div ref={postsEndRef} />
      </div>

      {/* 4. ALT ÇUBUK: GÖNDERİ PAYLAŞMA (YALNIZCA KURUCU VEYA ADMİN) */}
      {(isOwner || isAdmin) ? (
        currentUser.isMuted ? (
          <div className="p-3.5 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 shrink-0 z-20 shadow-sm">
            <div className="max-w-2xl mx-auto">
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex flex-col items-center justify-center text-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                  Hesabınız susturulduğu için şu anda kanalınızda paylaşım yapamazsınız.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 shrink-0 z-20 shadow-sm">
            <div className="max-w-2xl mx-auto">
              {postError && (
              <div className="mb-2.5 p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-2 text-red-600 dark:text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{postError}</span>
              </div>
            )}

            {/* Fotoğraf Önizlemesi */}
            {previewPhotoUrl && (
              <div className="relative mb-2.5 inline-block">
                <img
                  src={previewPhotoUrl}
                  alt="Önizleme"
                  className="h-24 w-auto rounded-xl object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm"
                />
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="absolute -top-1.5 -right-1.5 p-1 bg-zinc-900 text-white rounded-full shadow-md hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Emoji Seçici Açılır Penceresi */}
            {showEmojiPicker && (
              <div className="absolute bottom-24 left-4 sm:left-auto z-50">
                <EmojiPicker
                  onSelectEmoji={handleEmojiSelect}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}

            <form onSubmit={handlePublishPost} className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />

              {/* WhatsApp Kalitesinde Çok Satırlı Giriş Alanı */}
              <div className="relative flex items-start rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 focus-within:ring-2 focus-within:ring-red-500/20 focus-within:border-red-500 transition-all p-1.5">
                <textarea
                  id="channel-post-input"
                  rows={2}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handlePublishPost(e as any);
                    }
                  }}
                  placeholder="Kanalınızda yeni bir güncelleme paylaşın...&#10;Paragraflar oluşturabilir, link ve görsel ekleyebilirsiniz."
                  disabled={posting}
                  className="flex-1 px-3 py-2 text-xs sm:text-sm bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none resize-none min-h-[50px] max-h-40 leading-relaxed font-normal"
                />

                <div className="flex items-center gap-1 self-end pb-1 pr-1">
                  {/* Görsel Ekle Butonu */}
                  <button
                    type="button"
                    id="channel-attach-photo-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={posting}
                    className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-red-600 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 rounded-xl transition-colors cursor-pointer"
                    title="Görsel Ekle"
                  >
                    <ImageIcon className="w-4.5 h-4.5" />
                  </button>

                  {/* Emoji Butonu */}
                  <button
                    type="button"
                    id="channel-emoji-picker-btn"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    disabled={posting}
                    className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-red-600 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 rounded-xl transition-colors cursor-pointer"
                    title="Emoji"
                  >
                    <Smile className="w-4.5 h-4.5" />
                  </button>

                  {/* Paylaş Butonu */}
                  <button
                    type="submit"
                    id="channel-publish-btn"
                    disabled={posting || (!postText.trim() && !selectedPhotoFile)}
                    className="p-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none text-white rounded-xl shadow-md shadow-red-600/20 transition-all cursor-pointer flex items-center justify-center shrink-0"
                    title="Paylaş (Ctrl+Enter)"
                  >
                    {posting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
                <span>💡 Paragraf ve boşluklar korunur. Ctrl+Enter ile hızlıca paylaşabilirsiniz.</span>
              </div>
            </form>
          </div>
        </div>
        )
      ) : (
        /* Normal Kullanıcılar İçin Bilgilendirici Alt Çubuk */
        <div className="p-3 bg-zinc-100/70 dark:bg-zinc-900/70 border-t border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 shrink-0">
          📢 Bu kanalda yalnızca yöneticiler gönderi paylaşabilir. Takipçiler tepki ekleyebilir.
        </div>
      )}

      {/* 5. GÖRSEL LIGHTBOX MODAL */}
      {lightboxImageUrl && (
        <div
          id="channel-image-lightbox"
          onClick={() => setLightboxImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200"
        >
          <button
            onClick={() => setLightboxImageUrl(null)}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImageUrl}
            alt="Büyütülmüş Görsel"
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
        </div>
      )}

      {/* 6. GÖNDERİ SİLME ONAY MODALI */}
      {postToDelete && (
        <div
          id="delete-post-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Gönderiyi Sil
                </h3>
                <p className="text-xs text-zinc-500">
                  Bu gönderi kanaldan kalıcı olarak silinecektir.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setPostToDelete(null)}
                disabled={deletingPost}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePost}
                disabled={deletingPost}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                {deletingPost ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. KANAL SİLME ONAY MODALI */}
      {showDeleteChannelModal && (
        <div
          id="delete-channel-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Kanalı Sil
                </h3>
                <p className="text-xs text-zinc-500">
                  "{channel.name}" kanalı ve tüm gönderileri kalıcı olarak silinecektir. Bu işlem geri alınamaz.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowDeleteChannelModal(false)}
                disabled={deletingChannel}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteChannel}
                disabled={deletingChannel}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                {deletingChannel ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Evet, Kanalı Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showChannelProfile && (
        <ChannelProfileModal
          channel={channel}
          badgeUrl={badgeUrl}
          onClose={() => setShowChannelProfile(false)}
        />
      )}
    </div>
  );
};
