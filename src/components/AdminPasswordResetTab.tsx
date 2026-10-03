import React, { useState, useEffect, useMemo } from 'react';
import type { PasswordResetRequest, UserProfile } from '../types';
import {
  subscribeToPasswordResetRequests,
  updatePasswordResetRequestStatus,
} from '../services/passwordResetService';
import {
  KeyRound,
  Mail,
  User,
  Clock,
  Check,
  X,
  Copy,
  Search,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Building2,
  RefreshCw,
} from 'lucide-react';

interface AdminPasswordResetTabProps {
  currentUser: UserProfile;
}

export const AdminPasswordResetTab: React.FC<AdminPasswordResetTabProps> = ({
  currentUser,
}) => {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed' | 'rejected'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToPasswordResetRequests((data) => {
      setRequests(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCopyLink = async (requestId: string, link?: string) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(requestId);
      setTimeout(() => setCopiedId(null), 2500);
    } catch (err) {
      console.error('Kopyalama hatası:', err);
    }
  };

  const handleUpdateStatus = async (
    requestId: string,
    status: 'pending' | 'completed' | 'rejected'
  ) => {
    try {
      await updatePasswordResetRequestStatus(
        requestId,
        status,
        currentUser?.email || currentUser?.username || 'Admin'
      );
      setActionSuccess(
        status === 'completed'
          ? 'Talep işlendi olarak işaretlendi.'
          : status === 'rejected'
          ? 'Talep reddedildi.'
          : 'Talep durumu güncellendi.'
      );
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert('Durum güncellenemedi: ' + err.message);
    }
  };

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((req) => {
      const matchesFilter = filterStatus === 'all' || req.status === filterStatus;
      if (!matchesFilter) return false;

      if (!q) return true;
      return (
        req.email.toLowerCase().includes(q) ||
        (req.username && req.username.toLowerCase().includes(q)) ||
        (req.displayName && req.displayName.toLowerCase().includes(q))
      );
    });
  }, [requests, searchQuery, filterStatus]);

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const completedCount = requests.filter((r) => r.status === 'completed').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Bilinmiyor';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'Bilinmiyor';
    return date.toLocaleString('tr-TR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header Info Banner */}
      <div className="p-4 bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-2xl flex items-start gap-3">
        <div className="p-2 bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400 rounded-xl shrink-0 mt-0.5">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
            Manuel Şifre Sıfırlama Yönetimi
          </h3>
          <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
            Kullanıcıların oluşturduğu şifre sıfırlama talepleri burada listelenir. Hesap sahipliğini doğruladıktan sonra gerçek sıfırlama bağlantısını kopyalayıp kullanıcıya iletebilirsiniz.
          </p>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Arama ve Filtre Butonları */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="E-posta veya kullanıcı adına göre ara..."
            className="w-full text-xs pl-9 pr-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              filterStatus === 'all'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Tümü ({requests.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
              filterStatus === 'pending'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>🟡 Bekliyor</span>
            <span>({pendingCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('completed')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
              filterStatus === 'completed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>🟢 İşlendi</span>
            <span>({completedCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
              filterStatus === 'rejected'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>🔴 Reddedildi</span>
            <span>({rejectedCount})</span>
          </button>
        </div>
      </div>

      {/* Talepler Listesi */}
      {loading ? (
        <div className="p-8 text-center text-zinc-400 flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-xs">Şifre sıfırlama talepleri yükleniyor…</span>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="p-8 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center text-zinc-400">
          <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {searchQuery ? 'Aramanıza uygun talep bulunamadı.' : 'Henüz şifre sıfırlama talebi bulunmuyor.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const isPending = req.status === 'pending';
            const isCompleted = req.status === 'completed';
            const isRejected = req.status === 'rejected';

            return (
              <div
                key={req.id}
                className={`p-4 rounded-2xl border transition-all ${
                  isPending
                    ? 'bg-white dark:bg-zinc-900 border-amber-300 dark:border-amber-900/60 shadow-xs'
                    : 'bg-zinc-50/70 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isPending
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600'
                          : isCompleted
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-600'
                      }`}
                    >
                      <KeyRound className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                          {req.displayName || req.username}
                        </span>
                        <span className="font-mono text-xs text-red-600 dark:text-red-400">
                          @{req.username}
                        </span>
                        {req.accountType === 'business' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center gap-0.5">
                            <Building2 className="w-3 h-3" />
                            <span>İşletme</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        <span className="font-mono truncate">{req.email}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatDate(req.createdAt)}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Durum Rozeti */}
                  <div>
                    {isPending && (
                      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                        🟡 Bekliyor
                      </span>
                    )}
                    {isCompleted && (
                      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60">
                        🟢 İşlendi
                      </span>
                    )}
                    {isRejected && (
                      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60">
                        🔴 Reddedildi
                      </span>
                    )}
                  </div>
                </div>

                {/* Reset Linki & Manuel Aksiyonlar */}
                <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                      Gerçek Firebase Sıfırlama Bağlantısı
                    </span>
                    <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate select-all">
                      {req.resetLink || 'Bağlantı bulunamadı'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-4">
                    {req.resetLink && (
                      <button
                        type="button"
                        onClick={() => handleCopyLink(req.id, req.resetLink)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                          copiedId === req.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                        }`}
                      >
                        {copiedId === req.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Kopyalandı!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Reset Bağlantısını Kopyala</span>
                          </>
                        )}
                      </button>
                    )}

                    {isPending && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(req.id, 'completed')}
                          className="p-1.5 bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl transition-colors cursor-pointer"
                          title="İşlendi Olarak İşaretle"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(req.id, 'rejected')}
                          className="p-1.5 bg-rose-50 dark:bg-rose-950 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl transition-colors cursor-pointer"
                          title="Talebi Reddet"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
