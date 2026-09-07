# Playback Speed + Pitch Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted playback-speed control (0.5×–2×) with an explicit pitch-preservation toggle, without breaking the crossfade, the listening stats, or the OS media widget — all three of which currently assume 1×.

**Architecture:** `playbackRate` and `preservePitch` become two more persisted preferences in `App.tsx`, applied by `useAudioEngine` to **both** `<audio>` elements (the inactive one is the gapless/crossfade preload target). The subtle work is not applying the rate — it is that three time-based guards in the engine are written in *media* seconds while the fade they schedule runs in *wall-clock* seconds, so each must be scaled by the rate. Listening stats and Media Session each carry a hardcoded 1× that becomes a lie.

**Tech Stack:** React 18 + TypeScript, Vitest 3 + happy-dom + React Testing Library, Web Audio API, `idb-keyval` via `src/lib/storage.ts`.

**Spec:** None — this was brainstormed as a bounded change and escalated to a plan when the crossfade timing turned out tangled. The approved decisions are recorded under "Decisions" below; treat that section as the spec.

## Global Constraints

- **pnpm only.** `pnpm test:run` before every commit; `pnpm build` (runs `tsc`) before claiming done.
- **Commit messages: simple and concise. NO "Generated with Claude Code" line. NO "Co-Authored-By" footer.**
- **Never stage secrets.** Nothing in this plan introduces any.
- **`playbackRate` must never be set to 0 or a negative number.** Verified in Chromium 2026-09-06: `audio.playbackRate = 0` is silently accepted and acts as a pause; `audio.playbackRate = -1` throws `NotSupportedError`. Every write goes through `clampRate`.
- **`preservesPitch` is unprefixed and defaults to `true`.** Verified in the same probe: `'preservesPitch' in audio === true`, `'webkitPreservesPitch' in audio === false`, `'mozPreservesPitch' in audio === false`. Do **not** add prefixed fallbacks — they do not exist in this browser, and on an engine that lacks the property the assignment is an inert no-op (pitch shifts, nothing breaks).
- **Preferences persist through `prefsLoadedRef`, never `loadedRef`.** `loadedRef` guards the library and is deliberately false during a pending folder permission; gating a preference on it would stop preferences saving. See `App.tsx:516-535` for the existing pattern.
- **happy-dom already defaults `playbackRate` to `1` and `preservesPitch` to `true`** (probed 2026-09-07; both are writable, and an effect's writes are visible on the element). So **no test may assert `playbackRate === 1` or `preservesPitch === true` on a freshly rendered element** — it would pass with the implementation deleted. Assert a non-default value, or a transition away from one.
- **Do not touch the ReplayGain/fade gain split.** `filters → gain (ReplayGain) → fade (crossfade) → mixer`. Playback rate is a property of the `<audio>` element and never enters the graph.

## Decisions (approved 2026-09-06)

| Decision | Choice |
|---|---|
| Pitch | Speed control **plus** an explicit "preserve pitch" toggle, defaulting on |
| Placement | Inside the existing audio-settings popover in `MobileNowPlaying`, under Equalizer and Crossfade |
| Persistence | Persisted to IDB, **never** auto-reset on track change (same lifecycle as volume and EQ preset) |
| Range | 0.5× to 2× |
| Stats | `msPlayed` counts **wall-clock time actually spent**, so it is divided by the rate at finish |

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/playback-rate.ts` | **new** — the pure module: the option list, `clampRate`, `formatRate`. The single place the 0/negative clamp lives. Mirrors `src/lib/eq.ts` and `src/lib/crossfade.ts`. |
| `src/lib/playback-rate.test.ts` | **new** — unit tests for the above. |
| `src/lib/storage.ts` | Two more preference keys + getters/setters, mirroring `getVolume`/`saveVolume` at `:178-185`. |
| `src/hooks/useAudioEngine.ts` | Accept `playbackRate`/`preservePitch`; apply to both elements; scale the three media-second guards in `onTime`. |
| `src/lib/stats.ts` | `recordFinish` gains an optional rate so `msPlayed` means time actually spent. |
| `src/hooks/useMediaSession.ts` | Replace the hardcoded `playbackRate: 1` at `:89`. |
| `src/App.tsx` | State, load, save, engine wiring, stats rate, props down to `MobileNowPlaying`. |
| `src/components/MobileNowPlaying.tsx` | The popover section + the "audio is modified" indicator at `:385`. |

Tasks 3 and 4 both edit `useAudioEngine.ts` and are deliberately split: Task 3 is mechanical property assignment, Task 4 is the timing math that carries all the risk. A reviewer should be able to reject one and keep the other.

---

### Task 1: The pure playback-rate module

**Files:**
- Create: `src/lib/playback-rate.ts`
- Test: `src/lib/playback-rate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RATE_OPTIONS: readonly number[]`, `DEFAULT_RATE: number` (= `1`), `clampRate(n: number): number`, `formatRate(rate: number): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/playback-rate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RATE_OPTIONS, DEFAULT_RATE, clampRate, formatRate } from './playback-rate';

describe('clampRate', () => {
  it('passes through a rate inside the range', () => {
    expect(clampRate(1.5)).toBe(1.5);
  });

  it('clamps above the maximum', () => {
    expect(clampRate(4)).toBe(2);
  });

  it('clamps below the minimum', () => {
    expect(clampRate(0.1)).toBe(0.5);
  });

  it('rejects zero, which the browser accepts as a silent pause', () => {
    // Verified in Chromium: `audio.playbackRate = 0` does NOT throw, it just
    // stops the audio with no state change anywhere in the app — the worst
    // possible failure, because nothing looks wrong.
    expect(clampRate(0)).toBe(DEFAULT_RATE);
  });

  it('rejects a negative rate, which throws NotSupportedError on a real element', () => {
    expect(clampRate(-1)).toBe(DEFAULT_RATE);
  });

  it.each([NaN, Infinity, -Infinity])('rejects the non-finite value %p', (bad) => {
    expect(clampRate(bad)).toBe(DEFAULT_RATE);
  });

  it('coerces a non-number to the default rather than poisoning the audio element', () => {
    expect(clampRate(undefined as unknown as number)).toBe(DEFAULT_RATE);
  });
});

