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
- **Two gain nodes per chain, and the split is load-bearing**:
  `filters → gain (ReplayGain) → fade (crossfade) → mixer`. ReplayGain writes
  an ABSOLUTE per-track ratio via `setValueAtTime`; a crossfade ramps 0..1.
  Sharing one node would make them overwrite each other and silently break
  loudness normalisation. **Never ramp the `gain` node, never `setValueAtTime`
  an absolute level onto `fade`.** `volume` is separate again — it's set on
  `audio.volume`, not in the graph.
- **Crossfade** (`crossfadeSeconds`, 0 = off → the old gapless path runs
  byte-for-byte). Fires from `timeupdate`, NOT `ended` — by the time `ended`
  arrives there is nothing left to fade. Guards, all necessary:
  finite `duration`; `remaining <= xfade`; `duration > xfade * 2`;
  `nextSong.url !== active.src` (**repeat-one replays the same element in
  place — one element cannot crossfade with itself**); the inactive element
  actually holds `nextSong.url`; and no fade already in flight.
  `PRELOAD_LEAD_SECONDS` is widened to `max(5, xfade + 1)` or the incoming
  track wouldn't be loaded when the fade is due.
- **The crossfade flips `activeRef` at the START of the fade**, then plays the
  incoming element and calls `onEnded` immediately. This is what keeps it
  safe: no cancellable half-state, `seek`/`togglePlayPause` address the new
  track, and the outgoing element's later `ended`/`pause` events are swallowed
  by the existing `!== activeAudio()` guards. The UI advancing when the fade
  begins is intended.
