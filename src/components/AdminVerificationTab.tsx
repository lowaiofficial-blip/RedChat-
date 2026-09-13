import React, { useState, useEffect } from 'react';
import { subscribeToAllVerificationRequests, updateVerificationRequestStatus } from '../services/verificationService';
import type { VerificationRequest } from '../types';
import { Loader2, CheckCircle, XCircle, Search, ShieldCheck, User, Tv } from 'lucide-react';

export const AdminVerificationTab: React.FC = () => {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [filterType, setFilterType] = useState<'all' | 'user' | 'channel'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToAllVerificationRequests((data) => {
      setRequests(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleAction = async (id: string, action: 'approved' | 'rejected') => {
    let reason = undefined;
    if (action === 'rejected') {
      const p = window.prompt("Reddetme nedeni (İsteğe bağlı):");
      if (p === null) return; // Cancelled
      reason = p.trim();
    }
    
    if (action === 'approved') {
      const confirm = window.confirm("Bu başvuruyu onaylamak istediğinize emin misiniz? Kullanıcı veya kanal mavi tik alacaktır.");
      if (!confirm) return;
    }

    setProcessingId(id);
    try {
      await updateVerificationRequestStatus(id, action, reason);
    } catch (err: any) {
      alert(err.message || 'Bir hata oluştu.');
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter(r => {
    if (filterType !== 'all' && r.type !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  });

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-zinc-400" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-500" />
          Doğrulama Başvuruları
        </h2>
        
        <div className="flex flex-wrap gap-2">
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm"
          >
            <option value="all">Tüm Türler</option>
            <option value="user">Kullanıcılar</option>
            <option value="channel">Kanallar</option>
          </select>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm"
          >
            <option value="all">Tüm Durumlar</option>
            <option value="pending">Bekleyenler</option>
            <option value="approved">Onaylananlar</option>
            <option value="rejected">Reddedilenler</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredRequests.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            Gösterilecek başvuru bulunamadı.
          </div>
        ) : (
          filteredRequests.map(req => (
            <div key={req.id} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {req.type === 'user' ? (
                    <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg"><User className="w-4 h-4" /></div>
                  ) : (
                    <div className="p-1.5 bg-purple-100 text-purple-600 rounded-lg"><Tv className="w-4 h-4" /></div>
                  )}
                  <div>
                    <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                      {req.type === 'user' ? req.displayName || req.username : req.channelName}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {req.type === 'user' ? `@${req.username} • ${req.accountType}` : `Kanal • ${req.category}`}
                    </div>
                  </div>
                </div>
                <div>
                  {req.status === 'pending' && <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 text-xs font-semibold rounded-full">Bekliyor</span>}
                  {req.status === 'approved' && <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 text-xs font-semibold rounded-full">Onaylandı</span>}
                  {req.status === 'rejected' && <span className="px-2.5 py-1 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50 text-xs font-semibold rounded-full">Reddedildi</span>}
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg text-sm text-zinc-700 dark:text-zinc-300">
                <div className="mb-1"><span className="font-semibold">Neden:</span> {req.reason}</div>
                {req.links && <div className="mb-1"><span className="font-semibold">Bağlantı:</span> <a href={req.links} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{req.links}</a></div>}
                {req.extraInfo && <div><span className="font-semibold">Ek Bilgi:</span> {req.extraInfo}</div>}
                {req.rejectionReason && <div className="mt-2 text-red-500 font-medium">Red Nedeni: {req.rejectionReason}</div>}
              </div>

              {req.status === 'pending' && (
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => handleAction(req.id, 'approved')}
                    disabled={processingId === req.id}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Onayla
                  </button>
                  <button
                    onClick={() => handleAction(req.id, 'rejected')}
                    disabled={processingId === req.id}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                    Reddet
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
