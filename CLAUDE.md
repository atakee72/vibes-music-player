# Vibes — project notes for Claude

## Package manager

- **pnpm** (lockfile is `pnpm-lock.yaml`). Don't switch to npm/yarn.
- `package.json` pins `pnpm.onlyBuiltDependencies: ["esbuild"]` — pnpm 10
  blocks postinstall scripts by default, and esbuild's binary download is
  the one exception this project needs. If you ever see "esbuild binary not
  found" after `pnpm install`, that field is the fix.

## Architecture

- **All state lives in `src/App.tsx`.** The three components (`Sidebar`,
  `SongList`, `PlayerBar`) are purely presentational — props in, callbacks
  out, no `useState`, no `useEffect`.
- Audio + analyser wiring is in the `useEffect` in `App.tsx` keyed on
  `currentSong`. It uses `ctx.createMediaElementSource(audio)`, which **can
  only be called once per `<audio>` element per AudioContext** — if you
  refactor that effect, make sure you don't recreate the source on every
  render or playback breaks silently.
- `togglePlayPause` in `App.tsx` is the single source of truth for the
  play/pause toggle. `PlayerBar` only exposes `onPlayPause` (not separate
  play/pause callbacks). `SongList` does receive both `onPlay` and
  `onPause` because its row overlay needs to distinguish "play this song"
  from "pause the current song".

## Styling — AFTERGLOW theme

- **Design tokens live in `tailwind.config.js`** (`theme.extend`), not as raw
  hex in components. The "AFTERGLOW" reskin (Phase A) replaced the old cold
  slate + purple/pink Apple-Music look with a warm analog-dusk palette. Source
  of truth for the design is `pencil-design/AFTERGLOW.md` (+ the `.pen` frames).
- **Colour tokens**: `deep #150A24` (base bg / dark glyphs on accents),
  `surface`/`surface-2` (frosted raised surfaces), `amber #FF9E5E` +
  `coral #FF6B6B` (primary gradient), `gold` (visualizer top), `lilac` (tags /
  secondary accent), `cream` (titles), `muted`/`faint` (dim text),
  `danger #E5484D` (destructive — deliberately distinct from coral so "delete"
  never shares a hue with "play").
- **The primary accent gradient is `from-amber to-coral`**; hover is
  `hover:brightness-110` (the tokens are single-value, no `-600` shade). **Glyphs
  on accent fills are `text-deep`, never white** — white-on-amber fails AA.
  Visualizer bars are the one exception: `from-coral to-gold`.
- **Fonts** are self-hosted via `@fontsource-variable/*` (imported in
  `main.tsx`, so they precache for offline). `font-display` = Fraunces (titles,
  headings, wordmark), `font-sans` = Inter (body, the default), `font-mono` =
  Geist Mono (timecodes / counts / durations).
- **Background**: `body` is `#150A24`; the persistent `.aurora-bg` layer
  (`index.css`, fixed `z-[-1]`) sits behind a **transparent** App root, and the
  per-track dynamic tint overlay (`App.tsx`) layers on top. Don't give the root
  an opaque bg — it would hide the aurora.
- `text-white` is still used widely; AFTERGLOW Phase A intentionally did **not**
  sweep it to `cream` (white-on-plum is safe; the `body` default is cream).
- Layout breakpoint is `lg` (1024px). Below that, sidebar is overlay
  (`fixed` + transform), controls reflow vertically. Above, everything is
  inline.

## TypeScript gotcha

- `music-metadata` returns `Uint8Array<ArrayBufferLike>` for picture data.
  Under `"strict": true` this fails to assign to `BlobPart`. The hook casts
  with `pic.data as BlobPart` — don't "fix" it by importing or generic-
  parameterizing; the cast is correct.

## Audio engine

- `useAudioEngine` (`src/hooks/useAudioEngine.ts`) owns the entire audio
  graph. **Do not** call `new AudioContext()` or `createMediaElementSource`
  anywhere else — both are constrained to be called once.
- **Single AudioContext for the page's lifetime.** No cleanup on unmount;
  the browser handles teardown on tab close. This is intentional: React 18
  StrictMode runs effects twice in dev, and `createMediaElementSource`
  permanently marks an audio element — closing the context doesn't free it.
