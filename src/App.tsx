import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile, Conversation, AppSettings, GroupedNotificationData, GroupedNotificationMessage, Channel, ChannelNotification, SecuritySession } from './types';
import {
  subscribeToAuthState,
  subscribeToUserProfile,
  subscribeToAllUsers,
  getUserProfile,
  isRegistrationInProgress,
  formatAuthErrorMessage,
  logoutUser,
  setUserOnlineStatus,
} from './services/authService';
import {
  subscribeToConversations,
  getOrCreateDirectConversation,
  getGroupedUnreadMessages,
} from './services/chatService';
import {
  subscribeToChannels,
  subscribeToUserFollowingChannels,
  checkIsChannelOwner,
  followChannel,
  unfollowChannel,
  ensureOfficialRedChatChannel,
  subscribeToUserChannelNotifications,
  markChannelNotificationAsRead,
  markAllChannelNotificationsAsRead,
  clearAllChannelNotifications,
} from './services/channelService';
import { subscribeToAppSettings, ADMIN_EMAILS, isUserAdmin, isUserModerator } from './services/adminService';
import {
  verifyModeratorAuthority,
  subscribeToModeratorGrant,
  checkModerationExpiry,
  isUserEffectivelyBanned,
  toTimestampMs,
  MUSE_MODERATOR_UID,
} from './services/moderationService';
import { subscribeUserDrafts, type DraftData } from './services/draftService';
import { setupForegroundListener, requestNotificationPermissionAndToken } from './services/messagingService';
import { db } from './services/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { preloadBadgeImage } from './components/VerifiedBadge';
import { getRedChatAIProfile } from './services/aiService';
import { AuthCard } from './components/AuthCard';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatWindow } from './components/ChatWindow';
import { ProfileModal } from './components/ProfileModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { CreateChannelModal } from './components/CreateChannelModal';
import { ChannelManageModal } from './components/ChannelManageModal';
import { ChannelNotificationsModal } from './components/ChannelNotificationsModal';
import { ChannelView } from './components/ChannelView';
import { AdminPanel } from './components/AdminPanel';
import { BannedScreen } from './components/BannedScreen';
import { HardwareBannedScreen } from './components/HardwareBannedScreen';
import { EmailReviewScreen } from './components/EmailReviewScreen';
import { NewCountrySecurityScreen } from './components/NewCountrySecurityScreen';

import {
  registerOrVerifyDeviceSession,
  subscribeToSessionStatus,
  clearLocalSessionCredentials,
  verifyActiveSessionOnServer,
  checkServerMainAdminStatus,
} from './services/sessionSecurityService';
import { subscribeToDeviceBanStatus, syncCurrentDeviceInfo, checkDeviceBanNow } from './services/deviceService';
import { subscribeToBlockedUsers, unblockUser } from './services/blockService';
import type { BannedDevice } from './types';
import { WhatsAppNotificationBanner } from './components/WhatsAppNotificationBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loader2, Bell, X, Radio, AlertCircle, RefreshCw, LogOut } from 'lucide-react';

