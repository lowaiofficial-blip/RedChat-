import React, { useState, useRef } from 'react';
import type { UserProfile } from '../types';
import { createChannel } from '../services/channelService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import {
  X,
  Camera,
  Trash2,
  Radio,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Flame,
} from 'lucide-react';

interface CreateChannelModalProps {
  currentUser: UserProfile;
  onClose: () => void;
  onChannelCreated: (channelId: string) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  currentUser,
  onClose,
  onChannelCreated,
}) => {
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setPreviewPhotoUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = channelName.trim();
    const trimmedDesc = channelDescription.trim();

    if (!trimmedName) {
      setError('Lütfen bir kanal adı girin.');
      return;
    }

    if (trimmedName.length < 2) {
      setError('Kanal adı en az 2 karakter olmalıdır.');
      return;
    }

    if (!trimmedDesc) {
      setError('Lütfen kanalınız hakkında kısa bir açıklama yazın.');
      return;
    }

    try {
      setCreating(true);
      setError(null);

      let finalPhotoUrl: string | null = null;
      if (selectedPhotoFile) {
        finalPhotoUrl = await uploadImageToImgBB(selectedPhotoFile);
      }

      const newChannelId = await createChannel(currentUser, {
        name: trimmedName,
        description: trimmedDesc,
        photoURL: finalPhotoUrl,
      });

      onChannelCreated(newChannelId);
    } catch (err: any) {
      console.error('Kanal oluşturulurken hata:', err);
      setError(err?.message || 'Kanal oluşturulurken bir hata oluştu.');
      setCreating(false);
    }
  };

  return (
    <div
      id="create-channel-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="create-channel-modal-container"
        className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-600/10 text-red-600 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Yeni Kanal Oluştur
              </h2>
              <p className="text-[11px] text-zinc-500">
                Takipçilerinizle sınırsız güncellemeler paylaşın
              </p>
            </div>
          </div>
          <button
            id="close-create-channel-modal"
            onClick={onClose}
            disabled={creating}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleCreate} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-start gap-2.5 text-red-600 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Gizlilik Garantisi Bilgi Kutusu */}
          <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl flex items-start gap-2.5 text-emerald-800 dark:text-emerald-300 text-xs">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div className="leading-relaxed">
              <strong className="font-semibold block">Kurucu Gizliliği Aktif:</strong>
              Takipçiler veya diğer kullanıcılar kanal kurucusunun adını, profilini veya kimliğini kesinlikle göremez. Gönderiler kanal adıyla yayınlanır.
            </div>
          </div>

          {/* Profil Fotoğrafı Seçimi */}
          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative group">
              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border-2 border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center">
                {previewPhotoUrl ? (
                  <img
                    src={previewPhotoUrl}
                    alt="Kanal Önizleme"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-zinc-400 p-2 text-center">
                    <Radio className="w-8 h-8 stroke-[1.5] mb-1 text-zinc-400" />
                    <span className="text-[10px] font-medium">Fotoğraf</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                id="select-channel-photo-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={creating}
                className="absolute -bottom-2 -right-2 p-2 bg-red-600 text-white rounded-xl shadow-md hover:bg-red-700 transition-colors cursor-pointer"
                title="Fotoğraf Seç"
              >
                <Camera className="w-4 h-4" />
              </button>

              {previewPhotoUrl && (
                <button
                  type="button"
                  id="remove-channel-photo-btn"
                  onClick={handleRemovePhoto}
                  disabled={creating}
                  className="absolute -top-2 -right-2 p-1.5 bg-zinc-900 text-zinc-200 rounded-lg shadow-md hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Fotoğrafı Kaldır"
                >
                  <Trash2 className="w-3.5 h-3.5" />
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
            <span className="text-[11px] text-zinc-400 mt-2">
              Kanal profil görseli (isteğe bağlı)
            </span>
          </div>

          {/* Kanal Adı */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Kanal Adı <span className="text-red-500">*</span>
            </label>
            <input
              id="channel-name-input"
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Örn: RedChat Haberleri, Teknoloji Kulübü..."
              maxLength={60}
              disabled={creating}
              required
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-zinc-400">
                {channelName.length}/60
              </span>
            </div>
          </div>

          {/* Kanal Açıklaması */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Kanal Açıklaması <span className="text-red-500">*</span>
            </label>
            <textarea
              id="channel-desc-input"
              value={channelDescription}
              onChange={(e) => setChannelDescription(e.target.value)}
              placeholder="Takipçilerinize kanalınızın ne hakkında olduğunu anlatın..."
              rows={3}
              maxLength={300}
              disabled={creating}
              required
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-zinc-400">
                {channelDescription.length}/300
              </span>
            </div>
          </div>

          {/* Aksiyon Butonları */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              id="cancel-create-channel-btn"
              onClick={onClose}
              disabled={creating}
              className="px-4 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              id="submit-create-channel-btn"
              disabled={creating || !channelName.trim() || !channelDescription.trim()}
              className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-all shadow-md shadow-red-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              {creating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Kanal Oluşturuluyor...</span>
                </>
              ) : (
                <>
                  <Flame className="w-3.5 h-3.5 fill-white" />
                  <span>Kanalı Başlat</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