- **Two `<audio>` elements** (`audioRefA`, `audioRefB`), one MediaElementSource
  each, mixed before the analyser. Always render both in App.tsx (no
  conditional). The hook handles which is active via `activeRef`.
- **Gapless model**: preload `nextSong` on the inactive element when active
  reports `currentTime > duration - 5`. On `ended`, if inactive has the
  expected next song loaded, flip + play instantly, *then* call onEnded so
  App can update React state (avoids audible gap between flip and React commit).
- **ReplayGain**: per-song dB value comes from `Song.replayGainDb`. Captured
  from `meta.common.replaygain_track_gain?.dB` (note: it's an `IRatio` object,
  not a plain number). Applied via the active element's `GainNode`.
- **EQ band map**: 5 `BiquadFilterNode`s per element, `type='peaking'`, `Q=1`,
  frequencies `[60, 230, 910, 3600, 14000] Hz`. Presets and `applyPreset`
  live in `src/lib/eq.ts`. The preset name persists via `storage.getEqPreset`/
  `saveEqPreset`. Apply changes via `setValueAtTime` for sample-accuracy.
- **Why the `onEnded` ref dance in App.tsx**: handleEnded references engine
  returns (`seek`, `togglePlayPause`, `playNext`) defined *after* useAudioEngine
  in source order. We pass a stable `() => onEndedRef.current()` to the hook
  and update `onEndedRef.current = playNext` after definitions exist.

## Keyboard shortcuts

- `useKeyboardShortcuts(handlers, options?)` (`src/hooks/useKeyboardShortcuts.ts`)
  is the canonical way to register global shortcuts. Don't add ad-hoc
  `document.addEventListener('keydown', ...)` calls — the hook handles
  input-focus suppression, the ref-based fresh-closures pattern, and the
  Space/Slash preventDefault rules.
- Map keys are `KeyboardEvent.code` strings (`Space`, `ArrowLeft`,
  `ArrowRight`, `Slash`, `Escape`). Never `event.key` — that breaks `/`
  on AZERTY and gives `' '` for Space.
- Pass `{ isBlocked: showUpload }` (or similar) to suppress everything
  except Escape while a modal is open. The hook handles that with one
  branch — don't sprinkle guards into individual handlers.
- Currently wired in App.tsx: Space=play/pause, ←/→=prev/next,
  `/`=focus search, Escape=close modal → clear search → blur input.

## Media Session

- `useMediaSession({ song, isPlaying, currentTime, duration, on... })`
  (`src/hooks/useMediaSession.ts`) wires the browser's MediaSession API.
  Don't touch `navigator.mediaSession` directly anywhere else.
- The hook has FOUR effects, on purpose: metadata `[song]`, playbackState
  `[isPlaying]`, action handlers `[callbacks]`, positionState
  `[currentTime, duration]`. Keeping them split prevents the high-frequency
  `timeupdate` cadence from thrashing the slower ones.
- `setPositionState` is guarded by `duration > 0` — passing 0 throws,
  which happens for every freshly-loaded song mid-`loadedmetadata`.
- Manual verification only (no unit tests): play a song, check the OS
  Now Playing widget / lock screen / Bluetooth headphone keys.

## Persistence

- Storage layer: `src/lib/storage.ts`, a thin wrapper over `idb-keyval`.
  Three keys: `library-roots` (array of `LibraryRoot`), `playlists`
  (array of `StoredPlaylist`), and `eq-preset`. All persistence touches IDB
  through this module — no other file should import `idb-keyval` directly.
- **Hybrid persistence model**:
  - Songs with a `fileHandle` (Chromium folder ingest) serialize as
    `HandleStoredSong` — just the handle. No byte duplication. The browser
    re-reads the file from disk on reload.
  - Songs with only a `file` (Firefox/Safari, or Chromium single-file
    drops) serialize as `BlobStoredSong` — the actual bytes go into IDB
    along with the original filename. On reload, `new File([blob],
    fileName, { type })` reconstructs the File.
  - `StoredSong = HandleStoredSong | BlobStoredSong`. Discriminate by
    `'fileHandle' in stored`.
  - `toStored` prefers the handle path when both are present (no point
    duplicating bytes when the handle works).
- **Persistent storage**: `ensurePersisted()` is called once per session
  on first successful ingest (inside `handleFiles` / `addFolderHandle`,
  guarded by `persistRequestedRef`). It calls `navigator.storage.persisted()`
  first to skip the Firefox prompt if already granted from a prior session.
  Don't call on cold mount — that's a context-less prompt.
