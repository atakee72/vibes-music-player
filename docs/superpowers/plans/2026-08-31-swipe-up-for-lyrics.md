# Swipe-up-for-lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let lyrics open *inside* the full-screen now-playing view — as a bottom sheet reachable by an upward drag or the existing button — so the view no longer has to close itself to show them.

**Architecture:** Extract the lyric-rendering body of `LyricsPanel` into a presentational `LyricsView`, reuse it in a new `LyricsSheet` that lives inside `MobileNowPlaying`, and drive the sheet from lifted App state so the Escape chain and the `L` key can address it. A new `useSwipeGesture` hook supplies the upward drag on the view and the downward drag on the sheet's handle.

**Tech Stack:** React 18, TypeScript (strict), Tailwind, Vitest 3 + happy-dom + React Testing Library. No new dependencies — the gesture is hand-rolled Pointer Events, matching `SongList`'s existing long-press pattern.

**Spec:** None — this is ROADMAP backlog item 7 (`ROADMAP.md`, "Backlog — noted 2026-08-15"), scoped by two decisions the user made on 2026-08-31, recorded under "Decisions" below. There is no separate design document; this plan is the design of record.

## Decisions (locked 2026-08-31)

1. **Build both the sheet and the gesture.** The sheet is what removes the layering workaround; the drag is what makes it discoverable. A button-only version was offered and declined.
2. **Keep both lyrics surfaces.** The right-edge `LyricsPanel` continues to serve the song-list context on every screen size and its existing tests must keep passing untouched. The sheet belongs to the now-playing view only. A "sheet everywhere on mobile" variant was offered and declined.
3. **Queue and Stats keep closing the view.** `togglePanel` stops closing the view for `'lyrics'` only. Queue and Stats are still `z-40` under a `z-[60]` view, so they must still close it. The resulting asymmetry is deliberate and in scope for item 7, which names lyrics specifically.

## Global Constraints

Copied from `CLAUDE.md`; every task's requirements include these.

