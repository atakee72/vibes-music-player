# Read me first — AFTERGLOW redesign

You're about to implement **AFTERGLOW**, a warm analog-dusk reskin of Vibes.
This file is the front door: it tells you which doc to open, in what order, and
the sequence to build. It deliberately does **not** repeat the details — those
live in `AFTERGLOW.md`.

## Where everything is

| Open | For |
|---|---|
| **`READMEFIRST.md`** (this) | orientation + build order |
| **`AFTERGLOW.md`** | the spec — tokens, setup code, `VibeOrb`, file-by-file changes, motion |
| `vibes-player.pen` | the visual source of truth (open in Pencil). Frames **A–F** = screens, **G/H/I** = spec panels (adaptive tint, cover-art placement, motion) |
| `CLAUDE.md` | existing architecture + gotchas — read before touching audio/storage |
| `ROADMAP.md` | what's already shipped (Phases 0–6) |
| `README.md` | user-facing feature list |

## What this is (and isn't)

AFTERGLOW is a **visual reskin + re-routing of existing machinery**, not a
rewrite. Cover art already renders square, and the dominant-colour tint already
runs (`App.tsx:112` / `:871`). **Do not change** audio, playback, storage,
persistence, or the local-first model — the look changes, the behaviour does not.

## Build order

Work the three phases from `AFTERGLOW.md §7`, one branch each
(`afterglow-a-skin`, `-b-orb`, `-c-motion`), matching the ROADMAP's
one-branch-per-phase convention.

1. **Phase A — Skin** → `AFTERGLOW.md` §2 (fonts, `tailwind.config.js`,
   `index.css`, `.aurora-bg`) + the global `purple-500/pink-500 → amber/coral`
   find-replace. No behaviour change. Ship this first; it's the biggest visual
   payoff at the lowest risk.
2. **Phase B — Orb + colour routing** → §3 (`--vibe` CSS var) and §4
   (`VibeOrb.tsx`), plus the now-playing hero layout and the orb in
   `MiniPlayer`. This is where the identity lands.
3. **Phase C — Motion polish** → §6 items 1, 2, 5, 7, 8 (the other five already
   ship). Gate looping animations on `isPlaying`; honour
   `prefers-reduced-motion`.

## Before every push

The project's manual gate (see `ROADMAP.md`):

```bash
pnpm test:run && pnpm build
```

Both must pass. AFTERGLOW is presentational, so existing tests should stay green;
if one breaks, you've touched behaviour — back it out.

## Definition of done

Each screen matches its `vibes-player.pen` frame; the now-playing orb shows the
cover art (with the generative fallback when art is missing); the background +
orb + accents all tint to the current track; nothing left purple/slate.
