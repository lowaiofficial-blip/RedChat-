import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile, Conversation, AppSettings, GroupedNotificationData, GroupedNotificationMessage } from './types';
import {
  subscribeToAuthState,
  subscribeToUserProfile,
  subscribeToAllUsers,
  logoutUser,
  setUserOnlineStatus,
} from './services/authService';
import {
  subscribeToConversations,
  getOrCreateDirectConversation,
  getGroupedUnreadMessages,
} from './services/chatService';
import { subscribeToAppSettings, ADMIN_EMAILS } from './services/adminService';
import { setupForegroundListener, requestNotificationPermissionAndToken } from './services/messagingService';
import { db } from './services/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { preloadBadgeImage } from './components/VerifiedBadge';
import { getRedChatAIProfile } from './services/aiService';
import { AuthCard } from './components/AuthCard';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatWindow } from './components/ChatWindow';
import { ProfileModal } from './components/ProfileModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { AdminPanel } from './components/AdminPanel';
import { BannedScreen } from './components/BannedScreen';
import { WhatsAppNotificationBanner } from './components/WhatsAppNotificationBanner';
import { Loader2, Bell, X } from 'lucide-react';

export default function App() {
  const [currentUserAuth, setCurrentUserAuth] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);
  const [modalTab, setModalTab] = useState<'profile' | 'settings'>('profile');
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentHash, setCurrentHash] = useState<string>(window.location.hash || '#/');
  const [bannerNotification, setBannerNotification] = useState<GroupedNotificationData | null>(null);
  const lastSeenMsgTimestampsRef = React.useRef<Record<string, number>>({});

  // 0. Hash Router Listener (/#/admin desteği)
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 1. Firebase Auth State Listener
  useEffect(() => {
    const unsubscribeAuth = subscribeToAuthState((user) => {
      setCurrentUserAuth(user);
      setAuthLoading(false);
      if (!user) {
        setCurrentUserProfile(null);
        setActiveConversationId(null);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Logged-in User Profile Listener
  useEffect(() => {
    if (!currentUserAuth) return;

    const unsubscribeProfile = subscribeToUserProfile(
      currentUserAuth.uid,
      (profile) => {
        setCurrentUserProfile(profile);
      }
    );

    // Kullanıcı online durumunu ayarla ve pencere olaylarını dinle
    setUserOnlineStatus(currentUserAuth.uid, true);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setUserOnlineStatus(currentUserAuth.uid, true);
      } else {
        setUserOnlineStatus(currentUserAuth.uid, false);
      }
    };

    const handleBeforeUnload = () => {
      setUserOnlineStatus(currentUserAuth.uid, false);
    };

    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setUserOnlineStatus(currentUserAuth.uid, true);
      }
    }, 60000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      unsubscribeProfile();
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUserAuth]);

  // 3. Realtime Users List (All registered users in Firestore)
  useEffect(() => {
    if (!currentUserAuth) return;

    const unsubscribeUsers = subscribeToAllUsers((users) => {
      setAllUsers(users);
    });

    return () => unsubscribeUsers();
  }, [currentUserAuth]);

  // Aktif sohbet açıldığında, o sohbete ait açık bildirimi otomatik kapat
  useEffect(() => {
    if (activeConversationId && bannerNotification?.conversationId === activeConversationId) {
      setBannerNotification(null);
    }
  }, [activeConversationId, bannerNotification?.conversationId]);

  const isFirstConvSnapshotRef = React.useRef(true);

  // 4. Realtime Conversations Listener
  useEffect(() => {
    if (!currentUserAuth) return;

    const unsubscribeConv = subscribeToConversations(
      currentUserAuth.uid,
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
          if (c.id === activeConversationId) continue;
          const unreadCount = c.unreadCounts?.[currentUserAuth.uid] || 0;
          if (unreadCount <= 0) continue;
          if (!c.lastMessageSenderId || c.lastMessageSenderId === currentUserAuth.uid) continue;

          let msgTime = 0;
          if (c.lastMessageTimestamp?.toMillis) {
            msgTime = c.lastMessageTimestamp.toMillis();
          } else if (c.lastMessageTimestamp?.seconds) {
            msgTime = c.lastMessageTimestamp.seconds * 1000;
          }

          const lastSeen = lastSeenMsgTimestampsRef.current[c.id] || 0;
          if (msgTime > lastSeen) {
            lastSeenMsgTimestampsRef.current[c.id] = msgTime;

            try {
              const unreadList = await getGroupedUnreadMessages(
                c.id,
                c.lastMessageSenderId,
                c.lastMessageText || 'Yeni mesaj'
              );

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
              if (Notification.permission === 'granted' && document.visibilityState !== 'visible') {
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
  }, [currentUserAuth, activeConversationId]);

  // 5. App Settings Listener (Kalıcı Mavi Tik PNG & Genel Ayarlar)
  useEffect(() => {
    if (!currentUserAuth) return;

    const unsubscribeSettings = subscribeToAppSettings((settings) => {
      setAppSettings(settings);
      if (settings?.verifiedBadgeUrl) {
        preloadBadgeImage(settings.verifiedBadgeUrl);
      }
    });

    return () => unsubscribeSettings();
  }, [currentUserAuth]);

  // 🛡️ Yetkili Admin Otomatik Eşitlemesi (gg00cat73@gmail.com ve robloxenes930@gmail.com)
  useEffect(() => {
    if (!currentUserAuth?.uid || !currentUserProfile) return;
    const authEmail = currentUserAuth.email?.trim().toLowerCase();
    const isSpecialAdmin = authEmail && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(authEmail);
    if (isSpecialAdmin && currentUserProfile.role !== 'admin') {
      const userRef = doc(db, 'users', currentUserAuth.uid);
      updateDoc(userRef, { role: 'admin', isVerified: true }).catch((err) => {
        console.warn('Admin rolü senkronizasyonu:', err);
      });
    }
  }, [currentUserAuth, currentUserProfile]);

  // Foreground Push Notification Listener (WhatsApp Tarzı Gruplama Destekli)
  useEffect(() => {
    if (!currentUserAuth) return;
    
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
      if (Notification.permission === 'granted' && document.visibilityState !== 'visible') {
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
  }, [currentUserAuth, activeConversationId]);

  // RedChat AI hesabını kullanıcı listesine dahil et (Tüm kullanıcılar görebilsin ve doğrudan sohbet başlatabilsin)
  const displayedUsers = React.useMemo(() => {
    const aiUser = getRedChatAIProfile(appSettings?.aiProfilePhotoUrl);
    const existingAiIndex = allUsers.findIndex((u) => u.uid === aiUser.uid);
    if (existingAiIndex >= 0) {
      // Eğer veritabanında varsa ve appSettings fotoğrafı tanımlıysa birleştir
      const list = [...allUsers];
      list[existingAiIndex] = {
        ...list[existingAiIndex],
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
    return 'Notification' in window && Notification.permission === 'default' && localStorage.getItem('redchat_notif_banner_dismissed') !== 'true';
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
    if (currentUserProfile && 'Notification' in window && Notification.permission === 'granted') {
      // Zaten izin verilmişse, sessizce token alıp Firestore'a kaydet
      requestNotificationPermissionAndToken(currentUserProfile.uid).catch(console.error);
    }
  }, [currentUserProfile]);

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

  // Giriş Yapılmamışsa -> Auth Formu Göster
  if (!currentUserAuth || !currentUserProfile) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
        <AuthCard onAuthSuccess={() => {}} />
      </div>
    );
  }

  // 🚫 Ban Ekranı (Hesap askıya alınmışsa ekteki WhatsApp benzeri tam ekran açılır)
  if (currentUserProfile.isBanned) {
    return (
      <BannedScreen
        user={currentUserProfile}
        onLogout={logoutUser}
      />
    );
  }

  // 🛡️ Admin Panel Route (/#/admin)
  const isAdminRoute = currentHash === '#/admin' || currentHash.startsWith('#/admin');
  if (isAdminRoute) {
    return (
      <AdminPanel
        currentUser={currentUserProfile}
        allUsers={displayedUsers}
        appSettings={appSettings}
        onNavigateHome={() => {
          window.location.hash = '#/';
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-zinc-100 dark:bg-zinc-950 antialiased">
      {/* 🟢 WhatsApp Tarzı Açılır Gruplanmış Bildirim Kartı */}
      <WhatsAppNotificationBanner
        notification={bannerNotification}
        onOpenChat={(convId) => {
          setActiveConversationId(convId);
          setBannerNotification(null);
        }}
        onDismiss={() => setBannerNotification(null)}
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
      <div
        className={`w-full md:w-auto h-full ${
          activeConversationId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <ChatSidebar
          currentUser={currentUserProfile}
          conversations={conversations}
          users={displayedUsers}
          activeConversationId={activeConversationId}
          badgeUrl={appSettings?.verifiedBadgeUrl}
          aiProfilePhotoUrl={appSettings?.aiProfilePhotoUrl}
          onSelectConversation={(id) => setActiveConversationId(id)}
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

      {/* SAĞ PANEL (Chat Window) */}
      <div
        className={`w-full md:flex-1 h-full min-w-0 max-w-full overflow-hidden ${
          !activeConversationId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <ChatWindow
          conversation={activeConversation}
          currentUser={currentUserProfile}
          allUsers={displayedUsers}
          badgeUrl={appSettings?.verifiedBadgeUrl}
          aiProfilePhotoUrl={appSettings?.aiProfilePhotoUrl}
          onBack={() => setActiveConversationId(null)}
          onOpenProfile={(u) => {
            setInspectingUser(u);
            setModalTab('profile');
          }}
        />
      </div>

      {/* 👥 Grup Oluşturma Modalı */}
      {showCreateGroupModal && currentUserProfile && (
        <CreateGroupModal
          currentUser={currentUserProfile}
          allUsers={displayedUsers}
          users={displayedUsers}
          onClose={() => setShowCreateGroupModal(false)}
          onGroupCreated={(newGroupId) => {
            setActiveConversationId(newGroupId);
            setShowCreateGroupModal(false);
          }}
        />
      )}

      {/* Profil Görüntüleme / Düzenleme / Ayarlar Modalı */}
      {effectiveInspectingUser && (
        <ProfileModal
          user={effectiveInspectingUser}
          isCurrentUser={effectiveInspectingUser.uid === currentUserProfile.uid}
          initialTab={modalTab}
          badgeUrl={appSettings?.verifiedBadgeUrl}
          onClose={() => setInspectingUser(null)}
          onStartChat={(target) => {
            handleSelectUser(target);
            setInspectingUser(null);
          }}
        />
      )}
    </div>
  );
}

