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
    return () => unsub();
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

  if (loading) {
    return <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  }

  const pendingReq = requests.find(r => r.status === 'pending');
  const lastReq = requests[0];

  return (
    <div className="mt-6 mb-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-blue-500" />
        Kanal Doğrulama Başvurusu
      </h4>

      {!showForm && pendingReq && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 text-sm">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium mb-1">
            <Clock className="w-4 h-4" />
            Başvurunuz inceleniyor
          </div>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
            RedChat ekibi kanal başvurunuzu inceliyor. Bu işlem biraz zaman alabilir.
          </p>
        </div>
      )}

      {!showForm && !pendingReq && lastReq?.status === 'approved' && channel.isVerified && (
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 text-sm">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium mb-1">
            <CheckCircle className="w-4 h-4" />
            Kanalınız doğrulandı
          </div>
          <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
            Mavi tik rozetiniz kanalınızda görüntüleniyor.
          </p>
        </div>
      )}

      {!showForm && !pendingReq && lastReq?.status === 'rejected' && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 text-sm mb-3">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium mb-1">
            <XCircle className="w-4 h-4" />
            Başvurunuz onaylanmadı
          </div>
          {lastReq.rejectionReason && (
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mb-2">
              Neden: {lastReq.rejectionReason}
            </p>
          )}
          <button 
            onClick={() => setShowForm(true)}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            Tekrar Başvur
          </button>
        </div>
      )}

      {!showForm && !pendingReq && lastReq?.status !== 'approved' && lastReq?.status !== 'rejected' && (
         <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col items-start gap-2">
           <p className="text-xs text-zinc-600 dark:text-zinc-400">Kanalınızın resmi bir marka, kuruluş veya tanınmış bir topluluk olduğunu kanıtlayarak mavi tik alabilirsiniz.</p>
           <button 
             onClick={() => setShowForm(true)}
             className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors"
           >
             Mavi Tik Başvurusu Yap
           </button>
         </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 mt-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Kanal Kategorisi</label>
            <select 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>Topluluk</option>
              <option>Marka / İşletme</option>
              <option>Haber / Medya</option>
              <option>Eğlence</option>
              <option>Eğitim</option>
              <option>Diğer</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Web Sitesi / Sosyal Medya (İsteğe Bağlı)</label>
            <input 
              type="text"
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              placeholder="https://"
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Neden Doğrulanmak İstiyorsunuz?</label>
            <textarea 
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Kısaca açıklayın..."
              required
              rows={3}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Ek Bilgi (İsteğe Bağlı)</label>
            <textarea 
              value={extraInfo}
              onChange={(e) => setExtraInfo(e.target.value)}
              placeholder="Eklemek istedikleriniz..."
              rows={2}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          
          {error && <div className="text-red-500 text-xs">{error}</div>}
          
          <div className="flex items-center justify-end gap-2 pt-2">
            <button 
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg"
            >
              İptal
            </button>
            <button 
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Gönder
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