- **Song IDs are path-based**: `${root.id}/${relativePath}` for folder-
  ingested songs (stable across sessions so playlist membership survives
  reload); `crypto.randomUUID()` for legacy file-drop songs (which are
  also persisted now via blobs — drop-the-same-file-twice creates
  duplicate entries, accepted limitation).
- **Browser compatibility**: Persistence works in all evergreen browsers
  via the hybrid model. Chromium gets the efficient handle path;
  Firefox/Safari get the blob path. **iOS Safari evicts IDB after 7 days
  of inactivity** even with persistent storage — browser-imposed, not
  ours to fix.
- **Permission reality** (Chromium handle path only): Chrome does NOT
  remember FS Access grants across browser restarts. After reload,
  `queryPermission` returns `'prompt'`. The app shows a "Welcome back.
  Click to restore your library." banner; one click and it's back. The
  banner is FS-Access-specific — blob-only Firefox/Safari users never
  see it because there's no permission to re-grant.
- **Save-effect race guard**: `App.tsx` uses a `loadedRef` to suppress
  the first `useEffect([playlists])` write that would otherwise overwrite
  stored data with the initial empty `playlists` state before mount-load
  completes. If you touch the load-or-save lifecycle, keep this guard.

## Dynamic background tint

- `extractDominantColor` / `dominantColorFromPixels` live in `src/lib/colors.ts`.
  Canvas-based (20×20 down-sample), no external dependencies.
- `useDominantColor(imageUrl)` in `src/hooks/useDominantColor.ts` bridges the
  async extraction into React state with an abort guard for fast skipping.
- The tint is a `fixed inset-0 pointer-events-none` overlay in `App.tsx` with
  `transition-colors duration-[1500ms]` and `opacity: 0.15`. A CSS `mask-image`
  fades it from full at the bottom (PlayerBar area) to invisible at 70% height.
- The base gradient (`from-slate-900 via-purple-900 to-slate-900`) stays on the
  root div — the overlay adds to it when a song with cover art is playing.

## Document Picture-in-Picture

- `MiniPlayer` (`src/components/MiniPlayer.tsx`) is a presentational component
  rendered into the PiP window via `React.createPortal`.
- PiP state (`pipWindow`) lives in `App.tsx`. `togglePip` opens/closes the
  window, copies stylesheets from the main document so Tailwind works in PiP.
- **Chromium 116+ only** — feature-detected via `'documentPictureInPicture' in
  window`. The PiP button in PlayerBar is hidden when the API is unavailable.
- The PiP window auto-closes when `currentSong` becomes null.
- Type declarations for the Document PiP API are in `src/vite-env.d.ts`.

## Drag-to-reorder + multi-select

- `@dnd-kit/core` + `@dnd-kit/sortable` handle the drag UX. The song list
  wraps rows in `<DndContext>` + `<SortableContext>`, each row uses
  `useSortable()`. Drag is disabled when a search filter is active.
- **Selection state is local to SongList** (`selectedIds: Set<string>`).
  Same convention-break as PlayerBar's `eqOpen`. Exposed via
  `onBatchDelete(ids)` callback.
- `GripVertical` icon is the drag handle, visible on hover. 8px pointer
  sensor activation distance prevents accidental drags on tap.

## Playlist import

- `src/lib/playlist-import.ts` parses M3U/PLS files and matches entries
  by filename (case-insensitive) against the Library playlist's songs.
- Imported playlists appear in the sidebar with a notification showing
  how many tracks were matched.
- File routing in `handleFiles`: playlist files (`.m3u`, `.m3u8`, `.pls`)
  and LRC files (`.lrc`) are separated from audio files and processed
  after audio ingest completes.

## Lyrics

- `LyricLine = { time: number; text: string }` lives in `src/types.ts`,
  added as optional `lyrics?` field on `Song`.
- Three sources: embedded SYLT (synced, from `music-metadata`'s
  `common.lyrics[].syncText`), embedded USLT (unsynced, `.text`), and
  dropped `.lrc` files parsed by `src/lib/lrc.ts`.
- `LyricsPanel` (`src/components/LyricsPanel.tsx`) is a slide-in panel
  right of SongList. Auto-scrolls to the active line via
  `scrollIntoView`, only when `activeLyricIndex` changes.
