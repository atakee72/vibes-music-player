# Screen Wake Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the display from sleeping while the full-screen now-playing view is open and a track is playing, so the view works as an ambient display.

**Architecture:** One new hook, `useWakeLock(active: boolean)`, owns the entire Screen Wake Lock lifecycle — acquire, release, and the mandatory re-acquire after the browser auto-releases on tab hide. `App.tsx` calls it with a single derived boolean, `mobilePlayerOpen && isPlaying`. No UI, no storage key, no new props on any component.

**Tech Stack:** React 18 (StrictMode on), TypeScript 5.9 strict, Vitest 3 + happy-dom + React Testing Library.

**Spec:** None — this is a bounded feature, so no separate spec file was written. The **Approved decisions** section below is the binding authority: when the plan and a task disagree, that section wins.

## Approved decisions (2026-09-09, from the user)

1. **Trigger: full-screen view open AND playing.** Not "whenever playing". Audio keeps playing with the screen off, so a wake lock is not needed for playback — it exists for the ambient-display case (orb, `OrbVisualizerRing`, scrolling synced lyrics). Closing the view or pausing releases the lock.
2. **Automatic, no UI.** No toggle, no persisted preference, no popover row, no storage key. Opening the view is itself the intent signal.

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. Tests: `pnpm test:run`. Typecheck+build: `pnpm build`.
- **Test files are co-located** (`useWakeLock.test.ts` next to `useWakeLock.ts`).
- **No new dependencies.** The Wake Lock API is a browser global.
- **No `src/vite-env.d.ts` change.** Verified: TypeScript 5.9.3's `lib.dom.d.ts` already declares `interface WakeLock { request(type?: WakeLockType): Promise<WakeLockSentinel> }` and `Navigator.wakeLock`. The FS Access / Document PiP declarations in that file are the precedent for *missing* types; these are not missing. Adding them would be a duplicate-declaration error.
- **`navigator.wakeLock` must still be feature-detected at runtime.** `lib.dom` types it as always present, which is untrue outside a secure context and in older Firefox / iOS Safari. Verified: `if (!navigator.wakeLock) return;` typechecks clean under `strict` (tsc exit 0) — TypeScript does not flag it as an always-truthy condition.
- **Never use `window.prompt`/`alert`/`confirm`** (project rule — they block the audio engine). Not reachable in this feature, but the rule stands.
- **Commit messages: simple and concise. NO "Generated with Claude Code" line, NO "Co-Authored-By" footer.**

---

## Verified environment facts

Every fact below was measured in this repo on 2026-09-09, not assumed. Do not re-derive them; do not design around a contradicting guess.

| Fact | Measured value |
|---|---|
| `'wakeLock' in navigator` under happy-dom | `false` — the API is absent, so tests must install a fake, and the "unsupported browser" path is directly testable |
| `Object.defineProperty(navigator, 'wakeLock', …)` | Works, `configurable: true` |
| `Object.defineProperty(document, 'visibilityState', …)` | Works — visibility transitions are testable |
| `document.visibilityState` default | `'visible'` |
| TypeScript version | 5.9.3, and `lib.dom.d.ts` already has `WakeLock` + `WakeLockSentinel` |
| React StrictMode | **On** (`src/main.tsx:19`) — every effect mounts, tears down, and mounts again in dev |
| Baseline test count before this work | **583** passing across 48 files, `main` @ `a521c21` |

**Browser API facts** (from MDN, Screen Wake Lock API):

- `navigator.wakeLock.request('screen')` returns `Promise<WakeLockSentinel>`.
- **"Only active documents can acquire screen wake locks and previously acquired locks are automatically released when document becomes inactive."** So a `visibilitychange` listener that re-acquires is *mandatory*, not a refinement. MDN's own example does exactly this.
- A request "may be rejected for a number of reasons, including system settings (such as power save mode or low battery level) or if the document is not active or visible." MDN does not name the error, so **do not match on an error name** — catch everything.
- Secure context only. Baseline "newly available" since March 2025. MDN's page does not publish per-browser version numbers, so **this plan states none** — feature detection is the contract.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/hooks/useWakeLock.ts` | **new** — the entire wake-lock lifecycle. The only file in the project that touches `navigator.wakeLock`. |
| `src/hooks/useWakeLock.test.ts` | **new** — 10 unit tests, each pinned to a specific guard in the hook. |
| `src/App.tsx` | one import + one call. No other change. |
| `src/App.test.tsx` | 3 tests pinning the `mobilePlayerOpen && isPlaying` predicate — the one thing hook-level tests cannot see. |
| `CLAUDE.md`, `README.md`, `ROADMAP.md` | docs. |