- **`fadingOutRef` is the invariant keeper.** A crossfade is the only window
  where TWO elements sound at once, and every other code path assumes one.
  While it's set: `togglePlayPause`/`seek`/a song change cut the tail (else a
  pause leaves the outgoing track audible alone); the **inactive-chain
  ReplayGain effect is deferred** (that chain is the one still fading — writing
  the next-next track's gain onto it makes the outgoing track jump level
  mid-transition); and **preload is skipped** (it would overwrite the fading
  element's `src`). It doubles as the re-entry guard — don't replace it with a
  flag keyed on src, which breaks A → B → A.
- **`forceGain` exists because `setValueCurveAtTime` LOCKS its param** for the
  curve's duration: a bare `setValueAtTime` inside that window throws
  `NotSupportedError`, and `cancelScheduledValues` does not remove a curve
  that already started. Every cancel path (pause mid-fade is the common one)
  must go through it — it tries `cancelAndHoldAtTime`, falls back, and
  swallows, so a cancel can never throw out of a click handler.
- **Sleep timer**: `fadeOutAndPause(seconds)` ramps the **master mixer** to
  silence, then pauses and restores the level. Deliberately not the `volume`
  state — that is persisted, so fading it would write the faded value to
  storage and destroy the user's setting. The analyser hangs off the mixer, so
  the visualizer fades along with the audio (intended). The deadline lives in
  `App.tsx` as `sleepDeadline` (epoch ms) and is **session-only, never
  persisted**; one effect owns both the firing `setTimeout` and a 1s
  `setInterval` that exists only to re-render the countdown label.
- **EQ band map**: 5 `BiquadFilterNode`s per element, `type='peaking'`, `Q=1`,
  frequencies `[60, 230, 910, 3600, 14000] Hz`. Presets and `applyPreset`
  live in `src/lib/eq.ts`. The preset name persists via `storage.getEqPreset`/
  `saveEqPreset`. Apply changes via `setValueAtTime` for sample-accuracy.
- **Why the `onEnded` ref dance in App.tsx**: handleEnded references engine
  returns (`seek`, `togglePlayPause`, `playNext`) defined *after* useAudioEngine
  in source order. We pass a stable `() => onEndedRef.current()` to the hook
  and update `onEndedRef.current = playNext` after definitions exist.

## Interop contract (beets, Navidrome, NAS — for external tooling)

Facts other tools (e.g. a beets-managed library feeding Vibes) must know:

- **Vibes reads EMBEDDED tags only** via `music-metadata`: title, artist,
  album, genre (first entry), bpm, year, bitrate, duration, ReplayGain
  (`replaygain_track_gain` — beets' `replaygain` plugin writes this),
  embedded lyrics (USLT/SYLT + common `TXXX:LYRICS`-style frames), and
  **embedded cover art only** — `cover.jpg`/folder art files are invisible
  to Vibes. A beets setup feeding Vibes should `embedart`.
- Vibes downsizes embedded art to ≤512px for ITS OWN storage — it never
  writes anything back to the files. Vibes is strictly read-only on the
  music files themselves.
- **Song ids are path-based** (`${root.id}/${relativePath}`): renaming or
  moving files (e.g. beets re-organizing by `$albumartist/$album/…`)
  changes ids → Vibes' Refresh treats it as remove+add, and playlist
  membership/hearts are lost. **Stabilize beets path formats BEFORE bulk
  ingest into Vibes**, and export playlists as M3U before any mass
  reorganize (M3U import re-matches by filename, case-insensitive).
- M3U is the interchange format both ways (import `.m3u/.m3u8/.pls`,
  export `.m3u` with `#EXTINF`) — also how playlists can bridge to
  Navidrome (it reads M3U from the music dir).
- Current library location: a Dropbox-synced local folder (must be
  "available offline" — online-only placeholders stall ingest). Planned:
  UGREEN NAS via SMB mount (Chromium FS Access works on mounted shares);
  Navidrome covers remote/mobile, Vibes is the LAN/desktop + offline-PWA
  player. Subsonic-client support considered, deliberately not built.

## Ingest pipeline (worker + downscale)

- **Tag parsing runs in a Web Worker** (`src/workers/metadata.worker.ts`),
  fed through `src/lib/metadata-client.ts`: request/response by id, a
  concurrency pool of `min(4, max(2, hardwareConcurrency-1))` (single
  worker — the pool pipelines rather than parallelizes; the win is getting
  parses OFF the main thread), and a main-thread fallback (same `parseBlob`
  + `extractSongMeta` path). Vitest forces the fallback
  (`import.meta.env.MODE === 'test'` — happy-dom defines a Worker stub, so
  presence-detection alone is wrong). **Every worker failure mode fails
  over**: construction error, `onerror`, `onmessageerror`, a
  `workerEnv: true` response (the worker's own music-metadata import
  failed), and a 30s per-request timeout (a killed worker process fires NO
  event — without the timeout the pool would leak slots and ingest would
  hang forever). Extraction must never break, and never hang, because the
  worker did.
- **`vite.config.ts` needs `worker: { format: 'es' }`** — the default iife
  can't code-split, which would inline every music-metadata parser chunk
  into one monolithic worker file. The worker shell is ~2 kB; parsers load
  dynamically inside it.
- **`src/lib/metadata-core.ts`** is the pure, structured-clone-serializable
  field mapping shared by worker and fallback — no Blob/URL creation there
  (raw `picData`/`picFormat` bytes come back; the hook builds Blobs).
- **Cover art is downscaled before persisting** (`src/lib/cover.ts`,
  512px cap, JPEG q0.85 — PNG input stays PNG so alpha never goes black;
  main-thread Image+canvas, the same plain-canvas approach as colors.ts).
  Contract: NEVER worse than the original — decode failure, small-enough
  images, and a decode timeout all return the original blob. Applied in
  `useMetadataExtractor` AND App's cover self-heal effect (the self-heal's
  parse stays main-thread on purpose: rare one-shot migration).
- **All three ingest call sites are parallel** (`handleFiles`,
  `addFolderHandle`, `refreshLibrary`): `Promise.all` over `map` (order
  stable), the client pool bounds concurrency. `handleFiles` flushes the
  contiguous ready PREFIX every ~8 completions (index-addressed results
  array) so songs appear progressively in drop order; the other two sites
  batch once. `extractMetadata` never rejects (fallback Song), so
  `Promise.all` is safe.
- **OPFS migration: considered and deferred (2026-08-09)** — it would only
  replace the Firefox/Safari IDB-blob path + coverBlobs, at the cost of
  resumable byte-migration scaffolding. Revisit only under real quota
  pressure.

## Listening stats

- **`onTrackFinished` is NOT `onEnded`, and the distinction is the whole
  feature.** `onEnded` means "app, advance your state"; `onTrackFinished` means
  "this track reached its end". They diverge in both directions:
  - **repeat-one** replays in place and deliberately never calls `onEnded` — but
    it IS a completed play, so looping one track all evening must still count;
  - **under crossfade the DOM `ended` event never fires at all** (the outgoing
    element is paused at the top of the fade), so anything counting on `ended`
    silently records **zero plays** for every user with crossfade on.
  Fired at exactly two places in `useAudioEngine`: the top of `onAudioEnded`
  (covering repeat-one, the gapless flip and the plain end) and inside
  `startCrossfade`, **before** `onEnded`. Don't add a third.
- **The manual Next button must never count.** `playNext` is shared — the engine
  calls it via `onEndedRef`, the Next button calls it directly — so the counter
  hangs off the engine callback, never off `playNext`.
- **Stats live in their own `StatsMap` (`src/lib/stats.ts`), keyed by song id,
  NOT as a field on `Song`.** `Song.favorite` makes the field look tempting (it
  persists free via storage's `Omit`+spread), but writing to a song inside
  `activePlaylist.songs` would (1) **re-roll shuffle** — that array is a
  reference dep of the `nextSong` memo, so every track end would recompute the
  random pick and desync the gapless preload — and (2) rewrite the entire
  library through the `[playlists]` save effect every few minutes.
- `title`/`artist` are **denormalised** into each stat and refreshed on every
  finish, so the panel needs no join against the library and deleting a song
  doesn't make historical totals lurch. Ids are path-based, so a beets rename
  orphans stats — same fragility as hearts, see the interop contract.
- Persisted under `listening-stats` via `storage.getStats`/`saveStats`, gated on
  `prefsLoadedRef` (**not** `loadedRef` — that one guards the library).
- Consequences of the count-on-finish rule, by design: a skip at 95% counts
  nothing; **total listening time is the sum of completed durations**, so
  partial listens are invisible; and under crossfade the count lands `xfade`
  seconds early.

## The right-edge panel slot

- Lyrics, Queue and Stats share one slot and are mutually exclusive. Every
  opener goes through **`togglePanel(name)`** in `App.tsx` — before it existed,
  seven separate call sites hand-paired "open me, close the other", which a
  third panel would have turned into "close the other two" seven times over.
  Add a fourth panel by extending the helper, not by editing call sites.
  Regression-tested in `App.test.tsx` ("right-edge panel exclusivity").
- **`headerActions` feeds ONLY the mobile `⋯` HeaderMenu.** The desktop header's
  inline buttons are hand-written duplicates, so a new header action needs
  **two** edits or it ships invisible on desktop.
- Panels are non-modal: `role="complementary"` + `aria-label`, no focus trap,
  closed via the App Escape chain.

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
- **Space on a focused `<button>` activates the button, not play/pause** —
  app-wide, by design (the a11y focus traps park focus on modal buttons;
  native activation must win). The hook skips Space entirely (no handler,
  no preventDefault) when `activeElement` is a BUTTON.
- Currently wired in App.tsx: Space=play/pause, ←/→=seek ∓10s,
  **Shift+←/→**=prev/next track, `L`=lyrics, `Q`=queue, `S`=stats,
  `/`=focus search,
  Escape=chain (see "Selection mode" section for the full priority order).
  The ←/→ handlers branch on
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
- **Save-effect race guard — this one has already caused real data loss.**
  `loadedRef` gates the `useEffect([playlists])` write. Its meaning is
  precise: **"the in-memory library mirrors storage, so saving is safe."**
  It is therefore set ONLY when a load actually populated state from storage:
  `loadedRef.current = !needsPrompt` on the mount path, and `true` again after
  a successful `restoreLibrary()`. It is NOT set in a `finally`, and NOT on
  the load-failure path (which instead notifies the user that changes aren't
  being saved — silent non-saving is how "my library reset itself" happens).
  **Why it matters**: Chromium forgets FS Access grants across browser
  restarts, so a permission-gated boot renders an EMPTY placeholder library.
  An unconditional guard let the 500ms debounce persist that emptiness over
  the real stored data — destroying playlists/hearts before the "Welcome
  back, click to restore" banner could read them back. Regression-tested in
  `App.test.tsx` ("never overwrites the stored library while a folder
  permission is pending"). **Preferences use a separate `prefsLoadedRef`**:
  `eqPreset`/`volume` are read from storage unconditionally, so they mirror it
  even during a permission prompt and stay saveable.

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
  Mobile keeps the list + bottom bar; the full-screen now-playing view
  (frame D) shipped as `MobileNowPlaying` — see "Mobile layout".
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
  (visualizer + PiP + EQ + volume) is `hidden lg:flex`, leaving cover (left) +
  transport (right). The **cover/title block is a `role="button"`** (not a
  `<button>` — it wraps `<p>`s) that opens the mobile now-playing view.
  **The title is NOT in that block on mobile** — beside the transport controls
  it had ~60px and was unreadable even while marqueeing, so mobile renders
  `title · artist` as a full-width `ScrollingText` line ABOVE the progress bar
  (`lg:hidden`), and the in-cluster text block is `hidden lg:block`. The bar is
  `h-24` at every size — matching the empty state keeps it from jumping when
  playback starts.
- **`MobileNowPlaying`** (`src/components/MobileNowPlaying.tsx`) is the
  full-screen (`fixed inset-0 z-[60]`) frame-D view — the orb wrapped by
  `OrbVisualizerRing`, title, scrubbable progress, full transport, and the
  controls trimmed from the mobile bar (lyrics, EQ, volume, share). Volume is
  a **tap-to-open popover** (round icon button + slider above the row — the
  inline flex-1 slider was unusably narrow there; `volOpen` local state, EQ
  precedent). Root bg is `bg-deep supports-[backdrop-filter]:bg-deep/95` so
  browsers without backdrop-filter get solid, not see-through. **Despite the
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
- **Mobile row actions**: rows show an always-visible `⋯` (`lg:hidden`,
  hidden in selection mode) opening `RowActionSheet` — a bottom sheet
  (usePresence slide-up) with Play next / Add to queue / heart / Delete,
  reusing SongList's existing callbacks; `sheetSong` state is local to
  SongList. **The sheet renders at SongList root, never inside the
  virtualized row wrappers — their `transform` makes them the containing
  block for `position: fixed`** (same trap family as the RowMenu occlusion).
  Mobile rows also show a display-only coral heart beside the duration when
  favorited. Sidebar rename/delete pencils are visible-by-default below
  `lg` (`opacity-100 lg:opacity-0 lg:group-hover:opacity-100`).

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
- **Linked playlists**: an import records `Playlist.importSource` (the source
  file name). Re-importing that file **updates the same playlist** —
  `findLinkedPlaylist` matches on `importSource` only, so re-import never
  duplicates, and the update **replaces** the song list (the file is the
  source of truth; the toast reports `(+A, -B)`). It deliberately does NOT
  adopt a same-named unlinked playlist (importing `Rock.m3u` must never
  silently overwrite a hand-made "Rock"), and never targets
  `library`/`favorites`. Renaming a linked playlist in Vibes is safe — the
  link is the file name, not the display name.
- **Refresh re-syncs linked playlists too**: `refreshLibrary` walks each root
  ONCE with a widened `accept` (audio + playlist files), and for every found
  file that matches some playlist's `importSource` it re-parses and re-matches
  against the POST-refresh library — inside the same `setPlaylists` updater,
  because that's where the new library song list exists (parsing is async, so
  it happens before). Unlinked playlist files on disk are ignored: Refresh
  must never spontaneously create playlists the user didn't import.
  Toast gains `· N playlists re-synced`.
- `ingestDirectoryHandle(handle, prefix, accept)` — **the recursive call must
  forward `accept`**, or files that only exist in a subfolder (the beets
  `Music/Playlists/*.m3u` case) become invisible with no error. Unit-tested.
- **Audio is ingested BEFORE playlists** in `handleFiles`, and the freshly
  extracted songs are threaded into `handlePlaylistImport(files, justIngested)`
  — React state isn't committed yet, so without this a combined songs+`.m3u`
  drop would match against an empty library and create empty playlists.
- **Drag & drop goes through `ingestDataTransferItems`** (`src/lib/ingest.ts`),
  which returns `{ directoryHandles, files }`: Chromium folder drops yield a
  persistable directory handle (App registers it via `addFolderHandle`), while
  Firefox/Safari have no handle API and are walked with
  `webkitGetAsEntry()` + `readEntries()` into session-only files. **App must
  not reimplement this inline** — it did once, handling only the Chromium
  branch, so dropping a folder in Firefox called `getAsFile()` on the folder,
  got a 0-byte non-audio File, and dead-ended. The collector also
  **snapshots every item synchronously before the first `await`** — a
  `DataTransferItemList` is invalidated once the drop handler yields — and
  filters with `isIngestableFile`, so a dropped music folder delivers its
  `Playlists/*.m3u` too (handleFiles then routes them).
- **`src/lib/file-types.ts` owns all file-type predicates** (`isAudioFile`,
  `isPlaylistFileName`, `isLrcFileName`) — a tiny sync-loadable module, so the
  playlist parser can stay dynamically imported. **`isAudioFile` matches MIME
  `audio/*` OR a known extension**: browsers derive `File.type` from an OS
  registry lookup that on Windows routinely returns `""` for `.flac`, `.m4a`,
  `.opus`, `.aiff`, `.wma` — MIME-only detection silently dropped those files
  from every ingest path (drop, picker, folder walk) and produced a
  "no audio files" dead end. It also excludes `.m3u`/`.lrc` by name, since
  Chromium types `.m3u` as `audio/x-mpegurl`.
- File routing in `handleFiles`: playlist files (`.m3u`, `.m3u8`, `.pls`)
  and LRC files (`.lrc`) are separated from audio files and processed
  after audio ingest completes. **The audio filter must exclude playlist
  files explicitly** — Chromium reports `.m3u` as `audio/x-mpegurl`, which
  passes the `audio/` prefix check and would double-process the file as a
  playlist AND a bogus filename-titled "song".

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

## Online cover art (iTunes Search API)

- `src/lib/cover-online.ts` is the only file that knows iTunes exists.
  **Metadata only** (artist/title/album/duration) — no audio, no file bytes,
  same invariant as `lyrics-online.ts` and share links. Free, no key, no
  secret, and **CORS-open on both the JSON and the `mzstatic` artwork host**,
  which is what makes `res.blob()` possible in the browser and is why iTunes
  was chosen over Spotify (whose client-credentials flow needs a server).
- **Matching is strict and scored, never positional.** A live probe had an
  album search for "altin gun on" return Altın Gün *and Elton John*, so
  `result[0]` would paste wrong art across a library. `isConfidentTrackMatch`
  requires normalized artist AND title equality (equality, not containment —
  containment matches "Love" against "Love Story") plus duration within ±7s
  when both sides know it. `isConfidentAlbumMatch` is the fallback for album
  cuts. `normalizeForMatch` is a comparison key, not a display name: its only
  contract is that both sides run through it.
- `fetchCoverOnline` returns a **discriminated `CoverResult`**, not
  `Blob | null`. `'throttled'` (HTTP 403/429) has to be distinguishable from
  `'none'` or the library sweep cannot stop early — and a throttled sweep
  would otherwise read as "your library has no matchable art".
- The search endpoint answers `content-type: text/javascript`. `Response.json()`
  ignores content-type, so it parses — **don't add a content-type guard**, it
  would reject every valid response.
- **Only songs with no art are candidates**, on both surfaces. That is what
  keeps object-URL revocation out of this feature entirely: there is no
  previous `coverArt` URL to free. Replacing existing art is deliberately out
  of scope.
- **The sweep is sequential with a `SWEEP_GAP_MS` gap** — the API rate-limits
  per IP, so Re-scan's `Promise.all` fan-out is exactly wrong here. Its batch
  write merges patches onto the **live** song inside the state updater, never
  a pre-sweep snapshot (same lesson as Re-scan: a heart toggled mid-sweep
  would otherwise be reverted and then persisted).
- Fetched art is downscaled through `downscaleCover` *inside* the module, so
  no caller can forget. It goes into `coverBlob` and **never back into the
  file** — Vibes stays read-only on music files; beets owns tags.
- The header opener needs **two** edits (`headerActions` for the mobile `⋯`
  menu + the hand-written desktop button), per "The right-edge panel slot".

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
  mobilePlayerOpen → selectionMode → close upload → close queue panel →
  close lyrics panel → close sidebar (mobile only) → clear search → blur
  input. ConfirmModal/PromptModal/SharedTrackModal/RowActionSheet own their
  Escape via capture-phase listeners; RowMenu/HeaderMenu/EQ popover/volume
  popover own theirs via component `onKeyDown` + stopPropagation (each
  refocuses its trigger).

## Favorites

- `Song.favorite?: boolean` — persists for free via storage's `SongMeta`
  Omit+spread (no storage.ts changes). `toggleFavorite(id)` in `App.tsx`
  (stable `useCallback([])`) flips the flag across all playlists +
  `currentSong`.
- **"Favorites" is a virtual playlist** (`id: 'favorites'`), derived via
  `useMemo` from ALL playlists' hearted songs (deduped by id — ingest adds
  only to the active playlist, so Library is not a strict superset) and
  spliced into `sidebarPlaylists` for display only. It must NEVER enter
  `playlists` state (never persisted, saved, or URL-diffed). `activePlaylist`
  resolves it via a ternary.
- Guards mirror `'library'`: no rename/delete buttons (Sidebar), early
  returns in App's handlers, reorder disabled via the `isFilterActive` OR.
  Dropping songs onto the Favorites sidebar row marks them favorite instead
  of copying; drag FROM Favorites copies (Ctrl-move degrades to copy).
- Hearts: desktop song rows (hover-revealed, always visible when favorited),
  the `NowPlayingHero` right edge (h-6, the largest — the hero's sole button,
  its display-only/no-transport rule intact)
  + PlayerBar (all sizes — the mobile favoriting surface). `text-coral` +
  `fill-current` when on; `aria-pressed` carries the state. Never `danger`.

## Queue (play-next)

- `queue: Song[]` in App.tsx, **session-only** (never persisted). "Play
  next" prepends, "Add to queue" appends; queuing never removes songs from
  playlists. Duplicates allowed → queue rows use index-based keys.
- **The currently-playing song can't be queued** ("Already playing" toast),
  and `resolveNextSong` skips queue entries equal to current: the engine's
  replay-in-place path (`next.url === active.src`) never calls `onEnded`, so
  such a head could never dequeue — it would loop forever. `playNext`'s
  dequeue slices past the consumed entry (dropping any skipped run with it).
- **Resolution is pure**: `resolveNextSong` (`src/lib/queue.ts`, unit-tested)
  — repeat-one → current (queue WAITS); queue head; else `nextInPlaylist`
  from the **Spotify-style bookmark**: `lastPlaylistSongRef` holds the last
  song that played via the PLAYLIST FLOW (row click / prev / walk advance) and
  is deliberately NOT moved when a song arrives from the queue — so a queued
  detour resumes where the listener left off. A valid bookmark wins even when
  current is in the playlist; a stale one (playlist switch) falls back to
  current. Updated imperatively at the three new-song sites (playNext walk
  branch, playPrev, handlePlaySong) — **don't convert it to an effect**, an
  effect can't tell how a song arrived. The `nextSong` memo consumes the
  resolver (with `queue` as a dep), so the **gapless preload follows the
  queue** automatically; `playNext` dequeues when it consumes the head.
- App-wide deletes (Library/Favorites view) purge deleted songs from the
  queue; scoped user-playlist deletes don't.
- **`QueuePanel`** mirrors LyricsPanel: slide-in, `usePresence`, `open` prop,
  lazy + mount-once ref. Sections: Now playing / In queue (remove ×,
  drag-reorder via a panel-local DndContext, Clear) / Up next
  (`upNextPreview` walk; under shuffle only the memoized pick + note).
  Lyrics and Queue are **mutually exclusive** (same right-edge slot).
- Openers: PlayerBar ListMusic (desktop cluster), MobileNowPlaying button
  (closes the full-screen view), **Q** key. Row "⋯" (`RowMenu`) is the add
  surface — desktop rows only (mobile has no hover cluster; heart precedent).

## Focus & keyboard a11y

- **`useDialogFocus(active, containerRef, { initialFocus? })`**
  (`src/hooks/useDialogFocus.ts`) is the canonical modal focus manager:
  saves the opener, focuses `[data-autofocus]` (else first focusable) on
  open, traps Tab via a **document-level** keydown (a container-scoped
  listener can't recover focus that escaped to `body` via backdrop click),
  and restores the opener on close (`isConnected`-guarded).
- **Applied to the six modal surfaces**: ConfirmModal (`data-autofocus` on
  Cancel — destructive dialogs must not Enter-confirm by accident),
  PromptModal (`initialFocus: false` — its rAF input focus/select owns
  initial focus), SharedTrackModal, RowActionSheet, the inline upload
  dialog, MobileNowPlaying.
- **`usePresence` surfaces must key the hook on `open && mounted`**, not
  `open`: they mount one render after `open` flips (plain `open` would try
  to focus a not-yet-rendered dialog) and stay mounted ~300ms after close
  (keying on mount would delay restore until after the exit slide).
- **Panels are non-modal — never trap them.** QueuePanel/LyricsPanel and
  the desktop sidebar sit beside interactive content; they get
  `role="complementary"` + `aria-label` landmarks and close via the App
  Escape chain instead.
- Popovers/menus (RowMenu, HeaderMenu, EQ, volume) use the lighter pattern:
  local Escape `onKeyDown` (stopPropagation) + refocus-the-trigger; RowMenu
  additionally arrow-key cycles its items.

## Confirmation modals

- `ConfirmModal` (`src/components/ConfirmModal.tsx`) is the reusable
  confirmation primitive. Backdrop click and Escape both cancel.
- App.tsx has a `confirm` state shape `{ title, message, confirmLabel?,
  onConfirm } | null` driven by a `requestConfirm` helper. All
  destructive actions route through it: delete song, batch delete,
  delete playlist.
- **Song delete is scoped by view** (`handleDeleteSong`/`handleBatchDelete`):
  from a **user playlist**, it removes the song only from that playlist
  (Library keeps it, playback isn't stopped — the dialog says so); from
  **Library or Favorites**, it removes app-wide ("Permanently removes from
  your library and all playlists."). Keep copy and behavior in sync — the
  historical bug was copy promising playlist-scoped while code deleted
  everywhere.

## Prompt modal (no native prompt!)

- `PromptModal` (`src/components/PromptModal.tsx`) is the React-based
  text-input modal, used by "New Playlist" and playlist rename (sidebar
  pencil button; `defaultValue` prefills the current name, selected on
  open so typing replaces it). Same shape as ConfirmModal:
  `promptState: { title, placeholder?, defaultValue?, confirmLabel?,
  onConfirm: (value) => void } | null` in App.tsx.
- **Never use native `window.prompt()`, `alert()`, or `confirm()`** (the last
  native `alert()` — the "Please select audio files" dead end — was removed
  2026-08-11 in favour of a toast) —
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
- **Re-scan tags** (Library only, handle-backed songs only): Refresh diffs
  PATHS, so an external tagger rewriting tags in place (beets BPM/genre pass,
  `embedart`) is invisible to it. Re-scan is the counterpart — it re-reads
  every song that has a `fileHandle` via `fileHandle.getFile()` (NOT the
  cached `song.file`, a load-time snapshot that throws once the bytes change)
  and merges through `src/lib/rescan.ts`. **Merge policy**: the file wins for
  scalar tags (including clearing them), `duration` only when `> 0`, and
  **cover art + lyrics are merge-not-replace** — those can come from inside
  Vibes (LRCLIB "Find lyrics", the cover self-heal) and blind replacement
  would destroy them. Ids, hearts, playlist membership and the queue survive
  because the patch is applied by id.
  **The batch write merges onto the LIVE song, not a pre-sweep snapshot —
  this is load-bearing, don't "simplify" it back.** `rescanTags` stores only
  the raw fetch inputs per song (`{ meta, replacements }`), not a pre-merged
  Song built from the song object captured when the sweep started. A 469-song
  sweep is a minute-plus with a progress toast actively inviting the user to
  sit and watch; if the batch write applied pre-merged snapshots wholesale,
  any live-state mutation that happened mid-sweep — a heart toggled, lyrics
  just fetched via LRCLIB — would be silently reverted AND then persisted by
  the debounced save. Instead, `apply(s)` runs `mergeRescan(s, ...)` against
  whatever `s` the state updater hands it at COMMIT time, so mid-sweep
  mutations survive because they're already reflected in `s`.
  **The currently-playing song keeps its `url`/`file`, and this is enforced
  at APPLY time, not fetch time — the only checkpoint that exists.**
  `useAudioEngine`'s song effect early-returns only while
  `active.src === song.url`, so swapping the url would restart the track
  from 0 mid-play. `currentSongIdRef.current` is read ONCE, right before the
  three state writes (`playingId`), and `apply` omits `file`/`url` from that
  one song's replacements (letting `RescanReplacements`' "omit to keep
  current" semantics take over) — never at fetch time, because a fetch-time
  check goes stale on a long sweep: the user can start playing a song
  *after* its own tag fetch already ran, and the sweep won't finish for
  another minute. A prior version of this fix DID check at fetch time and
  had exactly this bug (fixed, then superseded by the current apply-time-only
  design — same class of staleness, this time affecting every field instead
  of just url/file).
  Old object URLs (audio + cover) are collected keyed by id and revoked on a
  deferred timeout — the playlists-diff revoke effect only fires for
  REMOVED ids, so an in-place swap must revoke its own predecessors. The
  playing song's original url is pulled back out of that collection before
  revoking (same `playingId` checkpoint); cover art has no such exception,
  since swapping it never restarts playback.
  **A fresh url is still built for the playing song at fetch time — it's
  the playing-vs-not decision that moved to apply time, not the url
  creation** (`replacements` is built unconditionally per candidate, before
  `playingId` is known). `apply` then discards that fresh url for the
  playing song, but `apply` is a state-updater callback — it must stay
  pure, so it can't be the thing that revokes it. The discarded url is
  captured once, at the SAME `playingId` checkpoint, into its own
  `discardedUrls` list (not folded into the cover list — the name would
  lie) and revoked alongside everything else. Skipping this capture is a
  leak, not a correctness bug — the URL silently outlives its Blob with no
  code path left to free it, one per re-scan-while-playing.
  **Cover art is only replaced when its size actually differs**
  (`blob.size !== song.coverBlob?.size`): every song with embedded art gets
  a FRESH downscaled Blob built from the file, so comparing by reference
  (what `hasMetaChanged` used to do) always looks "changed" — including
  when a tagger re-embeds the exact same artwork, which is the common case
  on an `embedart`-managed library. That silently made the completion toast
  permanently over-report and churned an object URL create+revoke per song
  for nothing. `hasMetaChanged` now also compares `coverBlob` by size, not
  reference, as a second line of defense. Size isn't a content hash, but
  it's a large improvement over reference identity for this case.
  Blob-persisted (Firefox/Safari) songs are skipped by design: their bytes
  were copied at ingest and can never reflect a later edit.
  **Scope boundary**: Re-scan never adds or removes songs. A file the tagger
  RENAMED or MOVED fails its `getFile()` and is reported "unreadable", not
  removed — path changes are Refresh's job. When every file fails, the toast
  says so and points at Refresh, because that is nearly always the cause.
  **Known cosmetic edge**: re-scanning during the last ~5s of a track swaps the
  url of the already-preloaded next song, so that one transition loses its
  gapless flip (the engine's `inactive.src === nextUrl` test misses and it
  falls back to the normal load path). Not worth engineering around.
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

## Code splitting (startup perf)

- The startup chunk is deliberately kept lean. **Off the critical path**:
  `music-metadata` (dynamic `import()` everywhere), the six deferred UI
  surfaces in `App.tsx` (`MobileNowPlaying`, `MiniPlayer`, `LyricsPanel`,
  `ConfirmModal`, `PromptModal`, `SharedTrackModal` — all `React.lazy` +
  `<Suspense fallback={null}>`), and the on-demand libs
  (`playlist-import`, `lyrics-online`, `playlist-export` — `await import()`
  inside their handlers). Don't re-add static imports for any of these;
  each one lands back in the startup bundle.
- **`usePresence` surfaces can't be `{open && <X/>}`-gated** (that kills the
  exit animation) but also shouldn't mount eagerly. The pattern: a monotonic
  render-phase ref (`lyricsEverOpenedRef` / `mobilePlayerEverOpenedRef`) —
  first open mounts the lazy chunk, and it stays mounted afterwards so exits
  animate. The plain modals self-null when closed, so they use simple
  conditional mounting.
- `lrc` stays in the startup chunk on purpose: eagerly-imported
  `lib/lyrics.ts` needs `parseLRC`. It's ~1 kB — not worth contorting.
- **Stale-chunk recovery** (`main.tsx`): a tab from a previous build can 404
  on a lazy chunk after a deploy (old hashes gone from the SW precache) —
  the `vite:preloadError` listener reloads to the new build instead of
  leaving a blank surface. Don't remove it while lazy chunks exist.

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
- `getStorageEstimate()` wraps `navigator.storage.estimate()`. **Early
  warning wired**: after each successful debounced save, App.tsx checks
  `formatStorageWarning(est)` (pure, unit-tested; threshold
  `STORAGE_WARN_PERCENT = 90`) and toasts once per session
  (`storageWarnedRef`) — warns BEFORE saves start failing, complementing
  the after-failure `StorageQuotaError` toast. The estimate check has its
  own `.catch` so an estimate failure never reads as a save failure.

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
- **`maskable` and `apple` override the preset with `padding: 0` + a brand
  background — don't drop back to bare `minimal2023Preset`.** Its defaults are
  `padding: 0.3` on a **white** canvas, which is wrong for both: Android only
  guarantees the centre 80% of a maskable icon, so 30% padding spent the whole
  safe zone on a white border and shipped a small badge floating on white,
  and iOS (which applies its own squircle) rendered the home-screen icon small
  and boxed. The source SVG is a *rounded* square, so the generator composites
  it over a canvas painted `#FF8464` (the amber→coral midpoint) to fill the
  transparent corners and bleed to the edge; the flat corner seam is cropped by
  both OS masks. The `transparent` ("any") set keeps the preset defaults on
  purpose — nothing masks desktop shortcuts, so those stay rounded.
  Verify a regeneration by checking the corners: `maskable-*`/`apple-*` must
  come out 3-channel (no alpha) and opaque, `pwa-*` 4-channel with alpha 0.
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
- **`App.tsx` IS tested** (`src/App.test.tsx`, since 2026-08-09) — the old
  "coupled to AudioContext/RAF" rationale died when the engine moved into
  `useAudioEngine`. The harness mocks exactly four things: `useAudioEngine`
  (fake with a captured `onEnded` so tests can simulate track end),
  `useMediaSession` (no-op), `./lib/storage` (in-memory; the factory must
  export EVERY name App imports, incl. `StorageQuotaError`), and
  `music-metadata` (App calls `parseBlob` directly in the cover self-heal +
  lyrics re-parse paths). **Gotcha: the modals are lazy-loaded** — the first
  interaction with any modal in a test must `await screen.find*` (a sync
  `get*` right after the opening click races the chunk import).
- The Sidebar trash-button test specifically uses `fireEvent.click` (not a
  direct prop call) because the test exists to verify `stopPropagation`,
  which only matters when a real DOM event bubbles.

## Visual verification

- `playwright-cli` (Microsoft `@playwright/cli` v0.1.x, installed globally)
  is the way to take screenshots / a11y snapshots. System Chrome isn't
  installed on this machine, so always pass `--browser=chromium` to use
  the bundled browser.
- Per-session output lands in `.playwright-cli/` (gitignored).
