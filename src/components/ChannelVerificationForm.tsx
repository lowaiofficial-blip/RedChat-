import React, { useState, useEffect } from 'react';
import { submitVerificationRequest, subscribeToMyVerificationRequests } from '../services/verificationService';
import type { VerificationRequest, Channel } from '../types';
import { Loader2, CheckCircle, Clock, XCircle, ShieldCheck } from 'lucide-react';

interface ChannelVerificationFormProps {
  channel: Channel;
}

export const ChannelVerificationForm: React.FC<ChannelVerificationFormProps> = ({ channel }) => {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [category, setCategory] = useState('Topluluk');
  const [links, setLinks] = useState('');
  const [reason, setReason] = useState('');
  const [extraInfo, setExtraInfo] = useState('');

  useEffect(() => {
    const unsub = subscribeToMyVerificationRequests('channel', channel.id, (data) => {
      setRequests(data);
      setLoading(false);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [channel.id]);

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
        type: 'channel',
        channelId: channel.id,
        channelName: channel.name,
        category,
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
  const isChannelVerified = Boolean(channel.isVerified || (lastReq?.status === 'approved' && !pendingReq));

  return (
    <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-blue-500" />
          <span>Kanal Mavi Tik Doğrulaması</span>
        </h4>
      </div>

      {loading ? (
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
        </div>
      ) : (
        <>
          {/* Kanal Doğrulanmış */}
          {!showForm && isChannelVerified && (
            <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 text-xs">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold mb-1">
                <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Kanalınız Doğrulandı</span>
              </div>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Kanalınızın yanında resmi mavi tik rozeti görüntülenmektedir.
              </p>
            </div>
          )}

          {/* Bekleyen Başvuru */}
          {!showForm && !isChannelVerified && pendingReq && (
            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold mb-1">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Kanal Başvurusu İnceleniyor</span>
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-400/80">
                Yöneticiler kanalınızın başvurusunu inceliyor. Tamamlandığında durum burada güncellenecektir.
              </p>
            </div>
          )}

          {/* Reddedilen Başvuru */}
          {!showForm && !isChannelVerified && !pendingReq && lastReq?.status === 'rejected' && (
            <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold">
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>Son Başvuru Onaylanmadı</span>
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
                Yeniden Başvur →
              </button>
            </div>
          )}

          {/* Başvuru Yapılmamış */}
          {!showForm && !isChannelVerified && !pendingReq && lastReq?.status !== 'rejected' && (
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Resmi Kanal Doğrulaması
                </p>
                <p className="text-[10px] text-zinc-500">
                  Kanalınızı resmi onaylı hale getirmek için başvuru yapın.
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

          {/* Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850 space-y-3 animate-in fade-in">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Kategori
                </label>
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>Topluluk</option>
                  <option>Marka / İşletme</option>
                  <option>Haber / Medya</option>
                  <option>Eğlence</option>
                  <option>Eğitim</option>
                  <option>Oyun / Espor</option>
                  <option>Diğer</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Web Sitesi / Sosyal Medya (İsteğe bağlı)
                </label>
                <input 
                  type="url"
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Doğrulanma Nedeni <span className="text-red-500">*</span>
                </label>
                <textarea 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Bu kanalın neden doğrulanması gerektiğini açıklayın..."
                  required
                  rows={3}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Ek Bilgi (İsteğe bağlı)
                </label>
                <textarea 
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  placeholder="Kanal hakkında eklemek istediğiniz diğer bilgiler..."
                  rows={2}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
