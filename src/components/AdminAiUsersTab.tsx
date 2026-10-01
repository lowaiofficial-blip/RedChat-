import React, { useState, useEffect, useMemo } from 'react';
import type { UserProfile, Conversation } from '../types';
import {
  reopenUserAiChat,
  closeUserAiChat,
  subscribeToAllConversations,
} from '../services/adminService';
import { isRedChatAI, REDCHAT_AI_UID } from '../services/aiService';
import { getDeterministicConversationId } from '../services/chatService';
import { VerifiedBadge } from './VerifiedBadge';
import {
  Search,
  Bot,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  X,
  ShieldAlert,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface AdminAiUsersTabProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onUpdateUser?: (updated: UserProfile) => void;
}

export const AdminAiUsersTab: React.FC<AdminAiUsersTabProps> = ({
  currentUser,
  allUsers,
  onUpdateUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'allowed' | 'blocked'>('all');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Firestore Konuşmaları (Gerçek zamanlı)
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);

  // Gerçek zamanlı konuşmaları dinle
  useEffect(() => {
    const unsubscribe = subscribeToAllConversations((convList) => {
      setConversations(convList);
      setLoadingConversations(false);
    });
    return () => unsubscribe();
  }, []);

  // Kullanıcı UID -> AI Conversation Haritası
  const aiConversationsMap = useMemo(() => {
    const map = new Map<string, Conversation>();
    conversations.forEach((conv) => {
      if (!conv.isGroup && conv.participantIds?.includes(REDCHAT_AI_UID)) {
        const userUid = conv.participantIds.find((id) => id !== REDCHAT_AI_UID);
        if (userUid) {
          map.set(userUid, conv);
        }
      }
    });
    return map;
  }, [conversations]);

  // Onay Modalı State'i
  const [confirmModalData, setConfirmModalData] = useState<{
    targetUser: UserProfile;
    targetAction: 'allow' | 'block';
  } | null>(null);

  // Yalnızca gerçek kullanıcıları filtrele (System AI hariç)
  const nonAiUsers = useMemo(() => {
    return allUsers.filter((u) => !isRedChatAI(u) && u.uid !== REDCHAT_AI_UID);
  }, [allUsers]);

  // Kullanıcının AI durumunu belirleyen yardımcı fonksiyon (Firestore Conversation + UserProfile)
  const checkIsUserAiTerminated = (user: UserProfile): { isTerminated: boolean; reason: string | null } => {
    const conv = aiConversationsMap.get(user.uid);
    const deterministicConvId = getDeterministicConversationId(user.uid, REDCHAT_AI_UID);
    const directConv = conv || conversations.find((c) => c.id === deterministicConvId);

    if (directConv?.securityStatus === 'terminated') {
      return { isTerminated: true, reason: 'Güvenlik İhlali (Küfür/Hakaret)' };
    }
    if (user.securityStatus === 'terminated') {
      return { isTerminated: true, reason: 'Güvenlik Kısıtlaması' };
    }
    if (user.aiAccess === 'blocked') {
      return { isTerminated: true, reason: 'Yönetici Engeli' };
    }
    return { isTerminated: false, reason: null };
  };

  // Gerçek Firestore verilerine göre Kapatılan & Açık sayıları
  const terminatedCount = useMemo(() => {
    return nonAiUsers.filter((u) => checkIsUserAiTerminated(u).isTerminated).length;
  }, [nonAiUsers, aiConversationsMap, conversations]);

  const openCount = nonAiUsers.length - terminatedCount;

  // Arama & Filtreleme
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nonAiUsers.filter((user) => {
      const { isTerminated } = checkIsUserAiTerminated(user);

      // Durum filtresi
      if (filterMode === 'allowed' && isTerminated) return false;
      if (filterMode === 'blocked' && !isTerminated) return false;

      // Metin araması
      if (!q) return true;
      const dName = (user.displayName || '').toLowerCase();
      const uName = (user.username || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const uid = (user.uid || '').toLowerCase();
      return (
        dName.includes(q) ||
        uName.includes(q) ||
        email.includes(q) ||
        uid.includes(q)
      );
    });
  }, [nonAiUsers, searchQuery, filterMode, aiConversationsMap, conversations]);

  // Onaylanan işlemi gerçekleştir
  const handleConfirmAction = async () => {
    if (!confirmModalData) return;
    const { targetUser, targetAction } = confirmModalData;

    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      if (targetAction === 'allow') {
        // AI Sohbetini Yeniden Aç
        await reopenUserAiChat(currentUser, targetUser.uid);

        const updatedUser: UserProfile = {
          ...targetUser,
          aiAccess: 'allowed',
          securityStatus: 'active',
        };

        if (onUpdateUser) {
          onUpdateUser(updatedUser);
        }

        setActionSuccess(`@${targetUser.username} kullanıcısının AI sohbeti yeniden açıldı.`);
      } else {
        // AI Sohbetini Kapat
        await closeUserAiChat(currentUser, targetUser.uid, 'admin_action');

        const updatedUser: UserProfile = {
          ...targetUser,
          aiAccess: 'blocked',
          securityStatus: 'terminated',
        };

        if (onUpdateUser) {
          onUpdateUser(updatedUser);
        }

        setActionSuccess(`@${targetUser.username} kullanıcısının AI sohbeti kapatıldı.`);
      }

      setConfirmModalData(null);

      setTimeout(() => {
        setActionSuccess(null);
      }, 4000);
    } catch (err: any) {
      console.error('AI erişim güncelleme hatası:', err);
      setActionError(err?.message || 'İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ℹ️ Bilgilendirme Banner'ı */}
      <div className="p-4 bg-gradient-to-r from-red-500/10 via-zinc-800/20 to-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 mt-0.5">
            <Bot className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>DeepRed AI Kullanıcı Durumları</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50">
                Gerçek Firestore Verisi
              </span>
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
              Bu panelde kullanıcıların yapay zeka asistanı (DeepRed AI) ile olan sohbet durumları listelenir.
              Güvenlik ihlali (küfür/hakaret) veya yönetici kararıyla kapatılan sohbetler anlık olarak tespit edilir ve tek tıkla yeniden açılabilir.
              Normal hesap banından tamamen ayrıdır.
            </p>
          </div>
        </div>
      </div>

      {/* Başarı & Hata Bildirimleri */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Arama & Filtreleme Çubuğu */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Kullanıcı adı, isim, e-posta veya UID ile ara..."
            className="w-full pl-9 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              filterMode === 'all'
                ? 'bg-red-600 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Tümü ({nonAiUsers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('allowed')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              filterMode === 'allowed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>🟢 Açık</span>
            <span>({openCount})</span>
          </button>
          <button
            type="button"
            id="admin-ai-terminated-filter-btn"
            onClick={() => setFilterMode('blocked')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              filterMode === 'blocked'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>🔴 Kapatılan</span>
            <span>({terminatedCount})</span>
          </button>
        </div>
      </div>

      {/* Kullanıcı Listesi / Tablosu */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
        {loadingConversations ? (
          <div className="p-8 text-center text-zinc-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-red-500" />
            <span className="text-xs">Firestore AI verileri taranıyor...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            <Bot className="w-8 h-8 mx-auto mb-2 text-zinc-400 opacity-60" />
            <p className="text-sm font-semibold">Eşleşen kullanıcı bulunamadı.</p>
            <p className="text-xs text-zinc-400 mt-1">Arama terimini veya filtreyi değiştirmeyi deneyin.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-800/30 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Kullanıcı</th>
                  <th className="py-3 px-4">Kullanıcı Adı</th>
                  <th className="py-3 px-4">Hesap Durumu</th>
                  <th className="py-3 px-4">AI Sohbet Durumu</th>
                  <th className="py-3 px-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 text-xs">
                {filteredUsers.map((user) => {
                  const { isTerminated, reason } = checkIsUserAiTerminated(user);
                  const isSelf = user.uid === currentUser.uid;

                  return (
                    <tr
                      key={user.uid}
                      className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Profil Fotoğrafı ve Görünen Ad */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {user.photoURL ? (
                              <img
                                src={user.photoURL}
                                alt={user.displayName || user.username}
                                className="w-9 h-9 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-600 to-rose-700 text-white flex items-center justify-center font-bold text-xs uppercase shadow-xs">
                                {(user.displayName || user.username || '?').charAt(0)}
                              </div>
                            )}
                            {user.isOnline && (
                              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-zinc-900 rounded-full" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-zinc-100">
                              <span className="truncate">{user.displayName || user.username}</span>
                              {user.isVerified && <VerifiedBadge size="sm" />}
                              {isSelf && (
                                <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.2 rounded font-normal">
                                  Sen
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">
                              {user.email || user.uid}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Kullanıcı Adı */}
                      <td className="py-3 px-4 font-mono text-zinc-600 dark:text-zinc-400">
                        @{user.username}
                      </td>

                      {/* Normal Hesap Durumu */}
                      <td className="py-3 px-4">
                        {user.isBanned ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50">
                            Banlı
                          </span>
                        ) : user.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-900/50">
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            Normal
                          </span>
                        )}
                      </td>

                      {/* AI Durumu */}
                      <td className="py-3 px-4">
                        {isTerminated ? (
                          <div className="inline-flex flex-col items-start gap-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 shadow-xs">
                              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                              <span>🔴 Kapatılan</span>
                            </span>
                            {reason && (
                              <span className="text-[10px] text-rose-500 font-medium pl-1">
                                {reason}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 shadow-xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span>🟢 Açık</span>
                          </span>
                        )}
                      </td>

                      {/* İşlem Butonu */}
                      <td className="py-3 px-4 text-right">
                        {isTerminated ? (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmModalData({
                                targetUser: user,
                                targetAction: 'allow',
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/80 transition-all cursor-pointer shadow-xs active:scale-95"
                            title="Bu kullanıcının AI sohbetini yeniden aç"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>🔓 AI Sohbetini Yeniden Aç</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() =>
                              setConfirmModalData({
                                targetUser: user,
                                targetAction: 'block',
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-rose-50 dark:bg-zinc-800 dark:hover:bg-rose-950/40 text-zinc-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-300 border border-zinc-200 dark:border-zinc-700 hover:border-rose-300 dark:hover:border-rose-800/80 transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={isSelf ? 'Kendinizi kapatamazsınız' : 'Kullanıcının AI sohbetini kapat'}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>🚫 AI Sohbetini Kapat</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 🔐 ONAY MODALI */}
      {confirmModalData && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xs select-none"
          onClick={() => {
            if (!actionLoading) setConfirmModalData(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm sm:max-w-md w-full p-5 sm:p-6 shadow-2xl relative my-auto text-center animate-in fade-in zoom-in-95"
          >
            {/* Kapat butonu */}
            <button
              type="button"
              onClick={() => !actionLoading && setConfirmModalData(null)}
              disabled={actionLoading}
              className="absolute top-3.5 right-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>

            {/* İkon */}
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 shadow-xs ${
                confirmModalData.targetAction === 'allow'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
              }`}
            >
              {confirmModalData.targetAction === 'allow' ? (
                <Unlock className="w-6 h-6" />
              ) : (
                <Lock className="w-6 h-6" />
              )}
            </div>

            {/* Başlık */}
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
              {confirmModalData.targetAction === 'allow'
                ? 'AI Sohbetini Yeniden Aç'
                : 'Kullanıcının AI Sohbetini Kapat'}
            </h3>

            {/* Hedef Kullanıcı Kartı */}
            <div className="my-3 p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl flex items-center gap-3 border border-zinc-200 dark:border-zinc-700/60 text-left">
              {confirmModalData.targetUser.photoURL ? (
                <img
                  src={confirmModalData.targetUser.photoURL}
                  alt={confirmModalData.targetUser.displayName}
                  className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xs uppercase">
                  {(confirmModalData.targetUser.displayName || confirmModalData.targetUser.username || '?').charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {confirmModalData.targetUser.displayName || confirmModalData.targetUser.username}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">
                  @{confirmModalData.targetUser.username}
                </div>
              </div>
            </div>

            {/* Açıklama Metni */}
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
              {confirmModalData.targetAction === 'allow'
                ? 'Bu kullanıcının AI erişimi yeniden açılsın mı?'
                : 'Bu kullanıcının AI erişimi kapatılsın mı?'}
            </p>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
              {confirmModalData.targetAction === 'allow'
                ? 'Sohbet yeniden açıldığında güvenlik kısıtlaması kaldırılır, kullanıcı DeepRed AI ile tekrar mesajlaşabilir.'
                : 'Kullanıcının hesabı banlanmaz; yalnızca DeepRed AI asistanı kilitlenir. Özel mesajlaşmaya, gruplara ve kanallara erişmeye devam eder.'}
            </p>

            {/* Butonlar */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmModalData(null)}
                disabled={actionLoading}
                className="flex-1 py-2.5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={`flex-1 py-2.5 px-4 text-xs font-bold text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmModalData.targetAction === 'allow'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                }`}
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>İşleniyor…</span>
                  </>
                ) : confirmModalData.targetAction === 'allow' ? (
                  <>
                    <Unlock className="w-4 h-4" />
                    <span>Evet, Yeniden Aç</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Evet, Kapat</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
