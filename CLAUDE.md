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
- **Never name a colour token after a Tailwind font-size scale word**
  (`base`, `xs`, `sm`, `lg`, …). A colour named `base` makes Tailwind emit
  `.text-base { color: … }` **on top of** the built-in `.text-base { font-size }`
  — so any element using `text-base`/`lg:text-base` silently gets that colour,
  overriding `text-white`/`text-amber` (the responsive `lg:` variant wins by
  cascade order). This is exactly the bug that made the player-bar title render
  dark plum on desktop. The old `base #1E1036` token was removed for this reason;
  it was unused as a colour. If you need that shade, name it e.g. `base-bg`.
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
- **Repeat-one (and repeat-all on a single track)**: `nextInPlaylist` returns
  the *same* song, so `nextSong.url === active.src`. The `ended` handler detects
  this (`ended.src === nextUrl`) and **replays the ended element in place**
  (`currentTime = 0; play()`) and **returns WITHOUT calling onEnded**. Two
  reasons this is its own branch: (1) flipping to the inactive element would
  start it from its *parked end position* (it was never reloaded, since its src
  already equals nextUrl), so the loop stalls after one pass; (2) `playNext`'s
  repeat-one branch does `if (!isPlaying) togglePlayPause()`, and on natural end
  `isPlaying` can be stale-true/false such that the toggle *pauses* the element
  we just restarted. Skipping onEnded for the in-place loop avoids that race.
  (The manual Next button still calls `playNext` directly — that path is fine.)
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
- Currently wired in App.tsx: Space=play/pause, ←/→=seek ∓10s,
  **Shift+←/→**=prev/next track, `L`=toggle lyrics, `/`=focus search,
  Escape=close modal → clear search → blur input. The ←/→ handlers branch on
  `event.shiftKey` (the hook passes the event through) and `preventDefault()`
  the arrow's default scroll on the seek path; they read live `currentTime`/
  `duration` via the hook's fresh-closure ref, so no stale-seek bug.
- **Lyric click-to-seek**: `LyricsPanel` synced lines take an optional
  `onSeek?(time)` — when set, each line is `role="button"` (+ Enter/Space
  keydown) that seeks to its timestamp. App passes `onSeek={seek}`. Unsynced
  (single-block) lyrics aren't clickable (no per-line timestamps).

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
- The backdrop is the `.aurora-bg` layer (`index.css`) behind a transparent
  root; this overlay adds to it when a song with cover art is playing.
