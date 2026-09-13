import React, { useState, useEffect } from 'react';
import { submitVerificationRequest, subscribeToMyVerificationRequests } from '../services/verificationService';
import type { VerificationRequest, UserProfile } from '../types';
import { Loader2, CheckCircle, Clock, XCircle, ShieldCheck } from 'lucide-react';

interface UserVerificationFormProps {
  user: UserProfile;
}

export const UserVerificationForm: React.FC<UserVerificationFormProps> = ({ user }) => {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form states
  const [accountType, setAccountType] = useState('İçerik Üreticisi');
  const [links, setLinks] = useState('');
  const [reason, setReason] = useState('');
  const [extraInfo, setExtraInfo] = useState('');

  useEffect(() => {
    const unsub = subscribeToMyVerificationRequests('user', user.uid, (data) => {
      setRequests(data);
      setLoading(false);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [user.uid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('Lütfen neden doğrulanmak istediğinizi belirtin.');
      return;
    }

    setSubmitting(true);
    try {
      await submitVerificationRequest({
        type: 'user',
        userId: user.uid,
        username: user.username,
        displayName: user.displayName,
        accountType,
        links: links.trim() || undefined,
        reason: reason.trim(),
        extraInfo: extraInfo.trim() || undefined,
      });
      setShowForm(false);
      setReason('');
      setLinks('');
      setExtraInfo('');
    } catch (err: any) {
      setError(err.message || 'Başvuru gönderilirken bir hata oluştu.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingReq = requests.find(r => r.status === 'pending');
  const lastReq = requests[0];
  const isUserVerified = Boolean(user.isVerified || (lastReq?.status === 'approved' && !pendingReq));

  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold text-zinc-900 dark:text-white mb-2.5 flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-blue-500" />
        <span>Doğrulama Başvurusu</span>
      </h4>

      {loading ? (
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
        </div>
      ) : (
        <>
          {/* Durum 1: Doğrulanmış Hesap */}
          {!showForm && isUserVerified && (
            <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 text-xs">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold mb-1">
                <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Hesabınız Doğrulandı</span>
              </div>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Profilinizde resmi mavi tik rozeti aktiftir.
              </p>
            </div>
          )}

          {/* Durum 2: Bekleyen Başvuru */}
          {!showForm && !isUserVerified && pendingReq && (
            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold mb-1">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Başvurunuz İnceleniyor</span>
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-400/80">
                Yetkililer başvurunuzu değerlendiriyor. Sonuçlandığında bildirim alacaksınız.
              </p>
            </div>
          )}

          {/* Durum 3: Reddedilen Başvuru */}
          {!showForm && !isUserVerified && !pendingReq && lastReq?.status === 'rejected' && (
            <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold">
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>Son Başvurunuz Onaylanmadı</span>
              </div>
              {lastReq.rejectionReason && (
                <p className="text-[11px] text-red-700/80 dark:text-red-400/80">
                  <span className="font-bold">Gerekçe:</span> {lastReq.rejectionReason}
                </p>
              )}
              <button 
                type="button"
                onClick={() => setShowForm(true)}
                className="self-start text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline pt-1 cursor-pointer"
              >
                Yeni Başvuru Gönder →
              </button>
            </div>
          )}

          {/* Durum 4: Henüz Başvuru Yapmamış */}
          {!showForm && !isUserVerified && !pendingReq && lastReq?.status !== 'rejected' && (
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Mavi Tik Başvurusu
                </p>
                <p className="text-[10px] text-zinc-500">
                  Tanınmış kişi, içerik üreticisi veya kurumlar için
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setShowForm(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer shrink-0"
              >
                Başvur
              </button>
            </div>
          )}

          {/* Başvuru Formu */}
          {showForm && (
            <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3 animate-in fade-in">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Hesap Türü
                </label>
                <select 
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>İçerik Üreticisi</option>
                  <option>Marka / Şirket</option>
                  <option>Kuruluş / Topluluk</option>
                  <option>Kamuya Mal Olmuş Kişi</option>
                  <option>Diğer</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Sosyal Medya veya Web Sitesi (İsteğe bağlı)
                </label>
                <input 
                  type="url"
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  placeholder="https://instagram.com/kullaniciadi"
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Doğrulanma Gerekçesi <span className="text-red-500">*</span>
                </label>
                <textarea 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Hesabınızın neden doğrulanması gerektiğini açıklayın..."
                  required
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Ek Bilgi (İsteğe bağlı)
                </label>
                <textarea 
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  placeholder="Eklemek istediğiniz diğer detaylar..."
                  rows={2}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              
              {error && (
                <div className="p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-lg text-red-600 dark:text-red-400 text-xs">
                  {error}
                </div>
              )}
              
              <div className="flex items-center justify-end gap-2 pt-1">
                <button 
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer"
                >
                  Vazgeç
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Başvuruyu Gönder</span>
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
};