- Toggle: `L` key or "Lyrics" button in header.

## Cover art persistence

- Songs carry both `coverArt: string` (an object URL, valid only this session)
  and `coverBlob: Blob` (the raw bytes). `storage.toStored` drops the stale
  `coverArt` URL and persists `coverBlob`. `storage.fromStored` rebuilds
  `coverArt = URL.createObjectURL(coverBlob)` on load.
- **Self-healing**: `App.tsx` has a `healedCoversRef`-guarded background
  effect that re-extracts metadata for songs lacking `coverBlob` (i.e.
  persisted before this fix). The next save persists the blob.
- Don't try to persist the `coverArt` URL itself — blob URLs are session-
  scoped and will be dead after a reload.

## Volume

- Lives in App.tsx as `volume: number` (0–1), persisted via
  `storage.saveVolume` / `getVolume`. Applied in `useAudioEngine` to both
  audio elements' `.volume` whenever it changes.
- PlayerBar has the slider + a mute toggle button. The icon swaps based
  on level (`Volume2 / Volume1 / Volume / VolumeX`). `lastVolumeRef`
  remembers the previous non-zero level so unmute restores it.

## Selection mode + cross-playlist drag

- **DndContext lifted to App.tsx**: there's a single top-level DndContext
  that spans both Sidebar and SongList. SongList keeps its own
  SortableContext (disabled during selection mode or filter).
- **SongList row long-press** (500ms, ≤5px movement) enters selection
  mode. A "Select" button in the header is the explicit alternative.
- **Selection state stays local to SongList** (`selectedIds: Set<string>`);
  `selectionMode: boolean` is lifted to App so Escape and the Select
  button can drive it.
- **Cross-playlist drag**: in selection mode, the row body becomes the
  drag source (instead of the GripVertical handle). The drag payload in
  `useSortable.data` carries `{ type: 'song', ids: [...selectedIds] }`.
- **`onDragEnd` routing** in App.tsx: if `over.id` starts with
  `playlist-`, route to cross-playlist drop (copy by default; Ctrl/Meta
  for move; never move out of Library). Otherwise route to reorder.
- **Escape chain priority** (App.tsx `useKeyboardShortcuts`):
  selectionMode → close upload → clear search → blur input.
  ConfirmModal owns its own Escape via a capture-phase listener.

## Confirmation modals

- `ConfirmModal` (`src/components/ConfirmModal.tsx`) is the reusable
  confirmation primitive. Backdrop click and Escape both cancel.
- App.tsx has a `confirm` state shape `{ title, message, confirmLabel?,
  onConfirm } | null` driven by a `requestConfirm` helper. All
  destructive actions route through it: delete song, batch delete,
  delete playlist.

## Prompt modal (no native prompt!)

- `PromptModal` (`src/components/PromptModal.tsx`) is the React-based
  text-input modal, used by "New Playlist". Same shape as ConfirmModal:
  `promptState: { title, placeholder?, defaultValue?, confirmLabel?,
  onConfirm: (value) => void } | null` in App.tsx.
- **Never use native `window.prompt()`, `alert()`, or `confirm()`** —
  they block the main thread, and **the audio engine pauses while
  blocked**. The "music stops when creating a playlist" bug was caused
  by `prompt()` blocking — PromptModal is the fix.

## Sidebar collapse

- The Sidebar is collapsible on both mobile AND desktop. State lives in
  App.tsx as `sidebarOpen: boolean`, initialized via `matchMedia(
  '(min-width: 1024px)').matches` (open on desktop, closed on mobile).
- When collapsed, the Sidebar's outer container uses `hidden` instead
  of just `translate-x-full` so it doesn't occupy layout space on
  desktop. Content area expands to fill the width.
- Close icon: `PanelLeftClose` (`<-|`) inside Sidebar header. Open
  icon: `PanelLeftOpen` (`|->`) in the App header, rendered only when
  `!sidebarOpen`. When collapsed, the Vibes logo is mirrored into the
  App header (centered, larger) so brand presence persists.
- **Auto-close on selection is mobile-only**: PlaylistRow's onClick
  calls `onClose()` only when `!matchMedia('(min-width: 1024px)').
  matches`. Don't remove this guard — closing the persistent desktop
  sidebar on every playlist click is annoying.

