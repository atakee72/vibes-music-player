# AFTERGLOW — design → code handoff

A warm, analog-dusk reskin of Vibes. It deliberately drops the cold slate +
purple/pink Apple-Music look for a plum-night-to-amber **aurora**, an editorial
serif, chunky frosted-glass pill controls, and a signature **vibe-orb** that
shows the album art as a glowing disc and doubles as the colour source for the
rest of the UI.

Design source of truth: `vibes-player.pen` (frames A–F are screens; G/H/I are
spec panels for the adaptive tint, cover-art placement, and motion).

**The good news:** most of the machinery already exists. Cover art already
renders square (`SongList.tsx:189`, `PlayerBar.tsx`), and the dominant-colour
tint already runs (`App.tsx:112` + the radial-gradient overlay at
`App.tsx:871`, already a 1500 ms transition). AFTERGLOW is largely a **reskin +
re-routing** of that, not new plumbing.

---

## 1. Tokens

All values are pulled from the `.pen` document variables. Tailwind is v3 here
(`@tailwind` directives in `index.css`, `theme.extend` in config), so add these
under `theme.extend`.

| Token | Hex / value | Use |
|---|---|---|
| `bg-deep` | `#150A24` | app/body background base |
| `bg-base` | `#1E1036` | secondary background |
| `surface` | `#2A1A47` | raised surface |
| `surface-2` | `#37255C` | raised surface (hover) |
| `glass` | `#FFFFFF14` | frosted card fill (rgba white 8%) |
| `glass-strong` | `#FFFFFF26` | frosted card fill (rgba white 15%) |
| `stroke-soft` | `#FFFFFF24` | hairline borders |
| `accent-amber` | `#FF9E5E` | primary accent / gradients |
| `accent-coral` | `#FF6B6B` | primary accent / gradients |
| `accent-gold` | `#FFC857` | accent highlight |
| `accent-lilac` | `#C9A8FF` | secondary accent (tags, links) |
| `accent-violet` | `#8B5CF6` | aurora glow |
| `text-primary` | `#FDF4E8` | cream — titles, body |
| `text-secondary` | `#BBA9D6` | muted lilac-grey |
| `text-tertiary` | `#7C6B9A` | captions, metadata |
| `font-display` | `Fraunces` | song titles, headings |
| `font-body` | `Inter` | all UI text |
| `font-mono` | `Geist Mono` | timecodes, hex, counts |
| `radius` | `28px` | cards / hero |
| `radius-sm` | `16px` | rows, chips, small cards |
| `radius-pill` | `999px` | buttons, pills, toggles |

Cream text on deep plum keeps WCAG-AA contrast; the accent gradient is only ever
used behind dark (`#2A0E12`) glyphs, never as text colour on the dark bg.

---

## 2. Setup

### 2a. Fonts — `index.html` `<head>` (preferred over `@import` for perf)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Inter:wght@400..700&family=Geist+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

> If `Geist Mono` is unavailable in your pipeline, fall back to `JetBrains Mono`.

