import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Channel, ChannelPost, UserProfile } from '../types';
import {
  subscribeToChannelPosts,
  createChannelPost,
  deleteChannelPost,
  deleteChannel,
  recordPostView,
} from '../services/channelService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { VerifiedBadge } from './VerifiedBadge';
import { EmojiPicker } from './EmojiPicker';
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
} from 'lucide-react';

interface ChannelViewProps {
  channel: Channel;
  currentUser: UserProfile;
  isOwner: boolean;
  isAdmin?: boolean;
  isFollowing: boolean;
  badgeUrl?: string;
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

  // Yeni gönderi state'leri (Kurucu / Admin için)
  const [postText, setPostText] = useState('');
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Lightbox modal state (Görseli büyütme)
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const postsContainerRef = useRef<HTMLDivElement>(null);
  const viewedPostIdsRef = useRef<Set<string>>(new Set());

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

      await createChannelPost(channel.id, trimmed, finalImageUrl, channel.name);

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
          <div className="relative shrink-0">
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
          </div>

          {/* Kanal Başlığı & Takipçi Bilgisi */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-tight">
              <h1 className="font-bold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 truncate">
                {channel.name}
              </h1>
              {channel.isVerified && (
                <VerifiedBadge badgeUrl={badgeUrl} size="sm" />
              )}
            </div>
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
              onClick={() => onFollowToggle(channel.id, !isFollowing)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isFollowing
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400'
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-red-600/20'
              }`}
            >
              {isFollowing ? (
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

      {/* 2. KANAL AÇIKLAMA VE BİLGİ KARTI */}
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
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl shadow-xs overflow-hidden transition-all hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                {/* Gönderi Başlığı: Kanal Bilgisi (KESİNLİKLE KURUCU BİLGİSİ YOK!) */}
                <div className="p-3.5 pb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0">
                      {channel.photoURL ? (
                        <img
                          src={channel.photoURL}
                          alt={channel.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Radio className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {channel.name}
                        </span>
                        {channel.isVerified && (
                          <VerifiedBadge badgeUrl={badgeUrl} size="xs" />
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-400">{postDate}</span>
                    </div>
                  </div>

                  {/* Silme Butonu (Sadece Kurucu veya Admin) */}
                  {(isOwner || isAdmin) && (
                    <button
                      id={`delete-post-${post.id}`}
                      onClick={() => setPostToDelete(post.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                      title="Gönderiyi Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Gönderi Metni */}
                {post.text && (
                  <div className="px-4 py-2 text-xs sm:text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                    {post.text}
                  </div>
                )}

                {/* Gönderi Görseli */}
                {post.imageUrl && (
                  <div className="mt-2 relative bg-black/5 dark:bg-black/30 overflow-hidden flex justify-center">
                    <img
                      src={post.imageUrl}
                      alt="Kanal Paylaşımı"
                      onClick={() => setLightboxImageUrl(post.imageUrl || null)}
                      className="w-full max-h-96 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                      loading="lazy"
                    />
                  </div>
                )}

                {/* Gönderi Alt Çubuğu: Görüntülenme Sayısı */}
                <div className="px-4 py-2.5 bg-zinc-50/50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Eye className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{post.viewsCount || 0} görüntülenme</span>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* 4. ALT ÇUBUK: GÖNDERİ PAYLAŞMA (YALNIZCA KURUCU VEYA ADMİN) */}
      {(isOwner || isAdmin) ? (
        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 shrink-0 z-20">
          <div className="max-w-2xl mx-auto">
            {postError && (
              <div className="mb-2 p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-2 text-red-600 dark:text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{postError}</span>
              </div>
            )}

            {/* Fotoğraf Önizlemesi */}
            {previewPhotoUrl && (
              <div className="relative mb-2 inline-block">
                <img
                  src={previewPhotoUrl}
                  alt="Önizleme"
                  className="h-20 w-auto rounded-xl object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm"
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
              <div className="absolute bottom-20 left-4 sm:left-auto z-50">
                <EmojiPicker
                  onSelectEmoji={handleEmojiSelect}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}

            <form onSubmit={handlePublishPost} className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />

              {/* Görsel Ekle Butonu */}
              <button
                type="button"
                id="channel-attach-photo-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={posting}
                className="p-2.5 text-zinc-500 dark:text-zinc-400 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                title="Görsel Ekle"
              >
                <ImageIcon className="w-5 h-5" />
              </button>

              {/* Emoji Butonu */}
              <button
                type="button"
                id="channel-emoji-picker-btn"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                disabled={posting}
                className="p-2.5 text-zinc-500 dark:text-zinc-400 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                title="Emoji"
              >
                <Smile className="w-5 h-5" />
              </button>

              {/* Metin Giriş Alanı */}
              <input
                id="channel-post-input"
                type="text"
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                placeholder="Kanalınızda yeni bir güncelleme paylaşın..."
                disabled={posting}
                className="flex-1 px-4 py-2.5 text-xs sm:text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
              />

              {/* Paylaş Butonu */}
              <button
                type="submit"
                id="channel-publish-btn"
                disabled={posting || (!postText.trim() && !selectedPhotoFile)}
                className="p-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none text-white rounded-xl shadow-md shadow-red-600/20 transition-all cursor-pointer flex items-center justify-center shrink-0"
                title="Yayınla"
              >
                {posting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Normal Kullanıcılar İçin Bilgilendirici Alt Çubuk */
        <div className="p-3 bg-zinc-100/70 dark:bg-zinc-900/70 border-t border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 shrink-0">
          📢 Bu kanalda yalnızca yöneticiler gönderi paylaşabilir.
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
    </div>
  );
};
