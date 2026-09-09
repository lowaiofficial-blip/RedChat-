import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { UserProfile, Conversation } from '../types';
import { formatLastSeen } from '../services/chatService';
import { isUserAdmin } from '../services/adminService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import { isRedChatAI, getRedChatAIProfile } from '../services/aiService';
import { SequentialTypingDots } from './SequentialTypingDots';
import { getTypingInfo } from '../utils/typingHelper';
import {
  Search,
  MessageSquare,
  Users,
  Settings,
  User as UserIcon,
  LogOut,
  Flame,
  ChevronUp,
  Image as ImageIcon,
  ShieldAlert,
  Bot,
  Sparkles,
} from 'lucide-react';

interface ChatSidebarProps {
  currentUser: UserProfile;
  conversations: Conversation[];
  users: UserProfile[];
  activeConversationId: string | null;
  badgeUrl?: string | null;
  aiProfilePhotoUrl?: string | null;
  onSelectConversation: (conversationId: string) => void;
  onSelectUser: (user: UserProfile) => void;
  onOpenProfile: (user: UserProfile, tab?: 'profile' | 'settings') => void;
  onCreateGroup: () => void;
  onLogout: () => void;
  onOpenAdmin?: () => void;
}

function formatTime(timestamp: any): string {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  currentUser,
  conversations,
  users,
  activeConversationId,
  badgeUrl,
  aiProfilePhotoUrl,
  onSelectConversation,
  onSelectUser,
  onOpenProfile,
  onCreateGroup,
  onLogout,
  onOpenAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'chats' | 'users'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [now, setNow] = useState<number>(Date.now());

  // Yazıyor durumlarını periyodik kontrol etmek için 1 sn ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const userMenuRef = useRef<HTMLDivElement>(null);

  // 🤖 RedChat AI Kullanıcısını ve Fotoğrafını Belirleme
  const aiUser = useMemo(() => {
    return users.find((u) => isRedChatAI(u)) || null;
  }, [users]);

  const effectiveAiPhoto = aiProfilePhotoUrl || aiUser?.photoURL || null;

  const handleStartAIChat = () => {
    if (aiUser) {
      onSelectUser(aiUser);
    } else {
      onSelectUser(getRedChatAIProfile(aiProfilePhotoUrl));
    }
  };

  // Menü dışına tıklanınca kapatma
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mevcut kullanıcı hariç diğer gerçek kullanıcılar (Banlı olanlar kullanıcılar sekmesinde çıkmamalı)
  const otherUsers = useMemo(() => {
    return users.filter((u) => u.uid !== currentUser.uid && !u.isBanned);
  }, [users, currentUser.uid]);

  // Toplam okunmamış mesaj sayısı
  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unreadCounts?.[currentUser.uid] || 0), 0);
  }, [conversations, currentUser.uid]);

  // Arama filtrelemesi
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return otherUsers;
    return otherUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q)
    );
  }, [otherUsers, searchQuery]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // Banlı kullanıcıların sohbetlerini filtrele:
    // Eğer karşı taraf banlıysa ve şu anda o sohbet açık DEĞİLSE listeden gizlenir.
    // Sohbet açıkken görünür, çıkıldığında gider; ban kaldırıldığında ise mesajlar korunarak geri gelir.
    const visibleConversations = conversations.filter((c) => {
      if (c.isGroup) return true;
      const otherParticipantId = c.participantIds.find((id) => id !== currentUser.uid);
      const userFromList = users.find((u) => u.uid === otherParticipantId);
      if (userFromList?.isBanned) {
        return c.id === activeConversationId;
      }
      return true;
    });

    if (!q) return visibleConversations;
    return visibleConversations.filter((c) => {
      if (c.isGroup) {
        return (
          c.name?.toLowerCase().includes(q) ||
          c.lastMessageText?.toLowerCase().includes(q)
        );
      }
      const otherParticipantId = c.participantIds.find((id) => id !== currentUser.uid);
      const otherInfo = otherParticipantId ? c.participants[otherParticipantId] : null;
      const userFromList = users.find((u) => u.uid === otherParticipantId);
      const displayName = userFromList?.displayName || otherInfo?.displayName;
      const username = userFromList?.username || otherInfo?.username;

      return (
        displayName?.toLowerCase().includes(q) ||
        username?.toLowerCase().includes(q) ||
        c.lastMessageText?.toLowerCase().includes(q)
      );
    });
  }, [conversations, currentUser.uid, searchQuery, users, activeConversationId]);

  return (
    <aside className="relative w-full md:w-80 lg:w-96 flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex-shrink-0">
      {/* Top Brand Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-red-600 to-red-500 flex items-center justify-center text-white shadow-md shadow-red-600/20">
            <Flame className="w-5 h-5 fill-white" />
          </div>
          <div>
            <h1 className="font-black text-lg tracking-tight text-zinc-900 dark:text-white leading-none">
              REDCHAT
            </h1>
            <span className="text-[11px] text-zinc-400 font-medium">
              Sohbet Platformu
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isUserAdmin(currentUser) && (
            <button
              onClick={() => {
                if (onOpenAdmin) onOpenAdmin();
                else window.location.hash = '#/admin';
              }}
              className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Admin Paneli"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          )}

          {/* + Grup Oluştur Hızlı Butonu */}
          <button
            onClick={onCreateGroup}
            className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-900/50 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Yeni Grup Oluştur"
          >
            <Users className="w-3.5 h-3.5" />
            <span>+ Grup</span>
          </button>
        </div>
      </div>

      {/* Modern Search Input */}
      <div className="p-3 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Kullanıcı, grup veya mesaj ara"
            className="w-full pl-10 pr-3.5 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
          />
        </div>
      </div>

      {/* Segment Tabs: Sohbetler vs Kullanıcılar */}
      <div className="px-3 pb-2">
        <div className="grid grid-cols-2 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('chats')}
            className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'chats'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Sohbetler</span>
            {totalUnreadCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[9px] font-bold">
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </span>
            ) : (
              <span className="text-zinc-400">({conversations.length})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'users'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Kullanıcılar ({otherUsers.length})</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/50">
        {activeTab === 'chats' ? (
          // CONVERSATIONS LIST
          filteredConversations.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center text-zinc-400">
              <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
                <MessageSquare className="w-5 h-5 text-zinc-400" />
              </div>
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {searchQuery ? 'Aramanıza uygun sohbet bulunamadı' : 'Henüz sohbet yok.'}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1 mb-4">
                Kullanıcılar sekmesinden mesajlaşabilir veya yeni bir grup oluşturabilirsiniz.
              </p>
              <button
                onClick={onCreateGroup}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Users className="w-3.5 h-3.5" />
                <span>+ Grup Oluştur</span>
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = activeConversationId === conv.id;
              const unreadCount = conv.unreadCounts?.[currentUser.uid] || 0;

              if (conv.isGroup) {
                // 👥 GRUP SOHBETİ KARTI
                const groupName = conv.name || 'Grup';
                const memberCount = conv.participantIds?.length || 0;

                return (
                  <button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-red-50/70 dark:bg-red-950/20 border-l-4 border-red-600'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      {conv.photoURL ? (
                        <UserAvatar
                          photoURL={conv.photoURL}
                          name={groupName}
                          size="lg"
                          shape="rounded"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-600 to-red-700 text-white flex items-center justify-center shadow-xs">
                          <Users className="w-5 h-5" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                            {groupName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 font-semibold shrink-0">
                            Grup
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-mono flex-shrink-0 ml-2 ${
                            unreadCount > 0
                              ? 'text-red-600 dark:text-red-400 font-bold'
                              : 'text-zinc-400'
                          }`}
                        >
                          {formatTime(conv.lastMessageTimestamp || conv.updatedAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1.5">
                        <div
                          className={`text-[11px] truncate flex items-center gap-1 min-w-0 ${
                            unreadCount > 0
                              ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {(() => {
                            const hasImage = Boolean(
                              conv.lastMessageHasImage ||
                              conv.lastMessageImageUrl ||
                              conv.lastMessageText === 'Fotoğraf' ||
                              conv.lastMessageText?.startsWith('📷') ||
                              conv.lastMessageText?.startsWith('[Fotoğraf]')
                            );

                            const raw = conv.lastMessageText || 'Grup oluşturuldu';
                            const cleanText = raw.replace(/^📷\s*/, '').trim();

                            if (hasImage) {
                              const displayText = cleanText || 'Fotoğraf';
                              return (
                                <div className="flex items-center gap-1 min-w-0 truncate">
                                  <ImageIcon className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                  <span className="truncate">{displayText}</span>
                                </div>
                              );
                            }
                            return <span className="truncate">{raw}</span>;
                          })()}
                        </div>

                        {unreadCount > 0 ? (
                          <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs animate-in zoom-in-95">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                            {memberCount} üye
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              }

              // 👤 BİREBİR SOHBET KARTI
              const otherParticipantId = conv.participantIds.find((id) => id !== currentUser.uid);
              const otherUserObj = users.find((u) => u.uid === otherParticipantId);
              const otherInfo = otherParticipantId ? conv.participants[otherParticipantId] : null;
              const isAi = isRedChatAI(otherUserObj || otherParticipantId);
              const isOnline = isAi ? true : (otherUserObj?.isOnline ?? false);

              const displayName = isAi
                ? 'RedChat AI'
                : (otherUserObj?.displayName || otherInfo?.displayName || otherUserObj?.username || otherInfo?.username || 'Kullanıcı');
              const username = isAi
                ? 'redchat_ai'
                : (otherUserObj?.username || otherInfo?.username || '');
              const photoURL = otherUserObj?.photoURL || otherInfo?.photoURL || null;
              const isVerified = isAi ? true : Boolean(otherUserObj?.isVerified);

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-red-50/70 dark:bg-red-950/20 border-l-4 border-red-600'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <UserAvatar
                      photoURL={photoURL}
                      name={displayName}
                      username={username}
                      size="lg"
                      shape="circle"
                    />
                    {!isAi && (
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${
                          isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                        }`}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                          {displayName}
                        </span>
                        <VerifiedBadge
                          isVerified={isVerified}
                          badgeUrl={badgeUrl}
                          size="sm"
                          user={{
                            displayName,
                            username,
                            photoURL: otherUserObj?.photoURL || otherInfo?.photoURL || null,
                          }}
                        />
                      </div>
                      <span
                        className={`text-[10px] font-mono flex-shrink-0 ml-2 ${
                          unreadCount > 0
                            ? 'text-red-600 dark:text-red-400 font-bold'
                            : 'text-zinc-400'
                        }`}
                      >
                        {formatTime(conv.lastMessageTimestamp || conv.updatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-1.5">
                      <div
                        className={`text-[11px] truncate flex items-center gap-1 min-w-0 ${
                          unreadCount > 0
                            ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {(() => {
                          const convTypingInfo = getTypingInfo(
                            conv.typingUsers,
                            currentUser.uid,
                            conv.isGroup,
                            conv.participants,
                            users,
                            now
                          );

                          if (convTypingInfo) {
                            return (
                              <div className="flex items-center gap-1 min-w-0 truncate text-red-600 dark:text-red-400 font-medium">
                                <span className="truncate">{convTypingInfo.displayText}</span>
                                <SequentialTypingDots size="xs" className="text-red-600 dark:text-red-400" />
                              </div>
                            );
                          }

                          const hasImage = Boolean(
                            conv.lastMessageHasImage ||
                            conv.lastMessageImageUrl ||
                            conv.lastMessageText === 'Fotoğraf' ||
                            conv.lastMessageText?.startsWith('📷') ||
                            conv.lastMessageText?.startsWith('[Fotoğraf]')
                          );

                          const raw = conv.lastMessageText || 'Sohbet başlatıldı';
                          const cleanText = raw.replace(/^📷\s*/, '').trim();

                          if (hasImage) {
                            const displayText = cleanText || 'Fotoğraf';
                            return (
                              <div className="flex items-center gap-1 min-w-0 truncate">
                                <ImageIcon className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                <span className="truncate">{displayText}</span>
                              </div>
                            );
                          }
                          return <span className="truncate">{raw}</span>;
                        })()}
                      </div>

                      {/* Okunmamış Kırmızı Badge */}
                      {unreadCount > 0 ? (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs animate-in zoom-in-95">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-400 font-mono truncate">
                          @{username}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )
        ) : (
          // 👥 USERS LIST (DOĞRUDAN SOHBET BAŞLATMA)
          <>
            {/* Üstte + Grup Oluştur Banner Butonu */}
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border-b border-zinc-100 dark:border-zinc-800">
              <button
                onClick={onCreateGroup}
                className="w-full py-2 px-3 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
              >
                <Users className="w-4 h-4 text-red-600" />
                <span>+ Yeni Grup Oluştur</span>
              </button>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center text-zinc-400">
                <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-zinc-400" />
                </div>
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  {searchQuery ? 'Aramanıza uygun kullanıcı bulunamadı' : 'Henüz başka kullanıcı kayıtlı değil.'}
                </p>
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isAi = isRedChatAI(user);
                return (
                  <div
                    key={user.uid}
                    className="w-full p-3.5 flex items-center justify-between gap-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    {/* Profil Açma */}
                    <button
                      onClick={() => onOpenProfile(user)}
                      className="flex items-center gap-3 min-w-0 text-left flex-1 cursor-pointer"
                    >
                      <div className="relative flex-shrink-0">
                        <UserAvatar
                          photoURL={user.photoURL}
                          name={user.displayName}
                          username={user.username}
                          size="md"
                          shape="circle"
                        />
                        {!isAi && (
                          <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                              user.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                            }`}
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                            {user.displayName || user.username}
                          </span>
                          <VerifiedBadge
                            isVerified={user.isVerified || isAi}
                            badgeUrl={badgeUrl}
                            size="sm"
                            user={{
                              displayName: user.displayName || user.username,
                              username: user.username,
                              photoURL: user.photoURL,
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                          {isAi ? (
                            <span className="text-zinc-500 dark:text-zinc-400 font-medium truncate">
                              @{user.username || 'redchat_ai'}
                            </span>
                          ) : (
                            <>
                              <span className="text-red-600 font-medium truncate">@{user.username}</span>
                              <span>•</span>
                              <span className={user.isOnline ? 'text-emerald-600 font-medium' : 'text-zinc-400'}>
                                {formatLastSeen(user.isOnline, user.lastSeen)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* 💬 DOĞRUDAN SOHBET BUTONU */}
                    <button
                      onClick={() => onSelectUser(user)}
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 bg-red-600 hover:bg-red-700"
                      title={isAi ? 'RedChat AI ile Sohbet Et' : 'Doğrudan Sohbet Başlat'}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Sohbet Et</span>
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Alt Kullanıcı Menüsü */}
      <div className="relative border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2" ref={userMenuRef}>
        {userMenuOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-xl p-1.5 animate-in fade-in slide-in-from-bottom-2 z-30">
            {isUserAdmin(currentUser) && (
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  if (onOpenAdmin) {
                    onOpenAdmin();
                  } else {
                    window.location.hash = '#/admin';
                  }
                }}
                className="w-full px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer mb-1 border border-red-200/60 dark:border-red-900/40"
              >
                <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span>Admin Paneli</span>
              </button>
            )}
            <button
              onClick={() => {
                setUserMenuOpen(false);
                onOpenProfile(currentUser, 'profile');
              }}
              className="w-full px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <UserIcon className="w-4 h-4 text-zinc-400" />
              <span>Profil</span>
            </button>
            <button
              onClick={() => {
                setUserMenuOpen(false);
                onOpenProfile(currentUser, 'settings');
              }}
              className="w-full px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4 text-zinc-400" />
              <span>Ayarlar</span>
            </button>
            <button
              onClick={() => {
                setUserMenuOpen(false);
                onCreateGroup();
              }}
              className="w-full px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4 text-zinc-400" />
              <span>Grup Oluştur</span>
            </button>
            <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
            <button
              onClick={() => {
                setUserMenuOpen(false);
                onLogout();
              }}
              className="w-full px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Çıkış Yap</span>
            </button>
          </div>
        )}

        {/* Kullanıcı Bilgi Butonu */}
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="w-full p-2 rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex-shrink-0">
              <UserAvatar
                photoURL={currentUser.photoURL}
                name={currentUser.displayName}
                username={currentUser.username}
                size="sm"
                shape="circle"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 bg-emerald-500" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                  {currentUser.displayName || currentUser.username}
                </span>
                <VerifiedBadge
                  isVerified={currentUser.isVerified}
                  badgeUrl={badgeUrl}
                  size="sm"
                  user={{
                    displayName: currentUser.displayName || currentUser.username,
                    username: currentUser.username,
                    photoURL: currentUser.photoURL,
                  }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 font-mono truncate">
                @{currentUser.username}
              </div>
            </div>
          </div>
          <ChevronUp className={`w-4 h-4 text-zinc-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* 🌸 WhatsApp Tarzı Sağ Altta Kayan RedChat AI Butonu (Kompakt ve Zarif) */}
      <button
        id="whatsapp-ai-floating-btn"
        onClick={handleStartAIChat}
        title="RedChat AI ile Sohbet Et"
        className="absolute right-4 bottom-18 z-20 w-10 h-10 rounded-xl bg-zinc-900/95 dark:bg-zinc-800 text-white shadow-lg shadow-black/40 border border-zinc-700/80 hover:border-red-500/80 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center p-1 group cursor-pointer"
      >
        {effectiveAiPhoto ? (
          <img
            src={effectiveAiPhoto}
            alt="RedChat AI"
            className="w-full h-full object-cover rounded-[9px] pointer-events-none group-hover:brightness-110 transition-all"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center rounded-[9px] bg-gradient-to-tr from-red-600/30 via-zinc-800 to-red-500/20">
            <Sparkles className="w-4 h-4 text-red-500 group-hover:scale-110 transition-transform" />
          </div>
        )}
        {/* WhatsApp AI Parıltı Rozeti */}
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-gradient-to-tr from-red-500 via-rose-500 to-amber-400 rounded-full border border-white dark:border-zinc-900 shadow-xs" />
      </button>
    </aside>
  );
};
