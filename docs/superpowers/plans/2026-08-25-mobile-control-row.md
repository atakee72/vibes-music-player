# Mobile Control Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every transport surface the same shuffle-left / repeat-right order, and spread `MobileNowPlaying`'s utility row edge to edge.

**Architecture:** Two presentational components change, no state, no props, no callbacks. `PlayerBar` currently renders shuffle and repeat TWICE — one `hidden lg:block` pair on the left of transport, one `lg:hidden` pair on the right — purely because the two breakpoints wanted them on opposite sides. Once both adopt one convention that duplication has no reason to exist, so the four buttons collapse to two.

**Tech Stack:** React 18 + TypeScript, Tailwind (design tokens in `tailwind.config.js`), Vitest 3 + happy-dom + React Testing Library, pnpm.

**Spec:** `ROADMAP.md` — "Backlog — noted 2026-08-15", item 8. **The spec is partly stale; see "Spec correction" below. Trust this plan over the ROADMAP text.**

## Global Constraints

- Package manager is **pnpm**. Never npm/yarn.
- **Edit with the Edit tool, never `sed`.** A prior task in this repo burned two fix rounds on `sed`-mangled indentation.
- Source stays **ASCII outside comments**.
- Colours come from **design tokens** (`text-amber`, `text-white/60`), never raw hex.
- The shuffle button keeps **`aria-pressed={shuffle}`**; the repeat button has none (it is a 3-state cycle, not a toggle).
- Existing `aria-label` strings are **unchanged** by this work: `Shuffle: on`/`Shuffle: off`, `Repeat: none`/`Repeat: all`/`Repeat: one`, `Previous`, `Next`, `Play`/`Pause`. Tests across the suite query by these names.
- Run `pnpm test:run` (full suite) before each commit — not just the file you touched.
- `pnpm build` runs `tsc && vite build`; `pnpm dev` skips typechecking, so build before claiming done.

## Spec correction — read before starting

ROADMAP item 8 lists **three** fixes. Verified against the source on 2026-08-25:

1. Transport order is mirrored vs. other players — **TRUE, this plan fixes it.**
2. Secondary row is a centered `gap-3` huddle — **TRUE** (it is `flex items-center gap-3`, actually left-aligned, not centered), **this plan fixes it.**
3. "The EQ `<select>` pill breaks the rhythm... make it a round trigger + popover" — **ALREADY SHIPPED.** `MobileNowPlaying.tsx:127-141` and `:268-339` are a round `Sliders` trigger opening an `Audio settings` popover that covers EQ presets *and* crossfade. `MobileNowPlaying.test.tsx:75-88` already tests it. **Do not implement this. Do not "restore" a `<select>`.**

The scope decision below was approved by the human partner on 2026-08-25: apply the convention to **all three** transport surfaces and collapse `PlayerBar`'s duplicate pair, accepting that desktop's repeat button moves from left-of-prev to right-of-next.

The target order everywhere:

```
shuffle · prev · play · next · repeat
```

`MiniPlayer` (Document PiP) is NOT affected — it renders only prev/play/next and has no shuffle or repeat button.

**Selector trap, already paid for once in this plan's audit:** `MobileNowPlaying.tsx:159` — the header row holding the close chevron — is ALSO `justify-between`. Any `querySelector('.justify-between')` finds the header, not the utility row. Both the Task 2 test and the browser check anchor on the lyrics button's `parentElement` instead.

---

### Task 1: One transport order across every surface