- **Package manager is pnpm.** Never `npm`/`yarn`. Test with `pnpm test:run`, typecheck with `pnpm build` (the `tsc` step catches what `pnpm dev` skips).
- **All state lives in `src/App.tsx`.** Components are presentational — props in, callbacks out. The two documented exceptions to "no `useState` in components" are `PlayerBar`'s `eqOpen` and `SongList`'s `selectedIds`; `MobileNowPlaying` already has `volOpen`/`audioOpen` on the same precedent.
- **All looping/transform motion is `motion-safe:` gated** so it vanishes under `prefers-reduced-motion: reduce`. Colour transitions are exempt.
- **Colour tokens only** (`deep`, `surface`, `amber`, `coral`, `lilac`, `cream`, `muted`, `faint`, `danger`) — never raw hex in components. Glyphs on accent fills are `text-deep`, never white.
- **Never name a colour token after a Tailwind font-size word.** Not relevant to new code here, but do not introduce one.
- **Panels are non-modal — never trap focus in them.** `role="complementary"` + `aria-label`, closed via the App Escape chain. `useDialogFocus` is for modals only. The sheet is a panel, not a modal.
- **`usePresence(open, duration=300)` is the only way to give a conditionally-rendered surface an exit animation.** Keep the node while `mounted`, drive the from/to class with `visible`.
- Commit messages: simple and concise, no Claude signature, no `Co-Authored-By` footer.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/LyricsView.tsx` | **new** — presentational lyric body: empty state + "Find lyrics", synced line list with click-to-seek, unsynced block, and the active-line auto-scroll. No positioning, no chrome, no `usePresence`, and no styling hooks until a host actually needs one. |
| `src/components/LyricsView.test.tsx` | **new** — tests for the three render modes and click-to-seek. |
| `src/components/LyricsPanel.tsx` | Keeps its chrome (backdrop, slide-in shell, header, close button); its body becomes `<LyricsView …/>`. Public props unchanged, so its existing tests pass untouched. |
| `src/hooks/useSwipeGesture.ts` | **new** — vertical-drag detection returning pointer handlers. Guards against drags that start on interactive elements. |
| `src/hooks/useSwipeGesture.test.ts` | **new** — threshold, direction, axis dominance, interactive-target guard. |
| `src/components/LyricsSheet.tsx` | **new** — the bottom sheet: `usePresence` slide-up, a drag handle wired to `useSwipeGesture`, a header with a close button, and `<LyricsView …/>` inside. |
| `src/components/LyricsSheet.test.tsx` | **new** — open/close, handle drag-down, `role="complementary"`. |
| `src/components/MobileNowPlaying.tsx` | Renders `LyricsSheet`; attaches the swipe-up handlers to its root; its `onToggleLyrics` now opens the sheet. New props `lyricsSheetOpen` / `onLyricsSheetChange` plus the lyric data it must forward. |
| `src/components/MobileNowPlaying.test.tsx` | Adds sheet-integration assertions. |
| `src/App.tsx` | New `lyricsSheetOpen` state; `togglePanel` routes lyrics to the sheet while the view is open; Escape gains a first branch; auto-close when the view closes or the song goes null. |
| `src/App.test.tsx` | Regression tests for the routing, the Escape order, and that the view no longer closes. |

---

## Task 1: Extract `LyricsView`

Pure refactor. No behaviour changes, no new features — the whole point is that `LyricsPanel`'s existing tests keep passing without edits, which is the proof the extraction is faithful.

**Files:**
- Create: `src/components/LyricsView.tsx`
- Create: `src/components/LyricsView.test.tsx`
- Modify: `src/components/LyricsPanel.tsx` (replace the body; keep the shell)

**Interfaces:**
- Consumes: `LyricLine` from `src/types.ts` (`{ time: number; text: string }`), `activeLyricIndex(lyrics, currentTime)` from `src/lib/lrc.ts`.
- Produces: `LyricsView` with exactly this signature — Tasks 4 and 5 depend on it:
  ```ts
  interface LyricsViewProps {
    lyrics: LyricLine[] | undefined;
    currentTime: number;
    onSeek?: (time: number) => void;
    onFetch?: () => void;
    fetching?: boolean;
    fetchError?: string | null;
  }
  export function LyricsView(props: LyricsViewProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `src/components/LyricsView.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { LyricsView } from './LyricsView';

describe('LyricsView', () => {
  it('offers a fetch button when there are no lyrics', () => {
    const onFetch = vi.fn();
    render(<LyricsView lyrics={undefined} currentTime={0} onFetch={onFetch} />);

    expect(screen.getByText('No lyrics available for this track.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Find lyrics' }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it('renders an unsynced block as plain text', () => {
    render(<LyricsView lyrics={[{ time: 0, text: 'one\ntwo' }]} currentTime={0} />);
    expect(screen.getByText('one\ntwo')).toBeInTheDocument();
  });

  it('seeks to a line when synced lyrics are clicked', () => {
    const onSeek = vi.fn();
    render(
      <LyricsView
        lyrics={[
          { time: 0, text: 'first' },
          { time: 10, text: 'second' },
        ]}
        currentTime={0}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByText('second'));
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it('does not make lines clickable without onSeek', () => {
    render(
      <LyricsView
        lyrics={[
          { time: 0, text: 'first' },
          { time: 10, text: 'second' },
        ]}
        currentTime={0}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/LyricsView.test.tsx`
Expected: FAIL — `Failed to resolve import "./LyricsView"`.

- [ ] **Step 3: Create `LyricsView`**

Create `src/components/LyricsView.tsx`. This is the body lifted verbatim out of `LyricsPanel` (the `<div className="flex-1 overflow-y-auto p-4">` block and the `lineRefs` / `activeIdx` / auto-scroll machinery that serves it):

```tsx
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LyricLine } from '../types';
import { activeLyricIndex } from '../lib/lrc';

interface LyricsViewProps {
  lyrics: LyricLine[] | undefined;
  currentTime: number;
  onSeek?: (time: number) => void;
  onFetch?: () => void;
  fetching?: boolean;
  fetchError?: string | null;
}

/**
 * The lyric body — empty state, synced line list, or unsynced block — with no
 * chrome and no positioning of its own.
 *
 * Extracted from LyricsPanel so the right-edge panel and the now-playing
 * bottom sheet render identical lyrics from one source. Anything about WHERE
 * the lyrics sit (backdrop, slide direction, header, close button) belongs to
 * the host, not here.
 */
export function LyricsView({
  lyrics,
  currentTime,
  onSeek,
  onFetch,
  fetching,
  fetchError,
}: LyricsViewProps) {
  const activeIdx = lyrics ? activeLyricIndex(lyrics, currentTime) : -1;
  const prevIdxRef = useRef(-1);
  const lineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());

  const isSynced = lyrics && lyrics.length > 1 && lyrics.some((l) => l.time > 0);

  useEffect(() => {
    if (activeIdx !== prevIdxRef.current && activeIdx >= 0) {
      const el = lineRefs.current.get(activeIdx);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    prevIdxRef.current = activeIdx;
  }, [activeIdx]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {!lyrics || lyrics.length === 0 ? (
        <div className="text-center mt-8 space-y-3">
          <p className="text-sm text-white/40">No lyrics available for this track.</p>
          {onFetch && (
            <>
              <button
                onClick={onFetch}
                disabled={fetching}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-amber to-coral text-deep text-sm font-medium hover:brightness-110 disabled:opacity-60 transition-all"
              >
                {fetching ? 'Searching…' : 'Find lyrics'}
              </button>
              {fetchError && <p className="text-xs text-danger">{fetchError}</p>}
              <p className="text-[11px] text-white/30 px-4 leading-relaxed">
                Checks the file, then LRCLIB (only the track name, artist &amp; duration are
                sent).
              </p>
            </>
          )}
        </div>
      ) : isSynced ? (
        <div className="space-y-3">
          {lyrics.map((line, i) => (
            <p
              key={i}
              ref={(el) => {
                if (el) lineRefs.current.set(i, el);
                else lineRefs.current.delete(i);
              }}
              {...(onSeek
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => onSeek(line.time),
                    onKeyDown: (e: ReactKeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSeek(line.time);
                      }
                    },
                    title: 'Jump to this line',
                  }
                : {})}
              className={`transition-all duration-300 ${
                onSeek ? 'cursor-pointer hover:text-white/80' : ''
              } ${
                i === activeIdx
                  ? 'text-amber text-lg font-medium font-display motion-safe:scale-105 origin-left'
                  : 'text-white/40 text-sm'
              }`}
            >
              {line.text || ' '}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed">
          {lyrics[0].text}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/LyricsView.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite `LyricsPanel` to use it**

In `src/components/LyricsPanel.tsx`:

Replace the import block's first two lines:

```tsx
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { activeLyricIndex } from '../lib/lrc';
import { usePresence } from '../hooks/usePresence';
```

with:

```tsx
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { usePresence } from '../hooks/usePresence';
import { LyricsView } from './LyricsView';
```

Delete these four lines from the component body (they moved into `LyricsView`):

```tsx
  const activeIdx = lyrics ? activeLyricIndex(lyrics, currentTime) : -1;
  const prevIdxRef = useRef(-1);
  const lineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());

  const isSynced = lyrics && lyrics.length > 1 && lyrics.some((l) => l.time > 0);
