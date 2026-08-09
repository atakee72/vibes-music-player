# Vibes — Roadmap

A phase-by-phase log of what's shipped and what's queued, captured as a single
durable document so it survives chat-history compaction.

The project started as a recovery: the original source for a small React +
Vite + Tailwind music player was lost. A first pass (pre-Phase-0) was done
with Claude Desktop, using the deployed Netlify bundle (`bolt-diy-7-…
netlify.app`) as the structural source of truth — `app.pretty.js`,
`styles.pretty.css`, `classnames.txt`. From there the project moved into a
proper roadmap.

Working repo: <https://github.com/atakee72/vibes-music-player>
Production deploy: <https://vibes-music-player-theta.vercel.app>

## Workflow conventions

- **Plan mode + self-audit**: every non-trivial phase enters plan mode,
  writes a plan to `~/.claude/plans/groovy-hugging-conway.md`, then does a
  self-audit pass on that plan *before* asking for approval (the user's
  observed preference — they've asked "audit your plan" enough times that
  it's now built into the flow).
- **One branch per phase**: `phase-N-<short-name>`, commits in plan-defined
  order, push → Vercel auto-preview → fast-forward merge to `main` → delete
  branch.
- **Tests via Vitest + RTL**: every new module gets a co-located `*.test.ts`.
  `App.tsx` deliberately has no tests (audio + RAF + AudioContext + IDB
  surface is too noisy to mock well; we test the hooks instead).
- **Manual gate**: `pnpm test:run && pnpm build` must pass before push.
- **Docs touched per phase**: `CLAUDE.md` for architecture/gotchas,
  `README.md` for user-facing features.

---

## Pre-Phase 0 — Reconstruction (shipped)

Status: ✅ merged into the initial commit on `main`.

The Vibes app was rebuilt from the prettified deploy bundle. Three
components (`Sidebar`, `SongList`, `PlayerBar`) had been left as stubs
with detailed JSDoc pointers to line ranges in `_recovered/app.pretty.js`;
this phase filled them in to match the original deploy pixel-for-pixel
(verified by side-by-side playwright screenshots).

Also delivered in this initial pass: project layout, `.gitignore`, working
`pnpm dev` / `pnpm build`, GitHub repo + Vercel project + GitHub↔Vercel
auto-deploy link (push to `main` → production redeploys; push to any
branch → preview URL).

Side fix: `useMetadataExtractor.ts` had a TS-strict typing bug
(`Uint8Array<ArrayBufferLike>` → `BlobPart`) — fixed with `pic.data as
BlobPart` cast.

---

## Phase 0 — Vitest + React Testing Library (shipped)

Status: ✅ merged (`b3f7170`).

The first phase of "make this maintainable." Added Vitest + happy-dom +
@testing-library/{react,jest-dom,user-event} with co-located tests. 17
happy-path tests covering the three components and the metadata hook.

**Key files added**:
- `vitest.config.ts` (using `mergeConfig(viteConfig, …)` so the test
  runner inherits the React plugin)
- `vitest.setup.ts` (one import: jest-dom matchers)
- `src/test-utils.ts` (`makeSong` / `makePlaylist` factories)
- 4 co-located test files

**Notable decisions**:
- **TS globals via triple-slash refs in `src/vite-env.d.ts`**, not via
  `tsconfig.json`'s `types` array — setting `types` overrides TypeScript's
  default `@types/*` auto-discovery (footgun).
- **Vitest 3, not 4**: 4 requires Vite 6; project is on Vite 5.
- **App.tsx not tested**: deferred until Phase 3 when the audio chain
  refactor would extract it into a testable hook anyway. (Still no App.tsx
  tests at Phase 3.5 — the engine extraction successfully made App.tsx
  thin enough. **Resolved 2026-08-09**: `src/App.test.tsx` — an 18-test
  wiring suite over a 4-mock harness; see CLAUDE.md "Testing".)

---

## Phase 1 — Folder drop + File System Access persistence (shipped)

Status: ✅ merged (`a858f8b`).

Replaced the "drop files one at a time, lose them on refresh" UX with
"drop a folder once, it sticks." Used the File System Access API
(`showDirectoryPicker`, `FileSystemDirectoryHandle`, `queryPermission`/
`requestPermission`) to store a handle to the user's folder in IndexedDB,
so reload restores the library via one click (Chromium remembers consent
per-session, not across browser restarts — banner is the common case).

**Key files added**:
- `src/lib/storage.ts` — thin wrapper over `idb-keyval` (~600 bytes lib)
- `src/lib/ingest.ts` — recursive folder traversal, both
  `FileSystemDirectoryHandle.values()` (Chromium) and `webkitGetAsEntry()`
  (Firefox/Safari)
- `src/lib/storage.test.ts`, `src/lib/ingest.test.ts`
- `src/types.ts` gained `LibraryRoot` interface and `Song.fileHandle?`

**App.tsx changes**: mount-load effect (with `loadedRef` guard so the save
effect doesn't overwrite stored data with an empty initial state), save
effect on `[playlists]` change, "Welcome back. Click to restore." banner,
`addFolderHandle` orchestrator.

**Notable decisions**:
- **Stable Song IDs** for folder-ingested songs: `${root.id}/${relativePath}`
  (so playlist membership survives reload). UUID for legacy single-file
  drops (no stability needed for ephemera).
- **`StoredSong = Omit<Song, 'file' | 'url'>` with required `fileHandle`** —
  introduced as the persistence boundary type. Conversion lived only in
  `storage.ts`; the rest of the codebase stayed ignorant of strip/rehydrate.
- **Firefox/Safari left as session-only** with a rude "requires Chrome" note
  in the upload modal. This was the wrong call (see Phase 3.5).

---

## Phase 2 — Native feel (shipped)

Status: ✅ merged (`6ef9332`).

Three independent additions in one branch:
1. **Keyboard shortcuts**: Space (play/pause), ←/→ (prev/next), `/` (focus
   search), Escape (close modal → clear search → blur). Implemented via
   `src/hooks/useKeyboardShortcuts.ts` with a ref-based fresh-closure
   pattern (single document-level listener, never re-registered).
2. **Media Session API**: lock-screen artwork, Bluetooth headphone keys,
   macOS Now Playing widget, Windows SMTC, Linux MPRIS. Four separate
   effects (metadata, playbackState, action handlers, positionState) to
   avoid thrashing.
3. **In-list search/filter**: pure `filterSongs` helper in `src/lib/filter.ts`,
   matched against title/artist/album case-insensitively. UI input above
   the song list; "N of M" indicator in the header; "No matches for X"
   empty state.

**Key files added**:
- `src/hooks/useKeyboardShortcuts.ts` + test
- `src/hooks/useMediaSession.ts` (no test — too thin a wrapper around the
  browser API)
- `src/lib/filter.ts` + test
- `SongList` gained an optional `emptyHint` prop for the "No matches" copy

**Notable decisions**:
- **Shortcut map keyed by `event.code`** (`Space`, `ArrowLeft`, `Slash`),
  not `event.key` — layout-independent.
- **Modal-open shortcut suppression** via `isBlocked` option on the hook.
- **`preventDefault` only for Space and Slash** (page-scroll, Firefox
  Quick Find).
- **Documented limitation**: transport (next/prev) ignores the active
  filter — searching for "Beatles" then hitting `→` jumps to whatever's
  next in the *unfiltered* playlist. Acknowledged in out-of-scope.

---

## Phase 3 — Audio chain matures (shipped)

Status: ✅ merged (`43b12b8`).

This is the big audio refactor + three audiophile features. The headline
fix: a latent bug from the original recovery where the visualizer froze
from song 2 onward (the `useEffect([currentSong])` was creating a new
`AudioContext` per song and calling `createMediaElementSource` on the same
`<audio>` element each time, which throws `InvalidStateError` after the
first call — caught and silently logged).

### a. Audio engine refactor

Extracted everything into `src/hooks/useAudioEngine.ts`:
- **Single `AudioContext`** for the page's lifetime (no cleanup; React 18
  StrictMode would re-init and the audio element's "captured" state is
  permanent). `ctxRef` guard skips re-init.
- **Two `<audio>` elements** (`audioRefA`, `audioRefB`), one
  `MediaElementSource` each, mixed before the analyser.
- **Per-element chain**: `source → 5 BiquadFilters → GainNode → mixer →
  analyser → destination`. EQ filters and ReplayGain gain are sibling
  nodes on the same chain.
- **`createMediaElementSource` regression test**: mock counts construction
  calls; across 3 song changes, only 2 sources are ever created (one per
  audio element). Catches the original bug if it ever regresses.

### b. Gapless playback

When active element's `timeupdate` reports `currentTime > duration - 5`,
preload `nextSong` on the inactive element. On `'ended'`, flip activeRef +
play the now-active (already-loaded) element, *then* call `onEnded` so App
state catches up. App's `playNext` and engine's preload share
`nextInPlaylist(current, songs, repeatMode)` from `src/lib/queue.ts`.

### c. ReplayGain

Read `meta.common.replaygain_track_gain?.dB` from `music-metadata` (note:
`IRatio` shape, not a plain number — easy footgun). Add `Song.replayGainDb?:
number`. Apply via the active element's `GainNode` whenever song changes:
`gain = 10 ^ (dB / 20)`. Always-on; harmless (gain=1) when tag absent.

### d. Equalizer

5 fixed bands at 60Hz / 230Hz / 910Hz / 3.6kHz / 14kHz. Peaking filters,
Q=1. Five presets: Off / Bass Boost / Vocal Boost / Treble Boost /
Acoustic. UI: a `Sliders` button in `PlayerBar` (next to the volume icon)
that opens an above-button popover (PlayerBar is at viewport bottom).
Outside-click dismiss via document `mousedown` listener. Active-preset
button tinted with the brand gradient. Preset name persists via
`storage.getEqPreset` / `saveEqPreset`.

**Notable decisions**:
- **No useAudioEngine cleanup**: React 18 StrictMode runs effects twice
  in dev; permanent audio-element capture means we can never re-init. Let
  the AudioContext live for the page's lifetime — browser cleans on tab
  close. Removed the "closes context on unmount" test since it conflicted
  with this reality.
- **`onEnded` ref dance in App.tsx**: `handleEnded` references engine
  returns (`seek`, `togglePlayPause`, `playNext`) defined *after*
  `useAudioEngine` in source order. Pass a stable `() =>
  onEndedRef.current()` to the hook; update `onEndedRef.current = playNext`
  after definitions exist.
- **Volume slider out of scope** (Phase 4+).
- **Crossfade out of scope** (gapless is the right default; crossfade is
  stylistic and goes Phase 5+ if at all).

---

## Phase 3.5 — Firefox/Safari persistence (shipped)

Status: ✅ merged (`b09eff9`).

User reported: "after reload the music file is not there anymore in
firefox." Phase 1's FS Access design is Chromium-only — Firefox/Safari
wiped the library on every refresh, and the upload modal compounded the
problem by showing a defensive "Library persistence requires Chrome, Edge,
or Brave" note that the user (correctly) found off-putting.

**Approach**: per-song hybrid. `StoredSong` became a discriminated union:

```ts
type HandleStoredSong = SongMeta & { fileHandle: FileSystemFileHandle };
type BlobStoredSong   = SongMeta & { blob: Blob; fileName: string };
type StoredSong       = HandleStoredSong | BlobStoredSong;
```

Songs with a `fileHandle` (Chromium folder ingest) still serialize as
`HandleStoredSong` — zero byte duplication. Songs with only a `file`
(Firefox/Safari, *and* Chromium single-file drops) serialize as
`BlobStoredSong` — bytes copied into IDB, file name stored alongside for
`new File()` reconstruction on reload.

**`ensurePersisted()` helper**: requests `navigator.storage.persist()` so
the browser won't evict IDB under quota pressure. Calls `persisted()`
first to skip Firefox's permission prompt when already granted from a
prior session. Fired once per session on first ingest (inside
`handleFiles` / `addFolderHandle`), guarded by `persistRequestedRef`.

**UI change**: deleted the rude note entirely. Dropped the "(persists
across reloads)" parenthetical from the Choose Folder button label —
true via every path now.

