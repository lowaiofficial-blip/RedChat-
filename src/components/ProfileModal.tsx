import { UserVerificationForm } from './UserVerificationForm';
import { BusinessSetupModal } from './BusinessSetupModal';
import { BusinessToolsTab } from './BusinessToolsTab';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { UserProfile } from '../types';
import { updateUserProfileDetails, logoutUser } from '../services/authService';
import { formatLastSeen } from '../services/chatService';
import { uploadProfilePhoto } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import { isRedChatAI } from '../services/aiService';
import { getStoredTheme, applyTheme, type ThemeMode } from '../utils/theme';
import { requestNotificationPermissionAndToken, removeTokenFromFirestore } from '../services/messagingService';
import { blockUser, unblockUser } from '../services/blockService';
import {
  X,
  Mail,
  Edit3,
  Check,
  Loader2,
  LogOut,
  Circle,
  MessageSquare,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Palette,
  Camera,
  Trash2,
  AlertCircle,
  Sparkles,
  Bot,
  Bell,
  Book,
  UserX,
  UserCheck,
  Zap,
  Store,
  Globe,
  Phone,
  MapPin,
  Clock,
  Building2,
  ExternalLink,
  Briefcase,
  ChevronRight,
} from 'lucide-react';

import { MemoryModal } from './MemoryModal';