## Refresh library + M3U export

- **Refresh** (Library only, Chromium only — requires FS Access handle):
  re-walks each `libraryRoot.handle` via `ingestDirectoryHandle`, diffs
  by stable id (`${root.id}/${relativePath}`). Adds new files, removes
  orphans from Library AND from any user playlist that referenced them.
- **Export**: `src/lib/playlist-export.ts` serializes a playlist to M3U
  (with `#EXTINF`). Triggered by a `<a download>` programmatic click.
  Round-trips through Phase 5's `parseM3U` import on the same machine.

## Virtualization (SongList)

- `useVirtualizer` from `@tanstack/react-virtual` renders only the rows
  in the viewport (plus 6 overscan). DOM stays at ~25 nodes regardless
  of song count.
- `SortableContext` still receives **all song IDs** — sortable membership
  is decoupled from DOM rendering. @dnd-kit works by ID, not DOM
  position, so reorder and cross-playlist drag still function for items
  scrolled off-screen.
- Each row needs `ref={virtualizer.measureElement}` + `data-index` for
  the variable-height measurement (mobile rows are taller than desktop).
- **`observeElementRect` override**: in happy-dom tests the scroll
  element has 0×0 dimensions, so no items would render. The custom
  observer falls back to a 1024×5000 viewport when the real measurement
  is zero. Real browsers use the actual rect.

## Memoization gotchas

- `SortableRow` is `React.memo`-wrapped. For this to actually skip
  re-renders, ALL its props must be stable.
- **`dragIds` is computed INSIDE the row via `useMemo`**, not passed
  in as an array. Building the array in the parent (`[...selectedIds]`)
  produces a new reference per render and defeats memo.
- **`handleRowClick` uses `songsRef` and `selectionModeRef`**, not the
  `songs` and `selectionMode` state directly. A `useCallback([songs])`
  would recreate on every list change (add, delete, reorder, filter),
  defeating memo across the board.
- **Inline callbacks in App.tsx (`onPlay`, `onDelete`) are now
  `useCallback`-wrapped** with refs for any state they need (e.g.,
  `filteredSongsRef`, `activePlaylistIdRef`). Same reason.

## Save debounce + URL revoke

- Playlist save in App.tsx uses a 500ms debounce (`saveTimerRef`). 200
  song mutations collapse into one IDB write. Trade-off: tab close
  within 500ms of a change loses that change.
- A separate `useEffect([playlists])` diffs the previous and current
  song lists, calling `URL.revokeObjectURL` on the audio and cover URLs
  of removed songs. Revoke is deferred via `setTimeout(0)` so the
  `<audio>` element finishes any teardown first.
- Currently-playing song's URL is skipped (`currentSongIdRef`) until
  the next diff — the `<audio>` element may still hold the ref.

## Quota awareness

- `StorageQuotaError` (`src/lib/storage.ts`) wraps IDB's native
  `DOMException('QuotaExceededError')`. `savePlaylists` catches and
  re-throws as this tagged type.
- App.tsx's save handler branches: on `StorageQuotaError`, shows a
  notification ("Storage full…"). Silent failure was the root cause of
  the "library gets reset" symptom from Phase 5.5's audit.
- `getStorageEstimate()` wraps `navigator.storage.estimate()` for future
  use (warning at 90%). Not currently wired into any UI.

## PWA / installability

- Built with **`vite-plugin-pwa`** (pinned to the `0.21.x` line — 1.x needs
  Vite 6; this project is on Vite 5). Config lives in `vite.config.ts`:
  `registerType: 'autoUpdate'` (the SW auto-registers; **no** manual
  `registerSW` call in `main.tsx`), a hand-written `manifest`, and Workbox
  precaching of the built shell. `devOptions.enabled: false` keeps the SW out
  of `pnpm dev` — exercise it via `pnpm build && pnpm preview`.
- **`base` must be `'/'`** (absolute), not `'./'`. A relative base produces a
  non-functional service worker (SW scope resolves from an absolute path). All
  deploys are root-domain, so this is safe. Don't switch it back to `'./'`.
