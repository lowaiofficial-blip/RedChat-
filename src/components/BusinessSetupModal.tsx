import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile, BusinessCategory, BusinessProfile } from '../types';
import { BUSINESS_CATEGORIES } from '../types';
import { uploadImageToImgBB } from '../services/imageUploadService';
import {
  requestBusinessStepCode,
  verifyBusinessStepCode,
  activateVerifiedBusinessAccount,
  getBusinessVerificationStatus,
} from '../services/businessService';
import { UserAvatar } from './UserAvatar';
import {
  Building2,
  X,
  Check,
  Loader2,
  Camera,
  Globe,
  Mail,
  Phone,
  MapPin,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Store,
  Briefcase,
  AlertCircle,
  KeyRound,
  RotateCcw,
  CheckCircle2,
  ChevronLeft,
  Info,
} from 'lucide-react';

interface BusinessSetupModalProps {
  currentUser: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type ModalStep =
  | 'intro'
  | 'form'
  | 'verification_intro'
  | 'step1'
  | 'step1_success'
  | 'step2'
  | 'completed';

export const BusinessSetupModal: React.FC<BusinessSetupModalProps> = ({
  currentUser,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [modalStep, setModalStep] = useState<ModalStep>('intro');

  // Form alanları (varsayılan olarak kullanıcının mevcut bilgileri veya önceki taslağı)
  const prevBusiness = currentUser?.businessProfile || currentUser?.businessVerification?.draftProfile;
  const [businessName, setBusinessName] = useState(prevBusiness?.businessName || currentUser?.displayName || '');
  const [category, setCategory] = useState<BusinessCategory | string>(prevBusiness?.category || 'Teknoloji');
  const [description, setDescription] = useState(prevBusiness?.description || currentUser?.bio || '');
  const [website, setWebsite] = useState(prevBusiness?.website || '');
  const [email, setEmail] = useState(prevBusiness?.email || currentUser?.email || '');
  const [phone, setPhone] = useState(prevBusiness?.phone || '');
  const [location, setLocation] = useState(prevBusiness?.location || '');
  const [hours, setHours] = useState(prevBusiness?.hours || '');

  // Fotoğraf state'leri
  const [photoURL, setPhotoURL] = useState<string | null>(prevBusiness?.photoURL || currentUser?.photoURL || null);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Doğrulama Kodları State'i (6 Haneli)
  const [step1Code, setStep1Code] = useState('');
  const [step2Code, setStep2Code] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Geri Sayım & Yeniden Gönder Sayacı (60 saniye)
  const [countdown, setCountdown] = useState<number>(0);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);

  // Hata & Bildirim State'leri
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Sayfa yenilendiğinde veya modal açıldığında kullanıcının mevcut doğrulama durumunu yükle
  useEffect(() => {
    if (!isOpen || !currentUser?.uid) return;

    const resumeState = async () => {
      try {
        const status = await getBusinessVerificationStatus(currentUser.uid);
        const storedDraft = currentUser.businessVerification?.draftProfile || status.draftProfile;

        if (storedDraft) {
          if (storedDraft.businessName) setBusinessName(storedDraft.businessName);
          if (storedDraft.category) setCategory(storedDraft.category);
          if (storedDraft.description) setDescription(storedDraft.description);
          if (storedDraft.website) setWebsite(storedDraft.website);
          if (storedDraft.email) setEmail(storedDraft.email);
          if (storedDraft.phone) setPhone(storedDraft.phone);
          if (storedDraft.location) setLocation(storedDraft.location);
          if (storedDraft.hours) setHours(storedDraft.hours);
          if (storedDraft.photoURL) setPhotoURL(storedDraft.photoURL);
        }

        const isStep1Done = currentUser.businessVerification?.step1Verified || status.step1Verified;
        const isStep2Done = currentUser.businessVerification?.step2Verified || status.step2Verified;

        if (isStep1Done && isStep2Done) {
          setModalStep('completed');
        } else if (isStep1Done && !isStep2Done) {
          setModalStep('step2');
        } else if (currentUser.businessVerification?.currentStep === 1) {
          setModalStep('step1');
        }
      } catch (err) {
        console.warn('Could not restore business verification state:', err);
      }
    };

    resumeState();
  }, [isOpen, currentUser]);

  // Geri sayım sayacı
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  if (!isOpen) return null;

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

  // Form Doğrulaması ve Bilgilendirme Ekranına Geçiş
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!businessName.trim()) {
      setError('İşletme adı zorunludur.');
      return;
    }
    if (!category.trim()) {
      setError('İşletme kategorisi seçilmelidir.');
      return;
    }
    if (!description.trim()) {
      setError('İşletme açıklaması zorunludur.');
      return;
    }
    if (!email.trim() || !email.includes('@') || !email.includes('.')) {
      setError('Lütfen geçerli bir işletme iletişim e-postası girin.');
      return;
    }