```

Delete the whole `useEffect` that calls `scrollIntoView` (it moved too). Then replace everything from `<div className="flex-1 overflow-y-auto p-4">` through its matching `</div>` with:

```tsx
        <LyricsView
          lyrics={lyrics}
          currentTime={currentTime}
          onSeek={onSeek}
          onFetch={onFetch}
          fetching={fetching}
          fetchError={fetchError}
        />
```

Keep `const { mounted, visible } = usePresence(open);`, the `if (!mounted) return null;`, the backdrop, the shell `<div role="complementary" aria-label="Lyrics" …>`, and the header with the close button exactly as they are.

- [ ] **Step 6: Verify the extraction is faithful**

Run: `pnpm vitest run src/components/LyricsPanel.test.tsx src/components/LyricsView.test.tsx`
Expected: PASS, with **zero edits to `LyricsPanel.test.tsx`**. If any panel test needed changing, the extraction was not faithful — revert and redo rather than adjusting the test.

- [ ] **Step 7: Commit**

```bash
git add src/components/LyricsView.tsx src/components/LyricsView.test.tsx src/components/LyricsPanel.tsx
git commit -m "refactor: extract LyricsView from LyricsPanel"
```

---

## Task 2: `useSwipeGesture` hook

**Files:**
- Create: `src/hooks/useSwipeGesture.ts`
- Create: `src/hooks/useSwipeGesture.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces — Tasks 3 and 4 depend on this exact shape:
  ```ts
  interface SwipeHandlers {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  }
  export function useSwipeGesture(opts: {
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
    threshold?: number;   // default 50 (px)
  }): SwipeHandlers
  ```

**Design notes the implementer must honour:**

- **Bail when the drag starts on an interactive element.** The now-playing view is covered in buttons, a click-to-seek progress bar and a volume `input[type=range]`. Without this guard, scrubbing upward would open the lyrics sheet. Check `(e.target as Element).closest('button, input, select, textarea, a, [role="button"], [role="slider"]')`.
- **Require vertical dominance.** Fire only when `Math.abs(dy) > Math.abs(dx)`. A mostly-horizontal drag is not a swipe up.
- **One gesture at a time**, tracked by `pointerId` — a second pointer (a pinch) must not corrupt the first.
- Do **not** call `setPointerCapture`: the sheet's scroll container and the buttons underneath still need their own events, and capture on the root would starve them.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useSwipeGesture.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { useSwipeGesture } from './useSwipeGesture';

/** Minimal React.PointerEvent stand-in — the hook only reads these fields. */
const evt = (over: { x?: number; y?: number; id?: number; target?: unknown } = {}) =>
  ({
    pointerId: over.id ?? 1,
    clientX: over.x ?? 0,
    clientY: over.y ?? 0,
    target: over.target ?? { closest: () => null },
  }) as unknown as React.PointerEvent;

