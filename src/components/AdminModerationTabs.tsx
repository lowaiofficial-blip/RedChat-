import React, { useState, useEffect, useMemo, useRef } from 'react';
import type {
  UserProfile,
  UserReport,
  ModerationReport,
  ModerationLogEntry,
  ModeratorGrant,
  Conversation,
  ModerationAccessLog,
} from '../types';
import {
  MUSE_MODERATOR_UID,
  MUSE_MODERATOR_EMAIL,
  subscribeToModeratorGrant,
  subscribeToModerationLogsPaginated,
  subscribeToUserReportsPaginated,
  subscribeToModerationReportsPaginated,
  subscribeToModerationAccessLogsPaginated,
  setModeratorRoleByAdmin,
  updateUserReportStatus,
  submitModerationReport,
  toTimestampMs,
  formatRemainingTime,
  type PaginatedCollectionState,
  type PaginatedSubscriptionHandle,
} from '../services/moderationService';
import { UserAvatar } from './UserAvatar';
import {
  Flag,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Send,
  History,
  UserCheck,
  UserX,
  Lock,
  MessageSquare,
  Search,
  ChevronDown,
  Info,
  Eye,
  Radio,
} from 'lucide-react';

function formatDateTime(ts: any): string {
  const ms = toTimestampMs(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  harassment: 'Hakaret / Taciz',
  spam: 'Spam / Flood',
  scam: 'Dolandırıcılık',
  inappropriate: 'Uygunsuz İçerik',
  other: 'Diğer',
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  temp_mute: { label: 'Geçici Susturma', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  perm_mute: { label: 'Kalıcı Susturma', color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30' },
  unmute: { label: 'Susturma Kaldırıldı', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  auto_mute_expired: { label: 'Susturma Süresi Doldu', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  temp_ban: { label: 'Geçici Ban', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' },
  perm_ban: { label: 'Kalıcı Ban', color: 'bg-red-600/20 text-red-600 dark:text-red-400 border-red-500/40' },
  unban: { label: 'Ban Kaldırıldı', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  auto_ban_expired: { label: 'Ban Süresi Doldu', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  moderator_role_granted: { label: 'Moderatör Yetkisi Verildi', color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  moderator_role_revoked: { label: 'Moderatör Yetkisi Alındı', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30' },
  report_reviewed: { label: 'Şikâyet / Rapor İşlendi', color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30' },
  email_in_review: { label: 'E-posta İncelemeye Alındı', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  email_review_released: { label: 'E-posta İncelemesi Kaldırıldı', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  verification_approved: { label: 'Mavi Tik Başvurusu Onaylandı', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  verification_rejected: { label: 'Mavi Tik Başvurusu Reddedildi', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' },
  user_verified: { label: 'Kullanıcı Mavi Tik Verildi', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  user_unverified: { label: 'Kullanıcı Mavi Tik Kaldırıldı', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30' },
  abusive_chat_flagged: { label: 'AI Güvenlik İhlali Bayrağı', color: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' },
  channel_disabled: { label: 'Kanal Devre Dışı Bırakıldı', color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30' },
  channel_enabled: { label: 'Kanal Etkinleştirildi', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  channel_deleted: { label: 'Kanal Silindi', color: 'bg-red-600/20 text-red-600 dark:text-red-400 border-red-500/40' },
  post_deleted: { label: 'Kanal Gönderisi Silindi', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' },
};

interface AdminModerationReportsTabProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  scopedConversations: Conversation[];
  onInspectConversation?: (conv: Conversation) => void;
  onInspectUser?: (user: UserProfile) => void;
}

export const AdminModerationReportsTab: React.FC<AdminModerationReportsTabProps> = ({
  currentUser,
  allUsers,
  scopedConversations,
  onInspectConversation,
  onInspectUser,
}) => {
  const [userReportsState, setUserReportsState] = useState<PaginatedCollectionState<UserReport>>({
    items: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
  });
  const [modReportsState, setModReportsState] = useState<PaginatedCollectionState<ModerationReport>>({
    items: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
  });
  const userReportsHandleRef = useRef<PaginatedSubscriptionHandle | null>(null);
  const modReportsHandleRef = useRef<PaginatedSubscriptionHandle | null>(null);

  const userReports = userReportsState.items;
  const moderationReports = modReportsState.items;

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'reviewing' | 'resolved' | 'dismissed'>('all');
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Şüpheli Davranış / İnceleme Raporu Formu State'i
  const [targetUid, setTargetUid] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [riskLevel, setRiskLevel] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [recommendedAction, setRecommendedAction] = useState<
    'monitor' | 'temp_mute' | 'temp_ban' | 'perm_ban_review' | 'dismiss'
  >('temp_mute');
  const [submittingReport, setSubmittingReport] = useState(false);

  const userMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    allUsers.forEach((u) => {
      if (u?.uid) map.set(u.uid, u);
    });
    return map;
  }, [allUsers]);

  useEffect(() => {
    const h1 = subscribeToUserReportsPaginated(setUserReportsState, 50);
    const h2 = subscribeToModerationReportsPaginated(setModReportsState, 50);
    userReportsHandleRef.current = h1;
    modReportsHandleRef.current = h2;
    return () => {
      h1.unsubscribe();
      h2.unsubscribe();
      userReportsHandleRef.current = null;
      modReportsHandleRef.current = null;
    };
  }, []);

  const filteredReports = useMemo(() => {
    if (statusFilter === 'all') return userReports;
    return userReports.filter((r) => r.status === statusFilter);
  }, [userReports, statusFilter]);

  const handleStatusChange = async (
    reportId: string,
    status: 'reviewing' | 'resolved' | 'dismissed'
  ) => {
    if (updatingReportId) return;
    setUpdatingReportId(reportId);
    setFeedback(null);
    try {
      await updateUserReportStatus(reportId, status, currentUser.uid);
      setFeedback({ type: 'success', text: 'Şikâyet durumu güncellendi.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Şikâyet durumu güncellenemedi.' });
    } finally {
      setUpdatingReportId(null);
    }
  };

  const handleCreateModerationReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUid || summary.trim().length < 5 || submittingReport) return;

    setSubmittingReport(true);
    setFeedback(null);
    try {
      await submitModerationReport({
        targetUid,
        conversationId: conversationId.trim() || null,
        riskLevel,
        title: title.trim() || 'Şüpheli Davranış Raporu',
        summary: summary.trim(),
        recommendedAction,
      });
      setFeedback({ type: 'success', text: '✓ İnceleme raporu başarıyla oluşturuldu ve kaydedildi.' });
      setTitle('');
      setSummary('');
      setConversationId('');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Rapor kaydedilemedi.' });
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold border flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* ÜST BÖLÜM: KULLANICI ŞİKÂYETLERİ */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Flag className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Kullanıcı Şikâyetleri ({userReports.length})
              </h3>
              <p className="text-[11px] text-zinc-400">
                Şikâyet edilen sohbetler ve mesajlar moderasyon incelemesine açılır.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl overflow-x-auto">
            {(['all', 'pending', 'reviewing', 'resolved', 'dismissed'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white dark:bg-zinc-900 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {st === 'all'
                  ? 'Tümü'
                  : st === 'pending'
                  ? 'Bekliyor'
                  : st === 'reviewing'
                  ? 'İnceleniyor'
                  : st === 'resolved'
                  ? 'Çözüldü'
                  : 'Reddedildi'}
              </button>
            ))}
          </div>
        </div>

        {filteredReports.length === 0 ? (
          <div className="py-10 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
            Seçili filtrede kullanıcı şikâyeti bulunmuyor.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((rep) => {
              const targetU = userMap.get(rep.reportedUid);
              const reporterU = userMap.get(rep.reporterUid);
              const matchedConv = rep.conversationId
                ? scopedConversations.find((c) => c.id === rep.conversationId)
                : undefined;

              return (
                <div
                  key={rep.id}
                  className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          rep.status === 'pending'
                            ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                            : rep.status === 'reviewing'
                            ? 'bg-sky-500/15 text-sky-600 border-sky-500/30'
                            : rep.status === 'resolved'
                            ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                            : 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30'
                        }`}
                      >
                        {rep.status === 'pending'
                          ? 'Bekliyor'
                          : rep.status === 'reviewing'
                          ? 'İnceleniyor'
                          : rep.status === 'resolved'
                          ? 'Çözüldü'
                          : 'Reddedildi'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-zinc-200/70 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[10px] font-bold">
                        {CATEGORY_LABELS[rep.category] || rep.category}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {formatDateTime(rep.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {matchedConv && onInspectConversation && (
                        <button
                          onClick={() => onInspectConversation(matchedConv)}
                          className="px-2.5 py-1 rounded-lg bg-zinc-200/80 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-red-600 hover:text-white text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Sohbeti İncele</span>
                        </button>
                      )}
                      {targetU && onInspectUser && (
                        <button
                          onClick={() => onInspectUser(targetU)}
                          className="px-2.5 py-1 rounded-lg bg-zinc-200/80 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-amber-600 hover:text-white text-[11px] font-bold transition-colors cursor-pointer"
                        >
                          Hedef Kullanıcı
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-zinc-400 block">Şikâyet Eden:</span>
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">
                        @{reporterU?.username || rep.reporterUsername || rep.reporterUid.slice(0, 8)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-zinc-400 block">Şikâyet Edilen:</span>
                      <span className="font-bold text-red-600 dark:text-red-400">
                        @{targetU?.username || rep.reportedUsername || rep.reportedUid.slice(0, 8)}
                      </span>
                    </div>
                  </div>

                  <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{rep.reason}</p>

                  {rep.messageExcerpt && (
                    <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900/70 border-l-2 border-amber-500 text-[11px] italic text-zinc-600 dark:text-zinc-400">
                      "{rep.messageExcerpt}"
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    {rep.status !== 'reviewing' && (
                      <button
                        onClick={() => handleStatusChange(rep.id, 'reviewing')}
                        disabled={updatingReportId === rep.id}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 cursor-pointer"
                      >
                        İncelemeye Al
                      </button>
                    )}
                    {rep.status !== 'resolved' && (
                      <button
                        onClick={() => handleStatusChange(rep.id, 'resolved')}
                        disabled={updatingReportId === rep.id}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                      >
                        Çözüldü İşaretle
                      </button>
                    )}
                    {rep.status !== 'dismissed' && (
                      <button
                        onClick={() => handleStatusChange(rep.id, 'dismissed')}
                        disabled={updatingReportId === rep.id}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-zinc-200/70 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                      >
                        Reddet
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {userReportsState.hasMore && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => userReportsHandleRef.current?.loadMore()}
                  disabled={userReportsState.loadingMore}
                  className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                >
                  {userReportsState.loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>Devamını Yükle</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ALT BÖLÜM: ŞÜPHELİ DAVRANIŞ RAPORU OLUŞTUR & RAPOR LİSTESİ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleCreateModerationReport}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5 text-xs"
        >
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <FileText className="w-4 h-4 text-red-600" />
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Şüpheli Davranış / İnceleme Raporu Gönder
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Hedef Kullanıcı <span className="text-red-500">*</span>
              </label>
              <select
                value={targetUid}
                onChange={(e) => setTargetUid(e.target.value)}
                disabled={submittingReport}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                <option value="">Kullanıcı seçin...</option>
                {allUsers
                  .filter((u) => !u.isSystemAI && u.uid !== currentUser.uid)
                  .map((u) => (
                    <option key={u.uid} value={u.uid}>
                      @{u.username} ({u.displayName || u.username})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Risk Seviyesi
              </label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as any)}
                disabled={submittingReport}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                <option value="low">Düşük</option>
                <option value="medium">Orta</option>
                <option value="high">Yüksek</option>
                <option value="critical">Kritik (Yönetici İncelemesi)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Başlık
              </label>
              <input
                type="text"
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Tekrarlayan taciz / spam"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Önerilen Aksiyon
              </label>
              <select
                value={recommendedAction}
                onChange={(e) => setRecommendedAction(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                <option value="monitor">Gözlem Altında Tut</option>
                <option value="temp_mute">Geçici Susturma</option>
                <option value="temp_ban">Geçici Ban</option>
                <option value="perm_ban_review">Kalıcı Ban Değerlendirmesi (Admin)</option>
                <option value="dismiss">İhlal Tespit Edilmedi</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              İlgili Sohbet ID (İsteğe bağlı)
            </label>
            <input
              type="text"
              maxLength={120}
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="Sohbet ID (varsa)"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              İnceleme Özeti <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              maxLength={1800}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Tespit edilen şüpheli davranış ve mesaj logu özetini yazın..."
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submittingReport || !targetUid || summary.trim().length < 5}
            className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            {submittingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>Raporu Gönder (Değiştirilemez Kayıt)</span>
          </button>
        </form>

        {/* Gönderilen Moderasyon Raporları */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Moderasyon İnceleme Raporları ({moderationReports.length})
            </h4>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Silinemez Kayıt
            </span>
          </div>

          {moderationReports.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">
              Henüz oluşturulmuş moderasyon raporu bulunmuyor.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {moderationReports.map((mr) => {
                const targetU = userMap.get(mr.targetUid);
                return (
                  <div
                    key={mr.id}
                    className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {mr.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                          mr.riskLevel === 'critical'
                            ? 'bg-red-600 text-white'
                            : mr.riskLevel === 'high'
                            ? 'bg-rose-500/20 text-rose-500'
                            : mr.riskLevel === 'medium'
                            ? 'bg-amber-500/20 text-amber-500'
                            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                        }`}
                      >
                        {mr.riskLevel}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap">
                      <span>
                        Hedef: <strong className="text-red-600">@{targetU?.username || mr.targetUsername || mr.targetUid.slice(0, 6)}</strong>
                      </span>
                      <span>•</span>
                      <span>Yazan: @{mr.authorUsername}</span>
                      <span>•</span>
                      <span>{formatDateTime(mr.createdAt)}</span>
                    </div>
                    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {mr.summary}
                    </p>
                  </div>
                );
              })}

              {modReportsState.hasMore && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => modReportsHandleRef.current?.loadMore()}
                    disabled={modReportsState.loadingMore}
                    className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    {modReportsState.loadingMore ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    <span>Devamını Yükle</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface AdminModerationLogsTabProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  isMainAdmin: boolean;
}

type LogCategoryFilter = 'all' | 'mute' | 'ban' | 'expiry' | 'reports' | 'roles' | 'other';

export const AdminModerationLogsTab: React.FC<AdminModerationLogsTabProps> = ({
  allUsers,
  isMainAdmin,
}) => {
  const [logsState, setLogsState] = useState<PaginatedCollectionState<ModerationLogEntry>>({
    items: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
  });
  const logsHandleRef = useRef<PaginatedSubscriptionHandle | null>(null);
  const logs = logsState.items;

  const [logSearch, setLogSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<LogCategoryFilter>('all');
  const [showScopeDetails, setShowScopeDetails] = useState(false);

  const [museGrant, setMuseGrant] = useState<ModeratorGrant | null>(null);
  const [grantReason, setGrantReason] = useState('');
  const [togglingRole, setTogglingRole] = useState(false);
  const [roleFeedback, setRoleFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const userMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    allUsers.forEach((u) => {
      if (u?.uid) map.set(u.uid, u);
    });
    return map;
  }, [allUsers]);

  const museUser = userMap.get(MUSE_MODERATOR_UID);
  const isMuseActive = Boolean(museGrant?.active && museUser?.role === 'moderator');

  const [activeSubTab, setActiveSubTab] = useState<'moderation' | 'access_audit'>('moderation');
  const [accessLogsState, setAccessLogsState] = useState<PaginatedCollectionState<ModerationAccessLog>>({
    items: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
  });
  const accessLogsHandleRef = useRef<PaginatedSubscriptionHandle | null>(null);

  useEffect(() => {
    const logsHandle = subscribeToModerationLogsPaginated(setLogsState, 10);
    logsHandleRef.current = logsHandle;
    const unsubGrant = subscribeToModeratorGrant(MUSE_MODERATOR_UID, setMuseGrant);

    let unsubAccessLogs = () => {};
    if (isMainAdmin) {
      const accessHandle = subscribeToModerationAccessLogsPaginated(setAccessLogsState, 30);
      accessLogsHandleRef.current = accessHandle;
      unsubAccessLogs = () => {
        accessHandle.unsubscribe();
        accessLogsHandleRef.current = null;
      };
    }

    return () => {
      logsHandle.unsubscribe();
      logsHandleRef.current = null;
      unsubGrant();
      unsubAccessLogs();
    };
  }, [isMainAdmin]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((entry) => {
      if (
        actionFilter === 'mute' &&
        entry.actionType !== 'temp_mute' &&
        entry.actionType !== 'perm_mute' &&
        entry.actionType !== 'unmute'
      ) {
        return false;
      }
      if (
        actionFilter === 'ban' &&
        entry.actionType !== 'temp_ban' &&
        entry.actionType !== 'perm_ban' &&
        entry.actionType !== 'unban'
      ) {
        return false;
      }
      if (
        actionFilter === 'expiry' &&
        entry.actionType !== 'auto_mute_expired' &&
        entry.actionType !== 'auto_ban_expired'
      ) {
        return false;
      }
      if (actionFilter === 'reports' && entry.actionType !== 'report_reviewed') {
        return false;
      }
      if (
        actionFilter === 'roles' &&
        entry.actionType !== 'moderator_role_granted' &&
        entry.actionType !== 'moderator_role_revoked'
      ) {
        return false;
      }
      if (
        actionFilter === 'other' &&
        entry.actionType !== 'email_in_review' &&
        entry.actionType !== 'email_review_released' &&
        entry.actionType !== 'verification_approved' &&
        entry.actionType !== 'verification_rejected' &&
        entry.actionType !== 'user_verified' &&
        entry.actionType !== 'user_unverified' &&
        entry.actionType !== 'abusive_chat_flagged' &&
        entry.actionType !== 'channel_disabled' &&
        entry.actionType !== 'channel_enabled' &&
        entry.actionType !== 'channel_deleted' &&
        entry.actionType !== 'post_deleted'
      ) {
        return false;
      }

      if (!q) return true;
      const actorU = userMap.get(entry.actorUid);
      const targetU = userMap.get(entry.targetUid);
      const actorLabel = (actorU?.username || entry.actorUsername || '').toLowerCase();
      const targetLabel = (targetU?.username || entry.targetUsername || '').toLowerCase();
      return (
        actorLabel.includes(q) ||
        targetLabel.includes(q) ||
        entry.actorUid.toLowerCase().includes(q) ||
        entry.targetUid.toLowerCase().includes(q) ||
        (entry.reason || '').toLowerCase().includes(q) ||
        entry.id.toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, logSearch, userMap]);

  const handleToggleMuseRole = async (grant: boolean) => {
    if (!isMainAdmin || togglingRole) return;
    setTogglingRole(true);
    setRoleFeedback(null);
    try {
      await setModeratorRoleByAdmin(
        grant ? 'grant' : 'revoke',
        MUSE_MODERATOR_UID,
        grantReason.trim() ||
          (grant
            ? 'Ana yönetici tarafından Muse moderatör yetkisi tanımlandı'
            : 'Ana yönetici tarafından Muse moderatör yetkisi kaldırıldı')
      );
      setGrantReason('');
      setRoleFeedback({
        type: 'success',
        text: grant
          ? '✓ Muse hesabına moderatör yetkisi güvenli biçimde tanımlandı.'
          : '✓ Muse hesabının moderatör yetkisi kaldırıldı.',
      });
    } catch (err: any) {
      setRoleFeedback({ type: 'error', text: err?.message || 'Yetki güncellenemedi.' });
    } finally {
      setTogglingRole(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 👑 ANA YÖNETİCİ ÖZEL: MUSE MODERATÖR YETKİ YÖNETİM KARTI */}
      {isMainAdmin && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Muse Moderatör Yetki Yönetimi</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      isMuseActive
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30'
                    }`}
                  >
                    {isMuseActive ? 'Aktif Moderatör' : 'Yetki Pasif'}
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono">
                  {MUSE_MODERATOR_EMAIL} • UID: {MUSE_MODERATOR_UID}
                </p>
              </div>
            </div>

            {museUser && (
              <div className="flex items-center gap-2">
                <UserAvatar
                  photoURL={museUser.photoURL}
                  name={museUser.displayName}
                  username={museUser.username}
                  size="sm"
                />
                <div className="text-xs">
                  <div className="font-bold text-zinc-800 dark:text-zinc-200">
                    {museUser.displayName || museUser.username}
                  </div>
                  <div className="text-[10px] text-zinc-400 font-mono">@{museUser.username}</div>
                </div>
              </div>
            )}
          </div>

          {roleFeedback && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold border ${
                roleFeedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400'
              }`}
            >
              {roleFeedback.text}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              type="text"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="Yetki değişikliği açıklaması (isteğe bağlı)..."
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
            {isMuseActive ? (
              <button
                onClick={() => handleToggleMuseRole(false)}
                disabled={togglingRole}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                {togglingRole ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
                <span>Moderatör Yetkisini Kaldır</span>
              </button>
            ) : (
              <button
                onClick={() => handleToggleMuseRole(true)}
                disabled={togglingRole}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                {togglingRole ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                <span>Moderatör Yetkisi Ver</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 📋 DEĞİŞTİRİLEMEZ MODERASYON KAYITLARI & ERİŞİM DENETİM GÜNLÜĞÜ */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        {isMainAdmin && (
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <button
              type="button"
              onClick={() => setActiveSubTab('moderation')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'moderation'
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Moderasyon İşlem Günlüğü</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('access_audit')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'access_audit'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Muse Sohbet Erişim Denetimi ({accessLogsState.items.length}{accessLogsState.hasMore ? '+' : ''})</span>
            </button>
          </div>
        )}

        {activeSubTab === 'access_audit' && isMainAdmin ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <span>Muse Moderatör Erişim Denetim Günlüğü</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25">
                      Salt Okunur Denetim
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Moderatör Muse tarafından görüntülenen özel sohbetler, grup sohbetleri ve kanal gönderilerinin zaman damgalı erişim izleri.
                  </p>
                </div>
              </div>
            </div>

            {accessLogsState.loading && accessLogsState.items.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                <span>Erişim kayıtları yükleniyor...</span>
              </div>
            ) : accessLogsState.items.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-xs bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                Henüz kayıtlı bir sohbet veya kanal inceleme erişimi bulunmuyor.
              </div>
            ) : (
              <div className="space-y-2.5">
                {accessLogsState.items.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-center shrink-0">
                        {acc.targetType === 'channel' ? <Radio className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-2">
                          <span>{acc.targetName || acc.targetId}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50">
                            Salt Okunur
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">@{acc.moderatorUsername || 'muse'}</span>
                          <span>•</span>
                          <span className="font-mono text-[10px]">Hedef: {acc.targetId}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-zinc-200/80 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                        {acc.action === 'view_conversation_messages' ? 'Sohbet Mesajları' : 'Kanal Gönderileri'}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {formatDateTime(acc.accessedAt)}
                      </span>
                    </div>
                  </div>
                ))}

                {accessLogsState.hasMore ? (
                  <div className="pt-2 pb-1 flex justify-center">
                    <button
                      type="button"
                      onClick={() => accessLogsHandleRef.current?.loadMore()}
                      disabled={accessLogsState.loadingMore}
                      className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      {accessLogsState.loadingMore ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span>Devamını Yükle ({accessLogsState.items.length} kayıt yüklendi)</span>
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 pb-1 text-center text-[11px] text-zinc-400">
                    Tüm erişim kayıtları listelendi (Toplam {accessLogsState.items.length} kayıt).
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 flex-wrap">
                <span>Moderasyon Kayıtları ({filteredLogs.length}{logsState.hasMore ? '+' : ''})</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                  Canlı Akış
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Yetkili tüm geçici/kalıcı susturma, ban, otomatik süre bitimi, rapor ve yetki değişiklikleri değiştirilemez biçimde listelenir.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowScopeDetails((prev) => !prev)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 flex items-center gap-1 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Kapsam Farkı</span>
            </button>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-red-500" /> Salt Okunur
            </span>
          </div>
        </div>

        {/* Log Kapsamı Karşılaştırması */}
        {showScopeDetails && (
          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/70 text-[11px] space-y-2 text-zinc-600 dark:text-zinc-300 leading-relaxed">
            <div className="font-bold text-zinc-900 dark:text-zinc-100">
              Ana Yönetici vs Muse (Moderatör) Log Kapsamı
            </div>
            <div>
              <strong className="text-indigo-600 dark:text-indigo-400">Muse Moderatör Kapsamı (Açık):</strong>{' '}
              <code>moderationLogs</code> koleksiyonundaki tüm yetkili moderasyon kayıtları (susturma, susturma kaldırma, geçici/kalıcı ban kayıtları, ban kaldırma, otomatik süre bitimi, şikâyet incelemeleri ve moderatör yetki değişiklikleri), kullanıcı şikâyetleri ve şikâyet kapsamındaki sohbet incelemeleri.
            </div>
            <div>
              <strong className="text-red-600 dark:text-red-400">Yalnızca Ana Yönetici Kapsamı (Gizli):</strong>{' '}
              <code>adminLogs</code> (yeni ülke/cihaz oturum güvenliği olayları, IP/ağ meta verileri, e-posta inceleme kararları), <code>securitySessions</code> / <code>securitySessionNetwork</code> gizli güvenlik kayıtları ve şikâyet dışı tüm özel sohbetler.
            </div>
            <div className="text-zinc-500 dark:text-zinc-400">
              Bu sınırlandırma <code>firestore.rules</code> tarafından zorunlu tutulur; moderatör log silemez, düzenleyemez ve rol atayamaz.
            </div>
          </div>
        )}

        {/* Arama ve İşlem Türü Filtresi */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="@kullanıcıadı, UID veya sebep ile moderasyon kayıtlarında ara..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-red-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl overflow-x-auto">
            {(
              [
                ['all', 'Tümü'],
                ['mute', 'Susturma'],
                ['ban', 'Ban'],
                ['expiry', 'Süre Bitimi'],
                ['reports', 'Şikâyet/Rapor'],
                ['roles', 'Yetki'],
                ['other', 'Doğrulama & Kanal'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActionFilter(key)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  actionFilter === key
                    ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {logsState.error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Kayıtlar okunurken hata oluştu: {logsState.error}</span>
          </div>
        )}

        {logsState.loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin text-red-600" />
            <span>Moderasyon kayıtları yükleniyor...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400">
            {logs.length === 0
              ? 'Henüz moderasyon kaydı bulunmuyor.'
              : 'Seçili arama/filtreye uygun moderasyon kaydı bulunamadı.'}
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {filteredLogs.map((entry) => {
              const actorU = userMap.get(entry.actorUid);
              const targetU = userMap.get(entry.targetUid);
              const actorDisplayUsername = actorU?.username || entry.actorUsername || entry.actorUid.slice(0, 8);
              const targetDisplayUsername = targetU?.username || entry.targetUsername || entry.targetUid.slice(0, 8);
              const badge = ACTION_LABELS[entry.actionType] || {
                label: entry.actionType,
                color: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
              };
              const endsMs = toTimestampMs(entry.endsAt);
              const stillActive = Boolean(
                endsMs && endsMs > Date.now() && (entry.actionType === 'temp_mute' || entry.actionType === 'temp_ban')
              );

              return (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-zinc-200/80 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[10px] font-bold uppercase">
                        {entry.actorRole === 'admin'
                          ? 'Ana Yönetici'
                          : entry.actorRole === 'moderator'
                          ? 'Moderatör'
                          : 'Sistem'}
                      </span>
                      {stillActive && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Kalan: {formatRemainingTime(endsMs)}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-zinc-400">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-zinc-400">İşlemi Yapan: </span>
                      <strong className="text-zinc-800 dark:text-zinc-200">
                        @{actorDisplayUsername}
                      </strong>
                      <span className="text-zinc-400 font-mono ml-1">({entry.actorUid.slice(0, 8)}…)</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Hedef Kullanıcı: </span>
                      <strong className="text-red-600 dark:text-red-400">
                        @{targetDisplayUsername}
                      </strong>
                      <span className="text-zinc-400 font-mono ml-1">({entry.targetUid.slice(0, 8)}…)</span>
                    </div>
                  </div>

                  {entry.reason && (
                    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      <span className="font-semibold text-zinc-500">Sebep: </span>
                      {entry.reason}
                    </p>
                  )}

                  {(entry.startsAt || entry.endsAt) && (
                    <div className="text-[10px] text-zinc-400 font-mono flex flex-wrap gap-3 pt-0.5">
                      <span>Başlangıç: {formatDateTime(entry.startsAt)}</span>
                      {entry.endsAt && <span>Bitiş: {formatDateTime(entry.endsAt)}</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {logsState.hasMore ? (
              <div className="pt-2 pb-1 flex justify-center">
                <button
                  type="button"
                  id="btn-load-more-modlogs"
                  onClick={() => logsHandleRef.current?.loadMore()}
                  disabled={logsState.loadingMore}
                  className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                >
                  {logsState.loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>Devamını Yükle ({logs.length} kayıt yüklendi)</span>
                </button>
              </div>
            ) : (
              <div className="pt-2 pb-1 text-center text-[11px] text-zinc-400">
                Yetkili tüm moderasyon kayıtları yüklendi (Toplam {logs.length} kayıt).
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
};