**Why the hook is unit-tested when `useMediaSession` and `useInstallPrompt` are not.** Those two carry a comment calling them "thin browser-API wrapper, untested by convention". That convention exists because their APIs cannot be observed under happy-dom, not because hooks are exempt. `navigator.wakeLock` is absent from happy-dom *and* trivially fakeable, and this hook holds real state (a sentinel) across an async boundary with a StrictMode race in it. It gets tests. A reviewer noticing the inconsistency should read this paragraph, not file it as a finding.

---

### Task 1: The `useWakeLock` hook

**Files:**
- Create: `src/hooks/useWakeLock.ts`
- Test: `src/hooks/useWakeLock.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function useWakeLock(active: boolean): void` — a hook taking one boolean and returning nothing. Task 2 calls it.

**The five guards this hook exists for.** Each has exactly one test that goes red when the guard is deleted; this was verified by mutation, not asserted. Do not "simplify" any of them away:

1. **`if (cancelled)` after the await** — StrictMode tears the effect down while the request is still in flight. Without this, the arriving sentinel is stored in a ref nobody will ever clean up: the lock leaks and the screen never sleeps again.
2. **The `visibilitychange` listener** — the browser auto-releases on hide; without re-acquiring, the lock is gone forever after the first tab switch.
3. **`finally { acquiring = false }`** — without it, one refused request latches the hook off permanently.
4. **`if (held && !held.released) return`** — without it, a spurious `visibilitychange` stacks a second sentinel and leaks the first.
5. **The cleanup's `release()`** — without it, closing the view leaves the screen locked awake.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useWakeLock.test.ts` with exactly this content:

```ts
import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

/** A controllable stand-in for a real WakeLockSentinel. */
function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  };
  return sentinel;
}

type Sentinel = ReturnType<typeof makeSentinel>;

/** Installs a fake `navigator.wakeLock`. happy-dom ships none. */
function installWakeLock(request: (type?: string) => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
}

function installGrantingWakeLock() {
  const sentinels: Sentinel[] = [];
  const request = vi.fn(async () => {
    const s = makeSentinel();
    sentinels.push(s);
    return s;
  });
  installWakeLock(request);
  return { request, sentinels };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

const fireVisibilityChange = () => document.dispatchEvent(new Event('visibilitychange'));

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('useWakeLock', () => {
  it('does nothing when the browser has no Wake Lock API', () => {
    expect('wakeLock' in navigator).toBe(false);
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it('requests a screen lock while active', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('does not request while inactive', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(false));
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not request while the document is hidden', async () => {
    const { request } = installGrantingWakeLock();
    setVisibility('hidden');
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('releases the lock when it stops being active', async () => {
    const { sentinels } = installGrantingWakeLock();
    const { rerender } = renderHook(({ a }: { a: boolean }) => useWakeLock(a), {
      initialProps: { a: true },
    });
    await act(async () => {});
    expect(sentinels).toHaveLength(1);

    await act(async () => {
      rerender({ a: false });
    });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('releases the lock on unmount', async () => {
    const { sentinels } = installGrantingWakeLock();
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(sentinels).toHaveLength(1);

    await act(async () => {
      unmount();
    });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('re-acquires when the document becomes visible again', async () => {
    const { request, sentinels } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    // The browser auto-releases the lock when the document is hidden.
    sentinels[0].released = true;
    setVisibility('hidden');
    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not stack a second lock while one is still held', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('recovers from a refused request', async () => {
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('NotAllowedError');
      return makeSentinel();
    });
    installWakeLock(request);

    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a sentinel that arrives after the effect was torn down', async () => {
    let resolveRequest: (s: Sentinel) => void = () => {};
    const pending = new Promise<Sentinel>((resolve) => {
      resolveRequest = resolve;
    });
    installWakeLock(vi.fn(() => pending));

    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();

    const late = makeSentinel();
    await act(async () => {
      resolveRequest(late);
      await pending;
      await Promise.resolve();
    });

    expect(late.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/hooks/useWakeLock.test.ts`

