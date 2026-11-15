import React, { useEffect, useMemo, useState } from 'react';
import type {
  AdminLogEntry,
  SecuritySession,
  SecuritySessionNetwork,
  UserProfile,
} from '../types';
import {
  subscribeToAdminSecuritySessions,
  subscribeToAdminSecurityNetworkMap,
  subscribeToAdminLogs,
  adminApproveSession,
  adminRevokeSingleSession,
  adminRevokeAllUserSessions,
  formatSessionDateTime,
} from '../services/sessionSecurityService';
import { UserAvatar } from './UserAvatar';
import {
  ShieldAlert,
  ShieldCheck,
  Globe,
  MapPin,
  Smartphone,
  Monitor,
  LogOut,
  CheckCircle,
  XCircle,
  Search,
  Loader2,
  FileText,
} from 'lucide-react';

interface AdminSuspiciousSessionsTabProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
}

type SessionFilter = 'suspicious' | 'pending' | 'approved' | 'revoked' | 'all';

export const AdminSuspiciousSessionsTab: React.FC<AdminSuspiciousSessionsTabProps> = ({
  allUsers,
}) => {
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [networkMap, setNetworkMap] = useState<Record<string, SecuritySessionNetwork>>({});
  const [adminLogs, setAdminLogs] = useState<AdminLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'sessions' | 'logs'>('sessions');
  const [filter, setFilter] = useState<SessionFilter>('suspicious');
  const [searchQuery, setSearchQuery] = useState('');

  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);
  const [confirmRevokeAllTarget, setConfirmRevokeAllTarget] = useState<{
    uid: string;
    username: string;
  } | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const userPhotoMap = useMemo(() => {
    const map = new Map<string, string | null>();
    allUsers.forEach((u) => {
      if (u?.uid) map.set(u.uid, u.photoURL || null);
    });
    return map;
  }, [allUsers]);

  useEffect(() => {
    setLoading(true);
    const unsubSessions = subscribeToAdminSecuritySessions(
      (list) => {
        setSessions(list);
        setLoading(false);
        setLoadError(null);
      },
      (errMsg) => {
        setLoadError(errMsg);
        setLoading(false);
      }
    );

    const unsubNetwork = subscribeToAdminSecurityNetworkMap((map) => {
      setNetworkMap(map);
    });

    const unsubLogs = subscribeToAdminLogs((logs) => {
      setAdminLogs(logs);
    });

    return () => {
      unsubSessions();
      unsubNetwork();
      unsubLogs();
    };
  }, []);

  const suspiciousPendingCount = useMemo(
    () =>
      sessions.filter(
        (s) => s.status === 'pending_verification' || s.status === 'awaiting_admin_approval'
      ).length,
    [sessions]
  );

  const suspiciousTotalCount = useMemo(
    () => sessions.filter((s) => s.isSuspicious).length,
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter === 'suspicious' && !s.isSuspicious) return false;
      if (
        filter === 'pending' &&
        s.status !== 'pending_verification' &&
        s.status !== 'awaiting_admin_approval'
      ) {
        return false;
      }
      if (filter === 'approved' && !(s.status === 'active' && s.adminDecision === 'approved')) {
        return false;
      }
      if (filter === 'revoked' && s.status !== 'revoked') return false;

      if (!q) return true;
      const net = networkMap[s.sessionId];
      return (
        s.username?.toLowerCase().includes(q) ||
        s.displayName?.toLowerCase().includes(q) ||
        s.userId?.toLowerCase().includes(q) ||
        s.countryName?.toLowerCase().includes(q) ||
        s.countryCode?.toLowerCase().includes(q) ||
        (net?.ip && net.ip.toLowerCase().includes(q)) ||
        (net?.city && net.city.toLowerCase().includes(q))
      );
    });
  }, [sessions, filter, searchQuery, networkMap]);

  const handleApprove = async (session: SecuritySession) => {
    if (processingSessionId) return;
    setProcessingSessionId(session.sessionId);
    setActionBanner(null);
    try {
      await adminApproveSession(session.sessionId);
      setActionBanner({
        type: 'success',
        text: `@${session.username} kullanıcısının ${session.countryName} oturumuna izin verildi.`,
      });
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Oturum onaylanamadı.',
      });
    } finally {
      setProcessingSessionId(null);
    }
  };

  const handleRevokeSingle = async (session: SecuritySession) => {
    if (processingSessionId) return;
    setProcessingSessionId(session.sessionId);
    setActionBanner(null);
    try {
      await adminRevokeSingleSession(session.sessionId);
      setActionBanner({
        type: 'success',
        text: `@${session.username} kullanıcısının seçilen oturumu tekil olarak kapatıldı (diğer cihazlar korundu).`,
      });
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Oturum kapatılamadı.',
      });
    } finally {
      setProcessingSessionId(null);
    }
  };

  const handleRevokeAllConfirm = async () => {
    if (!confirmRevokeAllTarget || processingSessionId) return;
    setProcessingSessionId(`all_${confirmRevokeAllTarget.uid}`);
    setActionBanner(null);
    try {
      const res = await adminRevokeAllUserSessions(
        confirmRevokeAllTarget.uid,
        confirmRevokeAllTarget.username
      );
      setActionBanner({
        type: 'success',
        text: `@${confirmRevokeAllTarget.username} kullanıcısının tüm oturumları (${res.revokedCount} oturum) kapatıldı.`,
      });
      setConfirmRevokeAllTarget(null);
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Tüm oturumlar kapatılamadı.',
      });
    } finally {
      setProcessingSessionId(null);
    }
  };

  const getUserResponseLabel = (resp: SecuritySession['userResponse']) => {
    switch (resp) {
      case 'confirmed_me':
        return { text: 'Bu Benim dedi', colorClass: 'text-emerald-600 dark:text-emerald-400' };
      case 'denied_not_me':
        return { text: 'Ben Değilim dedi', colorClass: 'text-red-600 dark:text-red-400' };
      case 'pending':
        return { text: 'Henüz yanıtlamadı', colorClass: 'text-amber-600 dark:text-amber-400' };
      default:
        return { text: 'Otomatik doğrulandı', colorClass: 'text-zinc-500 dark:text-zinc-400' };
    }
  };

  const getStatusMeta = (s: SecuritySession) => {
    switch (s.status) {
      case 'pending_verification':
        return {
          text: 'Kullanıcı Yanıtı Bekliyor',
          colorClass: 'text-amber-600 dark:text-amber-400',
          Icon: ShieldAlert,
        };
      case 'awaiting_admin_approval':
        return {
          text: 'Admin Onayı Bekliyor',
          colorClass: 'text-amber-500 dark:text-amber-300',
          Icon: ShieldCheck,
        };
      case 'active':
        return {
          text: s.adminDecision === 'approved' ? 'Admin İzin Verdi (Aktif)' : 'Aktif Oturum',
          colorClass: 'text-emerald-600 dark:text-emerald-400',
          Icon: CheckCircle,
        };
      case 'revoked':
        return {
          text: 'Kapatıldı / İptal Edildi',
          colorClass: 'text-red-600 dark:text-red-400',
          Icon: XCircle,
        };
    }
  };

  return (
    <div className="space-y-5">
      {/* Üst Başlık ve Görünüm Anahtarı */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
              Şüpheli Oturumlar ve Yeni Ülke Güvenliği
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
              {suspiciousPendingCount} bekleyen inceleme · {suspiciousTotalCount} toplam şüpheli oturum · {sessions.length} kayıtlı cihaz oturumu
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('sessions')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              viewMode === 'sessions'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Oturumlar</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('logs')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              viewMode === 'logs'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Admin Logları ({adminLogs.length})</span>
          </button>
        </div>
      </div>

      {actionBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
          }`}
        >
          {actionBanner.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionBanner.text}</span>
        </div>
      )}

      {viewMode === 'sessions' ? (
        <>
          {/* Arama & Filtreler */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Kullanıcı adı, ülke, şehir veya IP ile ara..."
                className="w-full pl-10 pr-4 py-2.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto no-scrollbar">
              {[
                { key: 'suspicious', label: 'Şüpheli Oturumlar' },
                { key: 'pending', label: `Bekleyen (${suspiciousPendingCount})` },
                { key: 'approved', label: 'İzin Verilen' },
                { key: 'revoked', label: 'İptal Edilen' },
                { key: 'all', label: 'Tüm Cihazlar' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key as SessionFilter)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filter === tab.key
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-10 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-red-500" />
              <span>Güvenlik oturumları yükleniyor...</span>
            </div>
          ) : loadError ? (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl p-6 text-xs text-red-600 dark:text-red-300">
              {loadError}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-10 text-center space-y-2">
              <ShieldCheck className="w-8 h-8 mx-auto text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Bu filtrede oturum kaydı bulunmuyor
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Yeni bir cihaz ve ülkeden giriş algılandığında kayıtlar burada gerçek zamanlı olarak listelenir.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSessions.map((session) => {
                const net = networkMap[session.sessionId];
                const respMeta = getUserResponseLabel(session.userResponse);
                const statusMeta = getStatusMeta(session);
                const StatusIcon = statusMeta.Icon;
                const isMobile = session.deviceType === 'mobile' || session.deviceType === 'tablet';
                const avatarUrl = session.photoURL || userPhotoMap.get(session.userId) || null;
                const isBusy = processingSessionId === session.sessionId;
                const isRevoked = session.status === 'revoked';
                const isAlreadyTrustedActive =
                  session.status === 'active' && session.trusted === true;

                return (
                  <div
                    key={session.sessionId}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4"
                  >
                    {/* Üst Satır: Kullanıcı + Durum */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          photoURL={avatarUrl}
                          name={session.displayName || session.username}
                          username={session.username}
                          size="md"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {session.displayName || session.username}
                            </span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                              @{session.username}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5 truncate">
                            UID: {session.userId} · Oturum: {session.sessionId}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-semibold shrink-0">
                        <StatusIcon className={`w-4 h-4 shrink-0 ${statusMeta.colorClass}`} />
                        <span className={statusMeta.colorClass}>{statusMeta.text}</span>
                      </div>
                    </div>

                    {/* Orta Grid: Konum, IP, Zaman, Cihaz, Kullanıcı Yanıtı */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                          <Globe className="w-3.5 h-3.5 shrink-0" />
                          <span>Ülke ve Geçmiş</span>
                        </div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {session.countryName} {session.flagEmoji}
                        </div>
                        {session.previousCountryName && (
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            Önceki: {session.previousCountryName}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>IP Konum Bilgisi (Admin)</span>
                        </div>
                        <div className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                          {net?.ip || 'Çözümlenemedi'}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {[net?.city, net?.region, net?.isp].filter(Boolean).join(' · ') || 'Ek konum verisi yok'}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                          {isMobile ? (
                            <Smartphone className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Monitor className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>Cihaz ve Tarayıcı</span>
                        </div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {session.browserName} · {session.osName}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                          {session.deviceId}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-zinc-500 dark:text-zinc-400">
                          Tarih & Kullanıcı Yanıtı
                        </div>
                        <div className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatSessionDateTime(session.createdAt)}
                        </div>
                        <div className={`font-semibold ${respMeta.colorClass}`}>
                          {respMeta.text}
                        </div>
                      </div>
                    </div>

                    {/* Alt İşlem Butonları */}
                    <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                      {!isAlreadyTrustedActive && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleApprove(session)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>Oturuma İzin Ver</span>
                        </button>
                      )}

                      {!isRevoked && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRevokeSingle(session)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <LogOut className="w-3.5 h-3.5 shrink-0" />
                          <span>Bu Oturumu Kapat</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={Boolean(processingSessionId)}
                        onClick={() =>
                          setConfirmRevokeAllTarget({
                            uid: session.userId,
                            username: session.username,
                          })
                        }
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ml-auto"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>Tüm Oturumları Kapat</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ADMIN İŞLEM & GÜVENLİK LOGLARI */
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {adminLogs.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              Henüz kaydedilmiş admin veya oturum güvenliği logu bulunmuyor.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {adminLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-bold ${
                          log.severity === 'critical'
                            ? 'text-red-600 dark:text-red-400'
                            : log.severity === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {log.action}
                      </span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {log.actorName || log.actorEmail || log.actorUid}
                      </span>
                      {log.targetUsername && (
                        <>
                          <span className="text-zinc-400">·</span>
                          <span className="font-mono text-zinc-500">@{log.targetUsername}</span>
                        </>
                      )}
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {log.details}
                    </p>
                  </div>

                  <div className="text-[11px] font-mono tabular-nums text-zinc-400 shrink-0">
                    {formatSessionDateTime(log.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tüm Oturumları Kapat Onay Penceresi */}
      {confirmRevokeAllTarget && (
        <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400 font-bold text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>Tüm Oturumları Kapat</span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <strong className="text-zinc-900 dark:text-white">
                @{confirmRevokeAllTarget.username}
              </strong>{' '}
              kullanıcısının bütün cihazlardaki aktif ve bekleyen oturumları kapatılacak ve
              yetki jetonları iptal edilecektir.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRevokeAllTarget(null)}
                className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={Boolean(processingSessionId)}
                onClick={handleRevokeAllConfirm}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {processingSessionId ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LogOut className="w-3.5 h-3.5" />
                )}
                <span>Evet, Tümünü Kapat</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
