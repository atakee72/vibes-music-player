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

## Styling

- Tailwind utilities only — no custom theme, no `tailwind.config.js`
  extensions beyond defaults.
- Brand gradient is `from-purple-500 to-pink-500` (and `from-purple-400 to
  pink-400` for text). Used consistently; swap those two values everywhere
  if you ever rebrand.
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

## Refresh library + M3U export

- **Refresh** (Library only, Chromium only — requires FS Access handle):
  re-walks each `libraryRoot.handle` via `ingestDirectoryHandle`, diffs
  by stable id (`${root.id}/${relativePath}`). Adds new files, removes
  orphans from Library AND from any user playlist that referenced them.
- **Export**: `src/lib/playlist-export.ts` serializes a playlist to M3U
  (with `#EXTINF`). Triggered by a `<a download>` programmatic click.
  Round-trips through Phase 5's `parseM3U` import on the same machine.

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
