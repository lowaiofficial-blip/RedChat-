import type { UserProfile } from '../types';

export interface TypingInfo {
  displayText: string;
  typingCount: number;
  activeUids: string[];
  firstUserName?: string;
  firstUserPhoto?: string | null;
}

/**
 * Grup veya birebir sohbette şu anda yazan kullanıcıların bilgisini formatlar.
 *
 * Kullanıcının istediği tam formatlar:
 * - 1 kişi yazıyorsa: "Ahmet yazıyor"
 * - 2 kişi aynı anda yazarsa: "Test ve +1 yazıyor"
 * - 3 kişi aynı anda yazarsa: "test ve +2 yazıyor"
 */
export function getTypingInfo(
  typingUsers: { [uid: string]: number } | undefined,
  currentUserId: string,
  isGroup: boolean | undefined,
  participants: { [uid: string]: { displayName?: string; username?: string; photoURL?: string | null } } | undefined,
  allUsers: UserProfile[],
  now: number = Date.now()
): TypingInfo | null {
  if (!typingUsers) return null;

  // Son 5 saniye içinde yazan ve mevcut kullanıcı olmayan aktif ID'leri al
  const activeUids = Object.keys(typingUsers).filter((uid) => {
    if (uid === currentUserId) return false;
    const timestamp = typingUsers[uid];
    return typeof timestamp === 'number' && now - timestamp < 5000;
  });

  if (activeUids.length === 0) return null;

  // Birebir sohbette
  if (!isGroup) {
    const firstUid = activeUids[0];
    const userObj = allUsers.find((u) => u.uid === firstUid);
    return {
      displayText: 'yazıyor',
      typingCount: 1,
      activeUids,
      firstUserName: userObj?.displayName || userObj?.username || 'Kullanıcı',
      firstUserPhoto: userObj?.photoURL || null,
    };
  }

  // Grup sohbetinde
  const firstUid = activeUids[0];
  const userObj = allUsers.find((u) => u.uid === firstUid);
  const participant = participants?.[firstUid];
  const rawName =
    userObj?.displayName ||
    participant?.displayName ||
    userObj?.username ||
    participant?.username ||
    'Biri';
  const firstName = rawName.trim();
  const firstPhoto = userObj?.photoURL || participant?.photoURL || null;

  if (activeUids.length === 1) {
    return {
      displayText: `${firstName} yazıyor`,
      typingCount: 1,
      activeUids,
      firstUserName: firstName,
      firstUserPhoto: firstPhoto,
    };
  }

  // 2 kişi veya daha fazla kişi aynı anda yazıyorsa: örn. "Test ve +1 yazıyor", "test ve +2 yazıyor"
  const remainingCount = activeUids.length - 1;
  return {
    displayText: `${firstName} ve +${remainingCount} yazıyor`,
    typingCount: activeUids.length,
    activeUids,
    firstUserName: firstName,
    firstUserPhoto: firstPhoto,
  };
}
