import React, { useState, useRef, useMemo } from 'react';
import type { UserProfile } from '../types';
import { createGroupConversation } from '../services/chatService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import {
  X,
  Camera,
  Trash2,
  Users,
  Check,
  Loader2,
  Search,
  AlertCircle,
} from 'lucide-react';

interface CreateGroupModalProps {
  currentUser: UserProfile;
  allUsers?: UserProfile[];
  users?: UserProfile[];
  onClose: () => void;
  onGroupCreated: (groupId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  currentUser,
  allUsers,
  users,
  onClose,
  onGroupCreated,
}) => {
  const rawUsers = allUsers || users || [];
  const [groupName, setGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Fotoğraf state'leri
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  // İşlem state'leri
  const [creating, setCreating] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Giriş yapan kullanıcı hariç diğer gerçek kullanıcılar (Banlılar eklenemez)
  const availableUsers = useMemo(() => {
    return (rawUsers || []).filter((u) => u && u.uid && u.uid !== currentUser.uid && !u.isBanned);
  }, [rawUsers, currentUser?.uid]);

  // Arama filtresi
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableUsers;
    return availableUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q)
    );
  }, [availableUsers, searchQuery]);

  // Fotoğraf seçimi
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setError(null);
    setSelectedPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewPhotoUrl(objectUrl);
  };

  const handleRemovePhoto = () => {
    setSelectedPhotoFile(null);
    if (previewPhotoUrl) {
      URL.revokeObjectURL(previewPhotoUrl);
    }
    setPreviewPhotoUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Kullanıcı seçme / çıkarma
  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Grup oluşturma işlemi
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (currentUser.isBanned) {
      setError('Hesabınız askıya alınmıştır (Banlandınız). Grup oluşturamazsınız.');
      return;
    }

    const cleanName = groupName.trim();

    if (!cleanName) {
      setError('Grup adı boş bırakılamaz.');
      return;
    }

    if (selectedUserIds.length === 0) {
      setError('Grup oluşturmak için en az bir üye seçmelisiniz.');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      let finalPhotoUrl: string | null = null;

      // Eğer fotoğraf seçilmişse ImgBB'ye yükle
      if (selectedPhotoFile) {
        setUploadingPhoto(true);
        finalPhotoUrl = await uploadImageToImgBB(selectedPhotoFile);
        setUploadingPhoto(false);
      }

      const selectedUsers = availableUsers.filter((u) => selectedUserIds.includes(u.uid));

      const newGroupId = await createGroupConversation(
        currentUser,
        cleanName,
        selectedUsers,
        finalPhotoUrl
      );

      onGroupCreated(newGroupId);
      onClose();
    } catch (err: any) {
      console.error('Grup oluşturma hatası:', err);
      setError(err?.message || 'Grup oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setCreating(false);
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Yeni Grup Oluştur
              </h2>
              <p className="text-[11px] text-zinc-400">
                Grup adı belirleyin ve arkadaşlarınızı ekleyin
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleCreateGroup} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            {/* Hata Mesajı */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Grup Fotoğrafı ve Grup Adı */}
            <div className="flex items-center gap-4">
              <div className="relative group shrink-0">
                {previewPhotoUrl ? (
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
                    <img
                      src={previewPhotoUrl}
                      alt="Grup Önizleme"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={creating}
                      className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                      title="Fotoğrafı Kaldır"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={creating}
                    className="w-16 h-16 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-red-500 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-red-50/50 dark:hover:bg-red-950/20 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="text-[9px] font-semibold">Fotoğraf</span>
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
              </div>

              <div className="flex-1">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Grup Adı <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => {
                    setGroupName(e.target.value);
                    if (error && e.target.value.trim()) setError(null);
                  }}
                  placeholder="Örn: Yazılımcılar Kulübü"
                  disabled={creating}
                  maxLength={50}
                  className="w-full px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>
            </div>

            {/* Seçilen Üyeler Listesi (Chips) */}
            {selectedUserIds.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Seçilen Üyeler ({selectedUserIds.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds([])}
                    className="text-[11px] text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    Tümünü Temizle
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto p-1 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  {availableUsers
                    .filter((u) => selectedUserIds.includes(u.uid))
                    .map((user) => (
                      <span
                        key={user.uid}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs text-zinc-800 dark:text-zinc-200 shadow-2xs"
                      >
                        <UserAvatar
                          photoURL={user.photoURL}
                          name={user.displayName}
                          username={user.username}
                          size="xs"
                        />
                        <span className="font-medium truncate max-w-[100px]">
                          {user.displayName || user.username}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleUserSelection(user.uid)}
                          className="text-zinc-400 hover:text-red-500 cursor-pointer ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Üye Seçim Bölümü */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Üye Ekle <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] text-zinc-400">
                  En az 1 üye seçmelisiniz
                </span>
              </div>

              {/* Kullanıcı Arama */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Kullanıcı ara..."
                  disabled={creating}
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              {/* Kullanıcı Listesi */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-48 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-400">
                    {searchQuery ? 'Kullanıcı bulunamadı.' : 'Kayıtlı başka kullanıcı yok.'}
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUserIds.includes(user.uid);
                    return (
                      <button
                        key={user.uid}
                        type="button"
                        onClick={() => toggleUserSelection(user.uid)}
                        disabled={creating}
                        className={`w-full p-2.5 flex items-center justify-between text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-red-50/60 dark:bg-red-950/30'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar
                            photoURL={user.photoURL}
                            name={user.displayName}
                            username={user.username}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {user.displayName || user.username}
                            </div>
                            <div className="text-[10px] text-zinc-400 font-mono truncate">
                              @{user.username}
                            </div>
                          </div>
                        </div>

                        <div
                          className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-red-600 border-red-600 text-white'
                              : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="px-4 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={!groupName.trim() || selectedUserIds.length === 0 || creating}
              className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              {creating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{uploadingPhoto ? 'Fotoğraf Yükleniyor…' : 'Grup Oluşturuluyor…'}</span>
                </>
              ) : (
                <>
                  <Users className="w-3.5 h-3.5" />
                  <span>Grubu Oluştur</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
