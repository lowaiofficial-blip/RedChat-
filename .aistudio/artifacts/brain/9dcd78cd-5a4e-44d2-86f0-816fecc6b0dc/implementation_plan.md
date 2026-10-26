# 🔒 Privacy Category in Settings (`Ayarlar → Gizlilik`) — RedChat

Integrate a distinct **🔒 Gizlilik** category directly inside the existing **Ayarlar** tab of `ProfileModal.tsx`, ensuring smooth real-time Firestore persistence, zero disruption to existing features, and full dark/light theme compatibility.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following design and workflow decisions were confirmed in Turn 1:

- **Confirmed Decision 1 (UI Placement)**: Embedded inside the existing **Ayarlar** tab as a distinct, framed card section with a dedicated lock 🔒 header and clean option cards. No separate top-level page or tab is created.
- **Confirmed Decision 2 (Instant Firestore Save)**: Selecting any option triggers an immediate Firestore document update on `users/{userId}` accompanied by an auto-dismissing toast notification (`"Gizlilik ayarınız kaydedildi."`).
- **Confirmed Decision 3 (DM Lock Behavior)**: Users with DMs closed remain fully visible in lists and profile modals with prior chat history intact. In `ChatWindow.tsx`, the message composer is replaced with a locked status bar: `🔒 Bu kullanıcının DM'leri kapalı.`
- **Confirmed Decision 4 (Group Addition Privacy)**: Users who disable group additions appear grayed-out with a lock 🔒 icon and `"Gruplara kapalı"` badge in `CreateGroupModal.tsx` and `GroupInfoModal.tsx`. Tapping them displays `Bu kullanıcı gruplara eklenmeyi kapatmış.` while keeping their profile photo and username visible.

---

## 1. Overview & Core Concept

- **Scope**:
  1. **💬 Özel Mesajlar (DM)**:
     - `🟢 DM'lerim açık` (`allowDirectMessages: 'everyone'`): Anyone can send direct messages.
     - `🔴 DM'lerim kapalı` (`allowDirectMessages: 'none'`): Blocks new direct message sends while preserving existing chat history and list visibility.
  2. **👥 Grup Gizliliği**:
     - `🟢 Herkes` (`allowGroupAdditions: 'everyone'`): Anyone can add the user to new groups.
     - `🔴 Hiç kimse` (`allowGroupAdditions: 'none'`): Renders the user unselectable in group creation and member add modals. Existing group memberships remain untouched.

---

## 2. Visual & Architectural Design

```
┌─────────────────────────────────────────────────────────────────┐
│              ProfileModal.tsx (Ayarlar Sekmesi)                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🔒 Gizlilik (Özel Kilit İkonlu Çerçeveli Kart)             │  │
│  │                                                           │  │
│  │ 💬 Direkt Mesajlarım (DM)                                 │  │
│  │ [ 🟢 DM'lerim açık ]  [ 🔴 DM'lerim kapalı ]              │  │
│  │                                                           │  │
│  │ 👥 Beni kimler gruplara ekleyebilir?                      │  │
│  │ [ 🟢 Herkes ]         [ 🔴 Hiç kimse ]                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (Anlık Firestore Güncellemesi)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      users/{userId} Doc                         │
│       `allowDirectMessages` & `allowGroupAdditions`            │
└────────────────┬────────────────────────────────┬───────────────┘
                 │                                │
                 ▼                                ▼
┌────────────────────────────────┐ ┌──────────────────────────────┐
│        ChatWindow.tsx          │ │    CreateGroupModal.tsx      │
│ Target DM = 'none'?            │ │ Group addition = 'none'?     │
│ Shows locked banner + input off│ │ Grays out + lock badge       │
└────────────────────────────────┘ └──────────────────────────────┘
```

---

## 3. Detailed Component Plan

1. **`src/components/ProfileModal.tsx`**:
   - Refine the **🔒 Gizlilik** card layout inside the **Ayarlar** tab.
   - Use toggle switches / option cards with active green/red state indicators and loading spinners.
   - Show auto-closing toast notification at the bottom upon Firestore save.

2. **`src/components/ChatWindow.tsx`**:
   - Check target recipient's `allowDirectMessages`.
   - If `'none'`, replace message input with locked banner `🔒 Bu kullanıcının DM'leri kapalı.`
   - Ensure message send handler programmatically enforces this restriction.

3. **`src/components/CreateGroupModal.tsx` & `src/components/GroupInfoModal.tsx`**:
   - Check each candidate's `allowGroupAdditions`.
   - If `'none'`, render grayed-out with lock 🔒 icon and `"Gruplara kapalı"` badge. Unselectable.
   - Show notification `Bu kullanıcı gruplara eklenmeyi kapatmış.` when tapped.

4. **`firestore.rules` & `firebase-blueprint.json`**:
   - Ensure `allowDirectMessages` and `allowGroupAdditions` properties are validated and protected so users can only update their own profile fields.

---

## 4. Verification & Testing Checklist

- [x] DM open user: direct messages can be sent normally.
- [x] DM closed user: new direct messages blocked, locked banner displayed, profile/history preserved.
- [x] Group privacy "Herkes": user can be selected in group creation.
- [x] Group privacy "Hiç kimse": user grayed out with lock badge, unselectable in group creation.
- [x] Settings persistence: preferences retained after page refresh / re-login.
- [x] Theme support: verified in both light and dark mode.
- [x] Build check: `compile_applet` and `lint_applet` pass with zero errors.
