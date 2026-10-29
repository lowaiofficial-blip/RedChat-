# Implementation Plan — GIPHY GIF System Integration for RedChat

This plan outlines the implementation of GIPHY GIF search, pre-send preview, chat bubble rendering, and animated fullscreen lightbox preview into RedChat while preserving all existing Firebase, Auth, DM privacy, and media handling systems.

## User Requirements Summary
1. **GIPHY API Key Management**: Access GIPHY via `process.env.GIPHY_API_KEY` through secure Express proxy endpoints.
2. **GIF Button & Picker Panel**:
   - GIF button alongside chat input composer.
   - Picker modal showing trending GIFs on open + debounced search bar.
   - Animated thumbnails grid, pagination/load more support, loading & error states.
   - Dark/Light theme compatibility and mobile-responsive layout.
3. **Pre-Send Preview Modal**:
   - Selecting a GIF opens the existing RedChat pre-send preview dialog.
   - Displays full animated GIF with "Gönder" and "Vazgeç" buttons.
4. **Chat Bubble Rendering**:
   - Sent GIFs render animated inside chat bubbles maintaining aspect ratio and maximum height bounds.
   - Persists in Firestore chat history and syncs in real-time across devices.
5. **Fullscreen Animated Lightbox Preview**:
   - Tapping/clicking a sent GIF (sender or recipient) opens the existing RedChat media lightbox.
   - Animation continues smoothly in full size without breaking scroll position or chat state.
6. **DM Privacy Compliance**:
   - Respects user DM privacy settings (`allowDirectMessages === 'none'`).

---

## User Alignment Questions Answered
- **GIPHY API Key**: Configured exclusively via `process.env.GIPHY_API_KEY` in `.env` and proxied server-side.

---

## Proposed Changes & File Architecture

### 1. `.env.example`
- Add `GIPHY_API_KEY=` placeholder.

### 2. `server.ts` (Express Server Proxy)
- Add `/api/giphy/trending` endpoint:
  - Accepts `offset` parameter (default 0, limit 25).
  - Fetches trending GIFs from `https://api.giphy.com/v1/gifs/trending`.
  - Validates `GIPHY_API_KEY` presence and returns clean 400/500 JSON errors if unconfigured or failed.
- Add `/api/giphy/search` endpoint:
  - Accepts `q` query string and `offset` parameter.
  - Fetches matching GIFs from `https://api.giphy.com/v1/gifs/search`.

### 3. `src/components/GiphyPickerModal.tsx` (New Component)
- Mobile-responsive popup/sheet matching RedChat design (Red accents, dark/light themes).
- Features:
  - Search bar with instant debouncing (300ms).
  - Infinite scroll / "Daha Fazla Yükle" for paginated GIPHY results.
  - Animated GIF grid using GIPHY's `fixed_height` / `downsized_medium` URLs.
  - Loading spinner, empty results indicator, and missing API key / connection error states.
  - Official "Powered by GIPHY" attribution badge.

### 4. `src/components/ChatWindow.tsx`
- **GIF Button**: Add GIF button (`<Film>` / `<FileVideo>` or GIF icon) to the message composer bar next to emoji and photo attachment buttons. Disabled if DM privacy is locked (`isTargetDmClosed`).
- **Pre-Send Preview**: On GIF selection from `GiphyPickerModal`, open existing pre-send modal (`selectedImageFile` / `selectedImagePreview`). Pass GIF URL to the media preview state with caption support.
- **Message Dispatch**: `handleSendImageMessage` sends the GIF URL as `imageUrl` in Firestore message document with standard timestamp and status.
- **Lightbox Integration**: Ensure `previewImage` state handles GIF URLs properly and displays full-screen animated GIF without static frame freezing.

### 5. `src/components/ChatMessageItem.tsx`
- Ensure image message click handler opens `onSelectImage({ url: msg.imageUrl! })`.
- Maintain aspect ratio and CSS bounds so animated GIFs render crisp and responsive in chat bubbles for both sender and receiver.

---

## Verification & Testing Plan
1. Test GIF picker toggle button in message composer.
2. Verify GIPHY Trending GIFs load on initial open.
3. Test search query auto-fetching with debounced input.
4. Verify clicking a GIF opens pre-send modal with animated preview and "Gönder"/"Vazgeç" options.
5. Verify "Gönder" posts GIF to Firestore chat in real-time.
6. Verify clicking a sent GIF in chat bubble opens RedChat's existing fullscreen lightbox modal with active animation.
7. Verify DM privacy lock (`allowDirectMessages === 'none'`) disables GIF button and blocks send.
8. Validate `npm run lint` (`tsc --noEmit`) and `compile_applet`.