describe('RATE_OPTIONS', () => {
  it('spans 0.5x to 2x and includes normal speed', () => {
    expect(RATE_OPTIONS[0]).toBe(0.5);
    expect(RATE_OPTIONS[RATE_OPTIONS.length - 1]).toBe(2);
    expect(RATE_OPTIONS).toContain(DEFAULT_RATE);
  });

  it('every option survives its own clamp', () => {
    for (const r of RATE_OPTIONS) expect(clampRate(r)).toBe(r);
  });
});

describe('formatRate', () => {
  it.each([
    [1, '1x'],
    [1.5, '1.5x'],
    [0.5, '0.5x'],
    [2, '2x'],
  ])('renders %p as %s', (rate, label) => {
    expect(formatRate(rate)).toBe(label);
  });

  it('drops a trailing .0 so normal speed reads "1x", not "1.0x"', () => {
    expect(formatRate(1.0)).toBe('1x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/playback-rate.test.ts`
Expected: FAIL — `Failed to resolve import "./playback-rate"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/playback-rate.ts`:

```ts
/**
 * Playback speed, as a pure module so the clamp lives in exactly one place.
 *
 * The clamp is not defensive padding — it is load-bearing. Verified in
 * Chromium 2026-09-06: `audio.playbackRate = 0` is silently ACCEPTED and
 * behaves as a pause (no event, no state change, nothing in the UI looks
 * wrong), and `audio.playbackRate = -1` throws `NotSupportedError` out of
 * whatever handler set it. Both are reachable from a corrupt persisted value.
 */

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const DEFAULT_RATE = 1;

/** The speeds offered in the UI. Quarter steps: fine enough to be useful,
 *  few enough to stay a tap list rather than a slider. */
export const RATE_OPTIONS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function clampRate(rate: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/** `1` -> "1x", `1.5` -> "1.5x". No trailing ".0". */
export function formatRate(rate: number): string {
  return `${parseFloat(rate.toFixed(2))}x`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/playback-rate.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playback-rate.ts src/lib/playback-rate.test.ts
git commit -m "feat: add pure playback-rate module with a load-bearing clamp"
```

---

### Task 2: Persist the two preferences

**Files:**
- Modify: `src/lib/storage.ts` (add beside `getVolume`/`saveVolume` at `:178-185`)
- Test: `src/lib/storage.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: `DEFAULT_RATE`, `clampRate` from `src/lib/playback-rate.ts` (Task 1).
- Produces: `getPlaybackRate(): Promise<number>`, `savePlaybackRate(rate: number): Promise<void>`, `getPreservePitch(): Promise<boolean>`, `savePreservePitch(on: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`src/lib/storage.test.ts` uses **named imports** (verified: its import block at
lines 1-12 lists `getCrossfade`, `getEqPreset`, `getVolume`, `saveCrossfade`, …).
Add these four names to that existing import block:

```ts
  getPlaybackRate,
  savePlaybackRate,
  getPreservePitch,
  savePreservePitch,
```

Then append this describe block at the end of the file:

```ts
describe('playback rate + pitch preferences', () => {
  it('round-trips a stored rate', async () => {
    await savePlaybackRate(1.5);
    expect(await getPlaybackRate()).toBe(1.5);
  });

  it('defaults to normal speed when nothing is stored', async () => {
    expect(await getPlaybackRate()).toBe(1);
  });

  it('clamps a corrupt stored rate on READ, not just on write', async () => {
    // A value written by an older build, a hand-edited IDB, or a bug elsewhere
    // must not reach the audio element. 0 is the dangerous one: the browser
    // accepts it and silently stops playback.
    await savePlaybackRate(0);
    expect(await getPlaybackRate()).toBe(1);
  });

  it('round-trips the pitch preference', async () => {
    await savePreservePitch(false);
    expect(await getPreservePitch()).toBe(false);
  });

  it('defaults to preserving pitch when nothing is stored', async () => {
    expect(await getPreservePitch()).toBe(true);
  });
});
```

The "defaults" tests assume each `it` starts from an empty store. Check how the
file resets IDB between tests (a `beforeEach` near the top) and place the two
default-value tests so they run against a clean store.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/storage.test.ts`
Expected: FAIL — `storage.savePlaybackRate is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/storage.ts`, add to the key constants near `const VOLUME_KEY = 'volume';` (line 10):

```ts
const PLAYBACK_RATE_KEY = 'playback-rate';
const PRESERVE_PITCH_KEY = 'preserve-pitch';
```

Add the import at the top of the file:

```ts
import { clampRate, DEFAULT_RATE } from './playback-rate';
```

Add the accessors immediately after `saveVolume` (line 185):

```ts
/**
 * Clamped on READ as well as write: a rate of 0 silently stops playback in
 * every browser, and this value survives across releases in IDB. Reading it
 * back through the clamp means one bad write can never become permanent.
 */
export async function getPlaybackRate(): Promise<number> {
  const v = await get<number>(PLAYBACK_RATE_KEY);
  return v === undefined ? DEFAULT_RATE : clampRate(v);
}

export async function savePlaybackRate(rate: number): Promise<void> {
  await set(PLAYBACK_RATE_KEY, clampRate(rate));
}

export async function getPreservePitch(): Promise<boolean> {
  const v = await get<boolean>(PRESERVE_PITCH_KEY);
  return v ?? true;
}

export async function savePreservePitch(on: boolean): Promise<void> {
  await set(PRESERVE_PITCH_KEY, on);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: persist playback rate and pitch preference"
```

---

### Task 3: Apply the rate to both audio elements

**Files:**
- Modify: `src/hooks/useAudioEngine.ts`
- Test: `src/hooks/useAudioEngine.test.tsx`

**Interfaces:**
- Consumes: `clampRate` from `src/lib/playback-rate.ts` (Task 1).
- Produces: `useAudioEngine` accepts two new optional args — `playbackRate?: number` (default `1`) and `preservePitch?: boolean` (default `true`). Also adds an internal `playbackRateRef` that Task 4 reads.

- [ ] **Step 1: Write the failing test**

In `src/hooks/useAudioEngine.test.tsx`, extend `TestHarness` (line 124) to forward the new props — add `playbackRate` and `preservePitch` to both its destructured params and its type, and pass them into `useAudioEngine`:

```tsx
function TestHarness({
  song,
  nextSong = null,
  crossfadeSeconds = 0,
  playbackRate,
  preservePitch,
  onEnded,
  onTrackFinished,
}: {
  song: HarnessSong;
  nextSong?: HarnessSong;
  crossfadeSeconds?: number;
  playbackRate?: number;
  preservePitch?: boolean;
  onEnded?: () => void;
  onTrackFinished?: () => void;
}) {
  const engine = useAudioEngine({
    song,
    nextSong,
    crossfadeSeconds,
    playbackRate,
    preservePitch,
    onEnded,
    onTrackFinished,
  });
  useEffect(() => {
    engineRef.current = engine;
  });
  return (
    <>
      <audio ref={engine.audioRefA} />
      <audio ref={engine.audioRefB} />
    </>
  );
}
```

Then add a new describe block at the end of the file:

```tsx
describe('useAudioEngine — playback rate', () => {
  it('applies the rate to BOTH elements, not just the active one', async () => {
    const view = render(<TestHarness song={makeSong({ title: 'A' })} playbackRate={1.5} />);
    await act(async () => {});

    // Both, because the inactive element is the gapless/crossfade preload
    // target: set only the active one and every track snaps back to 1x at
    // the flip, mid-listen, with nothing in the UI changing.
    expect(engineRef.current!.audioRefA.current!.playbackRate).toBe(1.5);
    expect(engineRef.current!.audioRefB.current!.playbackRate).toBe(1.5);
    view.unmount();
  });

  it('updates both elements when the rate changes', async () => {
    const song = makeSong({ title: 'A' });
    const view = render(<TestHarness song={song} playbackRate={1} />);
    await act(async () => {});

    view.rerender(<TestHarness song={song} playbackRate={2} />);
    await act(async () => {});

    expect(engineRef.current!.audioRefA.current!.playbackRate).toBe(2);
    expect(engineRef.current!.audioRefB.current!.playbackRate).toBe(2);
    view.unmount();
  });

  it('clamps a rate of 0, which the browser would accept as a silent pause', async () => {
    // Deliberately written as a TRANSITION from 1.5, not a fresh render at 0.
    // happy-dom's audio element already defaults `playbackRate` to 1 (probed
    // 2026-09-07), so asserting `toBe(1)` after a fresh render at 0 passes
    // whether the clamp works, whether the effect ran, or neither. Coming from
    // 1.5, the assertion fails at 0 if the clamp is missing and at 1.5 if the
    // effect never re-ran — it can only pass for the right reason.
    const song = makeSong({ title: 'A' });
    const view = render(<TestHarness song={song} playbackRate={1.5} />);
    await act(async () => {});
    expect(engineRef.current!.audioRefA.current!.playbackRate).toBe(1.5);

    view.rerender(<TestHarness song={song} playbackRate={0} />);
    await act(async () => {});

    expect(engineRef.current!.audioRefA.current!.playbackRate).toBe(1);
    view.unmount();
  });

  it('applies the pitch preference to both elements', async () => {
    // Asserts `false`, never `true`: happy-dom defaults `preservesPitch` to
    // true (probed 2026-09-07), so a `toBe(true)` assertion here would pass
    // with the effect deleted.
    const view = render(
      <TestHarness song={makeSong({ title: 'A' })} playbackRate={1.5} preservePitch={false} />,
    );
    await act(async () => {});

    expect(engineRef.current!.audioRefA.current!.preservesPitch).toBe(false);
    expect(engineRef.current!.audioRefB.current!.preservesPitch).toBe(false);
    view.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/hooks/useAudioEngine.test.tsx -t "playback rate"`
Expected: FAIL — `expected 1 to be 1.5` on the first test (happy-dom's element sits at its default rate of 1 because nothing writes to it yet), and `expected true to be false` on the pitch test.

- [ ] **Step 3: Write minimal implementation**

In `src/hooks/useAudioEngine.ts`:

1. Add the import beside the existing `crossfade` import at the top:

```ts
import { clampRate, DEFAULT_RATE } from '../lib/playback-rate';
```

2. Add to `UseAudioEngineArgs` (after `crossfadeSeconds`, line 27):

```ts
  /** Playback speed. Clamped — 0 silently stops audio, negatives throw. */
  playbackRate?: number;
  /** Keep pitch constant while the rate changes. Default true. */
  preservePitch?: boolean;
```

3. Add to the destructured params (after `crossfadeSeconds`, around line 77):

```ts
  playbackRate = DEFAULT_RATE,
  preservePitch = true,
```

4. Add the ref beside `crossfadeRef` (line 93):

```ts
  const playbackRateRef = useRef(clampRate(playbackRate));
```

5. Add to the ref-refresh effect (the block at lines 108-113, which has **no dependency array** and therefore runs every render):

```ts
    playbackRateRef.current = clampRate(playbackRate);
```

6. Add a new effect immediately after the volume effect at `:506-509`:

```ts
  // Both elements, every time. The INACTIVE element is the gapless/crossfade
  // preload target — it is already loaded and about to become active, so an
  // active-only write means the next track starts at 1x with no UI change to
  // explain it. Same reasoning as the volume effect directly above.
  useEffect(() => {
    const rate = clampRate(playbackRate);
    for (const el of [audioRefA.current, audioRefB.current]) {
      if (!el) continue;
      el.preservesPitch = preservePitch;
      el.playbackRate = rate;
    }
  }, [playbackRate, preservePitch]);
```

`preservesPitch` is assigned **before** `playbackRate` so the very first rate change is already rendered under the chosen pitch mode.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/hooks/useAudioEngine.test.tsx`
Expected: PASS — the new block and all pre-existing engine tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.test.tsx
git commit -m "feat: apply playback rate and pitch preference to both audio elements"
```

---

### Task 4: Scale the engine's time guards by the rate

This is the task that carries the risk. Read the whole task before starting.

**The problem.** In `onTime` (`useAudioEngine.ts:298-337`), `remaining = target.duration - target.currentTime` is in **media seconds**. The fade it triggers is scheduled with `setValueCurveAtTime(curve, now, seconds)` against the AudioContext clock — **wall-clock seconds** (`:361`, `:363`), and torn down by `window.setTimeout(endCrossfade, seconds * 1000)` (`:374`), also wall-clock. At rate `r`, `remaining` media seconds elapse in `remaining / r` wall seconds. So at 2× with a 6s crossfade the fade begins with **3** real seconds of audio left and the outgoing track ends mid-curve.

**The fix.** The scheduled curve duration stays `xfade` — a 6-second crossfade should sound like 6 seconds regardless of speed. Only the *trigger points* move, by multiplying each media-second threshold by the rate:

| Guard | Now | Becomes | Why |
|---|---|---|---|
| Crossfade trigger (`:326`) | `remaining <= xfade` | `remaining <= xfade * rate` | Fire when `xfade` **wall** seconds remain. |
| Preload lead (`:318`) | `remaining < preloadLead` | `remaining < preloadLead * rate` | The incoming track must be loaded before the fade is due; at 2× the deadline arrives twice as fast. |
| Min-duration guard (`:329`) | `target.duration > xfade * 2` | `target.duration > xfade * rate * 2` | The fade consumes `xfade * rate` **media** seconds, so at 2× a 6s fade eats 12s of the track and a 20s track would be nearly all fade. |

**Files:**
- Modify: `src/hooks/useAudioEngine.ts:308-337`
- Test: `src/hooks/useAudioEngine.test.tsx`

**Interfaces:**
- Consumes: `playbackRateRef` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to the `describe('useAudioEngine — crossfade', ...)` block in `src/hooks/useAudioEngine.test.tsx` (it already has the fake timers and `fireTimeUpdate` helper it needs):

```tsx
  it('starts the fade earlier in MEDIA time at 2x, so it still lasts the full wall-clock duration', async () => {
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} playbackRate={2} />,
    );
    await act(async () => {});
    const audioA = engineRef.current!.audioRefA.current!;

    // 8 media seconds left. At 2x that is 4 WALL seconds — less than the 6s
    // fade, so the fade must already be running or its tail would be cut.
    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 172, duration: 180 });
    });

    expect(gains.fadeA.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    // The curve duration itself is wall-clock and must NOT be scaled: the
    // user asked for a 6-second crossfade and must hear six seconds of it.
    expect(gains.fadeA.gain.setValueCurveAtTime).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      6,
    );
  });

  it('does not fade at 1x from the same position that fades at 2x', async () => {
    // The control for the test above. Without it, that test would pass even
    // if the trigger ignored the rate and simply fired too early always.
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} playbackRate={1} />,
    );
    await act(async () => {});
    const audioA = engineRef.current!.audioRefA.current!;

    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 172, duration: 180 });
    });

    expect(gains.fadeA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
  });

  it('does not crossfade a track too short for the fade AT THE CURRENT RATE', async () => {
    // The duration must sit BETWEEN the two guards or the test proves nothing.
    // 6s fade at 2x: unscaled guard is `duration > 12` (passes, would fade),
    // scaled guard is `duration > 6 * 2 * 2 = 24` (fails, correctly rejected).
    // A 20s track is inside that window. Do not raise it to 30 — 30 > 24, so
    // the scaled guard would pass too and the test would fail.
    // Position: remaining = 10, which is <= 6 * 2 = 12, so the trigger is
    // reached and the ONLY thing rejecting the fade is the duration guard.
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} playbackRate={2} />,
    );
    await act(async () => {});
    const audioA = engineRef.current!.audioRefA.current!;

    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 10, duration: 20 });
    });

    expect(gains.fadeA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
  });

  it('preloads the next track earlier in media time at 2x', async () => {
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={0} playbackRate={2} />,
    );
    await act(async () => {});
    const audioA = engineRef.current!.audioRefA.current!;
    const audioB = engineRef.current!.audioRefB.current!;

    // 8 media seconds left = 4 wall seconds, inside the 5s preload lead once
    // scaled. Unscaled (remaining < 5) this would not preload.
    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 172, duration: 180 });
    });

    expect(audioB.src).toContain(songB.url);
  });

  it('does not preload at 1x from the same position that preloads at 2x', async () => {
    // Control for the test above: without it, that test passes even if the
    // preload fired unconditionally.
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={0} playbackRate={1} />,
    );
    await act(async () => {});
    const audioA = engineRef.current!.audioRefA.current!;
    const audioB = engineRef.current!.audioRefB.current!;

    // 8 media seconds left, outside the unscaled 5s lead.
    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 172, duration: 180 });
    });

    expect(audioB.src).toBe('');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/hooks/useAudioEngine.test.tsx -t "crossfade"`
Expected: FAIL on three of the four new tests — the 2× fade test (`expected "spy" to be called 1 times, but got 0`), the short-track test (fade fires when it should not), and the preload test (`audioB.src` is empty). The 1× control test should PASS already; if it fails, stop — the harness is wrong, not the code.

- [ ] **Step 3: Write minimal implementation**

Replace `useAudioEngine.ts:308-337` (from `const remaining =` through the closing brace of the crossfade `if`) with:

```ts
      const remaining = target.duration - target.currentTime;

      // `remaining` is in MEDIA seconds; every deadline below is really about
      // WALL-CLOCK time, because the fade curve is scheduled against the
      // AudioContext clock (`setValueCurveAtTime`) and torn down by a
      // `setTimeout`. At rate r, `remaining` media seconds elapse in
      // `remaining / r` real seconds — so each media-second threshold is
      // multiplied by r. Get this wrong and at 2x a 6s crossfade begins with
      // 3 real seconds of audio left and the outgoing track dies mid-curve.
      const rate = playbackRateRef.current;

      // Preload next song on the inactive element when we're near the end. The
      // lead must cover the crossfade, or the incoming track wouldn't be
      // loaded yet when the fade is due to start.
      //
      // Skipped entirely while a crossfade is sounding: "inactive" is then the
      // element still fading out, and writing its src would cut the tail dead.
      // (Reachable when the incoming track is shorter than the lead.)
      const preloadLead = Math.max(PRELOAD_LEAD_SECONDS, xfade + 1) * rate;
      if (!fadingOutRef.current && remaining < preloadLead && inactive.src !== nextSong.url) {
        inactive.src = nextSong.url;
        inactive.load();
      }

      if (
        xfade > 0 &&
        !fadingOutRef.current &&
        remaining <= xfade * rate &&
        // Don't fade a track shorter than twice the fade — there'd be no
        // steady-state left in the middle. Scaled too: the fade eats
        // `xfade * rate` media seconds, so a faster rate needs a longer track.
        target.duration > xfade * rate * 2 &&
        // Repeat-one replays the SAME element in place (see the ended
        // handler); one element cannot crossfade with itself.
        nextSong.url !== target.src &&
        inactive.src === nextSong.url
      ) {
        // NOT scaled: the curve duration is wall-clock, and a 6-second
        // crossfade must sound like six seconds at any speed.
        startCrossfade(target, inactive, xfade);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/hooks/useAudioEngine.test.tsx`
Expected: PASS — the four new tests **and** every pre-existing crossfade test (they all run at the default rate of 1, where `x * 1 === x`, so none of their thresholds move).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioEngine.ts src/hooks/useAudioEngine.test.tsx
git commit -m "fix: scale crossfade and preload thresholds by the playback rate"
```

---

### Task 5: Count listening time at the rate it was played

**Files:**
- Modify: `src/lib/stats.ts:36-48`
- Test: `src/lib/stats.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `recordFinish(stats: StatsMap, song: Song, now: number, rate?: number): StatsMap` — the fourth parameter is **optional and defaults to 1**, so every existing three-argument call site and test keeps working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/stats.test.ts`:

```ts
describe('recordFinish at a non-default playback rate', () => {
  it('counts wall-clock time actually spent, not the track duration', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 2);

    // A 4-minute track played at 2x took 2 minutes of the listener's evening.
    expect(stats.s1.msPlayed).toBe(120_000);
  });

  it('counts more time than the duration at a slow rate', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 0.5);

    expect(stats.s1.msPlayed).toBe(480_000);
  });

  it('still counts one play regardless of rate', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 2);

    expect(stats.s1.plays).toBe(1);
  });

  it('defaults to 1x when no rate is given, so existing callers are unchanged', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    expect(recordFinish({}, song, 1000).msPlayed).toBe(240_000);
  });

  it('falls back to 1x for a nonsensical rate rather than dividing by zero', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    expect(recordFinish({}, song, 1000, 0).msPlayed).toBe(240_000);
  });
});
```

`src/lib/stats.test.ts` already imports `makeSong` (line 10) and `recordFinish`
(in the named block at lines 1-9), so no import changes are needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/stats.test.ts`
Expected: FAIL — `expected 240000 to be 120000` on the first test (the rate argument is ignored).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/stats.ts`, update the doc comment on `msPlayed` (line 16) and the function:

```ts
  /** Wall-clock ms actually spent listening (duration ÷ playback rate). */
  msPlayed: number;
```

```ts
/**
 * Record one completed play. Pure — returns a new map.
 *
 * `now` is injected rather than read from `Date.now()` so the caller (and the
 * tests) stay in control of time.
 *
 * `rate` is the playback speed in effect at the finish. `msPlayed` divides by
 * it so the panel's "listening time" means time the listener actually spent:
 * a 4-minute track at 2x cost them two minutes, not four. Defaults to 1, so
 * every pre-speed call site is unaffected.
 */
export function recordFinish(
  stats: StatsMap,
  song: Song,
  now: number,
  rate = 1,
): StatsMap {
  const prev = stats[song.id];
  // Guard the divisor here as well as at the source: this is a pure function
  // with a public signature, and a 0 would produce Infinity in a persisted map.
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return {
    ...stats,
    [song.id]: {
      plays: (prev?.plays ?? 0) + 1,
      lastPlayedAt: now,
      msPlayed: (prev?.msPlayed ?? 0) + (Math.max(0, song.duration) / safeRate) * 1000,
      // Refreshed every time, so a re-tag (beets) updates the display name.
      title: song.title,
      artist: song.artist,
    },
  };
}
```

Also update the module doc comment at the top of the file (lines 8-11): `msPlayed` is no longer "the sum of completed durations". Replace that sentence with:

```
 * A play is counted when a track FINISHES (see `useAudioEngine`'s
 * `onTrackFinished`), and `msPlayed` is the wall-clock time that took at the
 * playback rate in effect — partial listens are deliberately invisible.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/stats.test.ts`
Expected: PASS, including every pre-existing stats test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "fix: count listening time at the rate the track was played"
```

---

### Task 6: Tell the OS the real playback rate

**Files:**
- Modify: `src/hooks/useMediaSession.ts:1-14` (the `Args` interface and destructuring) and `:86-90`
- Test: `src/hooks/useMediaSession.test.tsx` if one exists; otherwise no test — see below.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useMediaSession` accepts `playbackRate?: number` (default `1`).

**There is no test file for this hook** — verified 2026-09-07: `src/hooks/useMediaSession.test.tsx` does not exist, and CLAUDE.md records the hook as **manual verification only (no unit tests)**. Do **not** create one: a new test file plus a `navigator.mediaSession` mock, for a hook the project has deliberately left untested, is scope creep on a three-line change. This task is covered by the browser check in Task 8.

- [ ] **Step 1: Add the argument**

In `src/hooks/useMediaSession.ts`, add to the `Args` interface after `duration: number;`:

```ts
  /** Current playback speed, so the OS scrubber advances at the right rate. */
  playbackRate?: number;
```

Add to the destructured params after `duration,`:

```ts
  playbackRate = 1,
```

- [ ] **Step 2: Use it**

Replace the hardcoded value at `:89`:

```ts
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate,
      });
```

- [ ] **Step 3: Add it to the effect's dependency array**

The positionState effect is keyed on `[currentTime, duration]`. Add `playbackRate`:

```ts
  }, [currentTime, duration, playbackRate]);
```

Without this the OS widget keeps the stale rate until the next `timeupdate` — which is only ~4 times a second, so in practice it self-heals, but a stale dep is a latent bug the next reader has to reason about.

- [ ] **Step 4: Verify it compiles and nothing regressed**

Run: `pnpm test:run && pnpm build`
Expected: all tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMediaSession.ts
git commit -m "fix: report the real playback rate to the Media Session position state

No unit test: this hook is manual-verification-only by project convention.
Covered by the browser check in the docs task."
```

---

### Task 7: Wire it through App and add the control

**Files:**
- Modify: `src/App.tsx` — state, mount load (`:341-344`), save effects (`:514-535`), engine call (`:308-324`), `useMediaSession` call (`:2010`), `MobileNowPlaying` props
- Modify: `src/components/MobileNowPlaying.tsx` — props, popover section, indicator at `:385`
- Test: `src/components/MobileNowPlaying.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `MobileNowPlaying` accepts `playbackRate: number`, `onPlaybackRateChange: (rate: number) => void`, `preservePitch: boolean`, `onPreservePitchChange: (on: boolean) => void`.

- [ ] **Step 1: Write the failing component test**

`src/components/MobileNowPlaying.test.tsx` already has a `renderView(overrides = {})`
helper (lines 5-39) that spreads `{...handlers}` then `{...overrides}` into the
component. Extend it first, or every existing test in the file fails to typecheck:

- add `onPlaybackRateChange: vi.fn(),` and `onPreservePitchChange: vi.fn(),` to its
  `handlers` object;
- add `playbackRate={1}` and `preservePitch` to the JSX defaults, beside `eqPreset="Off"`.

Then append:

```tsx
describe('MobileNowPlaying — playback speed', () => {
  it('offers the speed options in the audio settings popover', async () => {
    renderView({ playbackRate: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));

    expect(await screen.findByRole('menuitem', { name: '1.5x' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '0.5x' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '2x' })).toBeInTheDocument();
  });

  it('reports the chosen speed', () => {
    const onPlaybackRateChange = vi.fn();
    renderView({ playbackRate: 1, onPlaybackRateChange });
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '1.5x' }));

    expect(onPlaybackRateChange).toHaveBeenCalledWith(1.5);
  });

  it('toggles pitch preservation', () => {
    const onPreservePitchChange = vi.fn();
    renderView({ playbackRate: 1.5, preservePitch: true, onPreservePitchChange });
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Preserve pitch' }));

    expect(onPreservePitchChange).toHaveBeenCalledWith(false);
  });

  it('marks the audio-settings trigger as modified when only the speed is off-normal', () => {
    // The indicator already covers EQ and crossfade. A speed of 2x with both
    // of those at default is still modified audio — without this the button
    // says "nothing changed" while every track plays at double speed.
    renderView({ playbackRate: 2, eqPreset: 'Off', crossfade: 0 });

    expect(screen.getByRole('button', { name: 'Audio settings' })).toHaveClass('text-amber');
  });

  it('leaves the trigger unmarked at normal speed with everything else default', () => {
    renderView({ playbackRate: 1, eqPreset: 'Off', crossfade: 0 });

    expect(screen.getByRole('button', { name: 'Audio settings' })).not.toHaveClass('text-amber');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/MobileNowPlaying.test.tsx -t "playback speed"`
Expected: FAIL — `Unable to find role="menuitem" and name "1.5x"`.

- [ ] **Step 3: Implement the component changes**

In `src/components/MobileNowPlaying.tsx`:

Add the import:

```ts
import { RATE_OPTIONS, formatRate } from '../lib/playback-rate';
```

Add to the props interface, beside `eqPreset` (line 44):

```ts
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  preservePitch: boolean;
  onPreservePitchChange: (on: boolean) => void;
```

Add the same four names to the destructured params beside `eqPreset` (line 99).

Insert this block inside the popover, immediately **after** the crossfade `{CROSSFADE_OPTIONS.map(...)}` block and before the closing `</div>` of `role="menu"`:

```tsx
                <p className="mt-1 border-t border-white/10 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Speed
                </p>
                {RATE_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    role="menuitem"
                    onClick={() => {
                      onPlaybackRateChange(rate);
                      setAudioOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      rate === playbackRate
                        ? 'bg-gradient-to-r from-amber/30 to-coral/30 text-cream'
                        : 'text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {formatRate(rate)}
                  </button>
                ))}
                <button
                  role="menuitemcheckbox"
                  aria-checked={preservePitch}
                  onClick={() => onPreservePitchChange(!preservePitch)}
                  className="mt-1 flex w-full items-center justify-between border-t border-white/10 px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
                >
                  <span>Preserve pitch</span>
                  <span className={preservePitch ? 'text-amber' : 'text-faint'}>
                    {preservePitch ? 'On' : 'Off'}
                  </span>
                </button>
```

This one does **not** close the popover on click — it is a toggle you may want to flip back and forth while listening, unlike the single-choice lists above it.

Update the trigger's modified-indicator condition (line 385):

```tsx
                eqPreset !== 'Off' || crossfade > 0 || playbackRate !== 1
                  ? 'text-amber'
                  : 'text-white/70'
```

- [ ] **Step 4: Run the component test**

Run: `pnpm exec vitest run src/components/MobileNowPlaying.test.tsx`
Expected: PASS — the new block plus every pre-existing test in the file (the helper edits in Step 1 are what keep the existing ones compiling).

- [ ] **Step 5: Wire App.tsx**

Add the import:

```ts
import { clampRate } from './lib/playback-rate';
```

Add state beside the existing `crossfade` state:

```ts
  const [playbackRate, setPlaybackRate] = useState(1);
  const [preservePitch, setPreservePitch] = useState(true);
```

Load in the mount block, beside `storedCrossfade` (`:343`):

```ts
        const storedRate = await storage.getPlaybackRate();
        const storedPreservePitch = await storage.getPreservePitch();
```

and set them beside `setCrossfade(storedCrossfade)`:

```ts
        setPlaybackRate(storedRate);
        setPreservePitch(storedPreservePitch);
```

Add two save effects after the crossfade one (`:525-530`):

```ts
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage
      .savePlaybackRate(playbackRate)
      .catch((err) => console.error('Playback rate save failed:', err));
  }, [playbackRate]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage
      .savePreservePitch(preservePitch)
      .catch((err) => console.error('Pitch preference save failed:', err));
  }, [preservePitch]);
```

Pass to the engine (`:308-313`), after `crossfadeSeconds: crossfade,`:

```ts
    playbackRate,
    preservePitch,
```

Pass the rate to the stats recorder (`:322`). Reading `playbackRate` state directly is safe here: `useAudioEngine`'s ref-refresh effect (`:107-113`) has **no dependency array**, so `onTrackFinishedRef.current` is replaced on every render and the closure is never stale.

```ts
      setStats((prev) => recordFinish(prev, song, Date.now(), playbackRate));
```

Pass to `useMediaSession` (`:2010`), inside the argument object:

```ts
    playbackRate,
```

Pass to `MobileNowPlaying` wherever it is rendered, beside the existing `eqPreset`/`crossfade` props:

```tsx
        playbackRate={playbackRate}
        onPlaybackRateChange={(r) => setPlaybackRate(clampRate(r))}
        preservePitch={preservePitch}
        onPreservePitchChange={setPreservePitch}
```

- [ ] **Step 6: Write the App-level persistence test**

Append to `src/App.test.tsx`:

```tsx
  it('persists a playback speed change', async () => {
    await renderApp();

    // The storage mock is in-memory; the assertion is that App called it at
    // all, which is what the prefsLoadedRef gate exists to make conditional.
    await waitFor(() => expect(storage.getPlaybackRate).toHaveBeenCalled());
  });
```

Add `getPlaybackRate`, `savePlaybackRate`, `getPreservePitch` and `savePreservePitch` to the `./lib/storage` mock factory in that file — **the factory must export every name App imports, or every App test fails**, which is the documented trap in CLAUDE.md's Testing section.

- [ ] **Step 7: Run the full suite and build**

Run: `pnpm test:run && pnpm build`
Expected: all green, build clean.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/MobileNowPlaying.tsx src/components/MobileNowPlaying.test.tsx
git commit -m "feat: playback speed control with pitch toggle in audio settings"
```

---

### Task 8: Browser verification and docs

**Files:**
- Modify: `CLAUDE.md` (new section), `ROADMAP.md` (new shipped section), `README.md` (feature line)

**Interfaces:** none.

- [ ] **Step 1: Verify in a real browser**

happy-dom does not play audio, so nothing above proves the rate is audible or that the crossfade math holds against a real clock. Follow the recipe in `CLAUDE.md` → "Visual verification":

```bash
mkdir -p dist/fixtures
for i in 1 2; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 12 \
    -metadata title="Fixture Track $i" -metadata artist="Test Artist" \
    -c:a libmp3lame -q:a 9 dist/fixtures/track$i.mp3 2>/dev/null
done
pnpm build && pnpm preview   # run in the background
playwright-cli open --browser=chromium http://localhost:4173/
```

Ingest via a `DataTransfer` in `eval` (not the upload tool), then confirm:

1. Both elements carry the rate: `[...document.querySelectorAll('audio')].map(a => [a.playbackRate, a.preservesPitch])` — expect the same pair twice, not one changed and one at 1.
2. The audio-settings trigger is amber at 2× with EQ Off and crossfade 0.
3. `navigator.mediaSession` position state reflects the rate (read it back via `eval`).

**Scope every DOM query to the overlay**, not the document — `MobileNowPlaying` is `fixed inset-0 z-[60]` and the song list behind it is still in the DOM. Query
`document.querySelector('[role=dialog][aria-label="Now playing"]')` first.

Clean up: `playwright-cli close`, kill the preview **by PID** found with `ss -lptn 'sport = :4173'` (`pkill -f "vite preview"` matches its own wrapper shell and returns 144), then `rm -rf dist/fixtures .playwright-cli`.

- [ ] **Step 2: Write the CLAUDE.md section**

Add a `## Playback speed` section after `## Listening stats`. It must state:
- the rate is applied to **both** elements and why (inactive is the preload target);
- that `remaining` is media seconds while the fade curve is wall-clock, and which three guards are therefore scaled by the rate — and that the curve duration itself is **not** scaled;
- that `msPlayed` divides by the rate, so "listening time" means time spent;
- that `clampRate` exists because `playbackRate = 0` is silently accepted as a pause and negatives throw `NotSupportedError`, with the browser and date of that measurement;
- that `preservesPitch` is unprefixed and defaults `true`.

- [ ] **Step 3: Verify your own prose against the code**

Re-read every sentence you just wrote in `CLAUDE.md`, `ROADMAP.md` and `README.md` **against the source it describes**, out of diff context, asking "is this English sentence true?" — not "does the code match the brief?". On the previous two features this pass found a live product defect and a false claim that eight code-focused review passes had cleared.

**Every number must be pasted from a command's output in this session or re-derived now** — test counts, rate bounds, line numbers. Do not write a figure from memory, including one you measured yourself an hour earlier.

- [ ] **Step 4: Update ROADMAP.md and README.md**

Add a `## Playback speed + pitch (shipped, YYYY-MM-DD)` section to `ROADMAP.md` recording the crossfade-scaling decision and the stats semantics change. Note its provenance: mined from Harmonoid and Museeks, which both ship speed control independently. Add one feature line to `README.md`.

- [ ] **Step 5: Final verification and commit**

```bash
pnpm test:run && pnpm build
git add CLAUDE.md ROADMAP.md README.md
git commit -m "docs: record the playback speed feature and its timing rules"
```

---

## Self-Review

**1. Decision coverage.** Pitch toggle → Tasks 3, 7. Popover placement → Task 7. Persist-never-reset → Task 2 (storage), Task 7 (load/save, no per-track reset anywhere). Range 0.5–2 → Task 1. Stats divided by rate → Task 5. No decision is unimplemented.

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N". Two places delegate to a file's existing style rather than inventing one (`storage.test.ts` import style, `MobileNowPlaying.test.tsx` render helper); both name the file to read and why, which is a real instruction, not a placeholder. Task 6 conditionally skips a test file — that is an explicit decision with a stated reason, not an omission.

**3. Type consistency.** `clampRate`/`DEFAULT_RATE`/`RATE_OPTIONS`/`formatRate` are defined in Task 1 and used with those exact names in Tasks 2, 3, 4, 7. `playbackRateRef` is created in Task 3 and consumed in Task 4. `recordFinish`'s fourth parameter is optional in Task 5 and passed positionally in Task 7. The `MobileNowPlaying` prop names in Task 7's implementation match its test.

**4. Second audit pass (requested), axes: probe-the-test-environment and check-the-arithmetic.** Four defects found and fixed inline:
- **Two vacuous tests.** happy-dom's audio element already defaults `playbackRate` to 1 and `preservesPitch` to true, so Task 3's "clamps a rate of 0" and "defaults to normal speed" both asserted values the environment supplies for free — they would have passed with the whole effect deleted. The clamp test is now a transition from 1.5; the default test is gone, and the constraint is recorded in Global Constraints so no later task reintroduces the shape.
- **An arithmetically wrong test.** Task 4's short-track case used a 30s track against a scaled guard of `duration > 24`. 30 > 24, so the guard passes and the fade fires — the test asserted the opposite and would have failed, sending an implementer hunting a bug in correct code. The duration must sit between the unscaled guard (12) and the scaled one (24); it is now 20.
- **A missing control.** The preload test had no 1× counterpart, so it would have passed if the preload fired unconditionally. Added.

**5. Line-number claims re-verified against source** (2026-09-07): `storage.ts:183-185` `saveVolume`, `App.tsx:2010` `useMediaSession({`, `MobileNowPlaying.tsx:385` the indicator ternary, `useAudioEngine.ts:506-509` the volume effect. All correct.

**6. Known gaps, stated rather than fixed.** Changing speed *during* an in-flight crossfade leaves the already-scheduled curve running on the old timing; the outgoing element may reach its natural end a moment early. The existing `fadingOutRef` and `!== activeAudio()` guards swallow it, so the failure mode is a slightly clipped tail on one transition. Not worth engineering around — the same call the codebase already makes for re-scanning during the last 5 seconds of a track.