### 2b. `tailwind.config.js` — replace the empty `extend`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: '#150A24',
        base: '#1E1036',
        surface: { DEFAULT: '#2A1A47', 2: '#37255C' },
        amber: '#FF9E5E',
        coral: '#FF6B6B',
        gold: '#FFC857',
        lilac: '#C9A8FF',
        violet: '#8B5CF6',
        cream: '#FDF4E8',
        muted: '#BBA9D6',
        faint: '#7C6B9A',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '28px', sm2: '16px' },
      keyframes: {
        breathe: { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.04)' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        breathe: 'breathe 4s ease-in-out infinite',
        'spin-slow': 'spinSlow 24s linear infinite',
      },
    },
  },
  plugins: [],
};
```

### 2c. `index.css` — base background + font

```css
body {
  background: #150A24;             /* was #0f172a */
  font-family: 'Inter', system-ui, sans-serif;
  color: #FDF4E8;
}
```

The persistent aurora (under the dynamic tint) is best as one fixed layer near
the app root — three stacked radial gradients matching the `.pen` recipe:

```css
.aurora-bg {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(130% 100% at 50% 105%, #FF9E5EB3 0%, #C8553D 35%, #2A1140 75%, transparent 100%),
    radial-gradient(90% 80% at 12% 0%, #8B5CF673 0%, #5B2E86 40%, transparent 100%),
    radial-gradient(70% 70% at 100% 12%, #C9A8FF38 0%, transparent 100%),
    #160A26;
}
```

---

## 3. The colour pipeline — reuse what you have

`useDominantColor(currentSong?.coverArt)` (`App.tsx:112`) already returns a
clamped `hsl(...)` string via `lib/colors.ts` (sat 50–80%, lit 35–55% — already
glow-friendly). Today it feeds only the background overlay. AFTERGLOW routes
that **one value** to three places by publishing it as a CSS variable on the
root, so any element can opt in.

In `App.tsx`, alongside the existing tint `<div>`, set a custom property:

```tsx
// near the root wrapper
<div style={{ '--vibe': tintColor ?? '#FF9E5E' } as React.CSSProperties}>
```

Then:

1. **Background** — keep the existing overlay (`App.tsx:871-876`); it already
   does `radial-gradient(ellipse at 50% 100%, <tint> …)` with
   `transition-colors duration-[1500ms]`. This *is* motion #4. No change needed
   beyond colour: it already reads `tintColor`.
2. **Orb glow** — `box-shadow: 0 0 70px color-mix(in srgb, var(--vibe) 45%, transparent)`.
3. **Accents** — play button / progress fill / now-playing dot use
   `color-mix(in srgb, var(--vibe) 85%, white)` → gradient to `var(--vibe)`.

Fallback: when `tintColor` is `null` (no embedded art), `--vibe` defaults to
`#FF9E5E` and the orb shows the generative gradient instead of a photo (see §4).

---

## 4. New component — `VibeOrb.tsx`

The one genuinely new piece. It is the now-playing artwork **and** the colour
source. Square art already exists in rows/player bar; the orb is the *hero*
treatment.

```tsx
// src/components/VibeOrb.tsx
export function VibeOrb({ coverArt, isPlaying }: { coverArt?: string; isPlaying: boolean }) {
  return (
    <div className="relative aspect-square w-full max-w-[280px]">
      {/* glow halo — colour from --vibe */}
      <div className="absolute inset-0 rounded-full"
           style={{ boxShadow: '0 0 70px color-mix(in srgb, var(--vibe) 45%, transparent)' }} />
      {/* mood ring — rotates while playing (motion #2) */}
      <div className={`absolute inset-0 rounded-full p-[2px] ${isPlaying ? 'animate-spin-slow' : ''}`}
           style={{ background: 'conic-gradient(#FFC857,#FF6B6B,#C9A8FF,#FFC857)' }} />
      {/* disc — cover art, or generative fallback (motion #1: breathe) */}
      <div className={`absolute inset-[6px] rounded-full overflow-hidden ${isPlaying ? 'animate-breathe' : ''}`}>
        {coverArt
          ? <img src={coverArt} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full"
                 style={{ background: 'radial-gradient(circle at 35% 30%, #FFE9C7, #FFC857 32%, #FF8C5A 66%, #C9A8FF)' }} />}
      </div>
    </div>
  );
}
```

Use it in the now-playing hero (§4b) and, smaller, in `MiniPlayer.tsx`.

### 4b. Now-playing hero layout (desktop — frame A)

The hero **sits above the song list; it does not replace it.** The main column
(right of the sidebar) stacks top-to-bottom:

1. **Top bar** — search field (left); Surprise-me / Share / Install pills +
   avatar (right).
2. **Now-Playing hero** — a frosted-glass card spanning the column, ~300 px tall:
   - left: the `VibeOrb` (~252 px)
   - right: `NOW PLAYING` eyebrow + live dot → serif title → `Artist · Album`
     → mood/genre chips → progress bar (mono times) → controls row (large
     gradient play, prev/next, then heart + queue).
3. **List header** — `Library · 248 songs` (left); Select + Sort (right).
4. **Song list** — rows scroll directly beneath the hero in the same column
   (square art thumb, serif title, artist, album, heart, mono duration). The
   active row is highlighted and its index is replaced by the equalizer-bars
   indicator.

When nothing is playing, collapse the hero to the existing empty / "drop a
folder" state; the list (or empty state) fills the column.

**Mobile (frame D)** is the other pattern: a dedicated **full-screen**
now-playing view (orb fills the screen), reached by tapping the mini-player —
the "separate view you toggle into." So: **desktop = hero banner above the
list; mobile = full-screen view.**

---

## 5. File-by-file change list

| File | Change |
|---|---|
| `index.html` | add the three Google-Font links (§2a) |
| `index.css` | body bg `#150A24`, font Inter, cream text; add `.aurora-bg` (§2c) |
| `tailwind.config.js` | populate `theme.extend` (§2b) |
| `App.tsx` | publish `--vibe` from `tintColor` (§3); render `.aurora-bg`; existing tint overlay stays as-is |
| `components/VibeOrb.tsx` | **new** (§4) |
| `components/PlayerBar.tsx` | swap `from-purple-500 to-pink-500` → `from-amber to-coral`; title font `font-display`; timecodes `font-mono`; thumb `rounded-lg` is already square — keep; visualizer bars → `from-coral to-gold` (motion #3 already live) |
| `components/SongList.tsx` | row title `font-display`; active row tint amber not purple; cover `<img>` already `rounded-lg` — keep; hover/`ring` purple → amber (motion #9) |
| `components/Sidebar.tsx` | wordmark `font-display` + orb logo; active playlist row glass-strong + lilac (was purple gradient); add the on-device storage meter (design addition) |
| `components/LyricsPanel.tsx` | active line `font-display`, scale-up + brighten on change (motion #7) |
| `components/*Modal.tsx` | frosted glass + pill buttons; destructive = coral, not red-500 |

Global find/replace `purple-500`/`pink-500` accent gradients → `amber`/`coral`
covers ~80% of the visual shift in one pass.

---

## 6. Motion (panel I → Tailwind)

Pencil is static; these are the intended animations, most already feasible with
Tailwind transitions / the keyframes added in §2b.

| # | Motion | Implementation |
|---|---|---|
| 1 | Orb breathe | `animate-breathe` (added) — gate on `isPlaying` |
| 2 | Mood-ring spin | `animate-spin-slow` (added) — gate on `isPlaying` |
| 3 | Live visualizer | **already live** — Web Audio `AnalyserNode` bars in `PlayerBar.tsx` |
| 4 | Adaptive tint crossfade | **already live** — `App.tsx:871`, `duration-[1500ms]` |
| 5 | Art cross-dissolve | wrap orb/thumb `<img>` in a `transition-opacity` keyed on song id |
| 6 | Progress & scrub | `transition-all` on fill; knob `group-hover:scale-125` |
| 7 | Lyrics auto-scroll | existing `scrollIntoView`; add `transition-transform` scale on active line |
| 8 | Play / pause | `transition + active:scale-95`; glow pulse on press |
| 9 | Row interaction | `hover:bg-white/5 transition`; long-press ring already in selection mode |
| 10 | Surfaces | sidebar/sheet `translate-x` 300 ms (already in `Sidebar.tsx`); modal fade+scale 200 ms; toasts auto-dismiss 5 s (already) |

---

## 7. Suggested rollout (matches the ROADMAP's phase style)

- **Phase A — Skin:** §2 (fonts + tokens + aurora) and the `purple→amber`
  find/replace. Ships the whole new *look* with zero behaviour change. Lowest
  risk, biggest visual payoff.
- **Phase B — Orb + colour routing:** `VibeOrb.tsx`, the `--vibe` variable, the
  new now-playing hero layout, orb in `MiniPlayer`. This is where the identity
  lands.
- **Phase C — Motion polish:** items 1, 2, 5, 7, 8 from §6 (the rest already
  ship). Gate looping animations on `isPlaying` and respect
  `prefers-reduced-motion`.

Keeps the "nothing leaves your device" promise intact — the colour pipeline is
the same local canvas extraction you already ship; AFTERGLOW just shows it off.

---

## 8. Implementer Q&A (answered)

- **Now-playing hero layout** — see §4b. (Was the one real unknown; now
  specified: desktop hero banner above the list, mobile full-screen view.)
- **Offline fonts vs. the PWA** — self-host instead of the Google `<link>` in
  §2a (e.g. `@fontsource/fraunces`, `@fontsource/inter`,
  `@fontsource-variable/geist-mono`), so typography survives the first offline
  launch and stays inside the local-first promise. If you do, drop the `<link>`.
- **PWA brand drift** — regenerate the Phase-6 app icons and set manifest
  `theme_color` to the new base `#150A24` (app chrome). Roll into Phase A so it
  ships with the skin.
- **Tests asserting `purple-500`/`pink-500` classes** — expected to change. A
  test asserting old accent classes legitimately breaks on the find-replace;
  update those as style-snapshot changes, not behaviour regressions. Behaviour
  tests must stay green.
- **Sidebar storage meter** — yes, it's the one net-new bit of UI (not pure
  reskin), but cheap: `getStorageEstimate()` is already wired and currently
  unused. Keep it as a deliberate design addition; fine to land in Phase A or
  defer to B.
