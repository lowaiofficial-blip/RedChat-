import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { UserProfile, AppSettings, Conversation, ChatMessage } from '../types';
import {
  isUserAdmin,
  updateVerifiedBadgeUrl,
  updateAIProfilePhotoUrl,
  setUserVerificationStatus,
  banUser,
  unbanUser,
  muteUser,
  unmuteUser,
  fetchRealAdminStats,
  fetchAllConversationsForAdmin,
  fetchAllMessagesForConversationAdmin,
  formatChatLogText,
  type AdminStats,
} from '../services/adminService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge, preloadBadgeImage } from './VerifiedBadge';
import { formatLastSeen } from '../services/chatService';
import {
  Shield,
  Users,
  MessageSquare,
  Activity,
  Search,
  CheckCircle,
  Upload,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Flame,
  BadgeCheck,
  Eye,
  Mail,
  X,
  Ban,
  VolumeX,
  Volume2,
  ShieldAlert,
  ShieldCheck,
  FileText,
  Image as ImageIcon,
  Reply,
  Maximize2,
  Bot,
  Sparkles,
} from 'lucide-react';

interface AdminPanelProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  appSettings: AppSettings | null;
  onNavigateHome: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUser,
  allUsers: initialAllUsers,
  appSettings,
  onNavigateHome,
}) => {
  const isAdmin = isUserAdmin(currentUser);

  // Yerel kullanıcı listesi (optimistik güncelleme desteğiyle)
  const [localUsers, setLocalUsers] = useState<UserProfile[]>(initialAllUsers);

  useEffect(() => {
    setLocalUsers(initialAllUsers);
  }, [initialAllUsers]);

  // Hızlı kullanıcı arama haritası (UID -> UserProfile)
  const userMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    localUsers.forEach((u) => {
      if (u?.uid) map.set(u.uid, u);
    });
    return map;
  }, [localUsers]);

  const [activeTab, setActiveTab] = useState<'users' | 'chatlogs' | 'badge' | 'ai' | 'overview'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'online' | 'banned' | 'muted' | 'verified'>('all');

  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    onlineUsers: 0,
    totalMessages: 0,
    totalConversations: 0,
  });
  const [loadingStats, setLoadingStats] = useState(false);

  // Mavi Tik PNG Yükleme State'leri
  const [selectedBadgeFile, setSelectedBadgeFile] = useState<File | null>(null);
  const [badgePreviewUrl, setBadgePreviewUrl] = useState<string | null>(null);
  const [uploadingBadge, setUploadingBadge] = useState(false);
  const [badgeActionSuccess, setBadgeActionSuccess] = useState<string | null>(null);
  const [badgeActionError, setBadgeActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RedChat AI Profil Görseli Yükleme State'leri
  const [selectedAiPhotoFile, setSelectedAiPhotoFile] = useState<File | null>(null);
  const [aiPhotoPreviewUrl, setAiPhotoPreviewUrl] = useState<string | null>(null);
  const [uploadingAiPhoto, setUploadingAiPhoto] = useState(false);
  const [aiPhotoActionSuccess, setAiPhotoActionSuccess] = useState<string | null>(null);
  const [aiPhotoActionError, setAiPhotoActionError] = useState<string | null>(null);
  const aiFileInputRef = useRef<HTMLInputElement>(null);

  // Kullanıcı Moderasyon & Mavi Tik İşlem State'i
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);

  // Kullanıcı Detay Modalı
  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);

  // Kopyalandı Bildirimi
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  // 📋 SOHBET LOGLARI STATE'LERİ
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [chatLogFilter, setChatLogFilter] = useState<'all' | 'direct' | 'group'>('all');
  const [chatLogSearch, setChatLogSearch] = useState('');

  // Açık olan sohbet logu modalı
  const [activeLogConversation, setActiveLogConversation] = useState<Conversation | null>(null);
  const [logMessages, setLogMessages] = useState<ChatMessage[]>([]);
  const [loadingLogMessages, setLoadingLogMessages] = useState(false);

  // Sohbeti Kopyalama State'i
  const [copyingLog, setCopyingLog] = useState(false);
  const [copiedLogSuccess, setCopiedLogSuccess] = useState(false);
  const [copiedLogError, setCopiedLogError] = useState<string | null>(null);

  // Görsel büyütme modalı
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

  // İstatistikleri çekme fonksiyonu
  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const data = await fetchRealAdminStats();
      setStats(data);
    } catch (err) {
      console.error('İstatistikler yüklenemedi:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // Sohbetleri çekme fonksiyonu (Admin Sohbet Logları)
  const loadConversations = async () => {
    if (!isAdmin) return;
    setLoadingConversations(true);
    try {
      const convs = await fetchAllConversationsForAdmin(currentUser);
      setAllConversations(convs);
    } catch (err) {
      console.error('Sohbetler yüklenemedi:', err);
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadStats();
      loadConversations();
    }
  }, [isAdmin]);

  // ObjectURL bellek temizliği
  useEffect(() => {
    return () => {
      if (badgePreviewUrl) {
        URL.revokeObjectURL(badgePreviewUrl);
      }
      if (aiPhotoPreviewUrl) {
        URL.revokeObjectURL(aiPhotoPreviewUrl);
      }
    };
  }, [badgePreviewUrl, aiPhotoPreviewUrl]);

  // Kullanıcı Arama & Durum Filtresi
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return localUsers.filter((u) => {
      // Durum Filtresi
      if (userFilter === 'online' && !u.isOnline) return false;
      if (userFilter === 'banned' && !u.isBanned) return false;
      if (userFilter === 'muted' && !u.isMuted) return false;
      if (userFilter === 'verified' && !u.isVerified) return false;

      // Metin Araması
      if (!q) return true;
      return (
        u.username?.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    });
  }, [localUsers, searchQuery, userFilter]);

  // UID Kopyalama
  const handleCopy = (text: string, uid: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 2000);
  };

  // Mavi Tik PNG Dosya Seçimi
  const handleBadgeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setBadgeActionError('Lütfen geçerli bir PNG veya görsel dosyası seçin.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setBadgeActionError('Görsel boyutu en fazla 5MB olabilir.');
      return;
    }

    if (badgePreviewUrl) {
      URL.revokeObjectURL(badgePreviewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedBadgeFile(file);
    setBadgePreviewUrl(objectUrl);
    setBadgeActionError(null);
    setBadgeActionSuccess(null);
  };

  // Mavi Tik PNG'yi ImgBB'ye yükle ve Firestore'a kalıcı kaydet
  const handleUploadBadge = async () => {
    if (!selectedBadgeFile || uploadingBadge) return;

    setUploadingBadge(true);
    setBadgeActionError(null);
    setBadgeActionSuccess(null);

    try {
      const uploadedUrl = await uploadImageToImgBB(selectedBadgeFile);
      if (!uploadedUrl) {
        throw new Error('ImgBB görsel yükleme başarısız oldu.');
      }

      await updateVerifiedBadgeUrl(currentUser, uploadedUrl);
      preloadBadgeImage(uploadedUrl);

      setBadgeActionSuccess('Mavi Tik PNG başarıyla ImgBB ve Firestore veritabanına kaydedildi!');
      setSelectedBadgeFile(null);
      setBadgePreviewUrl(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error('Mavi Tik PNG yükleme hatası:', err);
      setBadgeActionError(err?.message || 'Rozet yüklenemedi. Lütfen tekrar deneyin.');
    } finally {
      setUploadingBadge(false);
    }
  };

  // Mavi Tik PNG'sini Sistemden Kaldır
  const handleRemoveBadge = async () => {
    if (uploadingBadge) return;

    setUploadingBadge(true);
    setBadgeActionError(null);
    setBadgeActionSuccess(null);

    try {
      await updateVerifiedBadgeUrl(currentUser, null);
      setBadgeActionSuccess('Mavi Tik PNG rozeti başarıyla kaldırıldı (Varsayılan SVG rozet kullanılacak).');
    } catch (err: any) {
      console.error('Rozet kaldırma hatası:', err);
      setBadgeActionError(err?.message || 'Rozet kaldırılamadı.');
    } finally {
      setUploadingBadge(false);
    }
  };

  // RedChat AI Profil Görseli Dosya Seçimi
  const handleAiPhotoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAiPhotoActionError('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WEBP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAiPhotoActionError('Görsel boyutu en fazla 5MB olabilir.');
      return;
    }

    if (aiPhotoPreviewUrl) {
      URL.revokeObjectURL(aiPhotoPreviewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedAiPhotoFile(file);
    setAiPhotoPreviewUrl(objectUrl);
    setAiPhotoActionError(null);
    setAiPhotoActionSuccess(null);
  };

  // RedChat AI Profil Görselini ImgBB'ye yükle ve Firestore'a kalıcı kaydet
  const handleUploadAiPhoto = async () => {
    if (!selectedAiPhotoFile || uploadingAiPhoto) return;

    setUploadingAiPhoto(true);
    setAiPhotoActionError(null);
    setAiPhotoActionSuccess(null);

    try {
      const uploadedUrl = await uploadImageToImgBB(selectedAiPhotoFile);
      if (!uploadedUrl) {
        throw new Error('ImgBB görsel yükleme başarısız oldu.');
      }

      await updateAIProfilePhotoUrl(currentUser, uploadedUrl);

      setAiPhotoActionSuccess('RedChat AI profil görseli başarıyla ImgBB ve Firestore veritabanına kalıcı olarak kaydedildi!');
      setSelectedAiPhotoFile(null);
      setAiPhotoPreviewUrl(null);
      if (aiFileInputRef.current) {
        aiFileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error('AI profil fotoğrafı yükleme hatası:', err);
      setAiPhotoActionError(err?.message || 'Fotoğraf yüklenemedi. Lütfen tekrar deneyin.');
    } finally {
      setUploadingAiPhoto(false);
    }
  };

  // RedChat AI Profil Görselini Sistemden Kaldır (Varsayılana Sıfırla)
  const handleRemoveAiPhoto = async () => {
    if (uploadingAiPhoto) return;

    setUploadingAiPhoto(true);
    setAiPhotoActionError(null);
    setAiPhotoActionSuccess(null);

    try {
      await updateAIProfilePhotoUrl(currentUser, null);
      setAiPhotoActionSuccess('RedChat AI profil görseli başarıyla sıfırlandı.');
    } catch (err: any) {
      console.error('AI profil görseli kaldırma hatası:', err);
      setAiPhotoActionError(err?.message || 'Görsel sıfırlanamadı.');
    } finally {
      setUploadingAiPhoto(false);
    }
  };

  // Kullanıcı Mavi Tik Aç/Kapa
  const handleToggleUserVerification = async (targetUser: UserProfile) => {
    if (processingUid) return;
    setProcessingUid(targetUser.uid);
    setUserActionError(null);
    setUserActionSuccess(null);

    const newStatus = !targetUser.isVerified;

    // Optimistik yerel güncelleme
    setLocalUsers((prev) =>
      prev.map((u) => (u.uid === targetUser.uid ? { ...u, isVerified: newStatus } : u))
    );
    if (inspectingUser && inspectingUser.uid === targetUser.uid) {
      setInspectingUser((prev) => (prev ? { ...prev, isVerified: newStatus } : null));
    }

    try {
      await setUserVerificationStatus(currentUser, targetUser.uid, newStatus);
      const name = targetUser.displayName || targetUser.username;
      setUserActionSuccess(
        newStatus
          ? `✓ ${name} kullanıcısına Mavi Tik verildi.`
          : `✓ ${name} kullanıcısının Mavi Tiki kaldırıldı.`
      );
    } catch (err: any) {
      console.error('Kullanıcı doğrulama hatası:', err);
      // Geri al
      setLocalUsers((prev) =>
        prev.map((u) => (u.uid === targetUser.uid ? { ...u, isVerified: !newStatus } : u))
      );
      if (inspectingUser && inspectingUser.uid === targetUser.uid) {
        setInspectingUser((prev) => (prev ? { ...prev, isVerified: !newStatus } : null));
      }
      setUserActionError(err?.message || 'İşlem başarısız oldu.');
    } finally {
      setProcessingUid(null);
    }
  };

  // 🔨 Kullanıcı Banla / Ban Kaldır
  const handleToggleUserBan = async (targetUser: UserProfile) => {
    if (processingUid) return;
    if (targetUser.uid === currentUser.uid) {
      setUserActionError('Kendi hesabınızı banlayamazsınız.');
      return;
    }
    if (targetUser.isSystemAI) {
      setUserActionError('RedChat AI sistem asistanı banlanamaz.');
      return;
    }

    setProcessingUid(targetUser.uid);
    setUserActionError(null);
    setUserActionSuccess(null);

    const isCurrentlyBanned = Boolean(targetUser.isBanned);
    const name = targetUser.displayName || targetUser.username;
    const newBanStatus = !isCurrentlyBanned;

    // Optimistik yerel güncelleme
    setLocalUsers((prev) =>
      prev.map((u) =>
        u.uid === targetUser.uid ? { ...u, isBanned: newBanStatus } : u
      )
    );
    if (inspectingUser && inspectingUser.uid === targetUser.uid) {
      setInspectingUser((prev) => (prev ? { ...prev, isBanned: newBanStatus } : null));
    }

    try {
      if (isCurrentlyBanned) {
        await unbanUser(currentUser, targetUser.uid);
        setUserActionSuccess(`✓ ${name} kullanıcısının banı kaldırıldı.`);
      } else {
        await banUser(currentUser, targetUser.uid, 'Admin tarafından askıya alındı');
        setUserActionSuccess(`✓ ${name} kullanıcısı başarıyla banlandı.`);
      }
    } catch (err: any) {
      console.error('Ban işlemi hatası:', err);
      // Geri al
      setLocalUsers((prev) =>
        prev.map((u) =>
          u.uid === targetUser.uid ? { ...u, isBanned: isCurrentlyBanned } : u
        )
      );
      if (inspectingUser && inspectingUser.uid === targetUser.uid) {
        setInspectingUser((prev) => (prev ? { ...prev, isBanned: isCurrentlyBanned } : null));
      }
      setUserActionError(err?.message || 'Ban işlemi gerçekleştirilemedi.');
    } finally {
      setProcessingUid(null);
    }
  };

  // 🔇 Kullanıcı Sustur / Susturmayı Kaldır
  const handleToggleUserMute = async (targetUser: UserProfile) => {
    if (processingUid) return;
    setProcessingUid(targetUser.uid);
    setUserActionError(null);
    setUserActionSuccess(null);

    const isCurrentlyMuted = Boolean(targetUser.isMuted);
    const name = targetUser.displayName || targetUser.username;
    const newMuteStatus = !isCurrentlyMuted;

    // Optimistik yerel güncelleme
    setLocalUsers((prev) =>
      prev.map((u) =>
        u.uid === targetUser.uid ? { ...u, isMuted: newMuteStatus } : u
      )
    );
    if (inspectingUser && inspectingUser.uid === targetUser.uid) {
      setInspectingUser((prev) => (prev ? { ...prev, isMuted: newMuteStatus } : null));
    }

    try {
      if (isCurrentlyMuted) {
        await unmuteUser(currentUser, targetUser.uid);
        setUserActionSuccess(`✓ ${name} kullanıcısının susturması kaldırıldı.`);
      } else {
        await muteUser(currentUser, targetUser.uid, 'Uygunsuz mesaj davranışı');
        setUserActionSuccess(`✓ ${name} kullanıcısı susturuldu.`);
      }
    } catch (err: any) {
      console.error('Susturma işlemi hatası:', err);
      // Geri al
      setLocalUsers((prev) =>
        prev.map((u) =>
          u.uid === targetUser.uid ? { ...u, isMuted: isCurrentlyMuted } : u
        )
      );
      if (inspectingUser && inspectingUser.uid === targetUser.uid) {
        setInspectingUser((prev) => (prev ? { ...prev, isMuted: isCurrentlyMuted } : null));
      }
      setUserActionError(err?.message || 'Susturma işlemi gerçekleştirilemedi.');
    } finally {
      setProcessingUid(null);
    }
  };

  // 📋 SOHBET LOGLARI MODALINI AÇMA
  const handleOpenChatLog = async (conv: Conversation) => {
    setActiveLogConversation(conv);
    setLogMessages([]);
    setLoadingLogMessages(true);
    setCopiedLogSuccess(false);
    setCopiedLogError(null);

    try {
      const messages = await fetchAllMessagesForConversationAdmin(currentUser, conv.id);
      setLogMessages(messages);
    } catch (err) {
      console.error('Mesaj logları yüklenemedi:', err);
    } finally {
      setLoadingLogMessages(false);
    }
  };

  // 📋 SOHBETİ TAM KOPYALA BUTONU (Clipboard)
  const handleCopyFullChatLog = async () => {
    if (!activeLogConversation || copyingLog) return;

    setCopyingLog(true);
    setCopiedLogSuccess(false);
    setCopiedLogError(null);

    try {
      const allMsgs = await fetchAllMessagesForConversationAdmin(
        currentUser,
        activeLogConversation.id
      );

      // Konuşmadaki güncel katılımcı isimlerini userMap ile zenginleştir
      const enrichedConv = { ...activeLogConversation };
      if (enrichedConv.participants) {
        const enrichedParts: { [uid: string]: any } = {};
        Object.keys(enrichedConv.participants).forEach((uid) => {
          const liveUser = userMap.get(uid);
          const original = enrichedConv.participants?.[uid];
          enrichedParts[uid] = {
            ...original,
            displayName: liveUser?.displayName || original?.displayName || liveUser?.username || 'Kullanıcı',
            username: liveUser?.username || original?.username || 'kullanici',
          };
        });
        enrichedConv.participants = enrichedParts;
      }

      const formattedLog = formatChatLogText(enrichedConv, allMsgs);

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formattedLog);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = formattedLog;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopiedLogSuccess(true);
      setTimeout(() => setCopiedLogSuccess(false), 3500);
    } catch (err: any) {
      console.error('Sohbet logu kopyalanamadı:', err);
      setCopiedLogError('Sohbet logu panoya kopyalanamadı. Lütfen tekrar deneyin.');
    } finally {
      setCopyingLog(false);
    }
  };

  // Sohbet Logları Arama ve Filtreleme
  const filteredConversations = useMemo(() => {
    const q = chatLogSearch.trim().toLowerCase();
    return allConversations.filter((c) => {
      if (chatLogFilter === 'direct' && c.isGroup) return false;
      if (chatLogFilter === 'group' && !c.isGroup) return false;

      if (!q) return true;

      if (c.isGroup && c.name?.toLowerCase().includes(q)) return true;

      // Katılımcı araması (canlı kullanıcı haritasından kontrol)
      if (c.participantIds) {
        const matchesUser = c.participantIds.some((uid) => {
          const userObj = userMap.get(uid) || c.participants?.[uid];
          return (
            userObj?.displayName?.toLowerCase().includes(q) ||
            userObj?.username?.toLowerCase().includes(q) ||
            uid.toLowerCase().includes(q)
          );
        });
        if (matchesUser) return true;
      }

      if (c.lastMessageText?.toLowerCase().includes(q)) return true;
      if (c.id.toLowerCase().includes(q)) return true;

      return false;
    });
  }, [allConversations, chatLogFilter, chatLogSearch, userMap]);

  const currentBadgeUrl = appSettings?.verifiedBadgeUrl || null;

  // Yetkisiz Giriş Koruması
  if (!isAdmin) {
    return (
      <div className="w-full h-full min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center mb-4 shadow-sm border border-rose-200 dark:border-rose-900/50">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 mb-2">
          Yetkisiz Erişim
        </h2>
        <p className="text-xs text-zinc-500 max-w-sm mb-6 leading-relaxed">
          Admin Paneline yalnızca sistem yöneticileri erişebilir.
        </p>
        <button
          onClick={onNavigateHome}
          className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
        >
          Sohbete Geri Dön
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[100dvh] max-h-[100dvh] flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden antialiased text-zinc-900 dark:text-zinc-100">
      {/* 🔴 ADMIN PANELİ ÜST BAŞLIK & NAVİGASYON BAR (TAM RESPONSIVE) */}
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Sol: Logo + Başlık + Giriş Yapan Admin */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                onClick={onNavigateHome}
                className="p-2 -ml-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                title="Sohbete Dön"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-red-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="text-sm sm:text-base font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                    RedChat Admin
                  </h1>
                  <span className="px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 text-[10px] font-extrabold uppercase">
                    4C Moderasyon
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 truncate max-w-[240px] sm:max-w-xs">
                  {currentUser.displayName || currentUser.username} ({currentUser.email})
                </p>
              </div>
            </div>

            {/* Mobil Geri Dön Butonu (Hızlı Buton) */}
            <button
              onClick={onNavigateHome}
              className="md:hidden px-2.5 py-1.5 text-[11px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Çıkış
            </button>
          </div>

          {/* Sağ: Sekmeler (Yatay Kaydırılabilir) */}
          <nav className="flex items-center gap-1 bg-zinc-100/90 dark:bg-zinc-800/90 p-1 rounded-xl overflow-x-auto no-scrollbar max-w-full">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'users'
                  ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Kullanıcılar ({localUsers.length})</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('chatlogs');
                loadConversations();
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'chatlogs'
                  ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Sohbet Logları ({allConversations.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('badge')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'badge'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <BadgeCheck className="w-3.5 h-3.5" />
              <span>Mavi Tik PNG</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'ai'
                  ? 'bg-white dark:bg-zinc-900 text-fuchsia-600 dark:text-fuchsia-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>RedChat AI Profil</span>
            </button>

            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>İstatistikler</span>
            </button>
          </nav>
        </div>
      </header>

      {/* 📱💻 ANA İÇERİK ALANI (TÜM BOYUTLARDA EKRANI DOLDURUR, BOŞLUK BIRAKMAZ) */}
      <main className="flex-1 w-full overflow-y-auto overflow-x-hidden p-3 sm:p-5 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* TAB 1: KULLANICI YÖNETİMİ & MODERASYON */}
          {activeTab === 'users' && (
            <div className="space-y-5">
              {/* Bildirim Çubukları */}
              {userActionSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{userActionSuccess}</span>
                </div>
              )}
              {userActionError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{userActionError}</span>
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
                    onClick={() => setUserFilter('all')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      userFilter === 'all'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                    }`}
                  >
                    Tümü ({localUsers.length})
                  </button>
                  <button
                    onClick={() => setUserFilter('online')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      userFilter === 'online'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                    }`}
                  >
                    Çevrimiçi ({localUsers.filter((u) => u.isOnline).length})
                  </button>
                  <button
                    onClick={() => setUserFilter('banned')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      userFilter === 'banned'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                    }`}
                  >
                    Banlı ({localUsers.filter((u) => u.isBanned).length})
                  </button>
                  <button
                    onClick={() => setUserFilter('muted')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      userFilter === 'muted'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                    }`}
                  >
                    Susturulmuş ({localUsers.filter((u) => u.isMuted).length})
                  </button>
                  <button
                    onClick={() => setUserFilter('verified')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      userFilter === 'verified'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                    }`}
                  >
                    Mavi Tik ({localUsers.filter((u) => u.isVerified).length})
                  </button>
                </div>
              </div>

              {/* 📱 MOBİL GÖRÜNÜM: KULLANICI KARTLARI (<640px) */}
              <div className="grid grid-cols-1 gap-3 sm:hidden">
                {filteredUsers.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400 text-xs bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
                    Eşleşen kullanıcı bulunamadı.
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isVerified = Boolean(user.isVerified);
                    const isBanned = Boolean(user.isBanned);
                    const isMuted = Boolean(user.isMuted);
                    const isProcessing = processingUid === user.uid;

                    return (
                      <div
                        key={user.uid}
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3"
                      >
                        {/* Üst: Avatar, İsim, Online Durumu */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative shrink-0">
                              <UserAvatar
                                photoURL={user.photoURL}
                                name={user.displayName}
                                username={user.username}
                                size="md"
                              />
                              <span
                                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                                  user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                                }`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                                <span className="truncate">{user.displayName || user.username}</span>
                                <VerifiedBadge
                                  isVerified={isVerified}
                                  badgeUrl={currentBadgeUrl}
                                  size="xs"
                                  user={{
                                    displayName: user.displayName || user.username,
                                    username: user.username,
                                    photoURL: user.photoURL,
                                  }}
                                />
                              </div>
                              <div className="text-[11px] text-red-600 font-mono truncate">
                                @{user.username}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                user.isOnline
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                                }`}
                              />
                              <span>{user.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
                            </span>
                          </div>
                        </div>

                        {/* Orta: Detay ve Etiketler */}
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                          <div className="flex items-center gap-1 font-mono text-zinc-400 text-[10px]">
                            <span className="truncate max-w-[100px]">{user.uid}</span>
                            <button
                              onClick={() => handleCopy(user.uid, user.uid)}
                              className="p-1 hover:text-zinc-600"
                              title="UID Kopyala"
                            >
                              {copiedUid === user.uid ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isBanned && (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-600 text-[10px] font-bold">
                                BANLI
                              </span>
                            )}
                            {isMuted && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-600 text-[10px] font-bold">
                                SUSTURULDU
                              </span>
                            )}
                            {isVerified && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-600 text-[10px] font-bold">
                                MAVİ TİK
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Alt: Butonlar */}
                        <div className="grid grid-cols-4 gap-1.5 pt-1">
                          <button
                            onClick={() => setInspectingUser(user)}
                            className="py-1.5 px-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>İncele</span>
                          </button>

                          <button
                            onClick={() => handleToggleUserVerification(user)}
                            disabled={isProcessing}
                            className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 ${
                              isVerified
                                ? 'bg-blue-50 text-blue-600 border border-blue-200 dark:border-blue-900/40'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            <BadgeCheck className="w-3.5 h-3.5" />
                            <span>Tik</span>
                          </button>

                          <button
                            onClick={() => handleToggleUserMute(user)}
                            disabled={isProcessing}
                            className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 ${
                              isMuted
                                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            {isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                            <span>{isMuted ? 'Aç' : 'Sustur'}</span>
                          </button>

                          <button
                            onClick={() => handleToggleUserBan(user)}
                            disabled={isProcessing}
                            className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 ${
                              isBanned
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-red-600 text-white shadow-xs'
                            }`}
                          >
                            {isProcessing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isBanned ? (
                              <span>Aç</span>
                            ) : (
                              <span>Banla</span>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 💻 TABLET / DESKTOP GÖRÜNÜM: KULLANICILAR TABLOSU (>=640px) */}
              <div className="hidden sm:block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-600 dark:text-zinc-300">
                    <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-400 font-semibold border-b border-zinc-200 dark:border-zinc-800 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-3.5 px-4">Kullanıcı</th>
                        <th className="py-3.5 px-4">İletişim & UID</th>
                        <th className="py-3.5 px-4">Durum</th>
                        <th className="py-3.5 px-4">Moderasyon & Rozet</th>
                        <th className="py-3.5 px-4 text-right">Moderasyon İşlemleri</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-zinc-400 text-xs">
                            Eşleşen kullanıcı bulunamadı.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isVerified = Boolean(user.isVerified);
                          const isBanned = Boolean(user.isBanned);
                          const isMuted = Boolean(user.isMuted);
                          const isProcessing = processingUid === user.uid;

                          return (
                            <tr
                              key={user.uid}
                              className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                            >
                              {/* Kullanıcı Profili */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div className="relative shrink-0">
                                    <UserAvatar
                                      photoURL={user.photoURL}
                                      name={user.displayName}
                                      username={user.username}
                                      size="md"
                                    />
                                    <span
                                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                                        user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                                      }`}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                                      <span className="truncate">{user.displayName || user.username}</span>
                                      <VerifiedBadge
                                        isVerified={isVerified}
                                        badgeUrl={currentBadgeUrl}
                                        size="sm"
                                        user={{
                                          displayName: user.displayName || user.username,
                                          username: user.username,
                                          photoURL: user.photoURL,
                                        }}
                                      />
                                    </div>
                                    <div className="text-[11px] text-red-600 font-mono truncate">
                                      @{user.username}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* E-posta ve UID */}
                              <td className="py-3 px-4">
                                <div className="space-y-0.5">
                                  <div className="text-zinc-700 dark:text-zinc-300 font-medium truncate max-w-[180px]">
                                    {user.email || '—'}
                                  </div>
                                  <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                                    <span className="truncate max-w-[120px]">{user.uid}</span>
                                    <button
                                      onClick={() => handleCopy(user.uid, user.uid)}
                                      className="p-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                      title="UID Kopyala"
                                    >
                                      {copiedUid === user.uid ? (
                                        <Check className="w-3 h-3 text-emerald-500" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </td>

                              {/* Online / Offline Durumu */}
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                    user.isOnline
                                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50'
                                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                                    }`}
                                  />
                                  <span>{formatLastSeen(user.isOnline, user.lastSeen)}</span>
                                </span>
                              </td>

                              {/* Moderasyon Etiketleri & Mavi Tik */}
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {isBanned && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 font-black text-[10px]">
                                      <Ban className="w-3 h-3" />
                                      <span>BANLI</span>
                                    </span>
                                  )}

                                  {isMuted && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 font-bold text-[10px]">
                                      <VolumeX className="w-3 h-3" />
                                      <span>SUSTURULDU</span>
                                    </span>
                                  )}

                                  {isVerified ? (
                                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 font-bold text-[10px]">
                                      <VerifiedBadge
                                        isVerified={true}
                                        badgeUrl={currentBadgeUrl}
                                        size="xs"
                                      />
                                      <span>Mavi Tik</span>
                                    </div>
                                  ) : !isBanned && !isMuted ? (
                                    <span className="text-zinc-400 text-[11px] font-medium">
                                      Normal
                                    </span>
                                  ) : null}
                                </div>
                              </td>

                              {/* İşlem Butonları */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => setInspectingUser(user)}
                                    className="p-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                                    title="Profili & Moderasyonu İncele"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>

                                  <button
                                    onClick={() => handleToggleUserVerification(user)}
                                    disabled={isProcessing}
                                    className={`p-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                      isVerified
                                        ? 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                                        : 'text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                    }`}
                                    title={isVerified ? 'Mavi Tiki Kaldır' : 'Mavi Tik Ver'}
                                  >
                                    <BadgeCheck className="w-4 h-4" />
                                  </button>

                                  <button
                                    onClick={() => handleToggleUserMute(user)}
                                    disabled={isProcessing}
                                    className={`p-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                      isMuted
                                        ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                        : 'text-zinc-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                                    }`}
                                    title={isMuted ? 'Susturmayı Kaldır' : 'Kullanıcıyı Sustur'}
                                  >
                                    {isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                                  </button>

                                  <button
                                    onClick={() => handleToggleUserBan(user)}
                                    disabled={isProcessing}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                      isBanned
                                        ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 dark:border-emerald-900/50'
                                        : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:border-red-900/50'
                                    }`}
                                    title={isBanned ? 'Banı Kaldır' : 'Kullanıcıyı Banla'}
                                  >
                                    {isProcessing ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : isBanned ? (
                                      <>
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        <span>Banı Kaldır</span>
                                      </>
                                    ) : (
                                      <>
                                        <Ban className="w-3.5 h-3.5" />
                                        <span>Banla</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 📋 TÜM SOHBET LOGLARI (ÖZEL & GRUP) */}
          {activeTab === 'chatlogs' && (
            <div className="space-y-5">
              {/* Üst Bar: Arama & Filtreler & Yenileme */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={chatLogSearch}
                    onChange={(e) => setChatLogSearch(e.target.value)}
                    placeholder="Katılımcı adı, @kullanıcıadı, grup adı veya mesaj içeriğiyle ara..."
                    className="w-full pl-9 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                  />
                </div>

                <div className="flex items-center gap-2 justify-between md:justify-end">
                  <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
                    <button
                      onClick={() => setChatLogFilter('all')}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        chatLogFilter === 'all'
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-900'
                      }`}
                    >
                      Tümü ({allConversations.length})
                    </button>
                    <button
                      onClick={() => setChatLogFilter('direct')}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        chatLogFilter === 'direct'
                          ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-900'
                      }`}
                    >
                      Özel ({allConversations.filter((c) => !c.isGroup).length})
                    </button>
                    <button
                      onClick={() => setChatLogFilter('group')}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        chatLogFilter === 'group'
                          ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-900'
                      }`}
                    >
                      Grup ({allConversations.filter((c) => c.isGroup).length})
                    </button>
                  </div>

                  <button
                    onClick={loadConversations}
                    disabled={loadingConversations}
                    className="p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-red-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    title="Sohbetleri Yenile"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${loadingConversations ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {/* Sohbet Kartları Grid */}
              {loadingConversations ? (
                <div className="py-20 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                  <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                  <span>Gerçek Firestore sohbetleri yükleniyor...</span>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="py-16 text-center text-zinc-400 text-xs bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8">
                  Eşleşen sohbet veya grup kaydı bulunamadı.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredConversations.map((conv) => {
                    const isGroup = Boolean(conv.isGroup);

                    // Katılımcı profillerini canlı haritadan (userMap) çekerek eksiksiz doldur
                    const participantProfiles = (conv.participantIds || []).map((uid) => {
                      const fromMap = userMap.get(uid);
                      const fromDoc = conv.participants?.[uid];
                      return {
                        uid,
                        displayName: fromMap?.displayName || fromDoc?.displayName || fromMap?.username || fromDoc?.username || 'Kullanıcı',
                        username: fromMap?.username || fromDoc?.username || 'kullanici',
                        photoURL: fromMap?.photoURL || fromDoc?.photoURL || null,
                        isVerified: Boolean(fromMap?.isVerified || (fromDoc as any)?.isVerified),
                      };
                    });

                    let timeFormatted = '—';
                    if (conv.lastMessageTimestamp?.toDate) {
                      timeFormatted = conv.lastMessageTimestamp.toDate().toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                    }

                    return (
                      <div
                        key={conv.id}
                        onClick={() => handleOpenChatLog(conv)}
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-red-500/50 dark:hover:border-red-500/50 rounded-2xl p-4 shadow-xs transition-all hover:shadow-md cursor-pointer flex flex-col justify-between space-y-3 group"
                      >
                        {/* Kart Üst Bilgisi */}
                        <div>
                          {isGroup ? (
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden border border-red-200 dark:border-red-900/50">
                                {conv.photoURL ? (
                                  <img
                                    src={conv.photoURL}
                                    alt={conv.name}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span>{conv.name?.charAt(0).toUpperCase() || 'G'}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-1">
                                  <h4 className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                                    {conv.name || 'Grup Sohbeti'}
                                  </h4>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 shrink-0 font-medium">
                                    {conv.participantIds?.length || 0} Üye
                                  </span>
                                </div>
                                <span className="text-[10px] text-red-600 font-semibold">
                                  👥 Grup Sohbeti
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-900/40">
                                  💬 Özel Sohbet
                                </span>
                                <span className="text-[10px] text-zinc-400 font-mono">
                                  {timeFormatted}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {participantProfiles.slice(0, 2).map((p, idx) => (
                                  <React.Fragment key={p.uid || idx}>
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <UserAvatar
                                        photoURL={p.photoURL}
                                        name={p.displayName}
                                        username={p.username}
                                        size="sm"
                                      />
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-0.5">
                                          <span className="truncate">{p.displayName || p.username}</span>
                                          {p.isVerified && (
                                            <VerifiedBadge
                                              isVerified={true}
                                              badgeUrl={currentBadgeUrl}
                                              size="xs"
                                            />
                                          )}
                                        </div>
                                        <div className="text-[10px] text-zinc-400 font-mono truncate">
                                          @{p.username}
                                        </div>
                                      </div>
                                    </div>
                                    {idx === 0 && participantProfiles.length > 1 && (
                                      <span className="text-zinc-300 dark:text-zinc-700 font-bold text-xs">
                                        ↔
                                      </span>
                                    )}
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Son Mesaj Önizlemesi */}
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
                          <div className="truncate flex-1 pr-2">
                            {conv.lastMessageHasImage ? (
                              <span className="text-zinc-700 dark:text-zinc-300 flex items-center gap-1 font-medium">
                                <ImageIcon className="w-3.5 h-3.5 text-red-500" />
                                {conv.lastMessageText || 'Fotoğraf'}
                              </span>
                            ) : conv.lastMessageText ? (
                              <span className="truncate">{conv.lastMessageText}</span>
                            ) : (
                              <span className="text-zinc-400 italic">Mesaj yok</span>
                            )}
                          </div>

                          <span className="text-xs text-red-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
                            <span>Logu Aç</span>
                            <span>→</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: KALICI MAVİ TİK PNG AYARLARI */}
          {activeTab === 'badge' && (
            <div className="space-y-6">
              {badgeActionSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{badgeActionSuccess}</span>
                </div>
              )}
              {badgeActionError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{badgeActionError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Sol: Yükleme & Yönetim Kartı */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                  <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                    <BadgeCheck className="w-5 h-5 text-blue-500" />
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      Özel Mavi Tik PNG Yükleme
                    </h3>
                  </div>

                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    RedChat üzerindeki Mavi Tik rozet görselini özelleştirin. Yüklenen PNG dosyası doğrudan <strong>ImgBB</strong> sunucusuna yüklenir ve kalıcı HTTPS bağlantısı Firestore <code>settings/app</code> dokümanına kaydedilir.
                  </p>

                  {/* Mevcut Aktif Rozet Durumu */}
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                      Sistemde Kayıtlı Rozet:
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0">
                        <VerifiedBadge
                          isVerified={true}
                          badgeUrl={currentBadgeUrl}
                          size="md"
                          interactive={false}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                          {currentBadgeUrl ? 'Özel ImgBB PNG Rozeti Aktif' : 'Varsayılan RedChat SVG Rozeti'}
                        </div>
                        {currentBadgeUrl && (
                          <a
                            href={currentBadgeUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 truncate"
                          >
                            <span className="truncate">{currentBadgeUrl}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Dosya Seçim & Yükleme Alanı */}
                  <div className="space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleBadgeFileSelect}
                      className="hidden"
                    />

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-zinc-50/50 dark:bg-zinc-900/50"
                    >
                      <Upload className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
                      <p className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                        Yeni Mavi Tik PNG Dosyası Seç
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        PNG (Şeffaf arka plan önerilir), Maksimum 5MB
                      </p>
                    </div>

                    {badgePreviewUrl && (
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={badgePreviewUrl}
                            alt="Önizleme"
                            className="w-8 h-8 object-contain aspect-square shrink-0"
                          />
                          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {selectedBadgeFile?.name}
                          </span>
                        </div>
                        <button
                          onClick={handleUploadBadge}
                          disabled={uploadingBadge}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                        >
                          {uploadingBadge ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Yükleniyor...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Kaydet</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {currentBadgeUrl && (
                      <button
                        onClick={handleRemoveBadge}
                        disabled={uploadingBadge}
                        className="w-full py-2.5 px-4 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Varsayılan Rozete Sıfırla (PNG'yi Kaldır)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sağ: Canlı Görsel Test & Önizleme */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                  <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                    <Eye className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      Canlı Görünüm Testi
                    </h3>
                  </div>

                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Mavi Tik PNG rozetinin sohbetler, mesajlar ve kullanıcı listesindeki canlı görünümü:
                  </p>

                  {/* Örnek 1: Açık Tema Kartı */}
                  <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-3">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Açık Tema Görünümü
                    </span>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name="Ahmet Yılmaz"
                        username="ahmetyilmaz"
                        size="md"
                      />
                      <div>
                        <div className="text-xs font-bold text-zinc-900 flex items-center gap-1">
                          <span>Ahmet Yılmaz</span>
                          <VerifiedBadge
                            isVerified={true}
                            badgeUrl={badgePreviewUrl || currentBadgeUrl}
                            size="sm"
                          />
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          @ahmetyilmaz
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Örnek 2: Koyu Tema Kartı */}
                  <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 space-y-3">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Koyu Tema Görünümü
                    </span>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name="Ayşe Kaya"
                        username="aysekaya"
                        size="md"
                      />
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1">
                          <span>Ayşe Kaya</span>
                          <VerifiedBadge
                            isVerified={true}
                            badgeUrl={badgePreviewUrl || currentBadgeUrl}
                            size="sm"
                          />
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono">
                          @aysekaya
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: REDCHAT AI PROFİL YÖNETİMİ (Kalıcı Firestore & ImgBB) */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              {/* Başlık & Bilgi */}
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Bot className="w-5 h-5 text-fuchsia-600" />
                  <span>RedChat AI Resmi Profil Fotoğrafı Yönetimi</span>
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  RedChat AI yapay zeka asistanının profil görselini buradan kalıcı olarak ayarlayabilirsiniz. Yüklenen görsel ImgBB CDN'e yüklenir ve Firestore <code className="font-mono text-zinc-700 dark:text-zinc-300">settings/app</code> ve <code className="font-mono text-zinc-700 dark:text-zinc-300">users/system_redchat_ai</code> hesaplarına kaydedilir. Tüm tarayıcı ve cihazlarda anında güncellenir.
                </p>
              </div>

              {/* Bildirim Mesajları */}
              {aiPhotoActionSuccess && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-3 text-emerald-800 dark:text-emerald-300 text-xs">
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{aiPhotoActionSuccess}</span>
                </div>
              )}

              {aiPhotoActionError && (
                <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{aiPhotoActionError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Sol: AI Profil Görseli Yükleme Kartı */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                  <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />
                      <span>AI Profil Görseli Yükle</span>
                    </h4>
                    {appSettings?.aiProfilePhotoUrl ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-600 dark:text-fuchsia-400 border border-fuchsia-200 dark:border-fuchsia-800">
                        Özel AI Görseli Aktif
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        Varsayılan Avatar Aktif
                      </span>
                    )}
                  </div>

                  {/* Dosya Seçim Alanı */}
                  <div className="space-y-3">
                    <input
                      ref={aiFileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      onChange={handleAiPhotoFileSelect}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => aiFileInputRef.current?.click()}
                      disabled={uploadingAiPhoto}
                      className="w-full py-8 border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-fuchsia-500 dark:hover:border-fuchsia-500 rounded-2xl flex flex-col items-center justify-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-fuchsia-600 transition-colors cursor-pointer bg-zinc-50/50 dark:bg-zinc-950/30"
                    >
                      <Upload className="w-7 h-7" />
                      <div className="text-xs font-semibold text-center">
                        <span>RedChat AI İçin Görsel Seç</span>
                        <span className="block text-[10px] text-zinc-400 mt-0.5">
                          Kare (1:1) PNG veya JPG görseli önerilir (Max 5MB)
                        </span>
                      </div>
                    </button>

                    {selectedAiPhotoFile && (
                      <div className="p-3 bg-fuchsia-50/60 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-800 rounded-xl flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Bot className="w-4 h-4 text-fuchsia-600 shrink-0" />
                          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {selectedAiPhotoFile?.name}
                          </span>
                        </div>
                        <button
                          onClick={handleUploadAiPhoto}
                          disabled={uploadingAiPhoto}
                          className="px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                        >
                          {uploadingAiPhoto ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Yükleniyor...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Kaydet</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {appSettings?.aiProfilePhotoUrl && (
                      <button
                        onClick={handleRemoveAiPhoto}
                        disabled={uploadingAiPhoto}
                        className="w-full py-2.5 px-4 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Varsayılan AI Görseline Sıfırla</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sağ: Canlı AI Profil Önizlemesi */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                  <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                    <Eye className="w-5 h-5 text-fuchsia-600" />
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      Canlı RedChat AI Görünümü
                    </h3>
                  </div>

                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    RedChat AI hesabının kullanıcılar sohbet listesinde ve mesaj ekranında nasıl görüneceğinin canlı simülasyonu:
                  </p>

                  {/* Örnek 1: Açık Tema Görünümü */}
                  <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-3">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Açık Tema Görünümü
                    </span>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        photoURL={aiPhotoPreviewUrl || appSettings?.aiProfilePhotoUrl}
                        name="RedChat AI"
                        username="redchat_ai"
                        size="md"
                      />
                      <div>
                        <div className="text-xs font-bold text-zinc-900 flex items-center gap-1">
                          <span>RedChat AI</span>
                          <VerifiedBadge
                            isVerified={true}
                            badgeUrl={currentBadgeUrl}
                            size="sm"
                          />
                        </div>
                        <div className="text-[11px] text-fuchsia-600 font-mono font-medium">
                          @redchat_ai • Flash Lite 1.0
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Örnek 2: Koyu Tema Görünümü */}
                  <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 space-y-3">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Koyu Tema Görünümü
                    </span>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        photoURL={aiPhotoPreviewUrl || appSettings?.aiProfilePhotoUrl}
                        name="RedChat AI"
                        username="redchat_ai"
                        size="md"
                      />
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1">
                          <span>RedChat AI</span>
                          <VerifiedBadge
                            isVerified={true}
                            badgeUrl={currentBadgeUrl}
                            size="sm"
                          />
                        </div>
                        <div className="text-[11px] text-fuchsia-400 font-mono font-medium">
                          @redchat_ai • Flash Lite 1.0
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: İSTATİSTİKLER */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Gerçek Firestore Veritabanı İstatistikleri
                </h3>
                <button
                  onClick={loadStats}
                  disabled={loadingStats}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold rounded-xl text-zinc-700 dark:text-zinc-300 hover:text-red-600 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
                  <span>Yenile</span>
                </button>
              </div>

              {/* İstatistik Kartları */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-xs font-semibold">Toplam Kullanıcı</span>
                    <Users className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white">
                    {stats.totalUsers}
                  </div>
                </div>

                <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-xs font-semibold">Çevrimiçi</span>
                    <Flame className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {stats.onlineUsers}
                  </div>
                </div>

                <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-xs font-semibold">Sohbet / Grup</span>
                    <MessageSquare className="w-4 h-4 text-purple-500" />
                  </div>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white">
                    {stats.totalConversations}
                  </div>
                </div>

                <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-xs font-semibold">Toplam Mesaj</span>
                    <Activity className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white">
                    {stats.totalMessages}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 📋 SOHBET LOGU İNCELEME MODALI (TAM RESPONSIVE) */}
      {activeLogConversation && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in"
          onClick={() => setActiveLogConversation(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-3xl h-[92vh] sm:h-[85vh] shadow-2xl flex flex-col overflow-hidden relative animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Üst Barı */}
            <div className="p-3.5 sm:p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90 flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center font-bold text-sm shrink-0">
                  {activeLogConversation.isGroup ? <span>👥</span> : <span>💬</span>}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-1.5">
                    <span className="truncate">
                      {activeLogConversation.isGroup
                        ? activeLogConversation.name || 'Grup Sohbeti'
                        : (activeLogConversation.participantIds || [])
                            .map((uid) => userMap.get(uid)?.displayName || userMap.get(uid)?.username || uid.slice(0, 6))
                            .join(' ↔ ')}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-normal shrink-0">
                      {activeLogConversation.isGroup ? 'Grup' : 'Özel'}
                    </span>
                  </h3>
                  <div className="text-[11px] text-zinc-400 font-mono truncate">
                    {logMessages.length} Mesaj • ID: {activeLogConversation.id}
                  </div>
                </div>
              </div>

              {/* İşlem Butonları: 📋 Sohbeti Kopyala & Kapat */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCopyFullChatLog}
                  disabled={copyingLog}
                  className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                    copiedLogSuccess
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                  title="Tüm Mesaj Geçmişini Kopyala"
                >
                  {copyingLog ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : copiedLogSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Kopyalandı!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Sohbeti Kopyala</span>
                      <span className="sm:hidden">Kopyala</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setActiveLogConversation(null)}
                  className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                  title="Kapat"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Bildirim Çubuğu */}
            {copiedLogSuccess && (
              <div className="p-2 bg-emerald-500 text-white text-xs font-bold text-center flex items-center justify-center gap-1.5 animate-in slide-in-from-top-2">
                <CheckCircle className="w-4 h-4" />
                <span>Sohbet logu panoya kopyalandı.</span>
              </div>
            )}
            {copiedLogError && (
              <div className="p-2 bg-rose-600 text-white text-xs font-bold text-center flex items-center justify-center gap-1.5 animate-in slide-in-from-top-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{copiedLogError}</span>
              </div>
            )}

            {/* Mesaj Akışı Gövdesi (Kronolojik: Eskiden Yeniye) */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3.5 bg-zinc-50/50 dark:bg-zinc-950/50">
              {loadingLogMessages ? (
                <div className="py-20 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                  <span>Mesaj logları Firestore'dan çekiliyor...</span>
                </div>
              ) : logMessages.length === 0 ? (
                <div className="py-20 text-center text-zinc-400 text-xs">
                  Bu sohbette henüz kaydedilmiş bir mesaj bulunmuyor.
                </div>
              ) : (
                logMessages.map((msg) => {
                  let timeFormatted = '—';
                  if (msg.createdAt?.toDate) {
                    timeFormatted = msg.createdAt.toDate().toLocaleDateString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  }

                  if (msg.isSystemMessage) {
                    return (
                      <div
                        key={msg.id}
                        className="py-1.5 px-3 bg-zinc-200/70 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-400 rounded-full text-[11px] text-center max-w-md mx-auto font-medium"
                      >
                        [Sistem]: {msg.text}
                      </div>
                    );
                  }

                  const senderProfile = userMap.get(msg.senderId);
                  const senderDisplayName = senderProfile?.displayName || msg.senderName || msg.senderUsername || 'Kullanıcı';
                  const senderUsername = senderProfile?.username || msg.senderUsername || 'kullanici';
                  const isVerifiedSender = Boolean(senderProfile?.isVerified);

                  return (
                    <div
                      key={msg.id}
                      className="p-3 sm:p-3.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-2"
                    >
                      {/* Mesaj Üstü */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar
                            photoURL={senderProfile?.photoURL}
                            name={senderDisplayName}
                            username={senderUsername}
                            size="sm"
                          />
                          <div className="flex items-center gap-1 font-bold text-zinc-900 dark:text-zinc-100 min-w-0">
                            <span className="truncate">{senderDisplayName}</span>
                            {isVerifiedSender && (
                              <VerifiedBadge
                                isVerified={true}
                                badgeUrl={currentBadgeUrl}
                                size="xs"
                              />
                            )}
                            <span className="text-[10px] text-red-600 font-mono font-normal truncate">
                              @{senderUsername}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 shrink-0 ml-2">
                          {timeFormatted}
                        </span>
                      </div>

                      {/* Yanıt (Reply) Varsa */}
                      {msg.replyTo && (
                        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/60 border-l-2 border-red-500 rounded-r-lg text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden">
                          <Reply className="w-3 h-3 text-red-500 shrink-0" />
                          <span className="font-bold shrink-0">{msg.replyTo.senderName}:</span>
                          <span className="truncate min-w-0 flex-1">
                            {msg.replyTo.text || '[Fotoğraf]'}
                          </span>
                        </div>
                      )}

                      {/* Fotoğraf Mesajı Varsa */}
                      {msg.imageUrl && (
                        <div className="relative rounded-xl overflow-hidden max-w-sm border border-zinc-200 dark:border-zinc-800 group/img">
                          <img
                            src={msg.imageUrl}
                            alt="Fotoğraf"
                            referrerPolicy="no-referrer"
                            className="max-h-60 w-auto object-cover rounded-xl"
                          />
                          <button
                            onClick={() => setExpandedImageUrl(msg.imageUrl || null)}
                            className="absolute bottom-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity cursor-pointer"
                            title="Büyüt"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Metin İçeriği */}
                      {msg.text && (
                        <p className="text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words break-all [overflow-wrap:anywhere] [word-break:break-word] leading-relaxed">
                          {msg.text}
                        </p>
                      )}

                      {/* Reaksiyonlar */}
                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {Object.entries(msg.reactions).map(([emoji, uids]) => {
                            const count = Array.isArray(uids) ? uids.length : 0;
                            return (
                              <span
                                key={emoji}
                                className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] border border-zinc-200 dark:border-zinc-700 flex items-center gap-1"
                              >
                                <span>{emoji}</span>
                                <span className="text-[10px] font-bold text-zinc-500">
                                  {count}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* KULLANICI DETAY & MODERASYON MODALI */}
      {inspectingUser && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setInspectingUser(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setInspectingUser(null)}
              className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Avatar & İsim */}
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-3">
                <UserAvatar
                  photoURL={inspectingUser.photoURL}
                  name={inspectingUser.displayName}
                  username={inspectingUser.username}
                  size="xl"
                />
                <span
                  className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                    inspectingUser.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                  }`}
                />
              </div>

              <h4 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-1">
                <span>{inspectingUser.displayName || inspectingUser.username}</span>
                <VerifiedBadge
                  isVerified={inspectingUser.isVerified}
                  badgeUrl={currentBadgeUrl}
                  size="sm"
                />
              </h4>
              <span className="text-xs font-mono text-red-600">
                @{inspectingUser.username}
              </span>
            </div>

            {/* Detay Alanları */}
            <div className="space-y-2 text-xs">
              <div className="p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> E-posta
                </span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[160px]">
                  {inspectingUser.email || '—'}
                </span>
              </div>

              <div className="p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400">UID</span>
                <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                  <span className="truncate max-w-[130px]">{inspectingUser.uid}</span>
                  <button
                    onClick={() => handleCopy(inspectingUser.uid, inspectingUser.uid)}
                    className="p-0.5 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedUid === inspectingUser.uid ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400">Hesap Durumu</span>
                <div className="flex items-center gap-1 font-bold">
                  {inspectingUser.isBanned ? (
                    <span className="text-red-600">🚫 Banlı</span>
                  ) : inspectingUser.isMuted ? (
                    <span className="text-amber-600">🔇 Susturulmuş</span>
                  ) : (
                    <span className="text-emerald-600">Aktif</span>
                  )}
                </div>
              </div>
            </div>

            {/* Moderasyon Aksiyon Butonları */}
            <div className="space-y-2 pt-1">
              <button
                onClick={() => handleToggleUserBan(inspectingUser)}
                disabled={processingUid === inspectingUser.uid}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                  inspectingUser.isBanned
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-xs'
                }`}
              >
                {processingUid === inspectingUser.uid ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : inspectingUser.isBanned ? (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Banı Kaldır</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-4 h-4" />
                    <span>Kullanıcıyı Banla</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleToggleUserMute(inspectingUser)}
                disabled={processingUid === inspectingUser.uid}
                className={`w-full py-2 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                  inspectingUser.isMuted
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200'
                }`}
              >
                {inspectingUser.isMuted ? (
                  <>
                    <Volume2 className="w-4 h-4" />
                    <span>Susturmayı Kaldır</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-4 h-4" />
                    <span>Kullanıcıyı Sustur</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Görsel Büyütme Modalı */}
      {expandedImageUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setExpandedImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setExpandedImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={expandedImageUrl}
              alt="Büyük Görsel"
              referrerPolicy="no-referrer"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
