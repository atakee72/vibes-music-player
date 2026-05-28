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
  thin enough.)

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

## Phase 6 — Distribution (planned, next up)

Status: 📋 planned.

Last phase before the player feels "done":

- **PWA install prompt + manifest** — make Vibes installable to dock /
  home screen. Offline support follows for free (the app is already
  static, just needs the service worker).
- **Shareable URL of playback state** — encode track metadata (title,
  artist, etc., NOT file content) in a URL fragment so users can share
  "what I'm listening to" without uploading anything. Recipient sees the
  metadata; can't play it back without their own file.

---

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

Total: 139 tests, all green; `pnpm build` clean; production live.
