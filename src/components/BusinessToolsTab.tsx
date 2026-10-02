import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile, BusinessCategory, BusinessProfile } from '../types';
import { BUSINESS_CATEGORIES } from '../types';
import { updateBusinessProfile, switchToPersonalAccount } from '../services/authService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import {
  Building2,
  Check,
  Loader2,
  Camera,
  Globe,
  Mail,
  Phone,
  MapPin,
  Clock,
  ArrowLeftRight,
  AlertCircle,
  CheckCircle,
  X,
  Store,
  Trash2,
} from 'lucide-react';

interface BusinessToolsTabProps {
  currentUser: UserProfile;
  onUpdate?: () => void;
  onSwitchToPersonal?: () => void;
}

export const BusinessToolsTab: React.FC<BusinessToolsTabProps> = ({
  currentUser,
  onUpdate,
  onSwitchToPersonal,
}) => {
  const business = currentUser?.businessProfile;

  // Form State'leri
  const [businessName, setBusinessName] = useState(business?.businessName || currentUser?.displayName || '');
  const [category, setCategory] = useState<BusinessCategory | string>(business?.category || 'Teknoloji');
  const [description, setDescription] = useState(business?.description || currentUser?.bio || '');
  const [website, setWebsite] = useState(business?.website || '');
  const [email, setEmail] = useState(business?.email || currentUser?.email || '');
  const [phone, setPhone] = useState(business?.phone || '');
  const [location, setLocation] = useState(business?.location || '');
  const [hours, setHours] = useState(business?.hours || '');

  // Fotoğraf state'leri
  const [photoURL, setPhotoURL] = useState<string | null>(business?.photoURL || currentUser?.photoURL || null);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Kaydetme & Hata state'leri
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Normal Hesaba Dönüş Onay Modalı
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Gelen prop güncellendiğinde formu senkronize et
  useEffect(() => {
    const b = currentUser?.businessProfile;
    setBusinessName(b?.businessName || currentUser?.displayName || '');
    setCategory(b?.category || 'Teknoloji');
    setDescription(b?.description || currentUser?.bio || '');
    setWebsite(b?.website || '');
    setEmail(b?.email || currentUser?.email || '');
    setPhone(b?.phone || '');
    setLocation(b?.location || '');
    setHours(b?.hours || '');
    setPhotoURL(b?.photoURL || currentUser?.photoURL || null);
  }, [currentUser]);

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

    setSelectedPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      setError('İşletme adı boş bırakılamaz.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let finalPhotoURL = photoURL;

      if (selectedPhotoFile) {
        setUploadingPhoto(true);
        finalPhotoURL = await uploadImageToImgBB(selectedPhotoFile);
        setUploadingPhoto(false);
      }

      const businessData: BusinessProfile = {
        businessName: businessName.trim(),
        category: category.trim(),
        description: description.trim(),
        website: website.trim(),
        email: email.trim(),
        phone: phone.trim(),
        location: location.trim(),
        hours: hours.trim(),
        photoURL: finalPhotoURL,
      };

      await updateBusinessProfile(currentUser.uid, businessData, finalPhotoURL);

      setPhotoURL(finalPhotoURL);
      setSelectedPhotoFile(null);
      setPhotoPreview(null);
      setSuccess('İşletme profil bilgileri başarıyla güncellendi.');
      setTimeout(() => setSuccess(null), 4000);

      if (onUpdate) {
        onUpdate();
      }
    } catch (err: any) {
      console.error('İşletme profili güncellenirken hata:', err);
      setError(err?.message || 'Bilgiler güncellenemedi. Lütfen tekrar deneyin.');
    } finally {
      setSaving(false);
      setUploadingPhoto(false);
    }
  };

  const handleSwitchToPersonal = async () => {
    setSwitching(true);
    setError(null);
    try {
      await switchToPersonalAccount(currentUser.uid);
      setShowSwitchModal(false);
      if (onSwitchToPersonal) {
        onSwitchToPersonal();
      }
    } catch (err: any) {
      console.error('Normal hesaba dönülürken hata:', err);
      setError(err?.message || 'Normal hesaba geçiş yapılamadı.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="space-y-4 py-1">
      {/* Üst Bilgi Kartı */}
      <div className="p-3.5 bg-red-50/60 dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/50 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-600/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
          <Store className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {business?.businessName || currentUser.displayName}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 shrink-0">
              İşletme Hesabı
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            Kategori: <strong className="text-zinc-700 dark:text-zinc-300">{business?.category || category}</strong>
          </p>
        </div>
      </div>

      {success && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3.5">
        {/* Logo / Fotoğraf Düzenleme */}
        <div className="flex flex-col items-center justify-center gap-1.5 py-1">
          <div className="relative group">
            <UserAvatar
              photoURL={photoPreview || photoURL}
              name={businessName || currentUser.displayName}
              username={currentUser.username}
              size="xl"
              shape="circle"
              className="ring-2 ring-red-500/20 shadow-md"
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/45 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span className="text-[9px] font-bold mt-0.5">Değiştir</span>
            </button>
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 flex items-center gap-1 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>İşletme Logosunu Güncelle</span>
          </button>
        </div>

        {/* İşletme Adı */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
            İşletme Adı <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Örn: Lexpan"
            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
          />
        </div>

        {/* İşletme Kategorisi */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
            İşletme Kategorisi <span className="text-red-500">*</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 cursor-pointer"
          >
            {BUSINESS_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* İşletme Açıklaması */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
            İşletme Açıklaması
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="İşletmeniz hakkında kısa bir açıklama..."
            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 resize-none"
          />
        </div>

        {/* İletişim Bilgileri */}
        <div className="space-y-2.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            İletişim & Konum Bilgileri
          </span>

          {/* Web Sitesi */}
          <div className="relative">
            <Globe className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Web sitesi (örn: https://lexpan.com)"
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>

          {/* E-posta */}
          <div className="relative">
            <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="İşletme E-postası"
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>

          {/* Telefon */}
          <div className="relative">
            <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Telefon Numarası"
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>

          {/* Konum */}
          <div className="relative">
            <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Adres / Konum (örn: Levent, İstanbul)"
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>

          {/* Çalışma Saatleri */}
          <div className="relative">
            <Clock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Çalışma Saatleri (örn: Hafta içi 09:00 - 18:00)"
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>
        </div>

        {/* Kaydet Butonu */}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{uploadingPhoto ? 'Logo Yükleniyor…' : 'Kaydediliyor…'}</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Değişiklikleri Kaydet</span>
            </>
          )}
        </button>
      </form>

      {/* 🔄 Normal Hesaba Dönüş Bölümü */}
      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setShowSwitchModal(true)}
          className="w-full py-2.5 px-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700/80 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>Normal Hesaba Dön</span>
        </button>
      </div>

      {/* 🔐 NORMAL HESABA DÖNÜŞ ONAY MODALI */}
      {showSwitchModal && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative text-center animate-in fade-in zoom-in-95"
          >
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center mx-auto mb-3">
              <ArrowLeftRight className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
              Normal Hesaba Dön
            </h3>

            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
              Normal hesaba dönmek istediğine emin misin?
            </p>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
              İşletme bilgileriniz silinmez. Tekrar işletme hesabına geçtiğinizde kayıtlı bilgileriniz korunur ve geri yüklenir.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSwitchModal(false)}
                disabled={switching}
                className="flex-1 py-2.5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={handleSwitchToPersonal}
                disabled={switching}
                className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {switching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Dönüştürülüyor…</span>
                  </>
                ) : (
                  <span>Evet, Dön</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
