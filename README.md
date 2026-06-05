# Vibes

A browser music player with a warm **analog-dusk** UI (the "AFTERGLOW" theme),
real-time audio visualization, and metadata extraction from local audio files.
Drag and drop MP3 / WAV / FLAC files and play them right in the browser —
nothing leaves your machine.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS with the AFTERGLOW token theme (`tailwind.config.js`); fonts
  self-hosted via `@fontsource-variable/*` (Fraunces / Inter / Geist Mono)
- [`lucide-react`](https://lucide.dev) icons
- [`music-metadata`](https://github.com/Borewit/music-metadata) for ID3 /
  Vorbis / FLAC tag parsing and cover-art extraction
- Web Audio API (`AnalyserNode`) for the 15-bar frequency visualizer

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # tsc + vite build → dist/
pnpm preview   # serve the built bundle
pnpm test      # Vitest in watch mode
pnpm test:run  # Vitest single pass
```

## Features

- **Drop a folder** (or individual files) — recursive ingest of every audio
  file inside
- **Library persists across reloads** in every modern browser. Chromium
  uses the File System Access API (zero data duplication, one click to
  re-grant per session); Firefox and Safari store the audio bytes in
  IndexedDB and restore silently on reload
- Per-file metadata: title, artist, album, duration, cover art, file size
- Multiple playlists (create / delete); "Library" is the always-present
  default
- Transport controls (play / pause / prev / next), seek bar, repeat modes
  (off / all / one)
- Live frequency visualizer driven by the `<audio>` element via Web Audio
  API
- Responsive layout — sidebar collapses on mobile, controls reflow under
  `lg`
- **Keyboard shortcuts**: `Space` play/pause, `←`/`→` prev/next, `/` focus
  search, `Esc` close modal / clear search / blur
- **Type-to-filter** the current playlist by title, artist, or album
- **OS media integration** via the Media Session API — lock-screen
  artwork, Bluetooth headphone keys, macOS Now Playing widget, Windows
  SMTC, Linux MPRIS
- **Gapless playback** — next track preloaded on a second audio element
  for seamless album transitions
- **ReplayGain** — per-track volume normalization from embedded RG tags
- **5-band equalizer** — Off / Bass Boost / Vocal Boost / Treble Boost /
  Acoustic presets, persisted across reloads
- **Dynamic background tint** — extracts the dominant color from the
  playing track's cover art and tints the background to match
- **Picture-in-Picture** — mini player window with transport controls
  via the Document PiP API (Chromium 116+)
- **Drag-to-reorder** — grab the handle on song rows to rearrange order
- **Selection mode** — long-press a row (or click Select) to enter
  multi-select, then drag the selection onto another playlist in the
  sidebar (copy by default; Ctrl-drag to move; Library never deletes)
- **Volume slider** with mute toggle, persisted across reloads
- **Refresh library** — re-scan your library folder for added or
  removed tracks (Chromium only; uses the original FS Access handle)
- **Export as M3U** — download any playlist as a portable `.m3u` file
- **Confirmation modals** for destructive actions (delete song, delete
  playlist) — no accidental wipes
- **M3U / PLS import** — drop a playlist file to create a new playlist
  matched against your library
- **Synced lyrics** — LRC file drop, embedded SYLT/USLT tags, or plain
  text; auto-scrolling lyrics panel toggled with `L`
- **Double-click a row to play**; click the play overlay also plays
- **Collapsible sidebar** — hide the playlist sidebar on desktop for a
  wider song list view (icon: `PanelLeftClose` to close, `PanelLeftOpen`
  to reopen)
- **Scales to large libraries** — the song list is virtualized; only
  the visible rows mount. Library size is ultimately bounded by your
  browser's storage quota (typically hundreds of MB to several GB).
- **Installable (PWA)** — add Vibes to your dock / home screen and launch
  it like a native app; the shell is precached so it opens offline (a
  previously-loaded library still plays from local disk / IndexedDB)
- **Share what you're listening to** — a one-tap link carries the current
  track's metadata (title, artist, album) — never the audio file. The
  recipient sees a card describing the track; they play it from their own
  copy or not at all

## Project layout

```
src/
  App.tsx                      state, audio + analyser wiring, file handling
  main.tsx                     React entry
  index.css                    Tailwind directives + base reset
  types.ts                     Song, Playlist, RepeatMode
  hooks/
    useAudioEngine.ts          audio graph, gapless, EQ, ReplayGain
    useDominantColor.ts        cover-art color extraction hook
    useMetadataExtractor.ts    music-metadata wrapper, returns Song objects
  components/
    Sidebar.tsx                playlist list + create / delete
    SongList.tsx               empty state + scrollable song rows
    PlayerBar.tsx              progress, transport, visualizer, PiP
    MiniPlayer.tsx             PiP window content
  lib/
    colors.ts                  dominant-color extraction from album art
```

All app state lives in `App.tsx`; the three components are purely
presentational and stateless.
