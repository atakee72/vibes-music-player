# Mobile Touch Affordances — Design

Date: 2026-08-09
Status: approved in brainstorming (always-visible ⋯, bottom action sheet, all 4 actions + sidebar)

## Purpose

Four row actions — heart, delete, Play next, Add to queue — are hover-revealed
and therefore unreachable on touch screens; the sidebar's rename/delete
pencils have the same gap. This feature closes every touch gap in one pass:
an always-visible ⋯ per mobile song row opening a bottom action sheet, plus
always-visible sidebar pencils on mobile. Desktop behavior is untouched.

## Decisions (from brainstorming)

- **Entry point: always-visible ⋯** on mobile rows. Long-press stays
  selection mode (500ms, shipped); swipe gestures rejected (conflict with
  drag sensors, undiscoverable).
- **Presentation: bottom action sheet on mobile**; desktop keeps the compact
  `RowMenu` dropdown unchanged.
- **Scope: all four actions + sidebar.** Delete is included (danger-styled,
  still routes through the existing confirm modal).

## Mobile row anatomy

- Song rows gain a `lg:hidden` ⋯ button at the right edge (min 44px touch
  target), visible whenever selection mode is OFF; it calls the list-level
  `openSheet(song)`. In selection mode the button is hidden (checkbox flow
  owns the row).
- **Favorited indicator**: mobile rows show a small filled `text-coral`
  heart beside the duration when `song.favorite` — display-only (the toggle
  lives in the sheet). Desktop is unchanged (hover heart button already
  shows state).

## The action sheet (`src/components/RowActionSheet.tsx`)

- **Positioning constraint (load-bearing):** the sheet must NOT render
  inside the virtualized row wrappers — their `transform` makes each wrapper
  the containing block for `position: fixed` descendants (same
  stacking-context family as the RowMenu occlusion bug, CLAUDE.md). It
  renders ONCE at SongList's root level (untransformed ancestor), driven by
  `sheetSong: Song | null` state local to SongList (same convention-break
  precedent as `selectedIds`).
- Presentational component. Props:
  `{ song: Song | null; onPlayNext: (id: string) => void; onAddToQueue: (id: string) => void; onToggleFavorite: (id: string) => void; onDelete: (id: string) => void; onClose: () => void }`
  — SongList always renders the component; it derives
  `open = song !== null` for `usePresence` internally, and keeps a
  `lastSongRef` so the content (title, favorite label) still renders from
  the previous song during the exit slide (when `song` is already null).
- Visuals: `fixed inset-x-0 bottom-0 z-50` panel sliding up
  (`usePresence`, `translate-y-full → 0`), backdrop `bg-black/50` fade,
  rounded top corners, `bg-surface/95 backdrop-blur-xl` (AFTERGLOW surface).
- Content: header (song title + artist, truncated) then four full-width
  rows with icons, min height 48px each:
  1. **Play next** (ListStart)
  2. **Add to queue** (ListEnd)
  3. **Add to Favorites** / **Remove from Favorites** (Heart; `text-coral
     fill-current` when favorited)
  4. **Delete** (Trash2, `text-danger` — fires `onDelete(id)`, which is the
     existing App handler that opens the confirm modal)
- Every action closes the sheet, then fires its callback. Closes also on
  backdrop tap and Escape (own capture-phase document listener —
  ConfirmModal precedent, so it doesn't collide with App's Escape chain).
- The sheet is mobile-first but not media-gated in the component; the
  OPENER is `lg:hidden`, so desktop simply never opens it.

## Sidebar on mobile

- `PlaylistRow`'s rename/delete buttons change
  `opacity-0 group-hover:opacity-100` → `max-lg:opacity-100 opacity-0
  group-hover:opacity-100` (always visible below `lg`; hover-revealed at
  `lg+`). CSS-only — handlers already work.

## Wiring

- **No new App props.** SongList already receives `onPlayNext`,
  `onAddToQueue`, `onToggleFavorite`, `onDelete` — the sheet reuses them.
  (`onToggleFavorite` exists on rows since the Favorites feature;
  `onDelete` opens the confirm modal.)
- SongList: `sheetSong` state + `openSheet`/`closeSheet`; the mobile ⋯ in
  `SortableRow` needs a stable callback (memo contract): pass a stable
  `onOpenSheet: (song: Song) => void` prop down (setState-only, `useCallback([])`).

## Edge cases

- Sheet open while the song gets deleted elsewhere / playlist switches:
  the sheet holds a `Song` snapshot; actions fire by id — the existing
  handlers no-op or guard on missing ids (delete confirms first; queue adds
  look the song up via `filteredSongsRef` and no-op when gone). Acceptable.
- Sheet + selection mode: the opener is hidden in selection mode; if
  selection mode is entered while the sheet is open (long-press on another
  row behind the backdrop is impossible — backdrop covers), no interaction.
- The "Already playing" queue guard applies unchanged (App handler).
- Orientation/desktop resize while open: sheet stays until closed — the
  opener is what's media-gated, not the sheet. Harmless.

## Testing

- `RowActionSheet.test.tsx`: renders header + 4 items when song set;
  favorite item label/`aria-pressed` flips with `song.favorite`; each item
  fires its callback with the song id AND closes (onClose called); backdrop
  click closes; Escape closes.
- `SongList.test.tsx` additions: mobile ⋯ (`aria-label` `Actions for
  <title>`) opens the sheet (sheet header visible); hidden in selection
  mode.
- `Sidebar.test.tsx`: class assertion that rename/delete buttons carry
  `max-lg:opacity-100`.
- Browser smoke at mobile viewport (`playwright-cli resize 390 844`):
  tap ⋯ on a row → sheet slides up → Add to queue → toast; reopen → heart
  → row shows the coral indicator; reopen → Delete → confirm modal;
  sidebar shows pencils. Desktop viewport check: no ⋯ on rows, hover
  cluster unchanged.
- CLAUDE.md "Mobile layout" section: document the sheet pattern and the
  fixed-inside-transform containing-block trap.

## Out of scope

- Swipe gestures, long-press changes, reorder on mobile (drag handle
  remains desktop-hover), "Add to playlist…" submenu, any desktop change.
