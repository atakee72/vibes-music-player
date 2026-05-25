# Vibes

A browser music player with an Apple-Music-style UI, real-time audio
visualization, and metadata extraction from local audio files. Drag and drop
MP3 / WAV / FLAC files and play them right in the browser — nothing leaves
your machine.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (utility-only — no custom theme)
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
- **Library persists across reloads** (Chrome / Edge / Brave / Opera) via
  the File System Access API + IndexedDB. One click to re-grant on each
  browser session; no re-dropping
- Per-file metadata: title, artist, album, duration, cover art, file size
- Multiple playlists (create / delete); "Library" is the always-present
  default
- Transport controls (play / pause / prev / next), seek bar, repeat modes
  (off / all / one)
- Live frequency visualizer driven by the `<audio>` element via Web Audio
  API
- Responsive layout — sidebar collapses on mobile, controls reflow under
  `lg`

## Project layout

```
src/
  App.tsx                      state, audio + analyser wiring, file handling
  main.tsx                     React entry
  index.css                    Tailwind directives + base reset
  types.ts                     Song, Playlist, RepeatMode
  hooks/
    useMetadataExtractor.ts    music-metadata wrapper, returns Song objects
  components/
    Sidebar.tsx                playlist list + create / delete
    SongList.tsx               empty state + scrollable song rows
    PlayerBar.tsx              progress, transport, visualizer
```

All app state lives in `App.tsx`; the three components are purely
presentational and stateless.