- **`--vibe` colour routing (AFTERGLOW Phase B)**: `tintColor` is also published
  as a CSS variable on the App root (`style={{ '--vibe': tintColor ?? '#FF9E5E' }}`)
  so the VibeOrb glow + the now-playing hero's progress fill tint to the track
  via `color-mix(in srgb, var(--vibe) …)`. The **bottom `PlayerBar` stays static
  amber** on purpose — only the hero/orb follow the per-track colour, so the
  chrome doesn't flicker each song. The PiP `MiniPlayer` sets its own `--vibe`
  locally (separate document, so the root var doesn't reach it).

## Now-playing hero + VibeOrb (AFTERGLOW Phase B)

- `VibeOrb` (`src/components/VibeOrb.tsx`) is the signature artwork: a glowing
  disc (cover art, or a generative gradient when art is missing) inside a conic
  mood-ring. Looping motion is `motion-safe:animate-{spin-slow,breathe}` gated on
  `isPlaying` — still when paused or under `prefers-reduced-motion`. Reused in
  the hero and the PiP `MiniPlayer`. Its `<img>` has a non-empty `alt` so it
  stays in the a11y tree (MiniPlayer tests rely on `getByRole('img')`).
- `NowPlayingHero` (`src/components/NowPlayingHero.tsx`) is **display-only** and
  **desktop-only** (`hidden lg:flex`, `shrink-0`), rendered above the song list
  when `currentSong`. Orb + `NOW PLAYING` eyebrow + serif title + `artist · album`
  + genre/BPM chips + a scrubbable tinted progress bar. **No transport buttons** —
  the persistent bottom `PlayerBar` owns transport (the hero scrolls off). Two
  progress bars (hero + bar) is intentional; only transport must not be doubled.
  Mobile keeps the list + bottom bar; the full-screen mobile now-playing view
  (frame D) is a deferred follow-up.
- **Chips** show `song.genre` / `${bpm} BPM` only when present (`bpm` read from
  `meta.common.bpm` in `useMetadataExtractor`, persists free via the `Omit`+spread
  in `storage.ts`); the chip row is omitted when both are absent. A genre chip
  click calls `setSearchQuery(genre)` — `filterSongs` matches genre too.
- **Shuffle** lives in `App.tsx` (`shuffle` state) + a `PlayerBar` toggle.
  `nextInPlaylist(current, songs, repeatMode, shuffle)` picks a random *other*
  song (simple, with replacement). **`nextSong` is memoized** and `playNext`
  consumes that exact value — required so the gapless preload and the advance
  agree under shuffle (recomputing would re-roll the random pick and desync).
- **Sort** is **view-only**: `sortSongs` (`src/lib/sort.ts`) orders the displayed
  list (`visibleSongs`) via a header `<select>`; playback still walks
  `activePlaylist.songs`. Drag-reorder is disabled while a sort is active (the
  `isFilterActive` prop ORs in `sortBy !== 'manual'`).

## Motion (AFTERGLOW Phase C)

- **All looping/transform motion is `motion-safe:` gated** so it vanishes under
  `prefers-reduced-motion: reduce` (Tailwind compiles `motion-safe:` to a
  `@media (prefers-reduced-motion: no-preference)` wrapper). Colour transitions
  (the 1500ms tint crossfade, etc.) are left alone — non-vestibular. There is
  **no** global `transition-duration:0` killer; gate per-utility instead.
- **Cover-art cross-dissolve**: the `fadeIn` keyframe (`tailwind.config.js`) +
  `motion-safe:animate-fade-in` on the cover `<img>`, which carries
  `key={coverArt}` so it remounts (and re-fades) on track change. In `VibeOrb`
  the generative gradient is an always-present backdrop **under** the img, so the
  dissolve happens over a warm surface, not a transparent flash through the ring.
- Orb breathe/spin (Phase B), lyrics active-line `motion-safe:scale-105`, and the
  play buttons' `motion-safe:active:scale-95` + amber `active:shadow` press glow
  round out §6 of `pencil-design/AFTERGLOW.md`. Verify by toggling the OS
  reduce-motion setting — animations stop, colour/visualizer/tint still update.
- **Enter/exit transitions on overlays**: `usePresence(open, duration=300)`
  (`src/hooks/usePresence.ts`) gives conditionally-rendered surfaces a real
  *exit* animation (a bare `{cond && <X/>}` unmounts abruptly). It returns
  `{ mounted, visible }`: keep the node while `mounted`, drive the from/to class
  with `visible` (double-rAF so the browser paints the "from" state first).
  **Honors `prefers-reduced-motion`** — instant swap, no 300ms empty hold.
  - `MobileNowPlaying` fades + slides (`opacity`/`translate-y-4`); it no longer
    early-returns on `!open` — it calls the hook, then `if (!mounted) return null`.
  - `LyricsPanel` slides in from the right (`translate-x-full`→`0`) + backdrop
    fade. It takes an **`open?` prop (default `true`)** so the many existing
    panel tests — which render it with no `open` — still mount it; App now
    **always renders** `<LyricsPanel open={showLyrics} …>` (not `{showLyrics &&}`)
    so the exit can play. This is also why hitting `L` from the full-screen view
    now cross-fades (view slides out as the panel slides in) instead of snapping.

## Mobile layout (the `lg` split)

- The whole UI is desktop-first and reflows at `lg` (1024px). AFTERGLOW added
  two desktop-only surfaces — the `NowPlayingHero` and the `PlayerBar`'s right
  cluster — so mobile needs its own now-playing surface.
- **Header actions** use `flex flex-wrap … gap-2` (not `space-x`) so the button
  row wraps instead of clipping "Add Music" on narrow screens.
- **Mobile player bar** is a slim "mini bar": the `PlayerBar` right cluster
  (visualizer + PiP + EQ + volume) is `hidden lg:flex`, leaving cover+title
  (left) + transport (right). The **cover+title is a `role="button"`** (not a
  `<button>` — it wraps `<p>`s) that opens the mobile now-playing view; its
  handler is gated with `matchMedia('(min-width: 1024px)')` so desktop taps no-op.
- **`MobileNowPlaying`** (`src/components/MobileNowPlaying.tsx`) is the
  full-screen (`fixed inset-0 z-[60]`) frame-D view — the orb wrapped by
  `OrbVisualizerRing`, title, scrubbable progress, full transport, and the
  controls trimmed from the mobile bar (lyrics, EQ, volume, share). **Despite the
  name it now renders on every size** (the `lg:hidden` was dropped) — on desktop
  it opens by clicking the bottom `PlayerBar`'s cover/title (the `onExpand` no
  longer gated to mobile); on mobile, by tapping the mini-bar. State
  `mobilePlayerOpen` lives in `App.tsx`; closes via the chevron, the Escape chain
  (first branch), or auto-close when `currentSong` goes null. **Toggling Lyrics
  from this view also closes it** (the `LyricsPanel` is `z-40`, below this view's
  `z-[60]`, so it would otherwise be hidden behind it).