**Files:**
- Modify: `src/components/PlayerBar.tsx:238-296` (the transport `<div>`)
- Modify: `src/components/MobileNowPlaying.tsx:216-249` (the transport `<div>`)
- Test: `src/components/PlayerBar.test.tsx`
- Test: `src/components/MobileNowPlaying.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first).
- Produces: nothing later tasks depend on. Task 2 touches a different `<div>` in `MobileNowPlaying.tsx` and does not read anything from here.

**Context you need:** `PlayerBar.tsx:130-131` already defines the two colour helpers this task reuses verbatim — do not redefine them:

```tsx
const repeatColor = repeatMode !== 'none' ? 'text-amber' : 'text-white/60';
const shuffleColor = shuffle ? 'text-amber' : 'text-white/60';
```

- [ ] **Step 1: Write the failing order test for PlayerBar**

Add to `src/components/PlayerBar.test.tsx`, inside the existing top-level `describe`. This reads aria-labels in DOM order and filters to the transport five, so it asserts the actual rendered sequence rather than a class name:

```tsx
  it('renders one transport row in shuffle · prev · play · next · repeat order', () => {
    const { container } = renderPlayerBar({ song: makeSong() });
    const order = Array.from(container.querySelectorAll('button'))
      .map((b) => b.getAttribute('aria-label'))
      .filter((l): l is string => !!l && /^(Shuffle|Repeat|Previous|Next|Play|Pause)/.test(l));
    expect(order).toEqual([
      'Shuffle: off',
      'Previous',
      'Play',
      'Next',
      'Repeat: none',
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/PlayerBar.test.tsx -t "shuffle · prev · play · next · repeat"`

Expected: FAIL. The received array has **seven** entries, because both responsive copies of shuffle and repeat are in the DOM:
`['Shuffle: off', 'Repeat: none', 'Previous', 'Play', 'Next', 'Repeat: none', 'Shuffle: off']`

- [ ] **Step 3: Collapse PlayerBar's duplicate pair and reorder**

In `src/components/PlayerBar.tsx`, replace the whole transport `<div>` (starts at line 238 with `<div className="flex items-center space-x-2 lg:space-x-4">`, ends at the `</div>` on line 296, immediately before `<div className="hidden lg:flex items-center space-x-2 lg:space-x-4 lg:ml-6">`) with:

```tsx
        <div className="flex items-center space-x-2 lg:space-x-4">
          {/* One pair, both breakpoints. There used to be two — a
              `hidden lg:block` pair left of transport and an `lg:hidden` pair
              right of it — because the layouts disagreed about which side
              shuffle and repeat belonged on. They now agree, so a single pair
              serves both and changing one button is one edit again. */}
          <button
            onClick={onToggleShuffle}
            className={`p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${shuffleColor}`}
            title={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-label={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-pressed={shuffle}
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            onClick={onPrev}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Previous"
          >
            <SkipBack className="h-4 w-4 lg:h-5 lg:w-5 text-white/80" fill="currentColor" />
          </button>
          <button
            onClick={onPlayPause}
            className="p-3 lg:p-4 bg-gradient-to-r from-amber to-coral hover:brightness-110 motion-safe:active:scale-95 active:shadow-[0_0_24px_#FF9E5E99] rounded-full transition-all duration-200 shadow-lg"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 lg:h-6 lg:w-6 text-deep" fill="currentColor" />
            ) : (
              <Play className="h-5 w-5 lg:h-6 lg:w-6 text-deep" fill="currentColor" />
            )}
          </button>
          <button
            onClick={onNext}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Next"
          >
            <SkipForward className="h-4 w-4 lg:h-5 lg:w-5 text-white/80" fill="currentColor" />
          </button>
          <button
            onClick={onCycleRepeat}
            className={`p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${repeatColor}`}
            title={`Repeat: ${repeatMode}`}
            aria-label={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-4 w-4" />
          </button>
        </div>
```

Tab order is unaffected: the retired copies were `display:none` at their breakpoint, so only one pair was ever focusable or in the a11y tree. DOM order still matches visual order after the move, which is what matters for keyboard users.

Note what is deliberately preserved: the play button keeps `text-deep` glyphs on the amber→coral fill (white fails AA on amber) and its `motion-safe:active:scale-95`; prev/next keep their `lg:` size bump. The surviving buttons carry `title` (the old mobile copies had none — a tooltip that never appears on touch is harmless).

- [ ] **Step 4: Run the PlayerBar order test**

Run: `npx vitest run src/components/PlayerBar.test.tsx -t "shuffle · prev · play · next · repeat"`
Expected: PASS

- [ ] **Step 5: Fix the four tests that asserted the duplication**

Those tests encoded "two copies render" as a fact. It is no longer a fact. In `src/components/PlayerBar.test.tsx`:

At line ~99-101, change:

```tsx
    const { rerender, onCycleRepeat } = renderPlayerBar({ song, repeatMode: 'all' });
    // "all" — both desktop and mobile repeat buttons render
    expect(screen.getAllByRole('button', { name: 'Repeat: all' })).toHaveLength(2);
```

to:

```tsx
    const { rerender, onCycleRepeat } = renderPlayerBar({ song, repeatMode: 'all' });
    // One repeat button now serves both breakpoints.
    expect(screen.getByRole('button', { name: 'Repeat: all' })).toBeInTheDocument();
```

At line ~124, change:

```tsx
    expect(screen.getAllByRole('button', { name: 'Repeat: one' })).toHaveLength(2);
```

to:

```tsx
    expect(screen.getByRole('button', { name: 'Repeat: one' })).toBeInTheDocument();
```

At line ~189-191, change:

```tsx
    const { onToggleShuffle } = renderPlayerBar({ song: makeSong() });
    // Two responsive copies (desktop + mobile) render in happy-dom; click one.
    fireEvent.click(screen.getAllByRole('button', { name: /Shuffle/ })[0]);
```

to:

```tsx
    const { onToggleShuffle } = renderPlayerBar({ song: makeSong() });
    fireEvent.click(screen.getByRole('button', { name: /Shuffle/ }));
```

At line ~197, change:

```tsx
    expect(screen.getAllByRole('button', { name: /Shuffle/ })[0]).toHaveClass('text-amber');
```

to:

```tsx
    expect(screen.getByRole('button', { name: /Shuffle/ })).toHaveClass('text-amber');
```

- [ ] **Step 6: Write the failing order test for MobileNowPlaying**

Add to `src/components/MobileNowPlaying.test.tsx`, inside the existing `describe('MobileNowPlaying')`:

```tsx
  it('renders transport in shuffle · prev · play · next · repeat order', () => {
    const { container } = renderView();
    const order = Array.from(container.querySelectorAll('button'))
      .map((b) => b.getAttribute('aria-label'))
      .filter((l): l is string => !!l && /^(Shuffle|Repeat|Previous|Next|Play|Pause)/.test(l));
    expect(order).toEqual([
      'Shuffle: off',
      'Previous',
      'Play',
      'Next',
      'Repeat: none',
    ]);
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/components/MobileNowPlaying.test.tsx -t "shuffle · prev · play · next · repeat"`

Expected: FAIL — received `['Repeat: none', 'Previous', 'Play', 'Next', 'Shuffle: off']` (repeat first, shuffle last).

- [ ] **Step 8: Swap the two buttons in MobileNowPlaying**

In `src/components/MobileNowPlaying.tsx`, replace the transport `<div>` — it starts at line 216 with `<div className="flex items-center justify-center gap-6">` and ends at the `</div>` on line 249 — with:

```tsx
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={onToggleShuffle}
            className={`p-2 transition-colors ${shuffle ? 'text-amber' : 'text-white/60'}`}
            aria-label={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-pressed={shuffle}
          >
            <Shuffle className="h-5 w-5" />
          </button>
          <button onClick={onPrev} className="p-2 text-white/80" aria-label="Previous">
            <SkipBack className="h-6 w-6" fill="currentColor" />
          </button>
          <button
            onClick={onPlayPause}
            className="rounded-full bg-gradient-to-r from-amber to-coral p-4 text-deep shadow-lg hover:brightness-110 motion-safe:active:scale-95 active:shadow-[0_0_24px_#FF9E5E99] transition-all"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-7 w-7" fill="currentColor" />
            ) : (
              <Play className="h-7 w-7" fill="currentColor" />
            )}
          </button>
          <button onClick={onNext} className="p-2 text-white/80" aria-label="Next">
            <SkipForward className="h-6 w-6" fill="currentColor" />
          </button>
          <button
            onClick={onCycleRepeat}
            className={`p-2 transition-colors ${repeatMode !== 'none' ? 'text-amber' : 'text-white/60'}`}
            aria-label={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-5 w-5" />
          </button>
        </div>
```

This is a pure move: every className, icon size, `fill`, and label is byte-identical to what was there. Only the sequence changed.

- [ ] **Step 9: Run both order tests**

Run: `npx vitest run src/components/MobileNowPlaying.test.tsx src/components/PlayerBar.test.tsx`
Expected: PASS, all tests in both files.

- [ ] **Step 10: Run the full suite and build**

Run: `pnpm test:run && pnpm build`
Expected: all files pass (476 tests before this task, 478 after — two new order tests), `tsc` clean, `vite build` succeeds.

If any test outside these two files fails, STOP and report: it means another surface queries these buttons in a way this plan did not anticipate.

- [ ] **Step 11: Commit**

```bash
git add src/components/PlayerBar.tsx src/components/PlayerBar.test.tsx src/components/MobileNowPlaying.tsx src/components/MobileNowPlaying.test.tsx
git commit -m "refactor: one transport order everywhere, shuffle left and repeat right"
```

---

### Task 2: Spread the utility row edge to edge

**Files:**
- Modify: `src/components/MobileNowPlaying.tsx:251` (the utility row `<div>`)
- Modify: `ROADMAP.md` (backlog item 8 → shipped)
- Modify: `CLAUDE.md` (transport-order invariant)
- Test: `src/components/MobileNowPlaying.test.tsx`

**Interfaces:**
- Consumes: nothing. Task 1 changed a sibling `<div>`; this one is independent.
- Produces: nothing.

**Context you need:** the row holds six children in the real app — lyrics, queue, audio settings, sleep timer, volume, share. The sleep timer is conditional (`{onSetSleepTimer && ...}`), so a caller that omits that prop gets five. `App.tsx` always passes it. `justify-between` handles both counts without a code branch.

- [ ] **Step 1: Write the failing test**

Add to `src/components/MobileNowPlaying.test.tsx`:

```tsx
  it('spreads the utility row edge to edge rather than huddling it', () => {
    const { container } = renderView();
    // The row is identified by its first child, the lyrics button — happy-dom
    // has no layout, so the class IS the assertion here. Real edge-to-edge
    // spacing is confirmed in a browser (see the plan's Verification section).
    const row = screen.getByRole('button', { name: 'Toggle lyrics' }).parentElement;
    expect(row).toHaveClass('justify-between');
    // NOT `container.querySelector('.justify-between')` — the header row at
    // :159 already carries that class and would match first.
    expect(row).toHaveClass('flex', 'items-center');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/MobileNowPlaying.test.tsx -t "edge to edge"`
Expected: FAIL — `expect(element).toHaveClass("justify-between")` against the received class list `"flex items-center gap-3"`.

- [ ] **Step 3: Change the row's layout**

In `src/components/MobileNowPlaying.tsx` line 251, change:

```tsx
        <div className="flex items-center gap-3">
```

to:

```tsx
        {/* Edge to edge, not a huddle: `gap-2` is a floor for the narrowest
            phones (where six buttons can exceed the row), `justify-between`
            does the spreading everywhere else. */}
        <div className="flex items-center justify-between gap-2">
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/MobileNowPlaying.test.tsx -t "edge to edge"`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run: `pnpm test:run && pnpm build`
Expected: 479 tests pass, build clean.

- [ ] **Step 6: Update ROADMAP.md**

In `ROADMAP.md`, replace the whole of backlog item 8 — **lines 718-729**, beginning `8. **Mobile control-row layout** — three small fixes, all inside` and ending `     the same reason (the inline slider was unusable there).` — with:

```markdown
8. ~~**Mobile control-row layout**~~ — shipped 2026-08-25. Transport is now
   `shuffle · prev · play · next · repeat` on **every** surface, and
   `PlayerBar`'s duplicate responsive shuffle/repeat pair collapsed into one
   (4 buttons → 2) since both breakpoints finally agree. `MobileNowPlaying`'s
   utility row is `justify-between`. The third sub-item — "make the EQ
   `<select>` a round trigger + popover" — was **already shipped** with the
   crossfade work and had gone stale in this list.
```

Also update `ROADMAP.md:693-694`. **It is wrapped across two lines in the file** — match both, or the edit will not apply:

```markdown
**Items 1-4 shipped** (1-2 on 2026-08-16, 3 on 2026-08-17, 4 on 2026-08-19) — see the sections
below. The rest stand.
```

Replace with:

```markdown
**Items 1-4 and 8 shipped** (1-2 on 2026-08-16, 3 on 2026-08-17, 4 on 2026-08-19,
8 on 2026-08-25) — see the sections below. Items 5-7 stand.
```

- [ ] **Step 7: Update CLAUDE.md**

The transport order is now an invariant spanning two components, and the collapse removed a trap that a future change could easily reintroduce. In `CLAUDE.md`, find the `## Mobile layout (the `lg` split)` section and add this bullet immediately after the `- **Mobile player bar** is a slim "mini bar"...` bullet:

```markdown
- **Transport order is `shuffle · prev · play · next · repeat` on every
  surface** (`PlayerBar`, `MobileNowPlaying`) — Spotify/Apple convention, and
  the reason `PlayerBar` no longer renders shuffle and repeat twice. It used to
  carry a `hidden lg:block` pair LEFT of transport and an `lg:hidden` pair
  RIGHT of it, so changing one button meant two edits and the two breakpoints
  drifted into different orders. One pair now serves both; don't re-split it.
  `MiniPlayer` (PiP) deliberately has neither button. Order is regression-tested
  by aria-label sequence in both components' tests.
```

- [ ] **Step 8: Commit**

```bash
git add src/components/MobileNowPlaying.tsx src/components/MobileNowPlaying.test.tsx ROADMAP.md CLAUDE.md
git commit -m "feat: spread the mobile utility row edge to edge"
```

---

## Verification

Unit tests cover order and the layout class. Neither can see actual pixels — happy-dom has no layout engine — so finish with a real browser pass:

```bash
pnpm build
npx vite preview --port 4173 &
playwright-cli open --browser=chromium http://localhost:4173/
playwright-cli resize 390 844      # iPhone 12/13/14 viewport
```

Ingest a track and open the full-screen view, then confirm edge-to-edge spacing by measuring rather than eyeballing — the utility row's first and last buttons should sit within a few px of the row's own edges:

```js
() => {
  // Anchor on the lyrics button, NOT `.justify-between` — the view's header
  // row carries that class too and sits earlier in the document.
  const row = document.querySelector('[aria-label="Toggle lyrics"]').parentElement;
  const kids = [...row.children];
  const r = row.getBoundingClientRect();
  const a = kids[0].getBoundingClientRect();
  const z = kids[kids.length - 1].getBoundingClientRect();
  return { leftGap: a.left - r.left, rightGap: r.right - z.right, count: kids.length };
}
```

Expected: `leftGap` and `rightGap` both under ~2, `count` 6. Then screenshot at 390×844 and confirm by eye that shuffle sits left of prev and repeat right of next, and that the row of round buttons reads as evenly distributed.

Clean up: `playwright-cli close`, kill the preview (find it with `ss -lptn 'sport = :4173'` — `pkill -f "vite preview"` matches its own wrapper shell and returns 144), `rm -rf .playwright-cli`.

**Not covered by any of this:** whether the new order actually feels better in the hand. That is the human partner's call after using it.
