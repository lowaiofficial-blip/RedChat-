import React, { useState, useEffect, useRef } from 'react';
import type { Channel, ChannelFollower, UserProfile } from '../types';
import {
  updateChannelInfo,
  deleteChannel,
  subscribeToChannelFollowers,
  clearAllChannelReactions,
  subscribeToChannelOwners,
  addChannelCoOwner,
  removeChannelCoOwner,
} from '../services/channelService';
import { isUserAdmin } from '../services/adminService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import {
  X,
  Camera,
  Trash2,
  Users,
  Settings,
  Radio,
  Loader2,
  AlertCircle,
  Check,
  Calendar,
  ShieldCheck,
  RotateCcw,
  Smile,
  Crown,
  ShieldAlert,
  UserCheck,
  UserMinus,
} from 'lucide-react';

interface ChannelManageModalProps {
  channel: Channel;
  currentUser: UserProfile;
  badgeUrl?: string | null;
  onClose: () => void;
  onChannelDeleted: () => void;
  onChannelUpdated?: (updated?: Channel) => void;
}

export const ChannelManageModal: React.FC<ChannelManageModalProps> = ({
  channel,
  currentUser,
  badgeUrl,
  onClose,
  onChannelDeleted,
  onChannelUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'followers'>('settings');
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || '');
  const [followers, setFollowers] = useState<ChannelFollower[]>([]);
  const [loadingFollowers, setLoadingFollowers] = useState(true);

  // Kurucu & Ortak Kurucular
  const [ownerInfo, setOwnerInfo] = useState<{ ownerId: string; coOwnerIds: string[] }>({
    ownerId: '',
    coOwnerIds: [],
  });
  const [managingOwnerUid, setManagingOwnerUid] = useState<string | null>(null);

  const isSystemAdmin = isUserAdmin(currentUser);
  const isPrimaryOwner = Boolean(ownerInfo.ownerId && ownerInfo.ownerId === currentUser.uid);

  // Fotoğraf state'leri
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(channel.photoURL || null);
  const [selectedBannerFile, setSelectedBannerFile] = useState<File | null>(null);
  const [previewBannerUrl, setPreviewBannerUrl] = useState<string | null>(channel.bannerUrl || null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Takipçileri ve Kurucuları dinle
  useEffect(() => {
    setLoadingFollowers(true);
    const unsubscribeFollowers = subscribeToChannelFollowers(channel.id, (list) => {
      setFollowers(list);
      setLoadingFollowers(false);
    });

    const unsubscribeOwners = subscribeToChannelOwners(channel.id, (info) => {
      setOwnerInfo(info);
    });

    return () => {
      unsubscribeFollowers();
      unsubscribeOwners();
    };
  }, [channel.id]);

  const handleGrantFounder = async (follower: ChannelFollower) => {
    try {
      setManagingOwnerUid(follower.uid);
      setError(null);
      await addChannelCoOwner(channel.id, {
        uid: follower.uid,
        displayName: follower.displayName,
        username: follower.username,
        photoURL: follower.photoURL,
      });
      setSuccess(`@${follower.username} kullanıcısına Kurucu yetkisi verildi.`);
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Kurucu yetkisi verilirken hata oluştu.');
    } finally {
      setManagingOwnerUid(null);
    }
  };

  const handleRevokeFounder = async (followerUid: string, username: string) => {
    try {
      setManagingOwnerUid(followerUid);
      setError(null);
      await removeChannelCoOwner(channel.id, followerUid);
      setSuccess(`@${username} kullanıcısının Kurucu yetkisi geri alındı.`);
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Kurucu yetkisi kaldırılırken hata oluştu.');
    } finally {
      setManagingOwnerUid(null);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Lütfen geçerli bir görsel dosyası seçin.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Görsel boyutu en fazla 10MB olabilir.');
      return;
    }

    setSelectedPhotoFile(file);
    const objUrl = URL.createObjectURL(file);
    setPreviewPhotoUrl(objUrl);
    setError(null);
  };

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Lütfen geçerli bir görsel dosyası seçin.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Görsel boyutu en fazla 10MB olabilir.');
      return;
    }

    setSelectedBannerFile(file);
    const objUrl = URL.createObjectURL(file);
    setPreviewBannerUrl(objUrl);
    setError(null);
  };

  const handleRemovePhoto = () => {
    setSelectedPhotoFile(null);
    setPreviewPhotoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveBanner = () => {
    setSelectedBannerFile(null);
    setPreviewBannerUrl(null);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (!trimmedName) {
      setError('Kanal adı boş bırakılamaz.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      let finalPhotoUrl = previewPhotoUrl;
      if (selectedPhotoFile) {
        finalPhotoUrl = await uploadImageToImgBB(selectedPhotoFile);
      }

      let finalBannerUrl = previewBannerUrl;
      if (selectedBannerFile) {
        finalBannerUrl = await uploadImageToImgBB(selectedBannerFile);
      }

      await updateChannelInfo(channel.id, {
        name: trimmedName,
        description: trimmedDesc,
        photoURL: finalPhotoUrl,
        bannerUrl: finalBannerUrl,
      });

      const updatedChannel: Channel = {
        ...channel,
        name: trimmedName,
        description: trimmedDesc,
        photoURL: finalPhotoUrl,
        bannerUrl: finalBannerUrl,
      };
      setSuccess('Kanal bilgileri başarıyla güncellendi.');
      onChannelUpdated?.(updatedChannel);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Güncelleme sırasında hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [clearingReactions, setClearingReactions] = useState(false);
  const [showClearReactionsConfirm, setShowClearReactionsConfirm] = useState(false);

  const handleExecuteClearReactions = async () => {
    try {
      setClearingReactions(true);
      setError(null);
      await clearAllChannelReactions(channel.id);
      setSuccess('Bu kanaldaki tüm gönderilerin emoji tepkileri başarıyla sıfırlandı.');
      setShowClearReactionsConfirm(false);
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Tepkiler sıfırlanırken hata oluştu.');
    } finally {
      setClearingReactions(false);
    }
  };

  const handleExecuteDeleteChannel = async () => {
    try {
      setDeleting(true);
      setError(null);
      await deleteChannel(channel.id, currentUser.uid);
      onChannelDeleted();
    } catch (err: any) {
      setError(err?.message || 'Kanal silinirken hata oluştu.');
      setDeleting(false);
    }
  };

  return (
    <div
      id="channel-manage-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="channel-manage-modal-container"
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-600/10 text-red-600 flex items-center justify-center font-bold">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span>Kanal Yönetimi</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 font-semibold">
                  Kurucu
                </span>
              </h2>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                <span className="truncate max-w-[200px]">{channel.name}</span>
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
            </div>
          </div>
          <button
            id="close-channel-manage-modal"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 pb-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <button
            id="channel-tab-settings"
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Kanal Ayarları</span>
          </button>

          <button
            id="channel-tab-followers"
            onClick={() => setActiveTab('followers')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'followers'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Takipçiler ({followers.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 mb-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-start gap-2.5 text-red-600 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 mb-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-start gap-2.5 text-emerald-600 dark:text-emerald-400 text-xs">
              <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: KANAL AYARLARI */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              {/* Gizlilik Bildirimi */}
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-start gap-2.5 text-zinc-600 dark:text-zinc-400 text-xs">
                <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Kanalınızın kurucu kimliği normal kullanıcılara ve takipçilere gösterilmez. Bu yönetim paneli yalnızca sizin hesabınıza özeldir.
                </span>
              </div>

              {/* Profil Görseli Düzenleme */}
              <div className="flex items-center gap-4 py-1">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                    {previewPhotoUrl ? (
                      <img
                        src={previewPhotoUrl}
                        alt="Kanal Fotoğrafı"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Radio className="w-7 h-7 text-zinc-400" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-red-600 text-white rounded-lg shadow-sm hover:bg-red-700 transition-colors cursor-pointer"
                    title="Görseli Değiştir"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                  {previewPhotoUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="absolute -top-1 -right-1 p-1 bg-zinc-900 text-zinc-200 rounded-md shadow-sm hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Görseli Kaldır"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                
                {/* Banner Görseli Düzenleme */}
                <div className="relative flex-1">
                  <div className="w-full h-16 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                    {previewBannerUrl ? (
                      <img
                        src={previewBannerUrl}
                        alt="Kanal Bannerı"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] text-zinc-400 font-medium">Banner (Opsiyonel)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-red-600 text-white rounded-lg shadow-sm hover:bg-red-700 transition-colors cursor-pointer"
                    title="Bannerı Değiştir"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                  {previewBannerUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveBanner}
                      className="absolute -top-1 -right-1 p-1 bg-zinc-900 text-zinc-200 rounded-md shadow-sm hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Bannerı Kaldır"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBannerSelect}
                  className="hidden"
                />
              </div>

              {/* Kanal Adı */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Kanal Adı
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>

              {/* Kanal Açıklaması */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Açıklama
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={300}
                  rows={3}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none"
                />
              </div>

              {/* Güncelle Butonu */}
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-all shadow-md shadow-red-600/20 flex items-center gap-1.5 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Kaydediliyor...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Değişiklikleri Kaydet</span>
                    </>
                  )}
                </button>
              </div>

              {/* Hızlı İşlemler: Yalnızca Bu Kanalın Tepkilerini Sıfırla */}
              <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800">
                <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-950/80 bg-amber-50/50 dark:bg-amber-950/20 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <Smile className="w-3.5 h-3.5" />
                        <span>Kanal Gönderi Tepkilerini Sıfırla</span>
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        Yalnızca bu kanaldaki gönderilerin emoji tepkilerini temizler. Diğer sohbetleri veya kanalları etkilemez.
                      </p>
                    </div>
                    {!showClearReactionsConfirm && (
                      <button
                        type="button"
                        id="clear-channel-reactions-btn"
                        onClick={() => setShowClearReactionsConfirm(true)}
                        disabled={clearingReactions}
                        className="px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Sıfırla</span>
                      </button>
                    )}
                  </div>

                  {showClearReactionsConfirm && (
                    <div className="p-3 bg-amber-100/90 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-in fade-in duration-150">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        Bu kanaldaki tüm tepkileri sıfırlamak istiyor musunuz?
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowClearReactionsConfirm(false)}
                          disabled={clearingReactions}
                          className="px-3 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          id="confirm-clear-channel-reactions-btn"
                          onClick={handleExecuteClearReactions}
                          disabled={clearingReactions}
                          className="px-3 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer"
                        >
                          {clearingReactions ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          <span>Evet, Sıfırla</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tehlikeli Bölge (Kanal Silme) */}
              <div className="pt-3">
                <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-950/80 bg-red-50/50 dark:bg-red-950/20 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-red-600 dark:text-red-400">
                        Kanalı Sil
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        Kanal ve tüm paylaşılan gönderiler kalıcı olarak silinir.
                      </p>
                    </div>
                    {!showDeleteConfirm && (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deleting}
                        className="px-3 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Sil</span>
                      </button>
                    )}
                  </div>

                  {showDeleteConfirm && (
                    <div className="p-3 bg-red-100/80 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-in fade-in duration-150">
                      <span className="text-xs font-bold text-red-700 dark:text-red-300">
                        Gerçekten silmek istiyor musunuz?
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={deleting}
                          className="px-3 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          onClick={handleExecuteDeleteChannel}
                          disabled={deleting}
                          className="px-3 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer"
                        >
                          {deleting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                          <span>Evet, Sil</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </form>
          )}

          {/* TAB 2: TAKİPÇİ VE KURUCU YÖNETİMİ (SADECE KURUCU VE ADMİN) */}
          {activeTab === 'followers' && (
            <div className="space-y-3">
              {/* Kurucu Yetki Bilgilendirme Kartı */}
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-2.5">
                <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <span className="font-bold">Kurucu Yetkisi:</span> Başka bir kullanıcıya Kurucu yetkisi verdiğinizde, o kişi de sizin gibi kanalda gönderi paylaşabilir ve fotoğraf yükleyebilir.
                  {!isPrimaryOwner && !isSystemAdmin && (
                    <span className="block mt-1 text-amber-700 dark:text-amber-300 font-semibold">
                      ℹ️ Ortak kurucular diğer kullanıcıların kurucu yetkisini değiştiremez veya kendi yetkilerini kaldıramaz. Bu yetki yalnızca asıl kanal sahibine aittir.
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">
                  Toplam {followers.length} Takipçi
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full font-medium">
                  Gizli Liste (Yalnızca siz görebilirsiniz)
                </span>
              </div>

              {loadingFollowers ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <span className="text-xs">Takipçiler yükleniyor...</span>
                </div>
              ) : followers.length === 0 ? (
                <div className="py-8 text-center text-zinc-400 text-xs">
                  Henüz takipçi bulunmuyor.
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-80 overflow-y-auto pr-1">
                  {followers.map((f) => {
                    const isMainOwner = ownerInfo.ownerId === f.uid;
                    const isCoOwner = Boolean(ownerInfo.coOwnerIds?.includes(f.uid));
                    const isSelf = currentUser.uid === f.uid;
                    const isProcessing = managingOwnerUid === f.uid;
                    const canManageFounders = isPrimaryOwner || isSystemAdmin;

                    const followedDate = f.followedAt?.toDate
                      ? f.followedAt.toDate().toLocaleDateString('tr-TR')
                      : '';

                    return (
                      <div
                        key={f.uid}
                        className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar
                            photoURL={f.photoURL}
                            name={f.displayName || f.username}
                            username={f.username}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                {f.displayName || f.username}
                              </span>
                              {isSelf && (
                                <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.2 rounded-md">
                                  (Sen)
                                </span>
                              )}
                              {isMainOwner && (
                                <span className="px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 rounded-md flex items-center gap-0.5">
                                  <Crown className="w-3 h-3 text-amber-600 fill-amber-500" />
                                  <span>Kurucu</span>
                                </span>
                              )}
                              {isCoOwner && !isMainOwner && (
                                <span className="px-1.5 py-0.2 text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/80 rounded-md flex items-center gap-0.5">
                                  <Crown className="w-3 h-3 text-red-600 fill-red-500" />
                                  <span>Ortak Kurucu</span>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400">
                              @{f.username}
                            </div>
                          </div>
                        </div>

                        {/* Aksiyonlar (Kurucu Yetkisi Verme / Geri Alma) */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          {isMainOwner ? (
                            <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg">
                              Kanal Sahibi
                            </span>
                          ) : isCoOwner ? (
                            canManageFounders && !isSelf ? (
                              <button
                                type="button"
                                id={`revoke-founder-${f.uid}`}
                                onClick={() => handleRevokeFounder(f.uid, f.username)}
                                disabled={isProcessing}
                                className="px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/60 border border-red-200 dark:border-red-900/60 rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                title="Kurucu Yetkisini Kaldır"
                              >
                                {isProcessing ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <UserMinus className="w-3 h-3" />
                                )}
                                <span>Yetkiyi Kaldır</span>
                              </button>
                            ) : (
                              <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded-lg border border-red-200 dark:border-red-900/50 flex items-center gap-1">
                                <Crown className="w-3 h-3 fill-red-500" />
                                <span>Ortak Kurucu</span>
                              </span>
                            )
                          ) : (
                            canManageFounders ? (
                              <button
                                type="button"
                                id={`grant-founder-${f.uid}`}
                                onClick={() => handleGrantFounder(f)}
                                disabled={isProcessing}
                                className="px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/70 border border-amber-300 dark:border-amber-800 rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-2xs"
                                title="Bu kullanıcıya Kurucu yetkisi ver"
                              >
                                {isProcessing ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Crown className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                                )}
                                <span>Kurucu Yap</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-400">Takipçi</span>
                            )
                          )}

                          {followedDate && (
                            <div className="text-[10px] text-zinc-400 hidden sm:flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>{followedDate}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
