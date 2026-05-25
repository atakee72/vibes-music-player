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
  Two keys: `library-roots` (array of `LibraryRoot`) and `playlists`
  (array of `StoredPlaylist`). All persistence touches IDB through this
  module — no other file should import `idb-keyval` directly.
- **Song persistence rule**: only songs with a `fileHandle` are persisted.
  Songs from single-file drops have no handle and are session-only. The
  `toStored`/`fromStored` helpers in storage.ts handle the strip
  (drop `file` + `url`) and rehydrate (`fileHandle.getFile()` → recreate
  blob URL) so the rest of the code never sees the split.
- **Song IDs are path-based**: `${root.id}/${relativePath}` for folder-
  ingested songs (stable across sessions so playlist membership survives
  reload); `crypto.randomUUID()` for legacy file-drop songs (session-only,
  ID stability doesn't matter).
- **Browser compatibility**:
  - Chromium (Chrome/Edge/Brave/Opera): full feature — folder drop +
    picker + persistence
  - Firefox/Safari: folder drop works via `webkitGetAsEntry`, but no
    handles means no persistence; the upload modal shows a note explaining
    this
- **Permission reality**: Chrome does NOT remember FS Access grants across
  browser restarts by default. After reload, `queryPermission` returns
  `'prompt'` even for previously-granted handles. The app shows a
  "Welcome back. Click to restore your library." banner; one click and
  it's back. Don't promise silent restore in UI — it's the exception.
- **Save-effect race guard**: `App.tsx` uses a `loadedRef` to suppress
  the first `useEffect([playlists])` write that would otherwise overwrite
  stored data with the initial empty `playlists` state before mount-load
  completes. If you touch the load-or-save lifecycle, keep this guard.

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