- **`OrbVisualizerRing`** (`src/components/OrbVisualizerRing.tsx`) draws 48 bars
  radially (each `rotate(i/N·360°)` + pushed to `BASE_RADIUS`), driven by
  `visualizerData` bins; `data[i] ?? 0` so it always draws (data is `[]` until
  audio flows). Same per-frame React pattern as the desktop bars, only mounted
  while the view is open.
- **Header overflow menu**: the header keeps Sort + Add Music always visible; the
  secondary actions (Select/Lyrics/Share/Refresh/Export/Install) render inline on
  desktop (`hidden lg:flex`) but collapse into a `⋯` `HeaderMenu`
  (`src/components/HeaderMenu.tsx`, `lg:hidden`) on mobile. The actions are
  defined once in `App.tsx` as a `HeaderAction[]` array consumed by the menu.
- **`ScrollingText`** (`src/components/ScrollingText.tsx`) marquees long titles
  only when they overflow — used for the title in `MobileNowPlaying`,
  `PlayerBar` (mini-bar) and `NowPlayingHero`. **Gotcha**: measure the *block*
  inner div's `scrollWidth`, not an inline `<span>` (inline elements — and
  `truncate` — report `scrollWidth === clientWidth`, hiding real overflow).
- The desktop `NowPlayingHero` is intentionally **compact** (`h-[180px]`, ~136px
  orb) so the song list keeps usable height beneath it.

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
- Sources: embedded tags, dropped `.lrc` files (`src/lib/lrc.ts`), and
  **online (LRCLIB)** on demand.
- **Embedded extraction** lives in `src/lib/lyrics.ts` `extractLyrics(meta)`
  (pure, reused by the ingest hook *and* the on-demand re-check). It reads
  `meta.common.lyrics` (SYLT/USLT) **and** falls back to scanning `meta.native`
  for any lyric-shaped frame (`TXXX:LYRICS`, `UNSYNCEDLYRICS`, `©lyr`, …) that
  `music-metadata` doesn't map to `common.lyrics` — that gap was why many
  embedded-lyrics files showed nothing.
- **Online**: `src/lib/lyrics-online.ts` `fetchLyricsOnline({title,artist,album,
  duration})` → LRCLIB `/api/get` (exact, duration ±2s) then `/api/search`
  (fuzzy); maps `syncedLyrics`→`parseLRC`, else `plainLyrics` block; `null` on
  no-match/instrumental/error (never throws). Free, no key, **CORS-open** (direct
  browser fetch); **metadata-only** request (no audio). No SW/runtime-cache rule.
- **"Find lyrics" button** (`LyricsPanel` empty state) → `App.handleFetchLyrics`:
  re-parse the file with `extractLyrics` first (recovers embedded lyrics the old
  ingest missed — **the fix for an existing library**, since reload/Refresh don't
  re-extract), then LRCLIB. Result is merged onto the song and **persisted** (it
  survives reload + renders offline). Manual only (auto-fetch is a future toggle).
- `LyricsPanel` (`src/components/LyricsPanel.tsx`) is a slide-in panel right of
  SongList; auto-scrolls to the active line via `scrollIntoView`. Toggle: `L` key
  or "Lyrics". (Toggling it from the now-playing view closes that view — it's
  `z-[60]`, above the panel's `z-40`.)

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
- **The collapse is animated** (not a `display:none` snap — `hidden` can't
  transition). The outer container keeps no `hidden`; instead it **animates
  width** on desktop (`lg:w-64`↔`lg:w-0` + `lg:transition-[width]`
  `overflow-hidden`, with `lg:translate-x-0` cancelling the mobile transform) and
  **translates** on mobile (`fixed` + `-translate-x-full`, no layout impact). An
  inner `w-64 shrink-0` wrapper keeps the content from squishing as the outer
  collapses to 0. The mobile backdrop fades (opacity) in step. Closed sidebar
  still takes 0 desktop width; the App content `flex-1` reflows.
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