export default function App() {
  const [currentUserAuth, setCurrentUserAuth] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // 📢 Kanallar State'i
  const [channels, setChannels] = useState<Channel[]>([]);
  const [followingChannelIds, setFollowingChannelIds] = useState<string[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [isCurrentChannelOwner, setIsCurrentChannelOwner] = useState<boolean>(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState<boolean>(false);
  const [managingChannel, setManagingChannel] = useState<Channel | null>(null);

  // 🔔 Kanal Bildirimleri State'i
  const [channelNotifications, setChannelNotifications] = useState<ChannelNotification[]>([]);
  const [showChannelNotificationsModal, setShowChannelNotificationsModal] = useState<boolean>(false);

  // ✍️ Mesaj Taslakları State'i (Map<targetId, DraftData>)
  const [userDrafts, setUserDrafts] = useState<Map<string, DraftData>>(new Map());

  // Realtime Taslak Dinleyicisi
  useEffect(() => {
    if (!currentUserAuth?.uid) {
      setUserDrafts(new Map());
      return;
    }

    const unsubscribeDrafts = subscribeUserDrafts(currentUserAuth.uid, (draftsMap) => {
      setUserDrafts(draftsMap);
    });

    return () => unsubscribeDrafts();
  }, [currentUserAuth?.uid]);

  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);
  const [modalTab, setModalTab] = useState<'profile' | 'settings'>('profile');
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [authExternalError, setAuthExternalError] = useState<string | null>(null);
  const [profileRetryTick, setProfileRetryTick] = useState(0);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentHash, setCurrentHash] = useState<string>(window.location.hash || '#/');
  const [bannerNotification, setBannerNotification] = useState<GroupedNotificationData | null>(null);
  const lastSeenMsgTimestampsRef = React.useRef<Record<string, number>>({});
  const notifiedMessageIdsRef = React.useRef<Set<string>>(new Set());

  // 🚫 IP & Donanım Banı State'i (Kati Cihaz Kilidi)
  const [deviceBanInfo, setDeviceBanInfo] = useState<BannedDevice | null>(null);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [clientHwid, setClientHwid] = useState<string | null>(null);
  const [clientDeviceType, setClientDeviceType] = useState<'desktop' | 'tablet' | 'mobile' | 'unknown'>('desktop');

  // 🌍 Yeni Ülke Girişi & Sunucu Doğrulamalı Cihaz Oturumu State'i
  const [currentSecuritySession, setCurrentSecuritySession] = useState<SecuritySession | null>(null);
  const [sessionCheckLoading, setSessionCheckLoading] = useState<boolean>(false);
  const [sessionRevokedNotice, setSessionRevokedNotice] = useState<string | null>(null);
  const currentSecuritySessionRef = React.useRef<SecuritySession | null>(null);
  currentSecuritySessionRef.current = currentSecuritySession;
  const currentUserProfileRef = React.useRef<UserProfile | null>(null);
  currentUserProfileRef.current = currentUserProfile;
  const currentUserAuthRef = React.useRef<User | null>(null);
  currentUserAuthRef.current = currentUserAuth;
  const initialPresenceSyncedUidRef = React.useRef<string | null>(null);
  const lastPresenceWriteRef = React.useRef<{ uid: string; isOnline: boolean; at: number } | null>(null);

  const syncUserOnlineStatus = useCallback(
    (uid: string, isOnline: boolean, options?: { force?: boolean }) => {
      if (!uid) return;
      const now = Date.now();
      const last = lastPresenceWriteRef.current;
      if (
        !options?.force &&
        last &&
        last.uid === uid &&
        last.isOnline === isOnline &&
        now - last.at < 4000
      ) {
        return;
      }
      lastPresenceWriteRef.current = { uid, isOnline, at: now };
      setUserOnlineStatus(uid, isOnline);
    },
    []
  );

  // 🛡️ Sunucu Doğrulamalı Yönetici & Moderatör Yetkisi
  const [serverVerifiedModerator, setServerVerifiedModerator] = useState<boolean>(false);
  const [moderatorGrantActive, setModeratorGrantActive] = useState<boolean | null>(null);
  const [serverMainAdmin, setServerMainAdmin] = useState<boolean>(false);
  const [adminSecurityReviewUnlocked, setAdminSecurityReviewUnlocked] = useState<boolean>(false);

  // 🚫 Kullanıcı Engelleme State'i (Gerçek Zamanlı & Cihazlar Arası Senkron)
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const blockedUserIdsRef = React.useRef<string[]>([]);
  blockedUserIdsRef.current = blockedUserIds;

  // 🚫 Gerçek Zamanlı Engellenen Kullanıcılar Dinleyicisi
  useEffect(() => {
    if (!currentUserAuth?.uid) {
      setBlockedUserIds([]);
      return;
    }

    const unsubscribeBlocked = subscribeToBlockedUsers(
      currentUserAuth.uid,
      (ids) => {
        setBlockedUserIds(ids);
      }
    );

    return () => unsubscribeBlocked();
  }, [currentUserAuth?.uid]);

  const handleUnblockUser = async (targetUserId: string) => {
    if (!currentUserAuth?.uid) return;
    try {
      await unblockUser(currentUserAuth.uid, targetUserId);
    } catch (err) {
      console.error('Engel kaldırılamadı:', err);
    }
  };

  // 🚫 Gerçek Zamanlı Cihaz & IP Banı Dinleyicisi
  useEffect(() => {
    const unsubscribeDeviceBan = subscribeToDeviceBanStatus((ban, ip, devId, devType) => {
      setDeviceBanInfo(ban);
      setClientIp(ip);
      setClientHwid(devId);
      setClientDeviceType(devType);
    });

    return () => unsubscribeDeviceBan();
  }, []);

  // Cihaz parmak izi ve IP bilgisini kullanıcı profiliyle eşleştir
  useEffect(() => {
    if (currentUserAuth?.uid && currentUserProfile?.uid) {
      syncCurrentDeviceInfo(currentUserAuth.uid);
    }
  }, [currentUserAuth?.uid, currentUserProfile?.uid]);

  // 0. Hash Router Listener (/#/admin desteği)
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 📱 Tablet ve mobil cihazlarda orientation / resize / visualViewport / background return senkronizasyonu
  const [, setViewportTick] = useState(0);

  useEffect(() => {
    const handleLayoutRecalc = () => {
      setViewportTick((prev) => prev + 1);
    };

    window.addEventListener('resize', handleLayoutRecalc, { passive: true });
    window.addEventListener('orientationchange', handleLayoutRecalc, { passive: true });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleLayoutRecalc();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleLayoutRecalc, { passive: true });
    }

    return () => {
      window.removeEventListener('resize', handleLayoutRecalc);
      window.removeEventListener('orientationchange', handleLayoutRecalc);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleLayoutRecalc);
      }
    };
  }, []);

  // 1. Firebase Auth State Listener
  useEffect(() => {
    const unsubscribeAuth = subscribeToAuthState((user) => {
      setCurrentUserAuth(user);
      setAuthLoading(false);
      if (!user) {
        setCurrentUserProfile(null);
        setProfileLoading(false);
        setProfileError(null);
        setActiveConversationId(null);
        setCurrentSecuritySession(null);
        setSessionCheckLoading(false);
        setServerMainAdmin(false);
        setAdminSecurityReviewUnlocked(false);
        initialPresenceSyncedUidRef.current = null;
        lastPresenceWriteRef.current = null;
      } else {
        setProfileError(null);
        setProfileLoading(true);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const isProfileReady = Boolean(currentUserProfile?.uid);

  // 1b. 🌍 Yeni Ülke Girişi & Cihaz Oturum Kaydı + Gerçek Zamanlı İptal Dinleyicisi
  useEffect(() => {
    const authUser = currentUserAuthRef.current;
    if (!authUser || !isProfileReady) {
      if (!authUser) {
        setCurrentSecuritySession(null);
      }
      setSessionCheckLoading(false);
      return;
    }

    let isMounted = true;
    setSessionCheckLoading(true);

    registerOrVerifyDeviceSession(authUser)
      .then(async ({ session }) => {
        if (!isMounted) return;
        if (session.status === 'revoked' && session.userResponse !== 'denied_not_me') {
          clearLocalSessionCredentials(authUser.uid);
          setSessionRevokedNotice('Bu cihazdaki oturumunuz güvenlik nedeniyle sonlandırıldı.');
          syncUserOnlineStatus(authUser.uid, false, { force: true });
          await logoutUser();
          return;
        }
        setSessionRevokedNotice(null);
        setCurrentSecuritySession(session);
        if (session.status !== 'active') {
          syncUserOnlineStatus(authUser.uid, false);
        }
      })
      .catch(async (err: any) => {
        console.warn('Oturum güvenlik doğrulaması hatası:', err);
        if (err?.code === 'TOKEN_REVOKED') {
          clearLocalSessionCredentials(authUser.uid);
          setSessionRevokedNotice('Oturumunuz güvenlik nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.');
          syncUserOnlineStatus(authUser.uid, false, { force: true });
          await logoutUser();
        }
      })
      .finally(() => {
        if (isMounted) setSessionCheckLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentUserAuth?.uid, isProfileReady, syncUserOnlineStatus]);

  useEffect(() => {
    const authUid = currentUserAuth?.uid;
    const sessionId = currentSecuritySession?.sessionId;
    if (!authUid || !sessionId) return;

    const unsubSession = subscribeToSessionStatus(
      sessionId,
      async (updatedSession) => {
        if (!updatedSession) return;
        setCurrentSecuritySession(updatedSession);

        const profile = currentUserProfileRef.current;
        const shouldBeOnline =
          updatedSession.status === 'active' &&
          !(profile && (profile.isEmailInReview || isUserEffectivelyBanned(profile)));
        if (!profile || Boolean(profile.isOnline) !== shouldBeOnline) {
          syncUserOnlineStatus(authUid, shouldBeOnline);
        }

        // Yönetici veya başka bir oturum tarafından tekil/toplu kapatıldıysa bu cihazı derhal düşür
        if (
          updatedSession.status === 'revoked' &&
          updatedSession.userResponse !== 'denied_not_me'
        ) {
          clearLocalSessionCredentials(authUid);
          setSessionRevokedNotice(
            updatedSession.verificationStatus === 'expired'
              ? 'Oturum süreniz dolduğu için güvenli çıkış yapıldı.'
              : 'Bu cihazdaki oturumunuz güvenlik nedeniyle sonlandırıldı.'
          );
          syncUserOnlineStatus(authUid, false, { force: true });
          await logoutUser();
        }
      }
    );

    // Sunucu tarafında süre dolumu (expiresAt) ve iptal kontrolünü periyodik olarak çalıştır
    const checkServerSession = async () => {
      const authUser = currentUserAuthRef.current;
      if (!authUser) return;
      try {
        const res = await verifyActiveSessionOnServer(authUser);
        if (res.reason === 'SESSION_EXPIRED' || (res.status === 'revoked' && res.reason === 'SESSION_REVOKED')) {
          if (currentSecuritySessionRef.current?.userResponse === 'denied_not_me') return;
          clearLocalSessionCredentials(authUid);
          setSessionRevokedNotice(
            res.reason === 'SESSION_EXPIRED'
              ? 'Oturum süreniz dolduğu için güvenli çıkış yapıldı.'
              : 'Bu cihazdaki oturumunuz güvenlik nedeniyle sonlandırıldı.'
          );
          syncUserOnlineStatus(authUid, false, { force: true });
          await logoutUser();
        }
      } catch {
        // Ağ hatasında mevcut yerel akışı bozma
      }
    };

    const sessionCheckInterval = setInterval(checkServerSession, 45000);
    const handleFocusSessionCheck = () => {
      if (document.visibilityState === 'visible') {
        checkServerSession();
      }
    };
    window.addEventListener('focus', handleFocusSessionCheck);

    return () => {
      unsubSession();
      clearInterval(sessionCheckInterval);
      window.removeEventListener('focus', handleFocusSessionCheck);
    };
  }, [currentUserAuth?.uid, currentSecuritySession?.sessionId, syncUserOnlineStatus]);

  // 1c. Sunucu Taraflı Ana Yönetici Doğrulaması
  useEffect(() => {
    let active = true;
    if (!currentUserAuth?.uid) {
      setServerMainAdmin(false);
      return;
    }
    checkServerMainAdminStatus()
      .then((res) => {
        if (active) setServerMainAdmin(Boolean(res.isMainAdmin));
      })
      .catch(() => {
        if (active) setServerMainAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [currentUserAuth?.uid]);

  useEffect(() => {
    if (currentSecuritySession?.status === 'active' && adminSecurityReviewUnlocked) {
      setAdminSecurityReviewUnlocked(false);
    }
  }, [currentSecuritySession?.status, adminSecurityReviewUnlocked]);

  // 2. Logged-in User Profile Listener
  useEffect(() => {
    const authUid = currentUserAuth?.uid;
    if (!authUid) {
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    let isMounted = true;
    let missingCheckTimer: ReturnType<typeof setTimeout> | null = null;
    setProfileLoading(true);
    setProfileError(null);

    const isLocked = () => {
      const p = currentUserProfileRef.current;
      const s = currentSecuritySessionRef.current;
      return Boolean(!p || p.isEmailInReview || isUserEffectivelyBanned(p) || (s && s.status !== 'active'));
    };

    const loadTimeout = setTimeout(() => {
      if (!isMounted) return;
      if (!currentUserProfileRef.current && !isRegistrationInProgress()) {
        setProfileLoading(false);
        setSessionCheckLoading(false);
        setProfileError('Kullanıcı profiliniz yüklenirken zaman aşımı oluştu. Bağlantınızı kontrol edip tekrar deneyin.');
      }
    }, 12000);

    const unsubscribeProfile = subscribeToUserProfile(
      authUid,
      (profile) => {
        if (!isMounted) return;
        if (missingCheckTimer) {
          clearTimeout(missingCheckTimer);
          missingCheckTimer = null;
        }

        if (profile) {
          setCurrentUserProfile(profile);
          setProfileLoading(false);
          setProfileError(null);
          setAuthExternalError(null);

          const shouldBeOnline = !(
            profile.isEmailInReview ||
            isUserEffectivelyBanned(profile) ||
            (currentSecuritySessionRef.current && currentSecuritySessionRef.current.status !== 'active')
          );
          const needsInitialSync = initialPresenceSyncedUidRef.current !== authUid;
          const statusDiffers = Boolean(profile.isOnline) !== shouldBeOnline;
          if (needsInitialSync || statusDiffers) {
            initialPresenceSyncedUidRef.current = authUid;
            syncUserOnlineStatus(authUid, shouldBeOnline);
          }
          return;
        }

        setCurrentUserProfile(null);
        // Kayıt batch işlemi devam ediyorsa profil yazılmasını bekle
        if (isRegistrationInProgress()) {
          return;
        }

        // Profil dokümanı eksikse kısa bir doğrulamanın ardından sonsuz Loading'e düşmeden çıkış yap ve hata göster
        missingCheckTimer = setTimeout(async () => {
          if (!isMounted || isRegistrationInProgress()) return;
          try {
            const directProfile = await getUserProfile(authUid);
            if (!isMounted || isRegistrationInProgress()) return;
            if (directProfile) {
              setCurrentUserProfile(directProfile);
              setProfileLoading(false);
              setProfileError(null);
              return;
            }
            setProfileLoading(false);
            setSessionCheckLoading(false);
            setAuthExternalError(
              'Hesabınız Firebase Authentication ile doğrulandı ancak Firestore kullanıcı profiliniz bulunamadı. Kayıt işlemi tamamlanmamış olabilir; lütfen yeniden kayıt olun.'
            );
            await logoutUser().catch(() => {});
          } catch (verifyErr: any) {
            if (!isMounted) return;
            setProfileLoading(false);
            setSessionCheckLoading(false);
            setProfileError(
              formatAuthErrorMessage(verifyErr, 'Kullanıcı profiliniz Firestore\'dan okunamadı.')
            );
          }
        }, 450);
      },
      (err) => {
        if (!isMounted) return;
        if (missingCheckTimer) {
          clearTimeout(missingCheckTimer);
          missingCheckTimer = null;
        }
        setProfileLoading(false);
        setSessionCheckLoading(false);
        setProfileError(
          formatAuthErrorMessage(err, 'Kullanıcı profiliniz okunurken bir hata oluştu.')
        );
      }
    );

    const handleVisibilityChange = () => {
      if (!currentUserProfileRef.current) return;
      if (isLocked()) {
        syncUserOnlineStatus(authUid, false);
        return;
      }
      if (document.visibilityState === 'visible') {
        syncUserOnlineStatus(authUid, true);
      } else {
        syncUserOnlineStatus(authUid, false);
      }
    };

    const handleBeforeUnload = () => {
      if (currentUserProfileRef.current) {
        syncUserOnlineStatus(authUid, false, { force: true });
      }
    };

    const heartbeatInterval = setInterval(() => {
      if (!currentUserProfileRef.current) return;
      if (isLocked()) {
        syncUserOnlineStatus(authUid, false);
        return;
      }
      if (document.visibilityState === 'visible') {
        syncUserOnlineStatus(authUid, true, { force: true });
      }
    }, 60000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isMounted = false;
      clearTimeout(loadTimeout);
      if (missingCheckTimer) clearTimeout(missingCheckTimer);
      unsubscribeProfile();
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUserAuth?.uid, profileRetryTick, syncUserOnlineStatus]);


  // 3. Realtime Users List (All registered users in Firestore)
  useEffect(() => {
    if (!currentUserAuth?.uid || !isProfileReady) return;

    const unsubscribeUsers = subscribeToAllUsers((users) => {
      setAllUsers(users);
    });

    return () => unsubscribeUsers();
  }, [currentUserAuth?.uid, isProfileReady]);

  // 3b. 📢 Realtime Channels & Following Listener
  useEffect(() => {
    const authUid = currentUserAuth?.uid;
    if (!authUid || !isProfileReady) return;

    const unsubscribeChannels = subscribeToChannels((chs) => {
      setChannels(chs);
    });

    const unsubscribeFollowing = subscribeToUserFollowingChannels(
      authUid,
      (followingIds) => {
        setFollowingChannelIds(followingIds);
      }
    );

    return () => {
      unsubscribeChannels();
      unsubscribeFollowing();
    };
  }, [currentUserAuth?.uid, isProfileReady]);

  // 3b2. 🔔 Realtime Channel Notifications Listener
  useEffect(() => {
    if (!currentUserAuth?.uid) {
      setChannelNotifications([]);
      return;
    }

    const unsubscribeNotifs = subscribeToUserChannelNotifications(
      currentUserAuth.uid,
      (notifs) => {
        setChannelNotifications(notifs);
      }
    );

    return () => unsubscribeNotifs();
  }, [currentUserAuth?.uid]);

  // 3c. 👑 Aktif Kanal Kuruculuk Kontrolü (Owner Check)
  const isUserAnAdmin = Boolean(
    currentUserProfile &&
      (currentUserProfile.role === 'admin' ||
        (currentUserAuth?.email
          ? ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(currentUserAuth.email.toLowerCase())
          : false))
  );

  useEffect(() => {
    let isMounted = true;
    const profileUid = currentUserProfile?.uid;
    if (!activeChannelId || !profileUid) {
      setIsCurrentChannelOwner(false);
      return;
    }

    if (isUserAnAdmin) {
      setIsCurrentChannelOwner(true);
      return;
    }

    checkIsChannelOwner(activeChannelId, profileUid, isUserAnAdmin)
      .then((isOwner) => {
        if (isMounted) setIsCurrentChannelOwner(isOwner);
      })
      .catch((err) => {
        console.error('Kanal sahiplik kontrolü hatası:', err);
        if (isMounted) setIsCurrentChannelOwner(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeChannelId, currentUserProfile?.uid, isUserAnAdmin]);

  // Aktif sohbet açıldığında, o sohbete ait açık bildirimi otomatik kapat
  useEffect(() => {
    if (activeConversationId && bannerNotification?.conversationId === activeConversationId) {
      setBannerNotification(null);
    }
  }, [activeConversationId, bannerNotification?.conversationId]);

  const isFirstConvSnapshotRef = React.useRef(true);

  // 4. Realtime Conversations Listener
  useEffect(() => {
    const authUid = currentUserAuth?.uid;
    if (!authUid || !isProfileReady) return;

    const unsubscribeConv = subscribeToConversations(
      authUid,
      async (convs) => {
        setConversations(convs);

        // Sayfa ilk yüklendiğinde eski mesajlar için bildirim patlaması olmasını engelle
        if (isFirstConvSnapshotRef.current) {
          convs.forEach((c) => {
            let msgTime = 0;
            if (c.lastMessageTimestamp?.toMillis) {
              msgTime = c.lastMessageTimestamp.toMillis();
            } else if (c.lastMessageTimestamp?.seconds) {
              msgTime = c.lastMessageTimestamp.seconds * 1000;
            }
            lastSeenMsgTimestampsRef.current[c.id] = msgTime;
          });
          isFirstConvSnapshotRef.current = false;
          return;
        }

        // Yeni mesaj gelen konuşmaları tespit et ve WhatsApp bildirimini güncelle
        for (const c of convs) {
          let msgTime = 0;
          if (c.lastMessageTimestamp?.toMillis) {
            msgTime = c.lastMessageTimestamp.toMillis();
          } else if (c.lastMessageTimestamp?.seconds) {
            msgTime = c.lastMessageTimestamp.seconds * 1000;
          }

          // Eğer kullanıcı şu an bu sohbetteyse:
          if (c.id === activeConversationId) {
            // Canlı olarak gördüğü için zaman damgasını son mesaja eşitle
            if (msgTime > (lastSeenMsgTimestampsRef.current[c.id] || 0)) {
              lastSeenMsgTimestampsRef.current[c.id] = msgTime;
            }
            // Aktif sohbetteyken unreadCount varsa Firestore'da sıfırla
            const unreadCount = c.unreadCounts?.[authUid] || 0;
            if (unreadCount > 0 && currentUserProfileRef.current?.role !== 'moderator') {
              updateDoc(doc(db, 'conversations', c.id), {
                [`unreadCounts.${authUid}`]: 0,
              }).catch(() => {});
            }
            continue;
          }

          const unreadCount = c.unreadCounts?.[authUid] || 0;
          if (unreadCount <= 0) {
            // Başka bir cihazda (telefon, tablet vb.) mesaj okunduysa banner'ı anında kapat!
            setBannerNotification((prev) => (prev?.conversationId === c.id ? null : prev));
            continue;
          }
          if (!c.lastMessageSenderId || c.lastMessageSenderId === authUid) continue;
          // 🚫 Engellenen kullanıcıdan gelen mesajlar için banner ve tarayıcı bildirimi üretme!
          if (blockedUserIdsRef.current.includes(c.lastMessageSenderId)) continue;

          const lastSeen = lastSeenMsgTimestampsRef.current[c.id] || 0;
          if (msgTime > lastSeen) {
            lastSeenMsgTimestampsRef.current[c.id] = msgTime;

            try {
              const unreadList = await getGroupedUnreadMessages(
                c.id,
                authUid,
                c.lastMessageSenderId,
                c.lastMessageText || 'Yeni mesaj'
              );

              // Gerçekte okunmamış mesaj kalmamışsa bildirim üretme ve Firestore'daki tutarsız sayıyı düzelt
              if (unreadList.length === 0) {
                if (unreadCount > 0 && currentUserProfileRef.current?.role !== 'moderator') {
                  updateDoc(doc(db, 'conversations', c.id), {
                    [`unreadCounts.${authUid}`]: 0,
                  }).catch(() => {});
                }
                continue;
              }

              // Çift bildirim koruması: En son mesaj ID'si bu oturumda zaten bildirildiyse tekrar etme
              const latestMsgId = unreadList[unreadList.length - 1]?.id;
              if (latestMsgId && notifiedMessageIdsRef.current.has(latestMsgId)) {
                continue;
              }
              if (latestMsgId) {
                notifiedMessageIdsRef.current.add(latestMsgId);
              }

              const senderInfo = c.participants?.[c.lastMessageSenderId];
              const senderName = senderInfo?.displayName || senderInfo?.username || 'Kullanıcı';

              setBannerNotification((prev) => {
                if (prev && prev.conversationId === c.id) {
                  const map = new Map<string, GroupedNotificationMessage>();
                  prev.messages.forEach((m) => map.set(m.text + m.time, m));
                  unreadList.forEach((m) => map.set(m.text + m.time, m));
                  return {
                    ...prev,
                    messages: Array.from(map.values()),
                    updatedAt: Date.now(),
                  };
                }
                return {
                  conversationId: c.id,
                  senderId: c.lastMessageSenderId!,
                  senderName,
                  senderPhoto: senderInfo?.photoURL || null,
                  isGroup: !!c.isGroup,
                  groupName: c.name,
                  messages: unreadList,
                  updatedAt: Date.now(),
                };
              });

              // Sistem sekmesi odakta değilse native tarayıcı bildirimi göster
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
                const notifTitle = unreadList.length > 1
                  ? (c.isGroup && c.name ? `${c.name} (${unreadList.length} yeni mesaj)` : `${senderName} (${unreadList.length} yeni mesaj)`)
                  : (c.isGroup && c.name ? c.name : senderName);

                const notifBody = unreadList.length > 1
                  ? unreadList.map((m) => `${m.text}  ${m.time}`).join('\n')
                  : unreadList[0]?.text || 'Yeni mesaj';

                const notif = new Notification(notifTitle, {
                  body: notifBody,
                  icon: senderInfo?.photoURL || '/ai-petal.png',
                  tag: c.id,
                  renotify: true,
                } as any);

                notif.onclick = () => {
                  window.focus();
                  setActiveConversationId(c.id);
                  notif.close();
                };
              }
            } catch (err) {
              console.warn('Realtime bildirim gruplama hatası:', err);
            }
          }
        }
      }
    );

    return () => unsubscribeConv();
  }, [currentUserAuth?.uid, isProfileReady, activeConversationId]);

  // 5. App Settings Listener (Kalıcı Mavi Tik PNG & Genel Ayarlar)
  useEffect(() => {
    if (!currentUserAuth?.uid || !isProfileReady) return;

    const unsubscribeSettings = subscribeToAppSettings((settings) => {
      setAppSettings(settings);
      if (settings?.verifiedBadgeUrl) {
        preloadBadgeImage(settings.verifiedBadgeUrl);
      }
    });

    return () => unsubscribeSettings();
  }, [currentUserAuth?.uid, isProfileReady]);

  // 🛡️ Yetkili Admin Otomatik Eşitlemesi (gg00cat73@gmail.com ve robloxenes930@gmail.com)
  useEffect(() => {
    const authUid = currentUserAuth?.uid;
    const authEmail = currentUserAuth?.email?.trim().toLowerCase();
    if (!authUid || !currentUserProfile?.uid) return;
    const isSpecialAdmin = authEmail && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(authEmail);
    if (isSpecialAdmin && currentUserProfile.role !== 'admin') {
      const userRef = doc(db, 'users', authUid);
      updateDoc(userRef, { role: 'admin', isVerified: true }).catch((err) => {
        console.warn('Admin rolü senkronizasyonu:', err);
      });
    }
  }, [currentUserAuth?.uid, currentUserAuth?.email, currentUserProfile?.uid, currentUserProfile?.role]);

  // 🛡️ Muse Moderatör Yetkisi Gerçek Zamanlı Dinleme & Sunucu Doğrulaması
  useEffect(() => {
    if (!currentUserAuth?.uid || currentUserAuth.uid !== MUSE_MODERATOR_UID) {
      setModeratorGrantActive(null);
      setServerVerifiedModerator(false);
      return;
    }

    const unsubGrant = subscribeToModeratorGrant(currentUserAuth.uid, (grant) => {
      setModeratorGrantActive(Boolean(grant?.active));
    });

    return () => unsubGrant();
  }, [currentUserAuth?.uid]);

  useEffect(() => {
    let cancelled = false;
    if (!currentUserAuth?.uid) {
      setServerVerifiedModerator(false);
      return;
    }
    if (currentUserAuth.uid !== MUSE_MODERATOR_UID && currentUserProfile?.role !== 'moderator') {
      setServerVerifiedModerator(false);
      return;
    }

    verifyModeratorAuthority()
      .then((res) => {
        if (!cancelled) {
          setServerVerifiedModerator(Boolean(res.isModerator));
        }
      })
      .catch(() => {
        if (!cancelled) setServerVerifiedModerator(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserAuth?.uid, currentUserProfile?.role, moderatorGrantActive]);

  // Yetkisi kaldırılan moderatör #/admin ekranındaysa anında sohbete döndür
  useEffect(() => {
    const profile = currentUserProfileRef.current;
    if (!profile) return;
    const onAdminHash = currentHash === '#/admin' || currentHash.startsWith('#/admin');
    if (onAdminHash && !isUserAdmin(profile) && !(isUserModerator(profile) && serverVerifiedModerator)) {
      // İlk doğrulama henüz tamamlanmadıysa hemen yönlendirme yapma (yalnızca grant kesin kapalıysa veya rolü user'a düştüyse)
      if (profile.role !== 'moderator' || moderatorGrantActive === false) {
        window.location.hash = '#/';
      }
    }
  }, [currentHash, currentUserProfile?.uid, currentUserProfile?.role, currentUserProfile?.email, serverVerifiedModerator, moderatorGrantActive]);

  // ⏱️ Geçici Ban & Susturma Süresi Dolduğunda Otomatik Sunucu Senkronizasyonu
  useEffect(() => {
    if (!currentUserAuth?.uid || !currentUserProfile) return;

    const banExpMs =
      currentUserProfile.isBanned && currentUserProfile.banType === 'temporary'
        ? toTimestampMs(currentUserProfile.banExpiresAt)
        : 0;
    const muteExpMs =
      currentUserProfile.isMuted && currentUserProfile.muteType === 'temporary'
        ? toTimestampMs(currentUserProfile.muteExpiresAt)
        : 0;

    const candidates = [banExpMs, muteExpMs].filter((ms) => ms > 0);
    if (candidates.length === 0) return;

    const nowMs = Date.now();
    const earliestMs = Math.min(...candidates);

    if (earliestMs <= nowMs) {
      checkModerationExpiry().catch(() => {});
      return;
    }

    const delayMs = Math.min(earliestMs - nowMs + 1000, 2147483000);
    const timer = setTimeout(() => {
      checkModerationExpiry().catch(() => {});
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    currentUserAuth?.uid,
    currentUserProfile?.isBanned,
    currentUserProfile?.banType,
    currentUserProfile?.banExpiresAt,
    currentUserProfile?.isMuted,
    currentUserProfile?.muteType,
    currentUserProfile?.muteExpiresAt,
  ]);

  // Foreground Push Notification Listener (WhatsApp Tarzı Gruplama Destekli)
  useEffect(() => {
    if (!currentUserAuth?.uid) return;
    
    let unsubscribe: any = null;
    setupForegroundListener((payload) => {
      const data = payload.data;
      if (!data || !data.conversationId) return;

      // Eğer kullanıcı şu anda bu sohbetteyse bildirim gösterme
      if (data.conversationId === activeConversationId) {
        return;
      }
      
      let parsedMessages: GroupedNotificationMessage[] = [];
      if (data.messagesJson) {
        try {
          parsedMessages = JSON.parse(data.messagesJson);
        } catch (e) {
          console.warn('messagesJson ayrıştırma hatası:', e);
        }
      }

      if (parsedMessages.length === 0) {
        const text = payload.notification?.body || data.body || 'Yeni mesaj';
        const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        parsedMessages = [{ text, time: nowTime }];
      }

      // WhatsApp Açılır Bildirim Kartını göster/güncelle
      setBannerNotification((prev) => {
        if (prev && prev.conversationId === data.conversationId) {
          const map = new Map<string, GroupedNotificationMessage>();
          prev.messages.forEach((m) => map.set(m.text + m.time, m));
          parsedMessages.forEach((m) => map.set(m.text + m.time, m));
          return {
            ...prev,
            messages: Array.from(map.values()),
            updatedAt: Date.now(),
          };
        }

        return {
          conversationId: data.conversationId,
          senderId: data.senderId || '',
          senderName: data.senderName || payload.notification?.title || 'RedChat',
          senderPhoto: data.senderPhoto || null,
          isGroup: data.isGroup === 'true',
          groupName: data.groupName || undefined,
          messages: parsedMessages,
          updatedAt: Date.now(),
        };
      });

      // Sekme arka plandaysa native tarayıcı bildirimi göster
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const title = payload.notification?.title || data.senderName || 'RedChat';
        const notifBody = parsedMessages.length > 1
          ? parsedMessages.map((m) => `${m.text}  ${m.time}`).join('\n')
          : parsedMessages[0]?.text || 'Yeni mesaj';

        const notif = new Notification(title, {
          body: notifBody,
          icon: data.senderPhoto || '/ai-petal.png',
          data: payload.data,
          tag: data.conversationId,
          renotify: true,
        } as any);

        notif.onclick = () => {
          window.focus();
          setActiveConversationId(data.conversationId);
          notif.close();
        };
      }
    }).then((unsub) => {
      unsubscribe = unsub;
    }).catch(console.error);
    
    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') unsubscribe();
    };
  }, [currentUserAuth?.uid, activeConversationId]);

  // DeepRed AI hesabını kullanıcı listesine dahil et (Tüm kullanıcılar görebilsin ve doğrudan sohbet başlatabilsin)
  const displayedUsers = React.useMemo(() => {
    const aiUser = getRedChatAIProfile(appSettings?.aiProfilePhotoUrl);
    const existingAiIndex = allUsers.findIndex((u) => u.uid === aiUser.uid);
    if (existingAiIndex >= 0) {
      // Eğer veritabanında varsa ve appSettings fotoğrafı tanımlıysa birleştir
      const list = [...allUsers];
      list[existingAiIndex] = {
        ...list[existingAiIndex],
        displayName: aiUser.displayName,
        username: aiUser.username,
        photoURL: appSettings?.aiProfilePhotoUrl || list[existingAiIndex].photoURL || null,
        isSystemAI: true,
        isVerified: true,
        isOnline: true,
      };
      return list;
    }
    return [aiUser, ...allUsers];
  }, [allUsers, appSettings?.aiProfilePhotoUrl]);

  // Sohbet başlatma (Kullanıcı seçildiğinde)
  const handleSelectUser = async (targetUser: UserProfile) => {
    if (!currentUserProfile) return;

    try {
      const convId = await getOrCreateDirectConversation(
        currentUserProfile,
        targetUser
      );
      setActiveConversationId(convId);
    } catch (err) {
      console.error('Sohbet başlatılamadı:', err);
    }
  };

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  ) || null;

  const effectiveInspectingUser = inspectingUser
    ? inspectingUser.uid === currentUserProfile?.uid
      ? currentUserProfile
      : displayedUsers.find((u) => u.uid === inspectingUser.uid) || inspectingUser
    : null;

  const [showNotifBanner, setShowNotifBanner] = useState(() => {
    return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default' && localStorage.getItem('redchat_notif_banner_dismissed') !== 'true';
  });

  const handleEnableNotifications = async () => {
    if (!currentUserProfile) return;
    try {
      await requestNotificationPermissionAndToken(currentUserProfile.uid);
      setShowNotifBanner(false);
    } catch (err) {
      console.error(err);
      setShowNotifBanner(false); // reddedilirse de gizle
    }
  };

  const handleDismissNotifBanner = () => {
    localStorage.setItem('redchat_notif_banner_dismissed', 'true');
    setShowNotifBanner(false);
  };

  // Arka planda otomatik FCM token senkronizasyonu
  useEffect(() => {
    const uid = currentUserProfile?.uid;
    if (uid && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      // Zaten izin verilmişse, sessizce token alıp Firestore'a kaydet
      requestNotificationPermissionAndToken(uid).catch(console.error);
    }
  }, [currentUserProfile?.uid]);

  const handleBanCheckExpiry = useCallback(async () => {
    await checkModerationExpiry();
  }, []);

  const handleOpenChatFromBanner = useCallback((convId: string) => {
    setActiveConversationId(convId);
    setBannerNotification(null);
  }, []);

  const handleDismissBanner = useCallback(() => {
    setBannerNotification(null);
  }, []);

  const handleBackFromChat = useCallback(() => {
    setActiveConversationId(null);
  }, []);

  const handleOpenChatProfile = useCallback((u: UserProfile) => {
    setInspectingUser(u);
    setModalTab('profile');
  }, []);

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold shadow-lg shadow-red-500/20">
            RC
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin text-red-600" />
            Yükleniyor...
          </div>
        </div>
      </div>
    );
  }

  // 🔐 Şifre Sıfırlama Sayfası Kontrolü (URL'de mode=resetPassword veya oobCode varsa)
  const urlParams = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  const hashParams = new URLSearchParams(hashQuery);

  const resetMode = urlParams.get('mode') || hashParams.get('mode');
  const resetOobCode = urlParams.get('oobCode') || hashParams.get('oobCode');
  const resetEmail = urlParams.get('email') || hashParams.get('email');

  if (resetOobCode || resetMode === 'resetPassword') {
    return (
      <ResetPasswordScreen
        oobCode={resetOobCode || ''}
        emailParam={resetEmail}
        onNavigateToLogin={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          window.location.reload();
        }}
      />
    );
  }

  // 🚫 KATI IP & DONANIM BANI EKRANI (Tüm erişimi ve yeni hesap açmayı kilitler)
  if (deviceBanInfo) {
    return (
      <HardwareBannedScreen
        banInfo={deviceBanInfo}
        currentIp={clientIp}
        currentDeviceId={clientHwid}
        currentDeviceType={clientDeviceType}
        onCheckStatus={async () => {
          const ban = await checkDeviceBanNow();
          setDeviceBanInfo(ban);
        }}
      />
    );
  }

  // Giriş Yapılmamışsa -> Auth Formu Göster
  if (!currentUserAuth || (!currentUserProfile && isRegistrationInProgress())) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
        <AuthCard
          securityNotice={sessionRevokedNotice}
          externalError={authExternalError}
          onClearExternalError={() => setAuthExternalError(null)}
          onAuthSuccess={() => {
            setSessionRevokedNotice(null);
            setAuthExternalError(null);
          }}
        />
      </div>
    );
  }

  // Kimlik doğrulanmış ancak profil yüklenememiş / eksik ise sonsuz Loading yerine net hata veya kontrollü yükleme ekranı göster
  if (!currentUserProfile) {
    if (profileError) {
      return (
        <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl max-w-md w-full text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Kullanıcı Profili Yüklenemedi
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                {profileError}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setProfileError(null);
                  setProfileLoading(true);
                  setProfileRetryTick((t) => t + 1);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tekrar Dene</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileError(null);
                  logoutUser().catch(() => {});
                }}
                className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Çıkış Yap</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (profileLoading) {
      return (
        <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center gap-4 p-4">
          <div className="flex items-center gap-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin text-red-600" />
            <span>Profiliniz yükleniyor...</span>
          </div>
          <button
            type="button"
            onClick={() => logoutUser().catch(() => {})}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline cursor-pointer"
          >
            İptal Et ve Giriş Ekranına Dön
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
        <AuthCard
          securityNotice={sessionRevokedNotice}
          externalError={
            authExternalError ||
            'Kullanıcı profiliniz bulunamadı veya okunamadı. Lütfen tekrar giriş yapın.'
          }
          onClearExternalError={() => setAuthExternalError(null)}
          onAuthSuccess={() => {
            setSessionRevokedNotice(null);
            setAuthExternalError(null);
          }}
        />
      </div>
    );
  }

  // 🚫 Ban Ekranı (Hesap süreli veya kalıcı askıya alınmışsa tam ekran açılır)
  if (isUserEffectivelyBanned(currentUserProfile)) {
    return (
      <BannedScreen
        user={currentUserProfile}
        onCheckExpiry={handleBanCheckExpiry}
        onLogout={logoutUser}
      />
    );
  }

  // ✉️ Manuel E-Posta İnceleme Ekranı (Hesap e-posta incelemesine alındıysa sohbet kilitlenir)
  if (currentUserProfile.isEmailInReview) {
    return (
      <EmailReviewScreen
        user={currentUserProfile}
        onLogout={logoutUser}
      />
    );
  }

  // 🌍 Oturum Güvenlik Kontrolü Yükleniyor
  if (sessionCheckLoading && !currentSecuritySession) {
    return (
      <div className="min-h-screen bg-[#0c1317] text-zinc-200 flex flex-col items-center justify-center gap-3 p-4">
        <Loader2 className="w-7 h-7 animate-spin text-red-500" />
        <p className="text-xs font-medium text-zinc-400">Oturum güvenliği doğrulanıyor...</p>
      </div>
    );
  }

  // 🛡️ Admin & Moderatör Panel Route Kontrolü
  const isAdminRoute = currentHash === '#/admin' || currentHash.startsWith('#/admin');

  // 🛡️ Ana Yönetici Kısıtlı Güvenlik İnceleme Modu (Pending oturumda yalnızca Şüpheli Oturumlar açılabilir, sohbetler kilitlidir)
  if (
    currentSecuritySession &&
    currentSecuritySession.status === 'pending_verification' &&
    isUserAnAdmin &&
    serverMainAdmin &&
    isAdminRoute &&
    adminSecurityReviewUnlocked
  ) {
    return (
      <AdminPanel
        currentUser={currentUserProfile}
        allUsers={displayedUsers}
        appSettings={appSettings}
        isVerifiedModerator={false}
        restrictedSecurityReviewOnly={true}
        onReturnToSecurityScreen={() => {
          setAdminSecurityReviewUnlocked(false);
          window.location.hash = '#/';
        }}
        onNavigateHome={() => {
          setAdminSecurityReviewUnlocked(false);
          window.location.hash = '#/';
        }}
      />
    );
  }

  // 🌍 Yeni Ülke / Şüpheli Oturum Güvenlik Ekranı (Karar verilmeden / onaylanmadan sohbet kilitlenir)
  if (currentSecuritySession && currentSecuritySession.status !== 'active') {
    return (
      <NewCountrySecurityScreen
        user={currentUserProfile}
        session={currentSecuritySession}
        onSessionUpdated={(updated) => setCurrentSecuritySession(updated)}
        onEnterAdminSecurityReview={
          isUserAnAdmin && serverMainAdmin
            ? () => {
                setAdminSecurityReviewUnlocked(true);
                window.location.hash = '#/admin';
              }
            : undefined
        }
        onLogout={logoutUser}
      />
    );
  }

  // 🛡️ Admin & Moderatör Panel Route (/#/admin)
  if (isAdminRoute) {
    return (
      <AdminPanel
        currentUser={currentUserProfile}
        allUsers={displayedUsers}
        appSettings={appSettings}
        isVerifiedModerator={serverVerifiedModerator && isUserModerator(currentUserProfile)}
        onNavigateHome={() => {
          window.location.hash = '#/';
        }}
      />
    );
  }

  return (
    <div className="h-full h-[100dvh] w-full max-w-full overflow-hidden flex bg-zinc-100 dark:bg-zinc-950 antialiased">
      {/* 🟢 WhatsApp Tarzı Açılır Gruplanmış Bildirim Kartı */}
      <WhatsAppNotificationBanner
        notification={bannerNotification}
        onOpenChat={handleOpenChatFromBanner}
        onDismiss={handleDismissBanner}
      />

      {showNotifBanner && (
        <div className="absolute top-0 left-0 right-0 z-[100] bg-red-600 text-white px-4 py-2 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">Bildirimleri açarak yeni mesajlardan anında haberdar olun.</span>
            <span className="sm:hidden">Bildirimleri açarak haberdar olun.</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleEnableNotifications} className="px-3 py-1 bg-white text-red-600 rounded-lg text-xs font-bold hover:bg-zinc-100 transition-colors">
              İzin Ver
            </button>
            <button onClick={handleDismissNotifBanner} className="p-1 hover:bg-black/10 rounded-full transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* SOL PANEL (Sidebar) */}
      {(() => {
        const isDetailOpen = Boolean(activeConversationId || activeChannelId);
        const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

        return (
          <>
            <div
              className={`w-full md:w-80 lg:w-96 md:shrink-0 md:flex-shrink-0 h-full ${
                isDetailOpen ? 'hidden md:flex' : 'flex'
              }`}
            >
              <ChatSidebar
                currentUser={currentUserProfile}
                conversations={conversations}
                users={displayedUsers}
                channels={channels}
                userDrafts={userDrafts}
                activeConversationId={activeConversationId}
                activeChannelId={activeChannelId}
                followingChannelIds={followingChannelIds}
                blockedUserIds={blockedUserIds}
                badgeUrl={appSettings?.verifiedBadgeUrl}
                aiProfilePhotoUrl={appSettings?.aiProfilePhotoUrl}
                unreadChannelNotificationsCount={channelNotifications.filter((n) => !n.read).length}
                onOpenChannelNotifications={() => setShowChannelNotificationsModal(true)}
                onSelectConversation={(id) => {
                  setActiveConversationId(id);
                  setActiveChannelId(null);
                }}
                onSelectChannel={(chId) => {
                  setActiveChannelId(chId);
                  setActiveConversationId(null);
                }}
                onCreateChannel={() => setShowCreateChannelModal(true)}
                onSelectUser={handleSelectUser}
                onOpenProfile={(u, tab = 'profile') => {
                  setInspectingUser(u);
                  setModalTab(tab);
                }}
                onCreateGroup={() => setShowCreateGroupModal(true)}
                onLogout={logoutUser}
                onOpenAdmin={() => {
                  window.location.hash = '#/admin';
                }}
              />
            </div>

            {/* SAĞ PANEL (Chat Window veya Channel View) */}
            <div
              className={`w-full md:flex-1 h-full min-w-0 max-w-full overflow-hidden flex flex-col ${
                !isDetailOpen ? 'hidden md:flex' : 'flex'
              }`}
            >
              {activeChannelId && activeChannel ? (
                <ChannelView
                  key={activeChannel.id}
                  channel={activeChannel}
                  currentUser={currentUserProfile}
                  isOwner={isCurrentChannelOwner}
                  isAdmin={isUserAnAdmin}
                  isFollowing={followingChannelIds.includes(activeChannel.id)}
                  badgeUrl={appSettings?.verifiedBadgeUrl}
                  onBack={() => setActiveChannelId(null)}
                  onFollowToggle={async (channelId, follow) => {
                    if (follow) {
                      await followChannel(channelId, currentUserProfile);
                    } else {
                      await unfollowChannel(channelId, currentUserProfile.uid);
                    }
                  }}
                  onOpenManage={(ch) => setManagingChannel(ch)}
                  onDeleteSuccess={() => {
                    setActiveChannelId(null);
                  }}
                />
              ) : activeConversationId ? (
                <ChatWindow
                  key={activeConversationId}
                  conversation={activeConversation}
                  currentUser={currentUserProfile}
                  allUsers={displayedUsers}
                  blockedUserIds={blockedUserIds}
                  badgeUrl={appSettings?.verifiedBadgeUrl}
                  aiProfilePhotoUrl={appSettings?.aiProfilePhotoUrl}
                  onBack={handleBackFromChat}
                  onOpenProfile={handleOpenChatProfile}
                  onUnblockUser={handleUnblockUser}
                />
              ) : (
                <div className="hidden md:flex flex-col items-center justify-center w-full h-full bg-zinc-50/50 dark:bg-zinc-900/50 text-zinc-400 p-8 text-center">
                  <div className="w-16 h-16 rounded-3xl bg-red-100/80 dark:bg-red-950/40 text-red-600 flex items-center justify-center mb-4 shadow-sm">
                    <Radio className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200">
                    RedChat Sohbet ve Kanallar
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mt-1.5 leading-relaxed">
                    Sohbet etmek için soldaki listeden bir konuşma seçin veya güncellemeleri takip etmek için kanallara göz atın.
                  </p>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* 🔔 Kanal Bildirimleri Modalı */}
      {showChannelNotificationsModal && currentUserProfile && (
        <ChannelNotificationsModal
          notifications={channelNotifications}
          channels={channels}
          onClose={() => setShowChannelNotificationsModal(false)}
          onSelectChannel={(chId) => {
            setActiveChannelId(chId);
            setActiveConversationId(null);
          }}
          onMarkAsRead={(notifId) => {
            if (currentUserProfile?.uid) {
              markChannelNotificationAsRead(currentUserProfile.uid, notifId);
            }
          }}
          onMarkAllAsRead={() => {
            if (currentUserProfile?.uid) {
              markAllChannelNotificationsAsRead(currentUserProfile.uid);
            }
          }}
          onClearAll={() => {
            if (currentUserProfile?.uid) {
              clearAllChannelNotifications(currentUserProfile.uid);
            }
          }}
        />
      )}

      {/* 📢 Kanal Oluşturma Modalı */}
      {showCreateChannelModal && currentUserProfile && (
        <CreateChannelModal
          currentUser={currentUserProfile}
          onClose={() => setShowCreateChannelModal(false)}
          onChannelCreated={(newId) => {
            setShowCreateChannelModal(false);
            setActiveChannelId(newId);
            setActiveConversationId(null);
          }}
        />
      )}

      {/* ⚙️ Kanal Yönetim ve Takipçi Modalı */}
      {managingChannel && currentUserProfile && (
        <ChannelManageModal
          channel={managingChannel}
          currentUser={currentUserProfile}
          badgeUrl={appSettings?.verifiedBadgeUrl}
          onClose={() => setManagingChannel(null)}
          onChannelUpdated={(updated) => {
            if (updated) {
              setChannels((prev) =>
                prev.map((c) => (c.id === updated.id ? updated : c))
              );
              setManagingChannel(updated);
            }
          }}
          onChannelDeleted={() => {
            setManagingChannel(null);
            setActiveChannelId(null);
          }}
        />
      )}

      {/* 👥 Grup Oluşturma Modalı */}
      {showCreateGroupModal && currentUserProfile && (
        <CreateGroupModal
          currentUser={currentUserProfile}
          allUsers={displayedUsers}
          users={displayedUsers}
          blockedUserIds={blockedUserIds}
          onClose={() => setShowCreateGroupModal(false)}
          onGroupCreated={(newGroupId) => {
            setActiveConversationId(newGroupId);
            setShowCreateGroupModal(false);
          }}
        />
      )}

      {/* Profil Görüntüleme / Düzenleme / Ayarlar Modalı */}
      {effectiveInspectingUser && (
        <ErrorBoundary>
          <ProfileModal
            user={effectiveInspectingUser}
            isCurrentUser={Boolean(currentUserProfile?.uid && effectiveInspectingUser.uid === currentUserProfile.uid)}
            currentUserId={currentUserProfile?.uid}
            blockedUserIds={blockedUserIds}
            initialTab={modalTab}
            badgeUrl={appSettings?.verifiedBadgeUrl}
            onClose={() => setInspectingUser(null)}
            onStartChat={(target) => {
              handleSelectUser(target);
              setInspectingUser(null);
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

