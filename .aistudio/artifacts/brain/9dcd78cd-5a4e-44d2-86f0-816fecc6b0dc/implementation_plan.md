# Implementation Plan — Message Sending Speed Optimization for RedChat

This plan details the performance diagnosis and code optimizations to eliminate delays in message sending (reducing wait times from ~15s to instant/under 200ms) across Desktop and Mobile on RedChat, without changing the database schema or authentication setup.

---

## Root Cause Analysis & Findings

1. **Multiple Sequential Read Roundtrips in `sendMessage` (`src/services/chatService.ts`)**:
   - Before writing a message, `sendMessage` executed a blocking `getDoc` on the conversation document.
   - For 1-on-1 chats, it then executed 2 additional blocking `getDoc` queries checking `blockedUsers` collections.
   - These 3 sequential database reads added significant network latency before any message write could begin.

2. **Sequential Write Roundtrips**:
   - Messages were saved via `await addDoc(...)` followed by `await updateDoc(...)` on the conversation document.
   - Executing these writes sequentially doubled the write latency.

3. **Blocking UI Execution without Optimistic Rendering in `ChatWindow.tsx`**:
   - `handleSend` set `sending = true` and locked the input composer with "Gönderiliyor..." while awaiting all network roundtrips to complete.
   - The user had to wait for server acknowledgement before seeing their message or typing the next one.

4. **Redundant Post-Send Write Cascades**:
   - `markMessagesAsRead` triggered supplementary `updateDoc` calls whenever messages changed, creating extra network traffic right after message submission.

---

## Proposed Optimizations

### 1. `src/services/chatService.ts`
- **Eliminate Unnecessary Reads**: Remove the 3 redundant `getDoc` read calls from `sendMessage`. `ChatWindow.tsx` already checks blocking and DM privacy client-side prior to calling `sendMessage`.
- **Parallelize Message Writes**: Pre-generate document ID with `doc(messagesCol)` and execute message creation (`setDoc`) and conversation summary update (`updateDoc`) concurrently using `Promise.all`.
- **Latency Reduction**: Reduces total sequential network roundtrips per message write from 5 down to 1 single parallel flight.

### 2. `src/components/ChatWindow.tsx`
- **Optimistic UI Updates**:
  - Upon submitting a message, create an optimistic local message item (`status: 'sending'`) and append it immediately to `messages` state.
  - Instantly reset `inputText`, reply reference, and attachments so the user can immediately continue typing without waiting for server response.
  - Perform the Firestore `sendMessage` write in the background.
  - When the real message snapshot arrives from `subscribeToMessages`, reconcile the optimistic item with the server document.
- **Double-Submission Lock**:
  - Utilize `sendLockRef` to prevent accidental duplicate message submissions when Enter or the Send button is pressed rapidly.
- **Error Handling**:
  - If a background send fails, update the optimistic message status to `'error'` or alert the user cleanly without freezing the chat.

### 3. `src/services/channelService.ts`
- **Parallelize Channel Post Writes**:
  - Apply `Promise.all` for post creation (`setDoc`) and channel summary updates (`updateDoc`) so channel messaging is equally instant.

### 4. Verification & Testing
- Test DM, Group, and Channel message sending on Desktop and Mobile.
- Verify instant message appearance in UI without "Gönderiliyor..." delay.
- Verify double-click / rapid Enter press prevention.
- Check message timestamp ordering, read receipts, and push notification triggers.
- Run `lint_applet` and `compile_applet` to confirm 0 compilation or lint errors.