**Notable decisions**:
- **Chromium single-file drops now persist too** — used to be documented
  as "session-only." Strictly an improvement.
- **`toStored` prefers `fileHandle` when both are present** — no point
  duplicating bytes when the handle works.
- **iOS Safari evicts IDB after 7 days idle** even with persistent
  storage. Browser-imposed, we can't override. Accepted limitation.
- **No Chromium migration**: existing handle-stored libraries keep
  working; no code path forces a switch to blob storage.

---

## Phase 4 — Visual polish (shipped)

Status: ✅ merged (`8bc1a2d`).

Two pure-UI additions, no audio engine changes:

- **Dynamic background tint** — extracts the dominant color from the
  playing track's cover art via a 20×20 canvas downsample + HSL hue
  bucketing (`src/lib/colors.ts`). Applied as a radial gradient glow
  emanating from the bottom center, transitioning over 1.5s on song
  change. `useDominantColor` hook bridges async extraction to React
  state with an abort guard for fast skipping.
- **Document Picture-in-Picture mini player** — `MiniPlayer` component
  rendered into a PiP window via `React.createPortal`. Stylesheets
  copied from the main document so Tailwind works in PiP. Chromium 116+
  only (feature-detected; button hidden elsewhere). Auto-closes when
  `currentSong` becomes null.