interface ProfileModalProps {
  user: UserProfile;
  isCurrentUser: boolean;
  onClose: () => void;
  onStartChat?: (user: UserProfile) => void;
  initialTab?: 'profile' | 'settings' | 'business_tools';
  badgeUrl?: string | null;
  currentUserId?: string;
  blockedUserIds?: string[];
  onBlockStatusChange?: (blocked: boolean) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  isCurrentUser,
  onClose,
  onStartChat,
  initialTab = 'profile',
  badgeUrl,
  currentUserId,
  blockedUserIds = [],
  onBlockStatusChange,
}) => {
  const isBusiness = user?.accountType === 'business';
  const business = user?.businessProfile;

  const [activeTab, setActiveTab] = useState<'profile' | 'settings' | 'business_tools'>(initialTab);
  const [showMemory, setShowMemory] = useState(false);
  const [showBusinessSetupModal, setShowBusinessSetupModal] = useState(false);

  // Düzenleme state'leri
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(
    isBusiness
      ? business?.businessName || user?.displayName || user?.username || 'Kullanıcı'
      : user?.displayName || user?.username || 'Kullanıcı'
  );
  const [bio, setBio] = useState(isBusiness ? business?.description || user?.bio || '' : user?.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🚫 Kullanıcı Engelleme State'leri
  const [showBlockConfirmModal, setShowBlockConfirmModal] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const isBlocked = useMemo(() => {
    if (!blockedUserIds || !user?.uid) return false;
    return blockedUserIds.includes(user.uid);
  }, [blockedUserIds, user?.uid]);

  const handleConfirmBlock = async () => {
    if (!currentUserId || !user?.uid) return;
    try {
      setBlockLoading(true);
      setBlockError(null);
      setError(null);
      await blockUser(currentUserId, user.uid);
      setShowBlockConfirmModal(false);
      onBlockStatusChange?.(true);
    } catch (err: any) {
      console.error('Kullanıcı engellenirken hata:', err);
      const msg = err?.message || 'Kullanıcı engellenemedi.';
      setBlockError(msg);
      setError(msg);
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUnblock = async () => {
    if (!currentUserId || !user?.uid) return;
    try {
      setBlockLoading(true);
      setError(null);
      await unblockUser(currentUserId, user.uid);
      onBlockStatusChange?.(false);
    } catch (err: any) {
      console.error('Engel kaldırılırken hata:', err);
      setError(err?.message || 'Engel kaldırılamadı.');
    } finally {
      setBlockLoading(false);
    }
  };

  // Push notification state
  const [pushEnabled, setPushEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted';
    } catch {
      return false;
    }
  });
  const [pushLoading, setPushLoading] = useState(false);

  const handleTogglePush = async () => {
    if (!isCurrentUser || !user?.uid) return;
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setError('Bu cihaz veya tarayıcı anlık bildirimleri desteklemiyor.');
      return;
    }
    setPushLoading(true);
    setError(null);
    try {
      if (pushEnabled) {
        await removeTokenFromFirestore(user.uid);
        setPushEnabled(false);
      } else {
        await requestNotificationPermissionAndToken(user.uid);
        setPushEnabled(typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted');
      }
    } catch (err: any) {
      console.error(err);
      setError('Bildirim ayarı değiştirilemedi. İzin verdiğinizden emin olun.');
    } finally {
      setPushLoading(false);
    }
  };

  // Anlık profil fotoğrafı state'i
  const [currentPhotoURL, setCurrentPhotoURL] = useState<string | null>(
    (isBusiness ? business?.photoURL : null) || user.photoURL || null
  );

  // Fotoğraf Onay & Yükleme State'leri
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tema state'i
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);

  const handleSelectTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    applyTheme(mode);
  };

  // ESC tuşu ile modalı kapatma desteği
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showBlockConfirmModal) {
          if (!blockLoading) {
            setShowBlockConfirmModal(false);
          }
        } else if (showConfirmModal) {
          if (!isUploadingPhoto) {
            setShowConfirmModal(false);
          }
        } else if (showBusinessSetupModal) {
          setShowBusinessSetupModal(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showBlockConfirmModal, blockLoading, showConfirmModal, isUploadingPhoto, showBusinessSetupModal]);

  // Gelen prop değiştiğinde senkronize et
  useEffect(() => {
    setCurrentPhotoURL((isBusiness ? business?.photoURL : null) || user?.photoURL || null);
    if (!editing) {
      setDisplayName(
        isBusiness
          ? business?.businessName || user?.displayName || user?.username || 'Kullanıcı'
          : user?.displayName || user?.username || 'Kullanıcı'
      );
      setBio(isBusiness ? business?.description || user?.bio || '' : user?.bio || '');
    }
  }, [user, isBusiness, business, editing]);

  // ObjectURL cleanup
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Görsel boyutu en fazla 10MB olabilir.');
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setShowConfirmModal(true);
    setError(null);
    setPhotoSuccess(null);
  };

  const handleCancelUpload = () => {
    if (isUploadingPhoto) return;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setShowConfirmModal(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile || isUploadingPhoto) return;

    setIsUploadingPhoto(true);
    setError(null);
    try {
      const downloadUrl = await uploadProfilePhoto(selectedFile);

      await updateUserProfileDetails(user.uid, {
        photoURL: downloadUrl,
      });

      setCurrentPhotoURL(downloadUrl);
      setShowConfirmModal(false);
      setPhotoSuccess('Profil fotoğrafın güncellendi.');
      setTimeout(() => setPhotoSuccess(null), 4000);

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error('Fotoğraf yükleme hatası:', err);
      setError(err?.message || 'Fotoğraf yüklenemedi. Lütfen tekrar deneyin.');
      setShowConfirmModal(false);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (isUploadingPhoto) return;
    setIsUploadingPhoto(true);
    setError(null);
    try {
      await updateUserProfileDetails(user.uid, {
        photoURL: null,
      });
      setCurrentPhotoURL(null);
      setPhotoSuccess('Profil fotoğrafı kaldırıldı.');
      setTimeout(() => setPhotoSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Fotoğraf kaldırılamadı.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('İsim boş bırakılamaz');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateUserProfileDetails(user.uid, {
        displayName: displayName.trim(),
        bio: bio.trim(),
      });
      setEditing(false);
      setPhotoSuccess('Profil bilgileri kaydedildi.');
      setTimeout(() => setPhotoSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Profil güncellenirken hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const headerTitle = isBusiness
    ? business?.businessName || user.displayName || user.username
    : user.displayName || user.username;

  const modalContent = (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-sm w-full p-5 sm:p-6 shadow-2xl relative my-auto max-h-[calc(100dvh-2rem)] flex flex-col overflow-y-auto"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer z-10"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Sekme Seçici (Mevcut Kullanıcı İçin) */}
          {isCurrentUser && (
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-5 pb-2 gap-4 text-xs font-bold overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveTab('profile')}
                className={`pb-1 cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === 'profile'
                    ? 'text-red-600 border-b-2 border-red-600'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                Profil
              </button>

              {isBusiness && (
                <button
                  onClick={() => setActiveTab('business_tools')}
                  className={`pb-1 cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${
                    activeTab === 'business_tools'
                      ? 'text-red-600 border-b-2 border-red-600'
                      : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                  }`}
                >
                  <Store className="w-3.5 h-3.5" />
                  <span>İşletme Araçları</span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('settings')}
                className={`pb-1 cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'text-red-600 border-b-2 border-red-600'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                Ayarlar
              </button>
            </div>
          )}

          {/* 🏢 SEKME: İŞLETME ARAÇLARI (YALNIZCA İŞLETME SAHİBİ İÇİN) */}
          {activeTab === 'business_tools' && isCurrentUser ? (
            <BusinessToolsTab
              currentUser={user}
              onSwitchToPersonal={() => setActiveTab('profile')}
            />
          ) : activeTab === 'profile' ? (
            <>
              {/* Profile Header & Avatar */}
              <div className="flex flex-col items-center text-center mb-4">
                <div className="relative mb-3">
                  <div className="relative group">
                    <UserAvatar
                      photoURL={currentPhotoURL}
                      name={headerTitle}
                      username={user.username}
                      size="2xl"
                      shape="circle"
                      className="shadow-lg shadow-red-600/10 ring-2 ring-zinc-100 dark:ring-zinc-800"
                    />

                    {/* Fotoğraf Değiştirme Butonu */}
                    {isCurrentUser && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploadingPhoto}
                        className="absolute inset-0 rounded-full bg-black/45 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:opacity-50"
                        title="Profil fotoğrafını değiştir"
                      >
                        <Camera className="w-5 h-5" />
                        <span className="text-[9px] font-bold mt-0.5">Değiştir</span>
                      </button>
                    )}
                  </div>

                  {/* Online / Offline Rozeti (RedChat AI için gösterilmez) */}
                  {!isRedChatAI(user) && (
                    <span
                      className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white dark:border-zinc-900 ${
                        user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                      }`}
                      title={user.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
                    />
                  )}
                </div>

                {/* Gizli Dosya Girişi */}
                {isCurrentUser && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                )}

                {/* Değiştir / Kaldır Butonları */}
                {isCurrentUser && (
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingPhoto}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-700 dark:text-red-400 flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-3 h-3" />
                      Fotoğrafı değiştir
                    </button>
                    {currentPhotoURL && (
                      <>
                        <span className="text-zinc-300 dark:text-zinc-700">•</span>
                        <button
                          onClick={handleRemovePhoto}
                          disabled={isUploadingPhoto}
                          className="text-[11px] font-semibold text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          Kaldır
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Kullanıcı / İşletme İsmi ve Mavi Tik */}
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {headerTitle}
                  </h3>
                  <VerifiedBadge
                    isVerified={user.isVerified}
                    badgeUrl={badgeUrl}
                    size="md"
                    user={{
                      displayName: headerTitle,
                      username: user.username,
                      photoURL: currentPhotoURL || user.photoURL,
                    }}
                  />
                </div>

                {/* İşletme Alt Başlığı veya Normal Kullanıcı Adı */}
                {isBusiness ? (
                  <div className="mt-1 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono text-zinc-400">@{user.username}</span>
                      <span>•</span>
                      <span className="text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                        <Store className="w-3 h-3" />
                        <span>İşletme Hesabı</span>
                      </span>
                      {business?.category && (
                        <>
                          <span>•</span>
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">
                            {business.category}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-red-600 font-mono font-medium mt-0.5">
                    @{user.username}
                  </p>
                )}

                {/* Durum Rozeti (RedChat AI için gizlenir) */}
                {!isRedChatAI(user) && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                        user.isOnline
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      <Circle
                        className={`w-2 h-2 ${
                          user.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-zinc-400 text-zinc-400'
                        }`}
                      />
                      {formatLastSeen(user.isOnline, user.lastSeen)}
                    </span>
                  </div>
                )}
              </div>

              {/* Başarı Bildirimi */}
              {photoSuccess && (
                <div className="mb-3 p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-2 animate-in fade-in">
                  <Check className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{photoSuccess}</span>
                </div>
              )}

              {/* Hata Bildirimi */}
              {error && (
                <div className="mb-4 p-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/50 flex items-center gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Normal Profil Düzenleme Formu (Kişisel Hesap İçin) */}
              {isCurrentUser && !isBusiness && editing ? (
                <form onSubmit={handleSave} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Görünen İsim
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      className="w-full text-xs px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Biyografi
                    </label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={2}
                      placeholder="Kendinizden bahsedin..."
                      className="w-full text-xs px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 resize-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="flex-1 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    >
                      İptal
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Kaydet
                    </button>
                  </div>
                </form>
              ) : (
                /* 📄 PROFİL İÇERİK KARTLARI */
                <div className="space-y-2.5">
                  {/* 🏢 İŞLETME PROFİLİ GÖRÜNÜMÜ (Yalnızca kullanıcının gerçekten girdiği dolu alanlar gösterilir) */}
                  {isBusiness ? (
                    <div className="space-y-2">
                      {/* Açıklama */}
                      {(business?.description?.trim() || user.bio?.trim()) && (
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block mb-0.5">
                            Açıklama
                          </span>
                          <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                            {business?.description?.trim() || user.bio?.trim()}
                          </p>
                        </div>
                      )}

                      {/* Kategori */}
                      {Boolean(business?.category?.trim()) && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5 text-red-500" />
                            <span>Kategori</span>
                          </span>
                          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                            {business!.category!.trim()}
                          </span>
                        </div>
                      )}

                      {/* Web Sitesi (Yalnızca geçerli değer varsa gösterilir) */}
                      {Boolean(
                        business?.website?.trim() &&
                          !['pexal.com', 'https://pexal.com', 'https://websiteniz.com', 'websiteniz.com'].includes(
                            business.website.trim().toLowerCase()
                          )
                      ) && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-blue-500" />
                            <span>Web Sitesi</span>
                          </span>
                          <a
                            href={
                              business!.website!.trim().startsWith('http')
                                ? business!.website!.trim()
                                : `https://${business!.website!.trim()}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 truncate max-w-[170px] hover:underline flex items-center gap-1"
                          >
                            <span className="truncate">
                              {business!.website!.trim().replace(/^https?:\/\//, '')}
                            </span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </div>
                      )}

                      {/* İletişim E-postası */}
                      {Boolean((business?.email?.trim() || user.email?.trim()) && (business?.email?.trim() || user.email?.trim()) !== 'example@email.com') && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-amber-500" />
                            <span>İletişim E-postası</span>
                          </span>
                          <a
                            href={`mailto:${business?.email?.trim() || user.email?.trim()}`}
                            className="text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:text-red-600 dark:hover:text-red-400 truncate max-w-[170px]"
                          >
                            {business?.email?.trim() || user.email?.trim()}
                          </a>
                        </div>
                      )}

                      {/* Telefon (Yalnızca geçerli değer varsa gösterilir) */}
                      {Boolean(
                        business?.phone?.trim() &&
                          !business.phone.trim().includes('+90 555...') &&
                          !business.phone.trim().includes('+90 555 123 45 67')
                      ) && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Telefon</span>
                          </span>
                          <a
                            href={`tel:${business!.phone!.trim()}`}
                            className="text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:text-red-600 dark:hover:text-red-400"
                          >
                            {business!.phone!.trim()}
                          </a>
                        </div>
                      )}

                      {/* Konum (Yalnızca geçerli değer varsa gösterilir) */}
                      {Boolean(
                        business?.location?.trim() &&
                          !['örnek adres', 'ornek adres'].includes(business.location.trim().toLowerCase())
                      ) && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-rose-500" />
                            <span>Konum</span>
                          </span>
                          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 text-right truncate max-w-[170px]">
                            {business!.location!.trim()}
                          </span>
                        </div>
                      )}

                      {/* Çalışma Saatleri (Yalnızca geçerli değer varsa gösterilir) */}
                      {Boolean(business?.hours?.trim()) && (
                        <div className="p-2.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-purple-500" />
                            <span>Çalışma Saatleri</span>
                          </span>
                          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 text-right">
                            {business!.hours!.trim()}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : isRedChatAI(user) ? (
                    <>
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-400 block mb-0.5">
                          Hakkında
                        </span>
                        <p className="text-xs text-zinc-700 dark:text-zinc-200">
                          {user.bio || 'RedChat Resmi Yapay Zeka Asistanı'}
                        </p>
                      </div>

                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                          <span className="text-zinc-400">Mod:</span>
                          <span className="font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>Hızlı</span>
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Kişisel Profil Kartı */
                    <>
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 block mb-0.5">
                          Biyografi
                        </span>
                        <p className="text-xs text-zinc-700 dark:text-zinc-300">
                          {user.bio || 'Henüz biyografi eklenmedi.'}
                        </p>
                      </div>

                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                          <Mail className="w-3.5 h-3.5 text-zinc-400" />
                          <span className="truncate">{user.email}</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Aksiyon Butonları */}
                  <div className="pt-2 flex flex-col gap-2">
                    {isCurrentUser ? (
                      isBusiness ? (
                        <button
                          onClick={() => setActiveTab('business_tools')}
                          className="w-full py-2.5 px-3 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-900/60 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Store className="w-3.5 h-3.5" />
                          <span>İşletme Araçlarını Yönet</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditing(true)}
                          className="w-full py-2 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Profili Düzenle</span>
                        </button>
                      )
                    ) : (
                      <>
                        {isBlocked ? (
                          <div className="flex flex-col gap-2">
                            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-center">
                              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1.5">
                                <UserX className="w-3.5 h-3.5" />
                                Bu kullanıcıyı engellediniz
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={handleUnblock}
                              disabled={blockLoading}
                              className="w-full py-2.5 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-xl border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                              {blockLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              )}
                              <span>Engeli Kaldır</span>
                            </button>
                          </div>
                        ) : (
                          <>
                            {onStartChat && (
                              <button
                                onClick={() => {
                                  onStartChat(user);
                                  onClose();
                                }}
                                className={`w-full py-2.5 px-3 text-xs font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                                  isRedChatAI(user)
                                    ? 'bg-fuchsia-600 hover:bg-fuchsia-700 shadow-fuchsia-600/20'
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
                              >
                                {isRedChatAI(user) ? (
                                  <>
                                    <Bot className="w-4 h-4" />
                                    <span>DeepRed ile Sohbet Et</span>
                                  </>
                                ) : isBusiness ? (
                                  <>
                                    <MessageSquare className="w-4 h-4" />
                                    <span>İşletmeyle Sohbet Başlat</span>
                                  </>
                                ) : (
                                  <>
                                    <MessageSquare className="w-4 h-4" />
                                    <span>Sohbet Başlat</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* 🚫 Kullanıcıyı Engelle Butonu */}
                            {!isRedChatAI(user) && currentUserId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBlockError(null);
                                  setShowBlockConfirmModal(true);
                                }}
                                disabled={blockLoading}
                                className="w-full py-2.5 px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-xl border border-rose-200/80 dark:border-rose-900/60 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                              >
                                <UserX className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                                <span>Engelle</span>
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ⚙️ SEKME: AYARLAR */
            <div className="space-y-4 py-1">
              {/* 🏢 İŞLETME HESABI BÖLÜMÜ (AYARLAR -> HESAP) */}
              {isCurrentUser && (
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-red-600" />
                    Hesap Türü & İşletme
                  </h4>

                  {isBusiness ? (
                    <div className="p-3.5 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Store className="w-4 h-4 text-red-600 dark:text-red-400" />
                          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {business?.businessName || user.displayName}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60">
                          İşletme Hesabı
                        </span>
                      </div>

                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        İşletme profilinizi, kategorinizi ve iletişim detaylarınızı İşletme Araçları sekmesinden dilediğiniz gibi güncelleyebilirsiniz.
                      </p>

                      <button
                        onClick={() => setActiveTab('business_tools')}
                        className="w-full py-2 px-3 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Store className="w-3.5 h-3.5" />
                        <span>İşletme Araçlarını Aç</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h5 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5 text-red-600" />
                            İşletme Hesabına Geç
                          </h5>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                            RedChat üzerinde işletmenizi daha profesyonel şekilde tanıtın.
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setShowBusinessSetupModal(true)}
                        className="w-full mt-1 py-2 px-3 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-900/60 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />
                          <span>İşletme Hesabına Geç</span>
                        </span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Görünüm ve Tema */}
              <div>
                <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-red-600" />
                  Görünüm ve Tema
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleSelectTheme('light')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      themeMode === 'light'
                        ? 'border-red-600 bg-red-50/50 text-red-600 dark:bg-red-950/20'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>Açık</span>
                  </button>
                  <button
                    onClick={() => handleSelectTheme('dark')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      themeMode === 'dark'
                        ? 'border-red-600 bg-red-50/50 text-red-600 dark:bg-red-950/20'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Koyu</span>
                  </button>
                  <button
                    onClick={() => handleSelectTheme('system')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      themeMode === 'system'
                        ? 'border-red-600 bg-red-50/50 text-red-600 dark:bg-red-950/20'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span>Sistem</span>
                  </button>
                </div>
              </div>

              {/* Bildirim Ayarı */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-white mb-2.5 flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-zinc-500" />
                  Bildirimler
                </h4>
                <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      Anlık Bildirimler
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Mesaj geldiğinde cihazına bildirim gönderilir
                    </span>
                  </div>
                  <button
                    onClick={handleTogglePush}
                    disabled={pushLoading}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none ${
                      pushEnabled ? 'bg-red-600' : 'bg-zinc-200 dark:bg-zinc-700'
                    } ${pushLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="sr-only">Bildirimleri Aç</span>
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                        pushEnabled ? 'translate-x-2' : '-translate-x-2'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Mavi Tik Doğrulama Başvurusu */}
              {isCurrentUser && <UserVerificationForm user={user} />}

              {/* Alt Butonlar */}
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                <button
                  onClick={() => setShowMemory(true)}
                  className="w-full py-2.5 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-xl transition-colors flex items-center justify-between cursor-pointer border border-red-100 dark:border-red-500/20"
                >
                  <span className="flex items-center gap-2">
                    <Book className="w-3.5 h-3.5 text-red-500" /> DeepRed AI Belleği
                  </span>
                  <span className="text-zinc-400">›</span>
                </button>

                {isBusiness ? (
                  <button
                    onClick={() => setActiveTab('business_tools')}
                    className="w-full py-2.5 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Store className="w-3.5 h-3.5 text-red-600" /> İşletme Araçları
                    </span>
                    <span className="text-zinc-400">›</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setActiveTab('profile');
                      setEditing(true);
                    }}
                    className="w-full py-2.5 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Edit3 className="w-3.5 h-3.5" /> Profili Düzenle
                    </span>
                    <span className="text-zinc-400">›</span>
                  </button>
                )}

                <button
                  onClick={async () => {
                    await logoutUser();
                    onClose();
                  }}
                  className="w-full py-2.5 px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl border border-rose-200/60 dark:border-rose-900/60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Çıkış Yap</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bellek Modal */}
      {showMemory && (
        <MemoryModal userId={user.uid} onClose={() => setShowMemory(false)} />
      )}

      {/* 🏢 İŞLETME HESABINA GEÇİŞ KURULUM MODALI */}
      {showBusinessSetupModal && (
        <BusinessSetupModal
          currentUser={user}
          isOpen={showBusinessSetupModal}
          onClose={() => setShowBusinessSetupModal(false)}
          onSuccess={() => {
            setActiveTab('business_tools');
          }}
        />
      )}

      {/* 🔴 REDCHAT ÖZEL PROFİL FOTOĞRAFI ONAY & YÜKLEME MODALI */}
      {showConfirmModal && previewUrl && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-center">
            <div className="relative mx-auto w-28 h-28 mb-4">
              <div className="w-full h-full rounded-full overflow-hidden border-3 border-red-600 shadow-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt="Profil Önizleme"
                  className="w-full h-full object-cover"
                />
              </div>

              {isUploadingPhoto && (
                <div className="absolute inset-0 rounded-full bg-black/70 flex flex-col items-center justify-center text-white">
                  <Loader2 className="w-8 h-8 animate-spin text-red-500 mb-1" />
                </div>
              )}
            </div>

            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
              {isUploadingPhoto
                ? 'Fotoğraf yükleniyor…'
                : 'Bu fotoğrafı profil fotoğrafın olarak kullanmak istiyor musun?'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-6">
              {isUploadingPhoto
                ? 'Lütfen işlem tamamlanana kadar bekleyin.'
                : 'Fotoğraf kırpılarak profilinizde ve sohbetlerinizde görüntülenecektir.'}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelUpload}
                disabled={isUploadingPhoto}
                className="flex-1 py-2.5 px-4 text-xs font-bold text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                İptal
              </button>

              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={isUploadingPhoto}
                className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploadingPhoto ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Yükleniyor…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Evet, yükle</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🚫 REDCHAT KULLANICI ENGELLEME ONAY MODALI */}
      {showBlockConfirmModal && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !blockLoading) {
              setShowBlockConfirmModal(false);
            }
          }}
          className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto select-none"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl relative my-auto text-center animate-in fade-in zoom-in-95"
          >
            <button
              type="button"
              onClick={() => {
                if (!blockLoading) setShowBlockConfirmModal(false);
              }}
              disabled={blockLoading}
              className="absolute top-3.5 right-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-3">
              <UserX className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
              Kullanıcıyı Engelle
            </h3>

            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
              @{user.username} kullanıcısını engellemek istediğinize emin misiniz?
            </p>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
              Bu kullanıcıyı engellediğinizde birbirinize doğrudan mesaj gönderemezsiniz.
            </p>

            {blockError && (
              <div className="mb-4 p-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/50 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{blockError}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowBlockConfirmModal(false)}
                disabled={blockLoading}
                className="flex-1 py-2.5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={handleConfirmBlock}
                disabled={blockLoading}
                className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {blockLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Engelleniyor…</span>
                  </>
                ) : (
                  <>
                    <UserX className="w-4 h-4" />
                    <span>Engelle</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
