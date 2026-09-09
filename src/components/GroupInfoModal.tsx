import React, { useState, useMemo, useRef } from 'react';
import type { Conversation, UserProfile, GroupRole } from '../types';
import {
  getUserRoleInGroup,
  getSafeUserName,
  leaveGroup,
  addMembersToGroup,
  removeMemberFromGroup,
  makeMemberAdmin,
  removeMemberAdmin,
  transferGroupOwnership,
  updateGroupName,
  updateGroupPhoto,
  formatLastSeen,
} from '../services/chatService';
import { uploadImageToImgBB } from '../services/imageUploadService';
import { UserAvatar } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import {
  X,
  Users,
  Crown,
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  UserMinus,
  LogOut,
  Loader2,
  AlertTriangle,
  Edit2,
  Check,
  Camera,
  Trash2,
  Search,
  MoreVertical,
  ChevronRight,
  User as UserIcon,
  CheckCircle2,
} from 'lucide-react';

interface GroupInfoModalProps {
  conversation: Conversation;
  currentUser: UserProfile;
  allUsers?: UserProfile[];
  users?: UserProfile[];
  badgeUrl?: string | null;
  onClose: () => void;
  onLeaveSuccess?: () => void;
  onLeftGroup?: () => void;
  onOpenUserProfile?: (user: UserProfile) => void;
}

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  conversation,
  currentUser,
  allUsers,
  users,
  badgeUrl,
  onClose,
  onLeaveSuccess,
  onLeftGroup,
  onOpenUserProfile,
}) => {
  const rawUsers = allUsers || users || [];

  // Mevcut kullanıcının rolu
  const currentUserRole = useMemo(() => {
    return getUserRoleInGroup(conversation, currentUser.uid);
  }, [conversation, currentUser.uid]);

  const isOwner = currentUserRole === 'owner';
  const isAdmin = currentUserRole === 'admin';
  const canManage = isOwner || isAdmin;

  // Grup adı düzenleme
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(conversation.name || '');
  const [savingName, setSavingName] = useState(false);

  // Grup fotoğrafı düzenleme
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Üye arama
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Üye Ekleme Modalı / Görünümü
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [selectedUserIdsToAdd, setSelectedUserIdsToAdd] = useState<string[]>([]);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);

  // Aksiyon / Onay Diyalogları
  const [actionMenuUserId, setActionMenuUserId] = useState<string | null>(null);

  // Kuruculuk Devri Onayı
  const [transferTargetUser, setTransferTargetUser] = useState<{ uid: string; name: string } | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Üye Çıkarma Onayı
  const [kickTargetUser, setKickTargetUser] = useState<{ uid: string; name: string } | null>(null);
  const [kicking, setKicking] = useState(false);

  // Gruptan Ayrılma Durumu
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Genel Hata ve Bildirim Mesajı
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const participantIds = conversation.participantIds || [];

  // Katılımcı detayları
  const members = useMemo(() => {
    return participantIds.map((uid) => {
      const userObj = rawUsers.find((u) => u.uid === uid);
      const participantInfo = conversation.participants?.[uid];
      const role = getUserRoleInGroup(conversation, uid);

      const displayName = getSafeUserName(userObj || participantInfo, 'Kullanıcı');
      const username = userObj?.username || participantInfo?.username || 'kullanici';
      const photoURL = userObj?.photoURL || participantInfo?.photoURL || null;
      const isOnline = userObj?.isOnline ?? false;
      const lastSeen = userObj?.lastSeen || null;
      const isCurrent = currentUser.uid === uid;

      return {
        uid,
        displayName,
        username,
        photoURL,
        role,
        isOnline,
        lastSeen,
        isCurrent,
        userObj,
      };
    });
  }, [participantIds, rawUsers, conversation, currentUser.uid]);

  // Filtrelenmiş üyeler
  const filteredMembers = useMemo(() => {
    const q = memberSearchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q)
    );
  }, [members, memberSearchQuery]);

  // Henüz grupta olmayan kullanıcılar (Üye ekleme için)
  const availableUsersToAdd = useMemo(() => {
    const existingSet = new Set(participantIds);
    const nonMembers = rawUsers.filter((u) => !existingSet.has(u.uid) && u.uid !== currentUser.uid);

    const q = addSearchQuery.trim().toLowerCase();
    if (!q) return nonMembers;
    return nonMembers.filter(
      (u) =>
        u.displayName?.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [rawUsers, participantIds, currentUser.uid, addSearchQuery]);

  const showFeedback = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } else {
      setSuccessNotice(msg);
      setTimeout(() => setSuccessNotice(null), 3000);
    }
  };

  // 1. Grup Adını Güncelle
  const handleSaveGroupName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || savingName) return;
    const cleanName = editedName.trim();
    if (!cleanName) {
      showFeedback('Grup adı boş bırakılamaz', true);
      return;
    }

    setSavingName(true);
    setError(null);
    try {
      await updateGroupName(conversation.id, currentUser, cleanName);
      setIsEditingName(false);
      showFeedback('Grup adı güncellendi');
    } catch (err: any) {
      console.error('Grup adı güncellenemedi:', err);
      showFeedback(err?.message || 'Grup adı güncellenirken hata oluştu', true);
    } finally {
      setSavingName(false);
    }
  };

  // 2. Grup Fotoğrafını Değiştir
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canManage) return;

    if (!file.type.startsWith('image/')) {
      showFeedback('Lütfen geçerli bir görsel dosyası seçin.', true);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showFeedback('Görsel boyutu en fazla 10MB olabilir.', true);
      return;
    }

    setUploadingPhoto(true);
    setError(null);
    try {
      const uploadedUrl = await uploadImageToImgBB(file);
      await updateGroupPhoto(conversation.id, currentUser, uploadedUrl);
      showFeedback('Grup fotoğrafı güncellendi');
    } catch (err: any) {
      console.error('Grup fotoğrafı yüklenemedi:', err);
      showFeedback(err?.message || 'Fotoğraf yüklenemedi', true);
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  // 3. Grup Fotoğrafını Kaldır
  const handleRemovePhoto = async () => {
    if (!canManage || uploadingPhoto) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      await updateGroupPhoto(conversation.id, currentUser, null);
      showFeedback('Grup fotoğrafı kaldırıldı');
    } catch (err: any) {
      console.error('Fotoğraf kaldırılamadı:', err);
      showFeedback(err?.message || 'Fotoğraf kaldırılamadı', true);
    } finally {
      setUploadingPhoto(false);
    }
  };

  // 4. Yeni Üyeleri Ekle
  const handleAddMembersSubmit = async () => {
    if (selectedUserIdsToAdd.length === 0 || addingMembers) return;

    setAddingMembers(true);
    setError(null);
    try {
      const usersToAdd = rawUsers.filter((u) => selectedUserIdsToAdd.includes(u.uid));
      await addMembersToGroup(conversation.id, currentUser, usersToAdd);
      setShowAddMembersModal(false);
      setSelectedUserIdsToAdd([]);
      setAddSearchQuery('');
      showFeedback('Yeni üyeler gruba eklendi');
    } catch (err: any) {
      console.error('Üye eklenemedi:', err);
      showFeedback(err?.message || 'Üyeler eklenirken hata oluştu', true);
    } finally {
      setAddingMembers(false);
    }
  };

  // 5. Üyeyi Yönetici Yap
  const handleMakeAdmin = async (targetUid: string, targetName: string) => {
    if (!isOwner) return;
    setActionMenuUserId(null);
    setError(null);
    try {
      await makeMemberAdmin(conversation.id, currentUser, targetUid, { displayName: targetName });
      showFeedback(`${targetName} yönetici yapıldı`);
    } catch (err: any) {
      console.error('Yönetici yapılamadı:', err);
      showFeedback(err?.message || 'Yetki verilemedi', true);
    }
  };

  // 6. Yöneticiliği Kaldır
  const handleRemoveAdmin = async (targetUid: string, targetName: string) => {
    if (!isOwner) return;
    setActionMenuUserId(null);
    setError(null);
    try {
      await removeMemberAdmin(conversation.id, currentUser, targetUid, { displayName: targetName });
      showFeedback(`${targetName} yöneticiliği kaldırıldı`);
    } catch (err: any) {
      console.error('Yöneticilik kaldırılamadı:', err);
      showFeedback(err?.message || 'Yetki kaldırılamadı', true);
    }
  };

  // 7. Kuruculuğu Devret
  const handleConfirmTransfer = async () => {
    if (!isOwner || !transferTargetUser || transferring) return;

    setTransferring(true);
    setError(null);
    try {
      await transferGroupOwnership(
        conversation.id,
        currentUser,
        transferTargetUser.uid,
        { displayName: transferTargetUser.name }
      );
      setTransferTargetUser(null);
      setActionMenuUserId(null);
      showFeedback(`Kuruculuk ${transferTargetUser.name} kullanıcısına devredildi`);
    } catch (err: any) {
      console.error('Kuruculuk devredilemedi:', err);
      showFeedback(err?.message || 'Kuruculuk devredilemedi', true);
    } finally {
      setTransferring(false);
    }
  };

  // 8. Üyeyi Gruptan Çıkar
  const handleConfirmKick = async () => {
    if (!kickTargetUser || kicking) return;

    setKicking(true);
    setError(null);
    try {
      await removeMemberFromGroup(
        conversation.id,
        currentUser,
        kickTargetUser.uid,
        { displayName: kickTargetUser.name }
      );
      setKickTargetUser(null);
      setActionMenuUserId(null);
      showFeedback(`${kickTargetUser.name} gruptan çıkarıldı`);
    } catch (err: any) {
      console.error('Üye çıkarılamadı:', err);
      showFeedback(err?.message || 'Üye çıkarılırken hata oluştu', true);
    } finally {
      setKicking(false);
    }
  };

  // 9. Gruptan Ayrıl
  const handleLeaveGroup = async () => {
    setLeaving(true);
    setError(null);
    try {
      await leaveGroup(conversation.id, currentUser.uid, currentUser);
      if (onLeftGroup) onLeftGroup();
      if (onLeaveSuccess) onLeaveSuccess();
      onClose();
    } catch (err: any) {
      console.error('Gruptan ayrılma hatası:', err);
      showFeedback(err?.message || 'Gruptan ayrılırken bir sorun oluştu.', true);
      setLeaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh] relative"
        onClick={(e) => {
          e.stopPropagation();
          setActionMenuUserId(null);
        }}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-red-600" />
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Grup Bilgileri ve Yönetimi
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Main Content */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {/* Bildirimler */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successNotice && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Grup Fotoğrafı ve Başlığı */}
          <div className="flex flex-col items-center text-center">
            <div className="relative group mb-3">
              {conversation.photoURL ? (
                <UserAvatar
                  photoURL={conversation.photoURL}
                  name={conversation.name || 'Grup'}
                  size="2xl"
                  shape="rounded"
                  className="shadow-md border-2 border-zinc-200 dark:border-zinc-700"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-red-600 to-red-500 text-white flex items-center justify-center shadow-lg shadow-red-600/20">
                  <Users className="w-10 h-10" />
                </div>
              )}

              {/* Kurucu / Yönetici Fotoğraf Düzenleme Butonu */}
              {canManage && (
                <div className="absolute -bottom-1 -right-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md cursor-pointer transition-transform hover:scale-105 disabled:opacity-50"
                    title="Grup Fotoğrafını Değiştir"
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {conversation.photoURL && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={uploadingPhoto}
                      className="p-2 bg-zinc-800 hover:bg-zinc-900 text-zinc-200 rounded-xl shadow-md cursor-pointer transition-transform hover:scale-105 disabled:opacity-50"
                      title="Fotoğrafı Kaldır"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  )}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoSelect}
                  />
                </div>
              )}
            </div>

            {/* Grup Adı */}
            {isEditingName ? (
              <form onSubmit={handleSaveGroupName} className="flex items-center gap-2 w-full max-w-xs mt-1">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  maxLength={50}
                  placeholder="Grup Adı"
                  disabled={savingName}
                  className="flex-1 px-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 font-bold text-center text-zinc-900 dark:text-zinc-100"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={savingName || !editedName.trim()}
                  className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl cursor-pointer disabled:opacity-50"
                  title="Kaydet"
                >
                  {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingName(false);
                    setEditedName(conversation.name || '');
                  }}
                  disabled={savingName}
                  className="p-1.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl cursor-pointer"
                  title="Vazgeç"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-center gap-1.5 group">
                <h3 className="text-base font-black text-zinc-900 dark:text-white">
                  {conversation.name || 'Grup'}
                </h3>
                {canManage && (
                  <button
                    onClick={() => {
                      setEditedName(conversation.name || '');
                      setIsEditingName(true);
                    }}
                    className="p-1 text-zinc-400 hover:text-red-600 rounded-md transition-colors cursor-pointer"
                    title="Grup Adını Düzenle"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
              <span>{participantIds.length} Katılımcı</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-medium text-zinc-500 dark:text-zinc-400">
                Yetkiniz:
                {isOwner ? (
                  <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-0.5">
                    <Crown className="w-3 h-3" /> Kurucu
                  </span>
                ) : isAdmin ? (
                  <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-0.5">
                    <Shield className="w-3 h-3" /> Yönetici
                  </span>
                ) : (
                  <span>Üye</span>
                )}
              </span>
            </div>
          </div>

          {/* Üyeler Bölümü */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Grup Üyeleri
                </span>
                <span className="text-[11px] px-2 py-0.2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-semibold">
                  {members.length}
                </span>
              </div>

              {/* Kurucu ve Yönetici İçin Üye Ekle Butonu */}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowAddMembersModal(true)}
                  className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Üye Ekle</span>
                </button>
              )}
            </div>

            {/* Üye Listesi İçi Hızlı Arama */}
            {members.length > 5 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="Üyelerde ara..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            )}

            {/* Üye Listesi */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-64 overflow-y-auto">
              {filteredMembers.map((member) => {
                const isTargetOwner = member.role === 'owner';
                const isTargetAdmin = member.role === 'admin';
                const isTargetSelf = member.isCurrent;

                // Yetki kontrolleri
                const canKickThisMember =
                  !isTargetSelf &&
                  !isTargetOwner &&
                  (isOwner || (isAdmin && !isTargetAdmin));

                const canPromoteToAdmin = isOwner && !isTargetSelf && member.role === 'member';
                const canDemoteAdmin = isOwner && !isTargetSelf && member.role === 'admin';
                const canTransferToThisMember = isOwner && !isTargetSelf;

                const hasAnyActions =
                  canKickThisMember ||
                  canPromoteToAdmin ||
                  canDemoteAdmin ||
                  canTransferToThisMember;

                return (
                  <div
                    key={member.uid}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors relative"
                  >
                    <div
                      className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                        member.userObj && onOpenUserProfile ? 'cursor-pointer' : ''
                      }`}
                      onClick={() => {
                        if (member.userObj && onOpenUserProfile) {
                          onOpenUserProfile(member.userObj);
                          onClose();
                        }
                      }}
                    >
                      <div className="relative shrink-0">
                        <UserAvatar
                          photoURL={member.photoURL}
                          name={member.displayName}
                          username={member.username}
                          size="md"
                        />
                        <span
                          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                            member.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                          }`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {member.displayName}
                          </span>
                          <VerifiedBadge
                            isVerified={member.userObj?.isVerified}
                            badgeUrl={badgeUrl}
                            size="sm"
                            user={{
                              displayName: member.displayName,
                              username: member.username,
                              photoURL: member.photoURL,
                            }}
                          />
                          {member.isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-medium shrink-0">
                              Siz
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono truncate">
                          @{member.username} •{' '}
                          <span className={member.isOnline ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}>
                            {formatLastSeen(member.isOnline, member.lastSeen)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Rol Rozetleri ve Menü */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isTargetOwner && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/50 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                          <Crown className="w-3 h-3 text-amber-500 fill-amber-500/20" />
                          <span>Kurucu</span>
                        </div>
                      )}

                      {isTargetAdmin && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                          <Shield className="w-3 h-3 text-blue-500 fill-blue-500/20" />
                          <span>Yönetici</span>
                        </div>
                      )}

                      {/* Aksiyon Menü Butonu */}
                      {hasAnyActions && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionMenuUserId(
                                actionMenuUserId === member.uid ? null : member.uid
                              );
                            }}
                            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
                            title="İşlemler"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {/* Aksiyon Popover Menüsü */}
                          {actionMenuUserId === member.uid && (
                            <div
                              className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* 👑 Kuruculuğu Devret (Sadece Kurucu) */}
                              {canTransferToThisMember && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTransferTargetUser({
                                      uid: member.uid,
                                      name: member.displayName,
                                    });
                                    setActionMenuUserId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center gap-2 cursor-pointer transition-colors"
                                >
                                  <Crown className="w-3.5 h-3.5" />
                                  <span>Kuruculuğu Devret</span>
                                </button>
                              )}

                              {/* 🛡️ Yönetici Yap (Sadece Kurucu) */}
                              {canPromoteToAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleMakeAdmin(member.uid, member.displayName)}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-2 cursor-pointer transition-colors"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Yönetici Yap</span>
                                </button>
                              )}

                              {/* 🛡️ Yöneticiliği Kaldır (Sadece Kurucu) */}
                              {canDemoteAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAdmin(member.uid, member.displayName)}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 flex items-center gap-2 cursor-pointer transition-colors"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                  <span>Yöneticiliği Kaldır</span>
                                </button>
                              )}

                              {/* 🚫 Gruptan Çıkar */}
                              {canKickThisMember && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setKickTargetUser({
                                      uid: member.uid,
                                      name: member.displayName,
                                    });
                                    setActionMenuUserId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer transition-colors border-t border-zinc-100 dark:border-zinc-700/50"
                                >
                                  <UserMinus className="w-3.5 h-3.5" />
                                  <span>Gruptan Çıkar</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gruptan Ayrılma Alanı */}
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            {/* Eğer kullanıcı Kurucu ise ve grupta başka üye varsa: Uyarı göster */}
            {isOwner && participantIds.length > 1 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-bold">
                  <Crown className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>Kurucu Ayrılma Kuralı</span>
                </div>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-relaxed">
                  Gruptan ayrılmadan önce kuruculuğu başka bir üyeye devretmelisin.
                </p>
              </div>
            ) : confirmLeave ? (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Gruptan ayrılmak istediğinize emin misiniz?</span>
                </div>
                <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 leading-relaxed">
                  Gruptan ayrıldığınızda sohbet listenizden kaldırılır ve mesaj gönderemezsiniz.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(false)}
                    disabled={leaving}
                    className="flex-1 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-100 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleLeaveGroup}
                    disabled={leaving}
                    className="flex-1 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {leaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                    <span>Evet, Ayrıl</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                className="w-full py-2.5 px-3 rounded-xl border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Gruptan Ayrıl</span>
              </button>
            )}
          </div>
        </div>

        {/* ➕ Üye Ekleme Alt Modalı */}
        {showAddMembersModal && (
          <div
            className="absolute inset-0 z-40 bg-white dark:bg-zinc-900 flex flex-col animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-red-600" />
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Gruba Yeni Üye Ekle
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddMembersModal(false);
                  setSelectedUserIdsToAdd([]);
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Arama Inputu */}
            <div className="p-4 pb-2">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={addSearchQuery}
                  onChange={(e) => setAddSearchQuery(e.target.value)}
                  placeholder="Kullanıcı ara (@kullaniciadı veya isim)..."
                  className="w-full pl-9 pr-4 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>
            </div>

            {/* Kullanıcı Listesi */}
            <div className="flex-1 overflow-y-auto p-4 pt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {availableUsersToAdd.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-400">
                  Eklenebilecek kullanıcı bulunamadı.
                </div>
              ) : (
                availableUsersToAdd.map((user) => {
                  const isSelected = selectedUserIdsToAdd.includes(user.uid);
                  const uName = getSafeUserName(user);

                  return (
                    <div
                      key={user.uid}
                      onClick={() => {
                        setSelectedUserIdsToAdd((prev) =>
                          isSelected ? prev.filter((id) => id !== user.uid) : [...prev, user.uid]
                        );
                      }}
                      className={`p-2.5 flex items-center justify-between rounded-xl cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-red-50/70 dark:bg-red-950/40'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <UserAvatar
                            photoURL={user.photoURL}
                            name={uName}
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
                          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {uName}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono truncate">
                            @{user.username}
                          </div>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Alt Ekle Butonu */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
              <span className="text-xs text-zinc-500">
                {selectedUserIdsToAdd.length} kullanıcı seçildi
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddMembersModal(false)}
                  disabled={addingMembers}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-100 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleAddMembersSubmit}
                  disabled={selectedUserIdsToAdd.length === 0 || addingMembers}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {addingMembers ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  <span>Gruba Ekle ({selectedUserIdsToAdd.length})</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 👑 Kuruculuk Devri Onay Diyaloğu */}
        {transferTargetUser && (
          <div
            className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                <Crown className="w-5 h-5 fill-amber-500/20" />
              </div>
              <div className="text-center space-y-1">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                  Kuruculuğu Devret
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Grup kuruculuğunu <strong>{transferTargetUser.name}</strong> kullanıcısına devretmek istediğinize emin misiniz?
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  Bu işlem sonrasında kuruculuk yetkileriniz kalkacak ve standart üye olacaksınız.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferTargetUser(null)}
                  disabled={transferring}
                  className="flex-1 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTransfer}
                  disabled={transferring}
                  className="flex-1 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {transferring ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Crown className="w-3.5 h-3.5" />
                  )}
                  <span>Devret</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🚫 Üye Çıkarma Onay Diyaloğu */}
        {kickTargetUser && (
          <div
            className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                <UserMinus className="w-5 h-5" />
              </div>
              <div className="text-center space-y-1">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                  Üyeyi Gruptan Çıkar
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  <strong>{kickTargetUser.name}</strong> kullanıcısını bu gruptan çıkarmak istediğinize emin misiniz?
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setKickTargetUser(null)}
                  disabled={kicking}
                  className="flex-1 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleConfirmKick}
                  disabled={kicking}
                  className="flex-1 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {kicking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="w-3.5 h-3.5" />
                  )}
                  <span>Çıkar</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