    // Eğer yeni görsel seçildiyse ImgBB'ye yükle
    let finalPhotoURL = photoURL;
    if (selectedPhotoFile) {
      try {
        setUploadingPhoto(true);
        finalPhotoURL = await uploadImageToImgBB(selectedPhotoFile);
        setPhotoURL(finalPhotoURL);
      } catch (uploadErr: any) {
        setError('Görsel yüklenemedi: ' + (uploadErr?.message || 'Lütfen tekrar deneyin.'));
        setUploadingPhoto(false);
        return;
      } finally {
        setUploadingPhoto(false);
      }
    }

    setModalStep('verification_intro');
  };

  // 1. Adım Kod İsteği (Kayıt E-postası)
  const handleStartStep1 = async () => {
    setError(null);
    setIsSendingCode(true);
    setInfoMessage(null);

    try {
      const draftProfile: BusinessProfile = {
        businessName: businessName.trim(),
        category: category.trim(),
        description: description.trim(),
        website: website.trim(),
        email: email.trim(),
        phone: phone.trim(),
        location: location.trim(),
        hours: hours.trim(),
        photoURL,
      };

      const res = await requestBusinessStepCode({
        userId: currentUser.uid,
        username: currentUser.username,
        displayName: currentUser.displayName,
        userEmail: currentUser.email,
        businessContactEmail: email.trim(),
        step: 1,
        draftProfile,
      });

      setCodeExpiresAt(res.expiresAt);
      setCountdown(60); // 60 saniye sonra tekrar isteyebilir
      setModalStep('step1');
      setInfoMessage(`1. Adım doğrulama kodu oluşturuldu ve yöneticiye iletildi.`);
    } catch (err: any) {
      setError(err?.message || '1. Adım doğrulama kodu oluşturulamadı.');
    } finally {
      setIsSendingCode(false);
    }
  };

  // 1. Adım Kod Doğrulama
  const handleVerifyStep1 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (step1Code.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu eksiksiz girin.');
      return;
    }

    setError(null);
    setIsVerifyingCode(true);

    try {
      await verifyBusinessStepCode({
        userId: currentUser.uid,
        step: 1,
        code: step1Code,
      });

      setModalStep('step1_success');

      // 1.5 saniye sonra otomatik olarak 2. Adıma geç
      setTimeout(() => {
        handleStartStep2();
      }, 1400);
    } catch (err: any) {
      setError(err?.message || 'Doğrulama kodu yanlış veya süresi doldu.');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  // 2. Adım Kod İsteği (İşletme İletişim E-postası)
  const handleStartStep2 = async () => {
    setError(null);
    setIsSendingCode(true);
    setInfoMessage(null);

    try {
      const res = await requestBusinessStepCode({
        userId: currentUser.uid,
        username: currentUser.username,
        displayName: currentUser.displayName,
        userEmail: currentUser.email,
        businessContactEmail: email.trim(),
        step: 2,
      });

      setCodeExpiresAt(res.expiresAt);
      setCountdown(60);
      setModalStep('step2');
      setInfoMessage(`2. Adım doğrulama kodu oluşturuldu ve yöneticiye iletildi.`);
    } catch (err: any) {
      setError(err?.message || '2. Adım doğrulama kodu oluşturulamadı.');
    } finally {
      setIsSendingCode(false);
    }
  };

  // 2. Adım Kod Doğrulama
  const handleVerifyStep2 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (step2Code.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu eksiksiz girin.');
      return;
    }

    setError(null);
    setIsVerifyingCode(true);

    try {
      await verifyBusinessStepCode({
        userId: currentUser.uid,
        step: 2,
        code: step2Code,
      });

      setModalStep('completed');
    } catch (err: any) {
      setError(err?.message || 'Doğrulama kodu yanlış veya süresi doldu.');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  // Son Adım: İşletme Hesabını Aktifleştirme
  const handleFinalActivation = async () => {
    setError(null);
    setIsActivating(true);

    try {
      const finalBusinessData: BusinessProfile = {
        businessName: businessName.trim(),
        category: category.trim(),
        description: description.trim(),
        website: website.trim(),
        email: email.trim(),
        phone: phone.trim(),
        location: location.trim(),
        hours: hours.trim(),
        photoURL,
      };

      await activateVerifiedBusinessAccount(currentUser, finalBusinessData, photoURL);

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'İşletme hesabı etkinleştirilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSendingCode && !isVerifyingCode && !isActivating) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs select-none overflow-y-auto animate-in fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative my-auto max-h-[calc(100dvh-2rem)] flex flex-col overflow-y-auto animate-in zoom-in-95"
      >
        {/* Kapat Butonu */}
        <button
          type="button"
          onClick={onClose}
          disabled={isSendingCode || isVerifyingCode || isActivating}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50 z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 1. GİRİŞ / TANITIM EKRANI */}
        {modalStep === 'intro' && (
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-3xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 flex items-center justify-center shadow-md shadow-red-500/10">
              <Store className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                İşletme Hesabına Geç
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                RedChat üzerinde işletmenizi daha profesyonel şekilde tanıtın.
              </p>
            </div>

            <div className="w-full space-y-2.5 text-left my-2">
              <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 flex items-start gap-3">
                <div className="p-1.5 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Özel İşletme Profili
                  </h4>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Kategori, çalışma saatleri, konum ve web sitesi gibi işletme detaylarını sergileyin.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 flex items-start gap-3">
                <div className="p-1.5 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    2 Aşamalı E-posta Doğrulaması
                  </h4>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Kayıt e-postanız ve işletme iletişim adresiniz güvenle doğrulanır.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setModalStep('form')}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>İşletme Hesabına Geç</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 2. İŞLETME BİLGİLERİ FORMU */}
        {modalStep === 'form' && (
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setModalStep('intro')}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  İşletme Bilgilerini Doldur
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Zorunlu ve opsiyonel alanları tamamlayın
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Fotoğraf Yükleme */}
            <div className="flex items-center gap-4 p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <div className="relative">
                <UserAvatar
                  photoURL={photoPreview || photoURL}
                  name={businessName || 'İşletme'}
                  username={currentUser.username}
                  size="xl"
                  shape="circle"
                />
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center text-white">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                  İşletme Profil Fotoğrafı
                </span>
                <span className="text-[10px] text-zinc-400 block mb-2">
                  İsteğe bağlı • ImgBB Kalıcı Depolama
                </span>
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Camera className="w-3.5 h-3.5 text-red-600" />
                  <span>Fotoğraf Seç</span>
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
              </div>
            </div>

            {/* Zorunlu Alanlar */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
                  İşletme Adı <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Örn: Lexpan"
                  required
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
                  İşletme Kategorisi <span className="text-red-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                >
                  {BUSINESS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
                  İşletme Açıklaması <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="İşletmeniz hakkında kısa ve net bilgi..."
                  required
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1 flex items-center justify-between">
                  <span>İşletme İletişim E-postası <span className="text-red-500">*</span></span>
                  <span className="text-[10px] text-zinc-400 font-normal">2. Adımda doğrulanacak</span>
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3.5 top-3 text-zinc-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="iletisim@lexpan.com"
                    required
                    className="w-full text-xs pl-9 pr-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                  />
                </div>
              </div>
            </div>

            {/* Opsiyonel Alanlar Accordion / Bilgiler */}
            <div className="space-y-2.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">
                Opsiyonel İletişim Detayları
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Web Sitesi
                  </label>
                  <div className="relative">
                    <Globe className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://websiteniz.com"
                      className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Telefon
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+90 555 000 00 00"
                      className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Konum
                  </label>
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Örn: Kadıköy, İstanbul"
                      className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Çalışma Saatleri
                  </label>
                  <div className="relative">
                    <Clock className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      placeholder="Örn: Hafta içi 09:00 - 18:00"
                      className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={uploadingPhoto}
              className="w-full mt-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>Doğrulama Adımına Geç</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* 3. DOĞRULAMA BİLGİLENDİRME EKRANI (E-posta Doğrulaması Gerekli) */}
        {modalStep === 'verification_intro' && (
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-md shadow-amber-500/10">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                E-posta Doğrulaması Gerekli
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                İşletme hesabını etkinleştirmek için iki e-posta adresini doğrulaman gerekiyor.
              </p>
            </div>

            {error && (
              <div className="w-full p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="w-full space-y-2.5 text-left my-1">
              {/* 1. Adım Kartı */}
              <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-extrabold text-blue-700 dark:text-blue-400">
                    1. ADIM — KAYIT E-POSTASI
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-300">
                    İlk Adım
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  RedChat'e ilk kayıt olurken kullandığınız e-posta adresi:
                </p>
                <div className="mt-1.5 font-mono text-xs font-bold text-red-600 dark:text-red-400 bg-white dark:bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-blue-100 dark:border-blue-900/40 truncate">
                  {currentUser.email}
                </div>
              </div>

              {/* 2. Adım Kartı */}
              <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                    2. ADIM — İŞLETME İLETİŞİM E-POSTASI
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300">
                    İkinci Adım
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  İşletmeniz için belirlediğiniz iletişim e-posta adresi:
                </p>
                <div className="mt-1.5 font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40 truncate">
                  {email}
                </div>
              </div>
            </div>

            <div className="w-full flex gap-2">
              <button
                type="button"
                onClick={() => setModalStep('form')}
                className="py-3 px-4 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
              >
                Geri Dön
              </button>
              <button
                type="button"
                onClick={handleStartStep1}
                disabled={isSendingCode}
                className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSendingCode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>1. Adım Doğrulamasını Başlat</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 4. 1. ADIM — KAYIT E-POSTASI KOD GİRİŞİ */}
        {modalStep === 'step1' && (
          <form onSubmit={handleVerifyStep1} className="space-y-4 py-1">
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-100 dark:border-zinc-800">
              <div className="p-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-blue-600 dark:text-blue-400">
                  1. Adım — Kayıt E-postası Doğrulaması
                </h3>
                <p className="text-[10px] text-zinc-400">
                  RedChat hesap e-postanızı doğrulayın
                </p>
              </div>
            </div>

            {/* Bildirim / Bilgilendirme Rozeti */}
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-2xl border border-blue-200 dark:border-blue-900/60 space-y-1">
              <div className="text-[11px] font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                <span>Doğrulanacak Kayıt E-postası:</span>
              </div>
              <div className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {currentUser.email}
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 pt-0.5">
                Yönetim tarafından size iletilen 6 haneli kodu giriniz.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{infoMessage}</span>
              </div>
            )}

            {/* 6 Haneli Kod Girişi */}
            <div>
              <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1.5 text-center">
                6 Haneli Doğrulama Kodu
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={step1Code}
                onChange={(e) => setStep1Code(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                autoFocus
                className="w-full text-center tracking-[0.5em] font-mono font-black text-2xl py-3 px-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-zinc-400 text-[11px]">
                {countdown > 0 ? (
                  `Yeniden kod iste (${countdown}s)`
                ) : (
                  <button
                    type="button"
                    onClick={handleStartStep1}
                    disabled={isSendingCode}
                    className="text-red-600 dark:text-red-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Yeni Kod İste</span>
                  </button>
                )}
              </span>

              <span className="text-[10px] text-zinc-400 font-mono">
                15 dk geçerli
              </span>
            </div>

            <button
              type="submit"
              disabled={step1Code.length !== 6 || isVerifyingCode}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isVerifyingCode ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>1. Adımı Doğrula</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* 1. ADIM BAŞARI GEÇİŞİ */}
        {modalStep === 'step1_success' && (
          <div className="flex flex-col items-center text-center space-y-4 py-8 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-600/20">
              <Check className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                ✓ 1. Adım tamamlandı
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                2. Adıma geçiliyor (İşletme İletişim E-postası)...
              </p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        )}

        {/* 5. 2. ADIM — İŞLETME İLETİŞİM E-POSTASI KOD GİRİŞİ */}
        {modalStep === 'step2' && (
          <form onSubmit={handleVerifyStep2} className="space-y-4 py-1">
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-100 dark:border-zinc-800">
              <div className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  2. Adım — İşletme İletişim E-postası Doğrulaması
                </h3>
                <p className="text-[10px] text-zinc-400">
                  İşletme iletişim adresinizi doğrulayın
                </p>
              </div>
            </div>

            {/* Bildirim / Bilgilendirme Rozeti */}
            <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 space-y-1">
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                <span>Doğrulanacak İletişim E-postası:</span>
              </div>
              <div className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {email}
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 pt-0.5">
                Bu adım için oluşturulan 6 haneli kodu giriniz.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{infoMessage}</span>
              </div>
            )}

            {/* 6 Haneli Kod Girişi */}
            <div>
              <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1.5 text-center">
                6 Haneli Doğrulama Kodu
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={step2Code}
                onChange={(e) => setStep2Code(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                autoFocus
                className="w-full text-center tracking-[0.5em] font-mono font-black text-2xl py-3 px-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-zinc-400 text-[11px]">
                {countdown > 0 ? (
                  `Yeniden kod iste (${countdown}s)`
                ) : (
                  <button
                    type="button"
                    onClick={handleStartStep2}
                    disabled={isSendingCode}
                    className="text-red-600 dark:text-red-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Yeni Kod İste</span>
                  </button>
                )}
              </span>

              <span className="text-[10px] text-zinc-400 font-mono">
                15 dk geçerli
              </span>
            </div>

            <button
              type="submit"
              disabled={step2Code.length !== 6 || isVerifyingCode}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isVerifyingCode ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>2. Adımı Doğrula</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* 6. BAŞARILI TAMAMLAMA & İŞLETME HESABINI ETKİNLEŞTİRME */}
        {modalStep === 'completed' && (
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-in zoom-in-95">
              <Check className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                ✓ Başardınız!
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                İşletme hesabınız için gerekli e-posta doğrulamaları tamamlandı.
              </p>
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                Artık işletme hesabınızı etkinleştirebilirsiniz.
              </p>
            </div>

            {error && (
              <div className="w-full p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl border border-rose-200 dark:border-rose-900/60 flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Özet Kartı */}
            <div className="w-full p-3.5 bg-zinc-50 dark:bg-zinc-800/60 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-left space-y-2">
              <div className="flex items-center gap-3">
                <UserAvatar
                  photoURL={photoURL}
                  name={businessName}
                  username={currentUser.username}
                  size="md"
                  shape="circle"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                    {businessName}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate">
                    {category} • {email}
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  Doğrulandı
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFinalActivation}
              disabled={isActivating}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isActivating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Store className="w-4 h-4" />
                  <span>İşletme Hesabına Geç</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