**Key files added**:
- `src/lib/colors.ts` + test — dominant-color extraction
- `src/hooks/useDominantColor.ts` — extraction hook
- `src/components/MiniPlayer.tsx` + test — PiP content
- `src/vite-env.d.ts` — Document PiP API type declarations

**Notable decisions**:
- **Regular canvas, not OffscreenCanvas** — avoids `drawImage` edge cases
  with blob URLs in some browser contexts.
- **Radial gradient glow, not flat overlay** — an early flat overlay at
  low opacity was invisible. The radial gradient centered at the bottom
  creates a visible, natural-looking glow.
- **No Video PiP fallback** — consistent with the "Chromium gets rich
  features, Firefox/Safari get graceful degradation" pattern.

---

## Phase 5 — Library editing & import (shipped)

Status: ✅ merged (`5c6b972`).

Three independent "manage your library" features in one phase:

- **Drag-to-reorder + multi-select delete** — `@dnd-kit/core` +
  `@dnd-kit/sortable` power the drag UX. `GripVertical` icon as the
  drag handle, visible on hover, hidden when search filter is active
  (reordering a filtered subset is ambiguous). Click / Shift+click /
  Ctrl+click selection with a floating toolbar showing "N selected" +
  batch delete. Delete key works when songs are selected.
- **M3U / PLS playlist import** — `src/lib/playlist-import.ts` parses
  both formats. Entries match by filename (case-insensitive) against
  Library songs. Imported playlists appear in the sidebar; a
  notification shows match results (e.g., "Created 'Mix' with 8 of 10
  tracks (2 not found)"). Auto-dismisses after 5s.
- **LRC synced lyrics** — three sources: embedded SYLT (synced tags
  via `music-metadata`'s `common.lyrics[].syncText`), embedded USLT
  (unsynced text via `.text`), and dropped `.lrc` files parsed by
  `src/lib/lrc.ts`. `LyricsPanel` slides in right of SongList (full
  overlay on mobile), auto-scrolls to the active line via
  `scrollIntoView` (only when index changes, not every tick). Toggle
  with `L` key or "Lyrics" header button.

**Key files added**:
- `src/lib/playlist-import.ts` + test — M3U/PLS parsing + matching
- `src/lib/lrc.ts` + test — LRC parsing + `activeLyricIndex`
- `src/components/LyricsPanel.tsx` + test

**Notable decisions**:
- **Selection state local to SongList** (not in App.tsx) — same
  precedent as PlayerBar's `eqOpen`. Selection is UI-only state with
  no cross-component consumer until the user acts (delete).
- **`@dnd-kit` dependency justified** — ~15KB gzipped for touch
  support, keyboard accessibility, and smooth animations. HTML5 DnD
  has poor touch UX.
- **File routing in `handleFiles`** — playlist and LRC files are
  separated before the audio loop, then processed in order (audio
  first so LRC matching has songs to match against).
- **Lyrics persist via `SongMeta`** — no storage.ts changes needed;
  the `lyrics` field flows through existing `toStored`/`fromStored`.

---

## Phase 5.5 — Polish, fixes, and library management UX (shipped)

Status: ✅ merged (`1fafece`).

Manual testing after Phase 5 surfaced four bugs and several UX gaps. This
phase was a polish + critical-fixes pass — not a new feature spike.

**Bug fixes**:
- **Cover art persistence** — `coverArt` was being stored as a stale blob
  URL that became invalid on reload. Fix: persist the underlying `coverBlob`
  in IDB; regenerate the URL via `URL.createObjectURL` in `fromStored`.
  Songs ingested before this fix self-heal via a background re-extraction
  in `App.tsx` (guarded by `healedCoversRef`).
- **EQ presets too subtle** — bumped gain values for noticeable effect
  (Bass Boost +8/+5, Treble Boost +5/+7, Acoustic +5/+3/-2/+4/+5).
- **Volume control was a static icon** — replaced with a real slider in
  PlayerBar, with mute toggle, persisted via `storage.getVolume` /
  `saveVolume`. Icon swaps between `Volume2 / Volume1 / Volume / VolumeX`.
- **Click no longer played** (Phase 5 regression) — restored play via
  double-click; row body single-click is now reserved for selection mode.

**New UX features**:
- **Long-press selection mode** — 500ms press enters selection mode
  with checkboxes per row. Select all + Cancel buttons in the toolbar.
  Also explicit "Select" button in the header. Escape exits.
- **Confirmation modals** — reusable `ConfirmModal` for all destructive
  actions: delete song, batch delete, delete playlist. Backdrop click
  and Escape cancel.
- **Drag songs between playlists** — DndContext lifted from SongList
  to App.tsx so it spans both Sidebar and SongList. Sidebar playlist
  rows are now droppable. Default = copy; Ctrl/Meta+drag = move
  (Library never deletes).
- **Refresh library** — re-walks the FS Access handle, diffs by stable
  ID (`${root.id}/${relativePath}`), adds new files and removes orphans
  from the Library and any user playlist that referenced them. Chromium
  only (Firefox/Safari blob path has no folder handle to re-walk).
- **Export playlist as M3U** — `src/lib/playlist-export.ts` serializes
  to M3U with `#EXTINF` headers. Round-trips through Phase 5's import.

**Key files added**:
- `src/components/ConfirmModal.tsx` + test
- `src/lib/playlist-export.ts` + test

**Notable decisions**:
- **DndContext lifted to App.tsx** — required for cross-component drag
  (Sidebar drop targets need to see drags from SongList). SongList keeps
  its SortableContext for reorder.
- **Selection mode state split**: `selectedIds` stays local to SongList;
  `selectionMode` is lifted to App so Escape and the Select header
  button can drive it.
- **Confirmation modal owns its own Escape** via capture-phase listener
  so it intercepts before the App-level chain.
- **Library refresh removes orphans from user playlists too** — if a
  file vanishes from disk, it's unplayable; keeping the reference would
  be confusing. Acceptable trade-off vs. preserving manual curation.

---

## Phase 5.7 — Performance and scale (shipped)

Status: ✅ merged (`a5ac441`).

The Phase 5.5 audit listed five deferred perf items. This phase ships
all five so the player stays smooth from ~50 to thousands of songs.

- **Virtualization** (`@tanstack/react-virtual`) — SongList renders only
  the visible rows (plus 6 overscan). DOM stays at ~25 nodes regardless
  of library size. SortableContext still receives all IDs so @dnd-kit
  works for reorder + cross-playlist drag on off-screen items. Custom
  `observeElementRect` falls back to a 1024×5000 viewport in happy-dom
  so tests still render rows.
- **React.memo on SortableRow** with stable props. `dragIds` moved
  inside the row as `useMemo`; parent callbacks (`handleRowClick`,
  `handlePlaySong`, `handleDeleteSong`) wrapped in `useCallback` with
  refs for state they read. A naive `useCallback([songs])` would
  recreate on every list mutation and defeat memo entirely.
- **Debounced save** — `savePlaylists` waits 500ms after the last
  mutation. A folder of 200 songs is one save instead of 200. Trade-off
  documented: tab close within 500ms loses pending changes.
- **Object URL revocation** — `useEffect([playlists])` diffs the song
  list and revokes URLs for removed songs. Deferred via `setTimeout(0)`
  so `<audio>` element teardown completes first. `currentSongIdRef`
  prevents revoking the URL of the currently-playing song mid-transition.
- **Quota awareness** — `StorageQuotaError` wraps IDB's native
  `DOMException`. Save handler branches on it to show a "Storage full"
  notification instead of silently failing. This was likely the root
  cause of the "library gets reset" symptom — quota overflow rejected
  the save promise but the UI didn't know.

**Key files added/touched**:
- `src/components/SongList.tsx` — virtualizer, memo, stable handlers
- `src/App.tsx` — debounce, URL revoke effect, quota error branch
- `src/lib/storage.ts` — `StorageQuotaError`, `getStorageEstimate`

**Notable decisions**:
- **`@tanstack/react-virtual` over `react-window`** — modern hooks API,
  handles variable row heights gracefully via `measureElement`.
- **State in refs, not deps**: the perf gain from memoization only
  materializes if callbacks are stable. Several handlers read from
  refs (`songsRef`, `selectionModeRef`, `filteredSongsRef`,
  `activePlaylistIdRef`, `playlistsRef`, `currentSongIdRef`) rather
  than taking those values as `useCallback` deps.
- **Not wired**: 90%-full warning, OPFS migration, image resizing of
  cover blobs, Web Worker for metadata extraction. All listed as
  "future, if needed." *(Resolved 2026-08-09: warning shipped 2026-08-08;
  worker + cover downscaling shipped — see CLAUDE.md "Ingest pipeline";
  OPFS considered and DEFERRED: it would only replace the Firefox/Safari
  IDB-blob path at the cost of resumable byte-migration scaffolding —
  revisit only under real quota pressure.)*

---

## Phase 6 — Distribution (shipped)

Status: ✅ merged.

Last phase before the player feels "done." Two additions, both keeping the
"nothing leaves your device" promise:

- **PWA install + manifest** — Vibes is installable to the dock / home
  screen via `vite-plugin-pwa` (Workbox SW precaches the shell for offline
  launch; a previously-loaded library still plays from disk / IDB). App
  icons are generated from a 512×512 brand SVG by
  `@vite-pwa/assets-generator` and committed. A header **Install** button
  uses `beforeinstallprompt` on Chromium; iOS Safari (which never fires it)
  gets an "Add to Home Screen" hint instead (`useInstallPrompt`).
- **Shareable now-playing URL** — a **Share** button encodes the current
  track's metadata (title/artist/album/duration, **never** the file) into a
  `#s=<base64url>` hash fragment (`src/lib/share.ts`, unicode-safe). Opening
  such a link pops a `SharedTrackModal` describing the track, then strips the
  hash. Uses `navigator.share` when present, else clipboard + toast.

**Key files added**:
- `src/hooks/useInstallPrompt.ts` — `beforeinstallprompt` + iOS detection
- `src/lib/share.ts` + test — metadata encode/decode core (the tested unit)
- `src/components/SharedTrackModal.tsx` + test — arrival card
- `pwa-assets.config.ts`, `public/pwa-icon.svg` + generated icon PNGs

**Notable decisions**:
- **`base: './'` → `base: '/'`** — vite-plugin-pwa needs an absolute base or
  the service worker's scope is broken. Safe because all deploys are
  root-domain. The one non-additive change in the phase.
- **Icons generated then committed** — keeps `sharp` (a native dep, added to
  `pnpm.onlyBuiltDependencies`) off the normal install/build path. A
  `!public/*.png` exception in `.gitignore` lets the icons past the blanket
  `*.png` screenshot ignore.
- **Metadata-only share, no library matching** — recipient sees a card, not
  a play button; honest to the local-first model. Cover art and whole-
  playlist sharing left out of scope (URL-size + complexity).
- **`pwaAssets: { config: true }`** auto-injects the manifest icons + HTML
  head links, so they're never hand-maintained.

---

## AFTERGLOW redesign — Phase A: Skin (shipped)

Status: ✅ merged to `main` (Phase C planned).

A warm "analog-dusk" reskin replacing the cold slate + purple/pink Apple-Music
look with a plum-night → amber/coral aurora, the Fraunces serif, and frosted
surfaces. Design handoff lives in `pencil-design/` (`AFTERGLOW.md` spec + `.pen`
frames). **Phase A is presentational only — zero behaviour change.**

- **Token theme** in `tailwind.config.js` (was an empty `extend`): the colour
  set, Fraunces/Inter/Geist-Mono families, radii, and `breathe`/`spin-slow`
  keyframes (the last unused until Phase C).
- **Self-hosted fonts** via `@fontsource-variable/*` (imported in `main.tsx`),
  so they precache in the SW and survive offline — no Google `<link>`.
- **Aurora background** (`.aurora-bg` in `index.css`, fixed `z-[-1]`) behind a
  now-transparent App root; the per-track tint overlay still layers on top.
- **Semantic recolor** of `App.tsx` + 8 components: primary `from-amber
  to-coral` with `text-deep` glyphs (white-on-amber fails AA), visualizer
  `from-coral to-gold`, active states `text-amber`, surfaces → `surface`,
  destructive → a distinct `danger` red (not coral — kept separate from the
  primary accent), serif titles, mono timecodes.
- **PWA rebrand**: icons/favicon regenerated amber→coral, manifest
  `theme_color` → `#150A24`, stale "Apple-Style" HTML branding → Vibes.

**Notable decisions**:
- This is a **one-time reskin, not a theming system** — consistent with the
  "pick a good default, stick with it" rule below.
- `text-white` deliberately **not** swept to `cream` (white-on-plum is safe;
  the `body` default is already cream) — keeps Phase A tight.
- The four tests asserting old `purple-*` classes were updated as style
  snapshots; all behaviour tests stay green (163, unchanged).

Phase C (motion) is planned separately.

---

## AFTERGLOW redesign — Phase B: Orb + colour routing (shipped)

Status: ✅ branch `afterglow-b-orb`.

Where the identity lands: the signature **VibeOrb** + a desktop **now-playing
hero**, plus the two cheap real features the user approved. Still no audio-graph
changes — it reuses the existing dominant-colour extraction.

- **`--vibe` colour routing** — `tintColor` published as a CSS variable on the
  App root; the orb glow + hero progress fill `color-mix` against it. The bottom
  `PlayerBar` stays static amber on purpose (no per-song flicker).
- **`VibeOrb`** — album art (or generative fallback) as a glowing disc in a conic
  mood-ring; `motion-safe` breathe/spin gated on `isPlaying`. Reused in the PiP
  `MiniPlayer`.
- **`NowPlayingHero`** — desktop-only (`lg+`), **display-only** banner above the
  list (transport stays in the bottom bar, which the hero scrolls past). Orb +
  serif title + genre/BPM chips + scrubbable tinted progress.
- **Shuffle** — `nextInPlaylist(…, shuffle)` random pick; `nextSong` memoized so
  the gapless preload and `playNext` agree (the one correctness-sensitive bit).
- **Sort** (view-only) + **genre/BPM chips**; genre chips click-to-filter via an
  extended `filterSongs`; `bpm` read from `meta.common.bpm` (persists free).

**Notable decisions**:
- Hero is **display-only** — no duplicated transport, no Heart (Favourites +
  Queue bundle into a later phase). Mobile full-screen now-playing view (frame D)
  deferred; no dead "expand" affordance shipped.
- New tests for VibeOrb / NowPlayingHero / sort + queue/filter additions — **187
  green** (was 163).

---

## AFTERGLOW redesign — Phase C: Motion polish (shipped)

Status: ✅ branch `afterglow-c-motion`. **Closes the AFTERGLOW arc.**

The remaining §6 motions plus a `prefers-reduced-motion` posture. Purely
presentational — no behaviour/audio/layout change.

- **Cover-art cross-dissolve** (§6 #5) — `fadeIn` keyframe + `key`-remounted
  `motion-safe:animate-fade-in` on the orb (over an always-present gradient
  backdrop) and the player-bar thumbnail.
- **Lyrics active-line scale** (§6 #7) — `motion-safe:scale-105 origin-left` on
  the active line as it scrolls into focus.
- **Play/pause press feedback** (§6 #8) — `motion-safe:active:scale-95` + an
  amber `active:shadow` glow on the PlayerBar + MiniPlayer play buttons.
- **Reduced motion** — every looping/transform motion is `motion-safe:` gated
  (compiles to `prefers-reduced-motion: no-preference`); colour/tint transitions
  stay. No global transition killer.

Orb breathe + mood-ring spin (§6 #1/#2) already shipped in Phase B; visualizer
(#3) + tint crossfade (#4) + hover/surface transitions (#6/#9/#10) predate
AFTERGLOW. **188 tests green** (was 187).

---

## Mobile responsiveness (shipped)

Status: ✅ branch `mobile-responsive`.

The AFTERGLOW redesign was desktop-first and **broke on phone widths** (header
buttons + player-bar controls clipped off-screen; no now-playing surface). Fixes:

- **Header** actions `flex-wrap` instead of clipping "Add Music".
- **Mobile player bar** → a slim mini bar: the right cluster (visualizer/PiP/EQ/
  volume) is `hidden lg:flex`; cover+title becomes a tap target.
- **`MobileNowPlaying`** — full-screen (`lg:hidden`) frame-D view opened from the
  mini bar: the orb wrapped by a new **`OrbVisualizerRing`** (48 radial bars),
  title, scrubbable progress, full transport, and the relocated lyrics/EQ/volume/
  share controls. Closes via chevron / Escape / track-end.

Desktop unchanged. **196 tests** (was 188). No new product features — purely
layout + a presentational view reusing existing engine state.

**Polish round 2** (branch `responsive-polish`, **202 tests**): animated sidebar
slide (dropped the `display:none` snap), compact desktop hero (frees the song
list), a mobile header `⋯` overflow menu (`HeaderMenu`), and `ScrollingText`
marquee for long titles + a clearer (mic) lyrics icon.

**Polish round 3** (same branch): glass-styled sidebar toggle buttons, tighter
header + hero/list spacing, lighter (cream) song-row titles, mobile per-song
delete moved to selection mode, the now-playing view now opens on **desktop too**
(click the player bar), and a lyrics z-index fix (toggling lyrics from the view
closes it so the panel shows).

---

## Online lyrics + embedded-lyrics fix (shipped)

Status: ✅ branch `lyrics-online`.

- **Embedded fix**: extraction moved to `src/lib/lyrics.ts` `extractLyrics`, which
  now also scans `meta.native` for lyric frames `music-metadata` doesn't map to
  `common.lyrics` (`TXXX:LYRICS`, `UNSYNCEDLYRICS`, `©lyr`) — the reason many
  embedded-lyrics files showed nothing.
- **Online (LRCLIB)**: `src/lib/lyrics-online.ts` `fetchLyricsOnline` — free, no
  key, CORS-open, metadata-only, synced LRC via the existing `parseLRC`.
- **"Find lyrics"** button (lyrics-panel empty state) re-parses the file first
  (recovers embedded lyrics for the *existing* library, which reload/Refresh
  don't re-extract), then LRCLIB; result merged + persisted (offline after).
  Manual-only this round.

**217 tests** (was 202). Verified the in-browser LRCLIB fetch returns real synced
lyrics (CORS works at runtime) + graceful no-match.

---

## Post-1.0 wave — perf round 2, Favorites, Queue (shipped, Aug 2026)

- **Startup perf round 2**: code-split the deferred UI surfaces (modals,
  MiniPlayer, LyricsPanel, MobileNowPlaying) + import/export libs out of the
  startup chunk (`index` 159→145 kB); SW navigation preload; lazy
  `music-metadata`; parallel library restore; `vite:preloadError` reload
  guard against post-deploy stale-chunk 404s. User-confirmed fast in
  production Firefox; `[perf]` diagnostic logs removed after verification.
- **Rename playlists** (sidebar pencil → prefilled PromptModal, select-on-open).
- **Favorites**: `Song.favorite` flag (persists via the storage Omit+spread
  for free), hearts in rows / hero / player bar, virtual "Favorites"
  sidebar view derived from all playlists (deduped — ingest adds only to
  the active playlist, so Library is not a strict superset). Drop-on-row
  hearts in bulk. Shuffle/gapless protected by keying the `nextSong` memo
  on track identity.
- **Play-next queue**: pure `resolveNextSong`/`upNextPreview` in
  `lib/queue.ts`; session-only `queue` state; `RowMenu` (the previously
  dead `⋯` button); lazy `QueuePanel` (LyricsPanel pattern) with editable
  queue + honest up-next preview; PlayerBar/MobileNowPlaying/`Q` openers,
  Lyrics↔Queue exclusivity. Notable catches: queueing the current song
  would infinite-loop against the engine's replay-in-place path (now
  guarded); the row menu was occluded by virtualized-row stacking contexts
  (z-index raise on the open row); **Spotify-style drain-back** — playback
  resumes from the pre-queue bookmark, not the queued song's position.
- **Fixes along the way**: playlist-scoped song delete (dialog and behavior
  finally agree; Library/Favorites delete stays app-wide with honest copy),
  `.m3u` double-ingest (`audio/x-mpegurl` passes the audio filter), 90%
  storage-quota warning toast wired to `getStorageEstimate()`.
- Full design/audit trail for the queue: `docs/superpowers/specs/`
  `2026-08-07-queue-panel-design.md` (with amendments).

## Out of scope (forever)

- **Cloud sync / accounts** — would break the "nothing leaves your device"
  promise.
- **Streaming service integration** (Spotify, Apple Music) — different
  product entirely.
- **Plugin system / theming** — the foobar2000 trap. Pick a good default,
  stick with it.
- **Library management UI** (smart playlists, ratings everywhere) — turns
  into iTunes circa 2010.

---

## Quick reference: shipped commits

| Phase | Headline commit |
|---|---|
| Initial (recovery) | (multiple) |
| 0 | `b3f7170` — `test: Add Vitest + RTL setup (Phase 0)` |
| 1 | `a858f8b` — `feat: Folder drop + File System Access persistence (Phase 1)` |
| 2 | `6ef9332` — `docs: Keyboard shortcuts + Media Session sections` (final of 4 commits) |
| 3 | `43b12b8` — `docs: Audio engine section + Phase 3 features in README` (final of 5 commits) |
| 3.5 | `b09eff9` — `feat: persist library via IDB blobs as fallback for Firefox/Safari` |
| 4 | `8bc1a2d` — `fix: boost tint visibility with radial gradient glow` (final of 3 commits) |
| 5 | `5c6b972` — `docs: Phase 5 features in CLAUDE.md and README` (final of 4 commits) |
| 5.5 | `1fafece` — `feat: refresh library from disk and export playlist as M3U` (final of 6 commits) |
| 5.7 | `a5ac441` — `feat: surface quota exceeded errors with a graceful notification` (final of 5 commits) |
| 6 | `a81684b` — `feat: share button and shared-track arrival card` (headline feature; docs commit follows) |
| AFTERGLOW A | `213b5e4` — `feat: recolor UI to amber/plum; serif titles, mono timecodes` (skin reskin; 3 feat + docs commits) |
| AFTERGLOW B | `feat: now-playing hero (desktop, display-only) with vibe-tinted orb` (orb + hero + shuffle/sort/chips; 4 feat + docs commits) |
| AFTERGLOW C | `feat: cross-dissolve cover art on track change` (motion polish; 2 feat + docs commits) |
| Mobile | `feat: mobile now-playing view + slim mobile player bar` (header wrap + mini bar + frame-D view + visualizer ring; 3 + docs commits) |
| Polish 2 | `fix: animate sidebar open/close` + compact hero + header `⋯` menu + scrolling titles (4 + docs commits) |

| Perf round 2 | `290367f` — `perf: code-split deferred UI surfaces + import/export libs out of startup chunk` |
| Rename | `bf32a37` — `feat: rename playlists via prompt modal` |
| Favorites | `1ae0cad` — `fix: preserve playlist refs on favorite toggle; honest Favorites delete copy` (final of 7) |
| Queue | `bb54bab` — `feat: Spotify-style queue drain-back (resume from pre-queue position)` (final of 6) |

Total: 263 tests, all green; `pnpm build` clean; production live.
