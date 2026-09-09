import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile, Conversation, AppSettings } from './types';
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
} from './services/chatService';
import { subscribeToAppSettings, ADMIN_EMAILS } from './services/adminService';
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
import { Loader2 } from 'lucide-react';

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

  // 4. Realtime Conversations Listener
  useEffect(() => {
    if (!currentUserAuth) return;

    const unsubscribeConv = subscribeToConversations(
      currentUserAuth.uid,
      (convs) => {
        setConversations(convs);
      }
    );

    return () => unsubscribeConv();
  }, [currentUserAuth]);

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
        className={`w-full md:flex-1 h-full ${
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