describe('useSwipeGesture', () => {
  it('fires onSwipeUp when the drag clears the threshold upward', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerMove(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).toHaveBeenCalledTimes(1);
  });

  it('fires onSwipeDown for a downward drag', () => {
    const onSwipeDown = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeDown }));

    result.current.onPointerDown(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 300 }));

    expect(onSwipeDown).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag shorter than the threshold', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerUp(evt({ x: 100, y: 270 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a mostly-horizontal drag', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerUp(evt({ x: 400, y: 240 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a drag that starts on an interactive element', () => {
    // The now-playing view is full of buttons and a scrubbable progress bar;
    // dragging one of those must never open the lyrics sheet.
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));
    const onButton = { closest: (sel: string) => (sel.includes('button') ? {} : null) };

    result.current.onPointerDown(evt({ x: 100, y: 300, target: onButton }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a second pointer while one gesture is in flight', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300, id: 1 }));
    result.current.onPointerUp(evt({ x: 100, y: 200, id: 2 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('abandons the gesture on pointer cancel', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerCancel(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/hooks/useSwipeGesture.test.ts`
Expected: FAIL — `Failed to resolve import "./useSwipeGesture"`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useSwipeGesture.ts`:

```ts
import { useRef } from 'react';

const INTERACTIVE = 'button, input, select, textarea, a, [role="button"], [role="slider"]';

interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * Vertical swipe detection for overlay surfaces. Returns handlers to spread
 * onto the element that should respond to the drag.
 *
 * Deliberately does NOT call setPointerCapture: the surfaces using this are
 * covered in buttons and scrollable regions that still need their own events.
 * Drags starting on an interactive element are ignored outright — otherwise
 * scrubbing the progress bar upward would read as a swipe.
 */
export function useSwipeGesture({
  onSwipeUp,
  onSwipeDown,
  threshold = 50,
}: {
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
}): SwipeHandlers {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const reset = () => {
    start.current = null;
  };

  return {
    onPointerDown: (e) => {
      if ((e.target as Element | null)?.closest?.(INTERACTIVE)) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    // Tracked for symmetry and future travel-based feedback; the decision is
    // taken on pointerup so a drag can still be abandoned mid-flight.
    onPointerMove: () => {},
    onPointerUp: (e) => {
      const from = start.current;
      reset();
      if (!from || from.id !== e.pointerId) return;

      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dy) <= Math.abs(dx)) return;
      if (Math.abs(dy) < threshold) return;

      if (dy < 0) onSwipeUp?.();
      else onSwipeDown?.();
    },
    onPointerCancel: reset,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/hooks/useSwipeGesture.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSwipeGesture.ts src/hooks/useSwipeGesture.test.ts
git commit -m "feat: add useSwipeGesture for vertical drag on overlays"
```

---

## Task 3: `LyricsSheet`

**Files:**
- Create: `src/components/LyricsSheet.tsx`
- Create: `src/components/LyricsSheet.test.tsx`

**Interfaces:**
- Consumes: `LyricsView` (Task 1), `useSwipeGesture` (Task 2), `usePresence` from `src/hooks/usePresence.ts`.
- Produces — Task 4 renders this:
  ```ts
  interface LyricsSheetProps {
    open: boolean;
    onClose: () => void;
    lyrics: LyricLine[] | undefined;
    currentTime: number;
    onSeek?: (time: number) => void;
    onFetch?: () => void;
    fetching?: boolean;
    fetchError?: string | null;
  }
  export function LyricsSheet(props: LyricsSheetProps): JSX.Element | null
  ```

**Design notes:**

- Root is `absolute inset-y-0 -inset-x-6 z-10`, **not** `fixed`, and its containing block is the view's **content area** (the orb/title region), not the whole view. That scoping is load-bearing, not cosmetic: measured in Chromium, a sheet anchored to the view root covers the progress bar, transport and utility rows, so opening lyrics would remove all playback control. Today's mobile `LyricsPanel` is `z-40` under a `z-50` `PlayerBar`, so the player stays reachable behind it — a root-anchored sheet would be a regression against that. Scoped to the content area, the sheet gets ~610px of height on a 390×844 phone while every control below stays hittable (all measured).
- The negative `-inset-x-6` cancels the host's `p-6` so the sheet still bleeds edge to edge and reads as a sheet rather than an inset card. Verified in Chromium: 390px wide at left 0, and `documentElement.scrollWidth` stays at 390, so it introduces no horizontal overflow.
- Non-modal: `role="complementary"` + `aria-label="Lyrics"`, **no focus trap**. Per `CLAUDE.md`, `useDialogFocus` is for modals only.
- The drag handle is a distinct element at the top of the sheet carrying the `useSwipeGesture` handlers for `onSwipeDown`. Do not put them on the sheet root — the body scrolls, and a downward scroll gesture there would dismiss the sheet.

- [ ] **Step 1: Write the failing test**

Create `src/components/LyricsSheet.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { LyricsSheet } from './LyricsSheet';

const lines = [
  { time: 0, text: 'first' },
  { time: 10, text: 'second' },
];

function renderSheet(overrides = {}) {
  const onClose = vi.fn();
  const utils = render(
    <LyricsSheet open onClose={onClose} lyrics={lines} currentTime={0} {...overrides} />,
  );
  return { ...utils, onClose };
}

describe('LyricsSheet', () => {
  it('renders the lyrics as a labelled complementary region', () => {
    renderSheet();
    expect(screen.getByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<LyricsSheet open={false} onClose={vi.fn()} lyrics={lines} currentTime={0} />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('closes from the close button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close lyrics' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the handle is dragged down', () => {
    const { onClose } = renderSheet();
    const handle = screen.getByTestId('lyrics-sheet-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 220 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the handle is dragged up', () => {
    const { onClose } = renderSheet();
    const handle = screen.getByTestId('lyrics-sheet-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 220 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/LyricsSheet.test.tsx`
Expected: FAIL — `Failed to resolve import "./LyricsSheet"`.

- [ ] **Step 3: Implement the sheet**

Create `src/components/LyricsSheet.tsx`:

```tsx
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { usePresence } from '../hooks/usePresence';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { LyricsView } from './LyricsView';

interface LyricsSheetProps {
  open: boolean;
  onClose: () => void;
  lyrics: LyricLine[] | undefined;
  currentTime: number;
  onSeek?: (time: number) => void;
  onFetch?: () => void;
  fetching?: boolean;
  fetchError?: string | null;
}

/**
 * Lyrics as a bottom sheet INSIDE the now-playing view.
 *
 * Exists so the view no longer has to close itself to show lyrics: the
 * right-edge LyricsPanel is z-40 and the view is z-[60], so App used to
 * dismiss the view whenever lyrics opened. This is positioned `absolute`
 * against the view's CONTENT AREA — deliberately not the view root, which
 * would bury the progress bar and transport and leave no way to control
 * playback while reading lyrics. The negative inline inset cancels the
 * host's padding so it still bleeds edge to edge.
 *
 * Non-modal, like the other panels: labelled landmark, no focus trap.
 */
export function LyricsSheet({
  open,
  onClose,
  lyrics,
  currentTime,
  onSeek,
  onFetch,
  fetching,
  fetchError,
}: LyricsSheetProps) {
  const { mounted, visible } = usePresence(open);

  // Only the handle is draggable. The body scrolls, and a downward scroll
  // there must not read as a dismissal.
  const drag = useSwipeGesture({ onSwipeDown: onClose });

  if (!mounted) return null;

  return (
    <div
      role="complementary"
      aria-label="Lyrics"
      className={`absolute inset-y-0 -inset-x-6 z-10 flex flex-col rounded-t-card border-t border-white/10 bg-surface/95 backdrop-blur-xl motion-safe:transition-transform motion-safe:duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div
        data-testid="lyrics-sheet-handle"
        className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2"
        {...drag}
      >
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>

      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <span className="text-sm font-medium text-white/80">Lyrics</span>
        <button
          onClick={onClose}
          className="rounded-full p-1 transition-colors hover:bg-white/10"
          aria-label="Close lyrics"
        >
          <X className="h-4 w-4 text-white/60" />
        </button>
      </div>

      <LyricsView
        lyrics={lyrics}
        currentTime={currentTime}
        onSeek={onSeek}
        onFetch={onFetch}
        fetching={fetching}
        fetchError={fetchError}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/LyricsSheet.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/LyricsSheet.tsx src/components/LyricsSheet.test.tsx
git commit -m "feat: add LyricsSheet, a bottom sheet for the now-playing view"
```

---

## Task 4: Wire the sheet into `MobileNowPlaying`

**Files:**
- Modify: `src/components/MobileNowPlaying.tsx`
- Modify: `src/components/MobileNowPlaying.test.tsx`

**Interfaces:**
- Consumes: `LyricsSheet` (Task 3), `useSwipeGesture` (Task 2).
- Produces: `MobileNowPlayingProps` gains these members, which Task 5 supplies from App:
  ```ts
    /** Whether the in-view lyrics sheet is showing. */
    lyricsSheetOpen?: boolean;
    onLyricsSheetChange?: (open: boolean) => void;
    lyrics?: LyricLine[];
    onSeekLyric?: (time: number) => void;
    onFetchLyrics?: () => void;
    fetchingLyrics?: boolean;
    fetchLyricsError?: string | null;
  ```
  The existing `onToggleLyrics` prop **stays** and keeps its meaning for hosts that do not pass `onLyricsSheetChange` — see the fallback note below.

**Design notes:**

- The Mic2 button opens the sheet when `onLyricsSheetChange` is supplied, and otherwise falls back to `onToggleLyrics`. That fallback keeps every existing `MobileNowPlaying` test rendering without the new props.
- Swipe-up handlers go on the **view root**, guarded by the hook's interactive-element check. They must be spread *before* nothing else — the root has no other pointer handlers today, so there is no ordering hazard.
- `LyricsSheet` renders **inside the orb/title content div**, which must gain `relative` — not as a child of the view root. Anchoring it to the root covers the transport (measured), which is the one thing a lyrics view must not do.

- [ ] **Step 1: Write the failing test**

Append to `src/components/MobileNowPlaying.test.tsx`, inside the existing top-level `describe`:

```tsx
  it('opens the lyrics sheet from the lyrics button without closing the view', () => {
    const onLyricsSheetChange = vi.fn();
    renderView({ onLyricsSheetChange, lyrics: [{ time: 0, text: 'a line' }] });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle lyrics' }));

    expect(onLyricsSheetChange).toHaveBeenCalledWith(true);
    // The view itself must stay put — that is the entire point of the sheet.
    expect(screen.getByRole('dialog', { name: 'Now playing' })).toBeInTheDocument();
  });

  it('opens the lyrics sheet on an upward drag', () => {
    const onLyricsSheetChange = vi.fn();
    renderView({ onLyricsSheetChange });
    const view = screen.getByRole('dialog', { name: 'Now playing' });

    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 100, clientY: 200 });

    expect(onLyricsSheetChange).toHaveBeenCalledWith(true);
  });

  it('does not open the sheet when a drag starts on a transport button', () => {
    const onLyricsSheetChange = vi.fn();
    renderView({ onLyricsSheetChange });
    const next = screen.getByRole('button', { name: 'Next' });

    fireEvent.pointerDown(next, { pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.pointerUp(next, { pointerId: 1, clientX: 100, clientY: 200 });

    expect(onLyricsSheetChange).not.toHaveBeenCalled();
  });

  it('renders the sheet when lyricsSheetOpen is set', () => {
    renderView({
      lyricsSheetOpen: true,
      onLyricsSheetChange: vi.fn(),
      lyrics: [{ time: 0, text: 'a line' }],
    });

    expect(screen.getByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    expect(screen.getByText('a line')).toBeInTheDocument();
  });

  it('keeps the transport reachable while the sheet is open', () => {
    // The sheet is scoped to the content area precisely so playback stays
    // controllable. Anchoring it to the view root would bury these.
    renderView({
      lyricsSheetOpen: true,
      onLyricsSheetChange: vi.fn(),
      lyrics: [{ time: 0, text: 'a line' }],
    });

    expect(screen.getByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    for (const label of ['Previous', 'Next', 'Toggle lyrics']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('still calls onToggleLyrics when no sheet handler is supplied', () => {
    // Backwards-compatible path: hosts that have not adopted the sheet keep
    // the old behaviour.
    const { onToggleLyrics } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle lyrics' }));
    expect(onToggleLyrics).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/MobileNowPlaying.test.tsx`
Expected: FAIL — the four new sheet tests fail (`onLyricsSheetChange` never called; no `complementary` region). The existing tests and the `onToggleLyrics` fallback test pass.

- [ ] **Step 3: Add the props**

In `src/components/MobileNowPlaying.tsx`, add to the `MobileNowPlayingProps` interface, immediately after `onToggleLyrics: () => void;`:

```tsx
  /** Whether the in-view lyrics sheet is showing. */
  lyricsSheetOpen?: boolean;
  /** Supplied by hosts that use the in-view sheet; when absent the lyrics
   *  button falls back to `onToggleLyrics`. */
  onLyricsSheetChange?: (open: boolean) => void;
  lyrics?: LyricLine[];
  onSeekLyric?: (time: number) => void;
  onFetchLyrics?: () => void;
  fetchingLyrics?: boolean;
  fetchLyricsError?: string | null;
```

Add `LyricLine` to the existing `import type { … } from '../types';` line, and add these imports:

```tsx
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { LyricsSheet } from './LyricsSheet';
```

Destructure the new props in the component signature alongside `onToggleLyrics`.

- [ ] **Step 4: Wire the gesture and the button**

Immediately after the existing `const format = describeFormat(song);` line, add:

```tsx
  // Swipe up anywhere on the view (except on a control) to reveal lyrics.
  const swipe = useSwipeGesture({
    onSwipeUp: () => onLyricsSheetChange?.(true),
  });
```

Spread the handlers onto the root `<div ref={viewRef} role="dialog" …>` by adding `{...swipe}` after `ref={viewRef}`.

Change the lyrics button's `onClick` from `onClick={onToggleLyrics}` to:

```tsx
            onClick={() => (onLyricsSheetChange ? onLyricsSheetChange(true) : onToggleLyrics())}
```

- [ ] **Step 5: Render the sheet inside the content area**

Give the orb/title container a positioning context. Change:

```tsx
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
```

to:

```tsx
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8">
```

Then, as the **last child of that div** (after the title block, still inside it), add:

```tsx
      <LyricsSheet
        open={!!lyricsSheetOpen}
        onClose={() => onLyricsSheetChange?.(false)}
        lyrics={lyrics}
        currentTime={currentTime}
        onSeek={onSeekLyric}
        onFetch={onFetchLyrics}
        fetching={fetchingLyrics}
        fetchError={fetchLyricsError}
      />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/MobileNowPlaying.test.tsx`
Expected: PASS — all existing tests plus the five new ones.

- [ ] **Step 7: Commit**

```bash
git add src/components/MobileNowPlaying.tsx src/components/MobileNowPlaying.test.tsx
git commit -m "feat: open lyrics as an in-view sheet, by button or swipe up"
```

---

## Task 5: App wiring — routing, Escape, auto-close

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: the `MobileNowPlaying` props added in Task 4.
- Produces: nothing further depends on this — it is the last task.

**Design notes:**

- `togglePanel` currently ends with an unconditional `setMobilePlayerOpen(false)`. It must stop doing that **for `'lyrics'` only**. Queue and Stats are still `z-40` beneath a `z-[60]` view and must keep closing it (Decision 3).
- While the view is open, `togglePanel('lyrics')` toggles the sheet and leaves `showLyrics` alone — otherwise pressing `L` twice from the view would leave the right-edge panel open behind it.
- The Escape chain gains `lyricsSheetOpen` as its **first** branch, before `mobilePlayerOpen`: Escape should peel the sheet off before dismissing the view underneath it.
- **Known benign state, do not "fix" it:** opening the now-playing view does not close the right-edge `LyricsPanel` (pre-existing — nothing in the expand path touches panel state). So a user who has the panel open and then expands the view can have both lyrics surfaces mounted at once. The view is `z-[60]` over the panel's `z-40`, so only the sheet is visible and nothing is broken. Closing the view reveals the panel again, which is the state the user left. Suppressing one from the other would need new coupling between two surfaces that are deliberately independent.

- [ ] **Step 1: Write the failing test**

Append to `src/App.test.tsx` a new top-level `describe` (place it after the existing "right-edge panel exclusivity" block):

```tsx
describe('lyrics sheet inside the now-playing view', () => {
  it('opens the sheet from L and leaves the now-playing view open', async () => {
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });
    fireEvent.click(await screen.findByText('Cemalım'));
    fireEvent.click(screen.getByLabelText('Open now playing'));

    fireEvent.keyDown(document, { code: 'KeyL' });

    expect(await screen.findByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    // The regression this whole feature exists to prevent.
    expect(screen.getByRole('dialog', { name: 'Now playing' })).toBeInTheDocument();
  });

  it('Escape closes the sheet before the view', async () => {
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });
    fireEvent.click(await screen.findByText('Cemalım'));
    fireEvent.click(screen.getByLabelText('Open now playing'));
    fireEvent.keyDown(document, { code: 'KeyL' });
    await screen.findByRole('complementary', { name: 'Lyrics' });

    fireEvent.keyDown(document, { code: 'Escape' });

    expect(screen.getByRole('dialog', { name: 'Now playing' })).toBeInTheDocument();

    fireEvent.keyDown(document, { code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument();
  });

  it('still closes the view when the queue is opened from it', async () => {
    // Queue is z-40 under a z-[60] view, so it must keep closing the view.
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });
    fireEvent.click(await screen.findByText('Cemalım'));
    fireEvent.click(screen.getByLabelText('Open now playing'));

    fireEvent.keyDown(document, { code: 'KeyQ' });

    expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument();
  });
});
```

`renderApp` is **async** and its seed is `{ playlists?, roots? }` — there is no
`songs` option, so every call must be `await renderApp({ playlists: [...] })`.
Add this helper next to the new `describe` (the existing tests spell the same
shape out inline):

```tsx
const libraryWith = (...songs: Song[]) =>
  makePlaylist({ id: 'library', name: 'Library', songs });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/App.test.tsx -t "lyrics sheet inside"`
Expected: FAIL — the first test fails because `KeyL` closes the view (`togglePanel` calls `setMobilePlayerOpen(false)`), so the `dialog` assertion fails.

- [ ] **Step 3: Add the state**

In `src/App.tsx`, immediately after the existing `const [mobilePlayerOpen, setMobilePlayerOpen] = useState(false);`, add:

```tsx
  // Lyrics shown INSIDE the now-playing view. Separate from `showLyrics`
  // (the right-edge panel) because both surfaces exist and serve different
  // contexts — see ROADMAP item 7.
  const [lyricsSheetOpen, setLyricsSheetOpen] = useState(false);
```

- [ ] **Step 4: Route lyrics to the sheet**

Replace the body of `togglePanel` with:

```tsx
  const togglePanel = useCallback((panel: 'lyrics' | 'queue' | 'stats') => {
    // Inside the full-screen view, lyrics mean the in-view sheet: it rides
    // above the view instead of being hidden beneath it, so the view stays.
    if (panel === 'lyrics' && mobilePlayerOpenRef.current) {
      setLyricsSheetOpen((v) => !v);
      return;
    }
    setShowLyrics((v) => (panel === 'lyrics' ? !v : false));
    setShowQueue((v) => (panel === 'queue' ? !v : false));
    setShowStats((v) => (panel === 'stats' ? !v : false));
    // Queue and Stats are z-40 beneath a z-[60] view, so they still have to
    // dismiss it. Only lyrics got its own in-view surface.
    setMobilePlayerOpen(false);
  }, []);
```

`togglePanel` is a stable `useCallback([])` consumed by memoized children, so it must not gain `mobilePlayerOpen` as a dependency. Add a ref beside the state declaration and keep it fresh:

```tsx
  const mobilePlayerOpenRef = useRef(false);
  mobilePlayerOpenRef.current = mobilePlayerOpen;
```

- [ ] **Step 5: Add the Escape branch and the auto-close**

In the `useKeyboardShortcuts` `Escape` handler, add this as the **first** branch, above `if (mobilePlayerOpen)`:

```tsx
        if (lyricsSheetOpen) {
          setLyricsSheetOpen(false);
          return;
        }
```

Extend the existing effect that auto-closes the view so the sheet cannot outlive it:

```tsx
  useEffect(() => {
    if (mobilePlayerOpen && !currentSong) setMobilePlayerOpen(false);
    if (!mobilePlayerOpen && lyricsSheetOpen) setLyricsSheetOpen(false);
  }, [mobilePlayerOpen, currentSong, lyricsSheetOpen]);
```

- [ ] **Step 6: Pass the new props**

At the `<MobileNowPlaying …>` call site, add beside the existing `onToggleLyrics`:

```tsx
            lyricsSheetOpen={lyricsSheetOpen}
            onLyricsSheetChange={setLyricsSheetOpen}
            lyrics={currentSong?.lyrics}
            onSeekLyric={seek}
            onFetchLyrics={currentSong ? handleFetchLyrics : undefined}
            fetchingLyrics={fetchingLyrics}
            fetchLyricsError={fetchLyricsError}
```

These names are verified against the existing `<LyricsPanel …>` call site: it
passes `onFetch={currentSong ? handleFetchLyrics : undefined}`,
`fetching={fetchingLyrics}` and `fetchError={fetchLyricsError}`. Note the App
state is **`fetchLyricsError`**, not `lyricsFetchError` — and the fetch handler
is passed conditionally, so a song-less render offers no "Find lyrics" button.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/App.test.tsx`
Expected: PASS — all existing App tests plus the three new ones.

- [ ] **Step 8: Full suite and typecheck**

Run: `pnpm test:run && pnpm build`
Expected: all tests pass; `tsc` reports no errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: route lyrics to the in-view sheet while the now-playing view is open"
```

---

## Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

In the **"Mobile layout (the `lg` split)"** section, the `MobileNowPlaying` bullet currently ends with the sentence beginning *"**Toggling Lyrics from this view also closes it**"*. Replace that sentence with:

```
  **Lyrics from this view open an in-view `LyricsSheet`, not the right-edge
  panel** — the sheet is `absolute` against the view's **content area** (the
  orb/title region, which carries `relative` for exactly this), so it rides
  above the orb without entering the global z-order, and the view no longer has
  to close itself. **It is deliberately NOT anchored to the view root**: that
  covers the progress bar and transport, leaving no way to control playback
  while reading — and today's `LyricsPanel` (`z-40`) sits under `PlayerBar`
  (`z-50`), so burying the controls would be a regression. `-inset-x-6` cancels
  the view's `p-6` so it still bleeds edge to edge. Reachable by
  the Mic2 button or a swipe up (`useSwipeGesture`, which ignores drags
  starting on a control so scrubbing the progress bar never opens it).
  **Queue and Stats still close the view** — they are `z-40` beneath a `z-[60]`
  view and have no in-view surface.
```

In the **"The right-edge panel slot"** section, append:

```
- **`togglePanel('lyrics')` is context-sensitive**: while `mobilePlayerOpen`,
  it toggles `lyricsSheetOpen` and returns, leaving `showLyrics` untouched.
  It reads the view's state through `mobilePlayerOpenRef`, not the state
  value — `togglePanel` is a stable `useCallback([])` consumed by memoized
  children and must not gain a dependency.
```

In the **"Lyrics"** section, append:

```
- **`LyricsView` (`src/components/LyricsView.tsx`) owns the lyric body** —
  empty state, synced list with click-to-seek, unsynced block, active-line
  auto-scroll. `LyricsPanel` and `LyricsSheet` are chrome around it. Add a
  third lyrics surface by wrapping `LyricsView`, never by copying its body.
```

- [ ] **Step 2: Update `ROADMAP.md`**

In the Backlog preamble, change `Items 5 and 7 stand.` to `Item 5 stands.` and update the shipped list to include 7 with the date `2026-08-31`.

Replace backlog entry 7 with:

```
7. ~~**Swipe-up-for-lyrics**~~ — shipped 2026-08-31. See the section below.
```

Append a new section at the end of the file:

```markdown
## Swipe-up-for-lyrics (shipped, 2026-08-31)

Backlog item 7. Lyrics now open as a `LyricsSheet` *inside* `MobileNowPlaying`
— by the Mic2 button or an upward drag — instead of forcing the view to close.
The old workaround existed because `LyricsPanel` is `z-40` and the view is
`z-[60]`; the sheet sidesteps the global z-order entirely by being `absolute`
against the view's content area. Anchoring it to the view root was tried on
paper and rejected after measuring in Chromium: it covers the progress bar and
transport, which would have made lyrics and playback control mutually
exclusive — a regression, since today's `z-40` panel sits under the `z-50`
player bar.

`LyricsView` was extracted first so the panel and the sheet render identical
lyrics from one source — the extraction was verified faithful by requiring
`LyricsPanel.test.tsx` to pass with zero edits.

Scope decisions: both surfaces were kept (the right-edge panel still serves the
song-list context on every screen size), and Queue/Stats deliberately still
close the view, since they have no in-view surface of their own.
```

- [ ] **Step 3: Update `README.md`**

In the feature list, beside the existing lyrics entry, add:

```
- **Swipe up in the now-playing view** to reveal lyrics without leaving it
```

- [ ] **Step 4: Verify the prose against the code**

Re-read each sentence added above against the shipped source. This is a required step, not a formality: on two consecutive branches this project shipped a factually false doc sentence that a full review chain passed, because reviewers are asked "does the code match the brief", never "is this sentence true". Check specifically that the z-index values, the class names, and the `useCallback` claim are all still accurate in the code as committed.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md ROADMAP.md README.md
git commit -m "docs: record the in-view lyrics sheet and swipe gesture"
```

---

## Verification

Automated:

```bash
pnpm test:run && pnpm build
```

Manual, in a real browser (`pnpm build && pnpm preview`, then `playwright-cli --browser=chromium`):

1. **Phone width (390×844).** Play a track, tap the mini-bar to open the now-playing view, drag upward from the middle of the view → the sheet rises and **the view stays**. Drag the handle down → the sheet falls, the view is still there.
2. **The guard that matters.** Drag *upward starting on the progress bar*, then on the volume button → the sheet must not open. This is the failure mode the interactive-element check exists for.
3. **Playback stays controllable.** With the sheet open, press play/pause, skip a track and drag the progress bar. All must work — the sheet is scoped to the content area for exactly this reason, and it is the defect this plan's audit caught.
4. **Desktop (1280×800).** Click the bottom player bar's cover to open the view; the button and the gesture behave the same. (`MobileNowPlaying` renders at every size despite its name.)
5. **Queue is unchanged.** From the view, tap the queue button → the view closes and the right-edge queue panel opens, exactly as before.
6. **Reduced motion.** Toggle the OS "reduce motion" setting and re-open the sheet: it appears and disappears instantly, with no 300ms empty hold.
7. **Escape order.** With the sheet open, Escape closes the sheet; a second Escape closes the view.

Not covered by any of this: nothing audio-related is touched, so no listening test is required for this feature.
