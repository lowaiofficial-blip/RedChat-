import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../types';
import { updateUserProfileDetails, logoutUser } from '../services/authService';
import { formatLastSeen } from '../services/chatService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import { isRedChatAI } from '../services/aiService';
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
} from 'lucide-react';

interface ProfileModalProps {
  user: UserProfile;
  isCurrentUser: boolean;
  onClose: () => void;
  onStartChat?: (user: UserProfile) => void;
  initialTab?: 'profile' | 'settings';
  badgeUrl?: string | null;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  isCurrentUser,
  onClose,
  onStartChat,
  initialTab = 'profile',
  badgeUrl,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'settings'>(initialTab);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName || user.username);
  const [bio, setBio] = useState(user.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);



  // Anlık profil fotoğrafı state'i (Firestore senkronizasyonu tamamlandığında veya hemen anında güncellenir)
  const [currentPhotoURL, setCurrentPhotoURL] = useState<string | null>(user.photoURL || null);

  // Fotoğraf Onay & Yükleme State'leri
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tema state'i
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  // Gelen prop değiştiğinde (Firestore snapshot güncellendiğinde) senkronize et
  useEffect(() => {
    setCurrentPhotoURL(user.photoURL || null);
    if (!editing) {
      setDisplayName(user.displayName || user.username);
      setBio(user.bio || '');
    }
  }, [user.photoURL, user.displayName, user.username, user.bio, editing]);

  // ObjectURL memory leak önleme
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Fotoğraf seçildiğinde tetiklenir (hemen yüklemez, onay modalını açar)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Dosya türü kontrolü
    if (!file.type.startsWith('image/')) {
      setError('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');
      return;
    }

    // Dosya boyutu kontrolü (Max 10 MB)
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

  // Onay modalında "İptal" tıklandığında
  const handleCancelUpload = () => {
    if (isUploadingPhoto) return; // Yükleme devam ederken iptali engelle
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

  // Onay modalında "Evet, yükle" tıklandığında
  const handleConfirmUpload = async () => {
    if (!selectedFile || isUploadingPhoto) return;

    setIsUploadingPhoto(true);
    setError(null);
    try {
      // 1. Gerçek ImgBB API'ye yükle
      const downloadUrl = await uploadImageToImgBB(selectedFile);

      // 2. Gerçek Firestore users/{uid}.photoURL alanını güncelle
      await updateUserProfileDetails(user.uid, {
        photoURL: downloadUrl,
      });

      // 3. Mevcut profil modalındaki avatarı da ANINDA güncelle
      setCurrentPhotoURL(downloadUrl);

      // 4. Temizlik ve Başarı Bildirimi
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
      // Hata durumunda eski fotoğraf korunur, anlaşılır hata gösterilir
      setError(err?.message || 'Fotoğraf yüklenemedi. Lütfen tekrar deneyin.');
      setShowConfirmModal(false);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // Mevcut fotoğrafı kaldırma işlemi
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

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Tab Selector */}
          {isCurrentUser && (
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-5 pb-2 gap-4 text-xs font-bold">
              <button
                onClick={() => setActiveTab('profile')}
                className={`pb-1 cursor-pointer transition-colors ${
                  activeTab === 'profile'
                    ? 'text-red-600 border-b-2 border-red-600'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                Profil
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`pb-1 cursor-pointer transition-colors ${
                  activeTab === 'settings'
                    ? 'text-red-600 border-b-2 border-red-600'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                Ayarlar
              </button>
            </div>
          )}

          {activeTab === 'profile' ? (
            <>
              {/* Profile Header & Avatar */}
              <div className="flex flex-col items-center text-center mb-4">
                <div className="relative mb-3">
                  <div className="relative group">
                    <UserAvatar
                      photoURL={currentPhotoURL}
                      name={user.displayName}
                      username={user.username}
                      size="2xl"
                      shape="circle"
                      className="shadow-lg shadow-red-600/10 ring-2 ring-zinc-100 dark:ring-zinc-800"
                    />

                    {/* Fotoğraf Değiştirme Butonu (Mevcut kullanıcı için hover butonu) */}
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
                      Profil fotoğrafını değiştir
                    </button>
                    {currentPhotoURL && (
                      <>
                        <span className="text-zinc-300 dark:text-zinc-700">•</span>
                        <button
                          onClick={handleRemovePhoto}
                          disabled={isUploadingPhoto}
                          className="text-[11px] font-semibold text-zinc-400 hover:text-rose-600 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          Kaldır
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {user.displayName || user.username}
                  </h3>
                  <VerifiedBadge
                    isVerified={user.isVerified}
                    badgeUrl={badgeUrl}
                    size="md"
                    user={{
                      displayName: user.displayName || user.username,
                      username: user.username,
                      photoURL: currentPhotoURL || user.photoURL,
                    }}
                  />
                </div>
                <p className="text-xs text-red-600 font-mono font-medium mt-0.5">
                  @{user.username}
                </p>

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
                      <Circle className={`w-2 h-2 ${user.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-zinc-400 text-zinc-400'}`} />
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

              {/* Profile Content / Edit Form */}
              {isCurrentUser && editing ? (
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
                <div className="space-y-3">
                  {isRedChatAI(user) ? (
                    <>
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-750 dark:border-zinc-700">
                        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-400 block mb-0.5">
                          Hakkında
                        </span>
                        <p className="text-xs text-zinc-700 dark:text-zinc-200">
                          {user.bio || 'RedChat Resmi Yapay Zeka Asistanı'}
                        </p>
                      </div>

                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-750 dark:border-zinc-700">
                        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                          <span className="text-zinc-400">Model:</span>
                          <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                            Flash Lite 1.0
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
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

                  <div className="pt-2 flex flex-col gap-2">
                    {isCurrentUser ? (
                      <button
                        onClick={() => setEditing(true)}
                        className="w-full py-2 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Profili Düzenle
                      </button>
                    ) : (
                      onStartChat && (
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
                              RedChat AI ile Sohbet Et
                            </>
                          ) : (
                            <>
                              <MessageSquare className="w-4 h-4" />
                              Sohbet Başlat
                            </>
                          )}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* SETTINGS TAB */
            <div className="space-y-4 py-1">
              <div>
                <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-red-600" />
                  Görünüm ve Tema
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setThemeMode('light')}
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
                    onClick={() => setThemeMode('dark')}
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
                    onClick={() => setThemeMode('system')}
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

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  onClick={() => {
                    setActiveTab('profile');
                    setEditing(true);
                  }}
                  className="w-full py-2.5 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors flex items-center justify-between cursor-pointer mb-2"
                >
                  <span className="flex items-center gap-2">
                    <Edit3 className="w-3.5 h-3.5" /> Profili Düzenle
                  </span>
                  <span className="text-zinc-400">›</span>
                </button>

                <button
                  onClick={async () => {
                    await logoutUser();
                    onClose();
                  }}
                  className="w-full py-2.5 px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl border border-rose-200/60 dark:border-rose-900/60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Çıkış Yap
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 🔴 REDCHAT ÖZEL PROFİL FOTOĞRAFI ONAY & YÜKLEME MODALI */}
      {showConfirmModal && previewUrl && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-center animate-in zoom-in-95">
            {/* Fotoğraf Önizleme */}
            <div className="relative mx-auto w-28 h-28 mb-4">
              <div className="w-full h-full rounded-full overflow-hidden border-3 border-red-600 shadow-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt="Profil Önizleme"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Yükleniyor Göstergesi Overlay */}
              {isUploadingPhoto && (
                <div className="absolute inset-0 rounded-full bg-black/70 flex flex-col items-center justify-center text-white">
                  <Loader2 className="w-8 h-8 animate-spin text-red-500 mb-1" />
                </div>
              )}
            </div>

            {/* Metinler */}
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

            {/* Butonlar */}
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
    </>
  );
};