- **Icons are generated, then committed.** `@vite-pwa/assets-generator` (run
  via `pnpm generate-pwa-assets`, config in `pwa-assets.config.ts`) rasterizes
  `public/pwa-icon.svg` (a 512×512 filled gradient square + white note — the
  24×24 `music-icon.svg` is just the favicon) into the `pwa-*`, `maskable-*`,
  and `apple-touch-icon` PNGs. `VitePWA({ pwaAssets: { config: true } })`
  auto-injects the manifest `icons` array and the HTML head links — **don't**
  hand-maintain them. The generator needs `sharp`, which is why
  `pnpm.onlyBuiltDependencies` includes `"sharp"`; the committed PNGs mean a
  plain `pnpm install` / `pnpm build` never needs it.
- `.gitignore` has a blanket `*.png` (Playwright screenshots) with a
  `!public/*.png` exception so the icons are tracked. Keep that exception.
- **Install UI**: `useInstallPrompt` (`src/hooks/useInstallPrompt.ts`) captures
  `beforeinstallprompt` (Chromium) and exposes `canInstall` / `promptInstall`.
  iOS Safari never fires that event, so `isIOS` gates a "Add to Home Screen"
  hint instead (best-effort UA sniff; only gates a hint). The header Install
  button shows when `canInstall || isIOS`.

## Share links

- **Metadata-only, never the file.** `src/lib/share.ts` encodes the current
  track's `{title, artist, album, duration}` into a URL **hash fragment**
  (`#s=<base64url>`). The recipient sees "what I'm listening to"; they can't
  play it without their own copy. This is the invariant — never put blob/file
  bytes (or even cover art) in the link.
- **Unicode-safe base64url**: encode JSON → UTF-8 bytes (`TextEncoder`) →
  base64 → URL-safe. Plain `btoa` is Latin1-only and would corrupt non-ASCII
  titles. `decodeSharePayload` returns `null` for anything malformed (never
  throws — a recipient can paste arbitrary junk). Fully unit-tested.
- **Arrival flow in App.tsx**: a ref-guarded mount effect (`shareHandledRef`,
  StrictMode-safe) reads `window.location.hash`, and if it decodes, opens
  `SharedTrackModal` and clears the hash via `history.replaceState` so a
  reload doesn't re-pop the modal.
- **`SharedTrackModal`** follows the `ConfirmModal` pattern and owns its own
  Escape via a **capture-phase** listener so it doesn't collide with App's
  Escape chain.
- The Share button (header, shown when `currentSong`) uses `navigator.share`
  when available, else copies the link to the clipboard with a toast.

## Dev loop

- `pnpm dev` (Vite HMR) is enough for almost everything. **No need to
  rebuild `dist/` during development** — `dist/` is only for production /
  preview. It's gitignored.
- `pnpm build` runs `tsc && vite build`. The `tsc` step catches type errors
  that `pnpm dev` silently skips, so run it before claiming a change is
  done.

## Testing

- `pnpm test` — Vitest watch mode
- `pnpm test:run` — single pass (use before commits)
- Stack: **Vitest 3** + **happy-dom** + **React Testing Library**.
- **Config**: `vitest.config.ts` uses `mergeConfig(viteConfig, ...)` so it
  inherits the `react()` plugin. Don't add a separate Vite config for tests.
- **Type globals** (`describe`, `it`, `expect`, `vi`, jest-dom matchers) are
  registered via triple-slash refs in `src/vite-env.d.ts`. **Do not** add
  `"types"` to `tsconfig.json`'s `compilerOptions` — that field overrides
  TypeScript's `@types/*` auto-discovery.
- Test files are **co-located** (`Sidebar.test.tsx` next to `Sidebar.tsx`).
- `src/test-utils.ts` has `makeSong` / `makePlaylist` factories. Use them
  instead of hand-rolling fixtures in each test.
- **`App.tsx` has no tests** by design — it's coupled to `AudioContext` and
  RAF, and the mocking surface isn't worth it until we refactor that
  pipeline (slated for the gapless-playback work).
- The Sidebar trash-button test specifically uses `fireEvent.click` (not a
  direct prop call) because the test exists to verify `stopPropagation`,
  which only matters when a real DOM event bubbles.

## Visual verification

- `playwright-cli` (Microsoft `@playwright/cli` v0.1.x, installed globally)
  is the way to take screenshots / a11y snapshots. System Chrome isn't
  installed on this machine, so always pass `--browser=chromium` to use
  the bundled browser.
- Per-session output lands in `.playwright-cli/` (gitignored).