Expected — verified verbatim, the whole suite fails to collect:

```
Error: Failed to resolve import "./useWakeLock" from "src/hooks/useWakeLock.test.ts". Does the file exist?
Test Files  1 failed (1)
```

That is the correct failure: it proves the tests are running against nothing.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useWakeLock.ts` with exactly this content:

```ts
import { useEffect, useRef } from 'react';

/**
 * Holds a Screen Wake Lock (keeps the display from sleeping) while `active`,
 * and releases it the moment it isn't.
 *
 * Audio keeps playing with the screen off, so this is NOT about playback —
 * it exists for the full-screen now-playing view used as an ambient display
 * (orb, visualizer ring, scrolling synced lyrics).
 *
 * Three browser facts shape this hook:
 * - The lock can only be held by a VISIBLE document, and the browser
 *   auto-releases it whenever the document becomes hidden. Re-acquiring on
 *   `visibilitychange` is mandatory, not a nicety.
 * - `request()` rejects for reasons outside our control (power saving, low
 *   battery, a document that stopped being visible mid-request). A refusal
 *   is not an error worth surfacing — the screen just behaves normally.
 * - `lib.dom` types `navigator.wakeLock` as always present, which is untrue
 *   off a secure context and in older Firefox/iOS Safari, so it is
 *   feature-detected anyway.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return;

    let cancelled = false;
    let acquiring = false;

    const acquire = async () => {
      if (cancelled || acquiring) return;
      if (document.visibilityState !== 'visible') return;
      const held = sentinelRef.current;
      if (held && !held.released) return;
      acquiring = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // Torn down while the request was in flight — React 18 StrictMode
          // does exactly this on every mount in dev. Nothing else holds a
          // reference to this sentinel, so dropping it leaks the lock and
          // the screen never sleeps again.
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Refused. Leave the screen alone.
      } finally {
        acquiring = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/hooks/useWakeLock.test.ts`
Expected: `Tests  10 passed (10)`

- [ ] **Step 5: Prove the tests are load-bearing**

Green tests prove nothing until you have watched them go red for the right reason. Delete one guard at a time, run the suite, confirm the named test fails, then restore the guard before moving to the next. Restore the file exactly — verify with `git diff` that only your intended edit is present each time.

| Delete | Test that must fail |
|---|---|
| the `if (cancelled) { … }` block | `releases a sentinel that arrives after the effect was torn down` |
| the `document.addEventListener('visibilitychange', …)` line | `re-acquires when the document becomes visible again` |
| the `finally { acquiring = false; }` clause | `recovers from a refused request` |
| the `if (held && !held.released) return;` line | `does not stack a second lock while one is still held` |
| the cleanup's `void sentinel?.release()…` line | `releases the lock on unmount` |

If any deletion leaves all 10 tests green, the corresponding test is vacuous — **report that rather than continuing**; it means the plan's test is wrong.

- [ ] **Step 6: Typecheck**

Run: `pnpm build`
Expected: `tsc` passes and Vite builds. If `tsc` complains about `navigator.wakeLock` being undeclared, stop — do not add declarations to `src/vite-env.d.ts`; report it, because the plan verified those types are already present in TypeScript 5.9.3.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useWakeLock.ts src/hooks/useWakeLock.test.ts
git commit -m "feat: add useWakeLock hook"
```

---

### Task 2: Wire it into App

**Files:**
- Modify: `src/App.tsx` (one import beside the other hook imports; one call immediately above the existing `useMediaSession({` call)
- Test: `src/App.test.tsx` (append a new `describe` at the end of the file)

**Interfaces:**
- Consumes: `useWakeLock(active: boolean): void` from `src/hooks/useWakeLock.ts` (Task 1).
- Produces: nothing for later tasks.

The predicate is `mobilePlayerOpen && isPlaying`. Both operands already exist in `App.tsx`: `mobilePlayerOpen` is `useState` (declared around line 128) and `isPlaying` is destructured from `useAudioEngine` (around line 305). Do **not** use `mobilePlayerOpenRef` — that ref exists for `togglePanel`, a stable `useCallback([])` that must not gain dependencies. This is a render-time boolean, so the state value is correct and the ref would not re-render the hook.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the very end of `src/App.test.tsx`. It relies on three helpers already defined in that file: `renderApp`, `playRow`, `libraryWith`, plus the hoisted `engine` fake whose `isPlaying` field is settable (`src/App.test.tsx:27`).

```tsx
describe('screen wake lock', () => {
  const requestWakeLock = vi.fn(async () => ({
    released: false,
    release: vi.fn(async () => {}),
  }));

  beforeEach(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestWakeLock },
      configurable: true,
    });
  });

  afterEach(() => {
    // happy-dom ships no `navigator.wakeLock`; restore that absence so every
    // other test in this file keeps exercising the unsupported-browser path.
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  const openNowPlaying = async (title: string) => {
    await screen.findByText(title);
    playRow(0);
    fireEvent.click(screen.getAllByLabelText('Open now playing')[0]);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Now playing' })).not.toHaveClass('opacity-0'),
    );
  };

  it('holds the screen awake while the now-playing view is open and playing', async () => {
    engine.isPlaying = true;
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });
    expect(requestWakeLock).not.toHaveBeenCalled();

    await openNowPlaying('Cemalım');

    await waitFor(() => expect(requestWakeLock).toHaveBeenCalledWith('screen'));
  });

  it('does not hold the screen awake when the view is open but paused', async () => {
    engine.isPlaying = false;
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });

    await openNowPlaying('Cemalım');

    expect(requestWakeLock).not.toHaveBeenCalled();
  });

  it('releases the lock when the now-playing view closes', async () => {
    engine.isPlaying = true;
    await renderApp({ playlists: [libraryWith(makeSong({ title: 'Cemalım' }))] });
    await openNowPlaying('Cemalım');
    await waitFor(() => expect(requestWakeLock).toHaveBeenCalled());
    const sentinel = await requestWakeLock.mock.results[0].value;

    fireEvent.keyDown(document, { code: 'Escape' });

    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });
});
```

Three notes on why this block looks the way it does:

- `openNowPlaying` is copied from the identically-named helper inside the existing `describe('lyrics sheet inside the now-playing view')`. It is duplicated on purpose: it is local to that describe and moving it to module scope would touch a passing test block for no benefit. `playRow(0)` starts playback because a bare row click outside selection mode is a no-op in `SongList`, and `getAllByLabelText(...)[0]` is used because "Open now playing" is not unique — both the pull-up handle and the cover/title row carry it.
- `Escape` closes the view because `mobilePlayerOpen` is the **first** branch of App's Escape chain.
- The `afterEach` deleting `navigator.wakeLock` is not tidiness — leaving a fake installed would silently change what every other test in the 596-test suite exercises.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/App.test.tsx -t "wake lock"`
Expected: all 3 fail. The first two fail on the `expect(requestWakeLock)` assertions (nothing calls the API yet); the third fails at `requestWakeLock.mock.results[0]` being `undefined`.

- [ ] **Step 3: Add the import**

In `src/App.tsx`, directly below the existing line `import { useInstallPrompt } from './hooks/useInstallPrompt';`, add:

```ts
import { useWakeLock } from './hooks/useWakeLock';
```

- [ ] **Step 4: Add the call**

In `src/App.tsx`, immediately above the existing `useMediaSession({` call, insert:

```tsx
  // Keep the display awake only while the full-screen view is open AND a
  // track is playing: that view is the ambient-display surface (orb,
  // visualizer ring, scrolling lyrics). Audio alone needs no wake lock.
  useWakeLock(mobilePlayerOpen && isPlaying);

```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm vitest run src/App.test.tsx -t "wake lock"`
Expected: `Tests  3 passed | 64 skipped (67)`

- [ ] **Step 6: Prove both halves of the predicate are pinned**

Change the call to `useWakeLock(isPlaying)`, run `pnpm vitest run src/App.test.tsx -t "wake lock"`, and confirm **2 tests fail** (`holds the screen awake…` and `releases the lock…`). Restore it.

Then change it to `useWakeLock(mobilePlayerOpen)`, run again, and confirm **1 test fails** (`does not hold the screen awake when the view is open but paused`). Restore it.

If either mutation leaves the suite green, report it — the wiring is not actually pinned.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `pnpm test:run && pnpm build`
Expected: **596 tests passing across 48 files** (583 before this work + 10 from Task 1 + 3 from this task), and a clean `tsc`. A different total means something else changed — investigate before committing.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: keep the screen awake in the now-playing view while playing"
```

---

### Task 3: Documentation

**Files:**
- Modify: `CLAUDE.md` (new section), `README.md` (feature line), `ROADMAP.md` (new shipped section)

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1-2.
- Produces: nothing.

- [ ] **Step 1: Add a CLAUDE.md section**

Insert a new `## Screen wake lock` section immediately **after** the `## Playback speed` section and before `## Format/quality badge`:

```markdown
## Screen wake lock

- **`useWakeLock(active)` (`src/hooks/useWakeLock.ts`) is the only file that
  touches `navigator.wakeLock`.** App calls it as
  `useWakeLock(mobilePlayerOpen && isPlaying)` — nothing else.
- **The lock is deliberately NOT tied to playback alone.** Audio keeps
  playing with the screen off, so playback needs no wake lock; the feature
  exists for the full-screen now-playing view used as an ambient display
  (orb, `OrbVisualizerRing`, scrolling synced lyrics). Holding it for any
  playing track would keep a desk-idle browser lit for no reason. There is
  no toggle and no persisted preference: opening the view IS the intent.
- **The browser auto-releases the lock whenever the document becomes
  hidden**, so the hook re-acquires on `visibilitychange`. That listener is
  not a refinement — without it the lock is gone permanently after the first
  tab switch.
- **Four more guards, each with a test that goes red without it** (verified
  by deletion, not assumed): a `cancelled` flag checked AFTER the await
  (React 18 StrictMode tears the effect down mid-request, and a sentinel
  that arrives orphaned is a lock nothing can ever release); `acquiring`
  reset in a `finally` (else one refused request latches the hook off
  forever); an already-held check (else a spurious `visibilitychange`
  stacks a second sentinel and leaks the first); and the cleanup's
  `release()`.
- **A refused request is not an error.** `request()` rejects for power
  saving, low battery, or a document that stopped being visible mid-flight,
  and MDN does not name the error — so the hook catches everything and
  surfaces nothing. The screen simply behaves normally.
- **No `src/vite-env.d.ts` entry.** Unlike FS Access and Document PiP,
  `WakeLock`/`WakeLockSentinel` are already in TypeScript 5.9's `lib.dom`.
  They are typed as always present, which is a lie off a secure context and
  in older Firefox/iOS Safari, so the hook feature-detects anyway.
- **Unit-tested, unlike `useMediaSession`/`useInstallPrompt`.** Those two are
  untested because happy-dom cannot observe their APIs. happy-dom ships no
  `navigator.wakeLock` at all and both it and `document.visibilityState` are
  `Object.defineProperty`-able, so this hook's whole lifecycle is testable.
```

- [ ] **Step 2: Add a README feature line**

In `README.md`, find the feature bullet list that already mentions playback speed and add one bullet in the same style:

```markdown
- **Screen stays awake** in the full-screen now-playing view while a track plays — so the visualizer and synced lyrics keep showing.
```

- [ ] **Step 3: Add a ROADMAP shipped section**

Append to `ROADMAP.md`, after the `## Playback speed + pitch (shipped, 2026-09-08)` section, following the same shape as its neighbours (status line, what shipped, decisions, and the commits). Record the two approved decisions verbatim: **trigger is view-open AND playing**, and **automatic with no UI or persisted preference**. Note that it came from the 2026-09-06 feature-mining research rather than the (now exhausted) backlog.

- [ ] **Step 4: Verify nothing else broke**

Run: `pnpm test:run`
Expected: still 596 passing. Docs-only changes must not move that number.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md ROADMAP.md
git commit -m "docs: document the screen wake lock"
```

---

### Task 4: Browser verification

**Files:** none — this task produces a finding, not a diff. If it finds a defect, that defect is fixed here with its own test and commit.

**Interfaces:**
- Consumes: the shipped feature from Tasks 1-3.
- Produces: a verification result recorded in the task report.

**Why this task exists.** The 13 unit tests all run against a fake `navigator.wakeLock` that this plan wrote. They prove the hook calls the API correctly; they cannot prove the real API accepts what we send it. This project has already been bitten by exactly that gap once: `HTMLMediaElement.load()` silently resets `playbackRate`, 581 green tests missed it, and only a real browser caught it (see the "Playback speed" section of `CLAUDE.md`).

**Read `CLAUDE.md`'s "Visual verification" section before starting.** Key facts: `playwright-cli` is installed globally, system Chrome is absent so **always pass `--browser=chromium`**, and per-session output lands in the gitignored `.playwright-cli/`.

- [ ] **Step 1: Build and serve**

```bash
pnpm build && pnpm preview
```

Note the port it prints (4173 by default). To stop it later, get the PID from `ss -lptn 'sport = :4173'` and kill that — **`pkill -f "vite preview"` returns 144 because it matches its own wrapper shell.**

- [ ] **Step 2: Instrument the real API before opening the view**

Headless Chromium may legitimately refuse a screen wake lock — there is no physical display to keep awake. **A refusal is not a failure of this feature**, and the point of instrumenting is to tell the two apart. In the page, wrap the real method before interacting:

```js
window.__wl = { calls: [], grants: 0, errors: [] };
const real = navigator.wakeLock.request.bind(navigator.wakeLock);
navigator.wakeLock.request = async (type) => {
  window.__wl.calls.push(type);
  try {
    const s = await real(type);
    window.__wl.grants++;
    return s;
  } catch (e) {
    window.__wl.errors.push(String(e && e.name));
    throw e;
  }
};
```

- [ ] **Step 3: Exercise the feature and read the result**

Ingest a track, start playback, open the full-screen now-playing view, then read `window.__wl`.

Interpret it as:
- `calls` contains `'screen'` → **our wiring is correct**; this is the assertion that matters.
- `grants > 0` → the browser granted it; also check `document.visibilityState` handling by backgrounding the tab and returning, then confirm `calls.length` grew.
- `errors` non-empty with `calls` non-empty → the browser refused. **Record the error name and move on** — this is a headless-environment limitation, not a bug, and it is exactly what the hook's empty `catch` is designed for. Verify only that nothing was thrown into the console and the UI is unaffected.
- `calls` empty → **a real defect.** The predicate never became true. Diagnose before reporting done.

- [ ] **Step 4: Confirm the release path**

Close the view (Escape) and confirm no console error appears. If step 3 granted a lock, also confirm the sentinel's `released` is `true`.

- [ ] **Step 5: Report**

Write the outcome into the task report: whether the request was made, whether it was granted or refused (with the error name), and whether the visibility round-trip re-acquired. Stop the preview server by PID.

No commit unless a defect was found and fixed.

---

## Verification (whole feature)

- `pnpm test:run && pnpm build` — **596 tests across 48 files**, clean `tsc`.
- Task 1 Step 5 and Task 2 Step 6 are the real gates: every new test must have been watched failing for the right reason.
- Task 4 is the browser gate.
- **What none of this covers:** whether the screen actually stays lit on a real phone. That needs the user's hardware — the same category as the audio checks (crossfade quality, ReplayGain levels) that `CLAUDE.md` already flags as human-only.

## Out of scope

- Any toggle, setting, or persisted preference (decision 2).
- Holding the lock for playback outside the full-screen view (decision 1).
- A visible indicator of lock state — considered and declined; it would make an invisible feature legible at the cost of chrome in a view built to be uncluttered.
- The `'system'` wake lock type. It is not implemented by browsers, and Vibes has no use for it.
