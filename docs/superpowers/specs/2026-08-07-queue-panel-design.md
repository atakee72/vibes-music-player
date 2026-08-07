# Queue Panel — Design

Date: 2026-08-07
Status: approved in brainstorming (play-next model, ⋯ row menu, Lyrics-style panel, full edit + preview, session-only)

## Purpose

Give Vibes a "play next" queue: explicitly queued songs jump ahead of the
normal playlist flow, with a panel that shows and edits what's coming. This is
the second half of the AFTERGLOW deferral that produced Favorites (the heart
shipped 2026-08-06; the queue is the remaining piece).

## Model & playback semantics

- **State**: `queue: Song[]` in `App.tsx`. Session-only — no storage changes,
  gone on reload. Queuing never removes a song from any playlist; the queue
  holds references to library songs.
- **"Play next"** prepends to the queue; **"Add to queue"** appends.
- **Next-song resolution** is extracted into a pure function in
  `src/lib/queue.ts` (alongside the existing `nextInPlaylist`):

  ```
  resolveNextSong({ current, queue, songs, repeatMode, shuffle, anchor }):
    repeatMode === 'one'      → current            (unchanged today)
    queue.length > 0          → queue[0]
    otherwise                 → nextInPlaylist(base, songs, repeatMode, shuffle)
                                where base = current if it is in songs,
                                else anchor (may be null → nextInPlaylist(null, …))
  ```

  The `anchor` is passed in by App.tsx from `lastPlaylistSongRef` — the pure
  function receives it as a parameter and holds no state of its own.

  The memoized `nextSong` in App.tsx consumes this, so the **gapless preload
  follows the queue automatically** — `useAudioEngine` preloads whatever the
  memo says, exactly as today. The memo's dependency contract (keyed on
  `currentSong?.id`, honest comment about `activePlaylist?.songs` churn) is
  preserved; `queue` joins the dependency array.
- **Dequeue on consumption**: `playNext` already consumes the memoized
  `nextSong`; when `nextSong?.id === queue[0]?.id` it also
  `setQueue(q => q.slice(1))`. The engine's repeat-one in-place loop never
  calls `playNext`, so under repeat-one the queue *waits* (Spotify behavior);
  the existing "manual Next under repeat-one replays the track" behavior is
  unchanged and out of scope.
- **Drain-back anchor**: a `lastPlaylistSongRef` records the most recent
  playing song that is a member of `activePlaylist.songs`. When the queue
  drains and the just-finished queued song is not in the active playlist, the
  playlist walk resumes from that anchor instead of returning null — the
  queue ending must never mean silence. (Without shuffle,
  `nextInPlaylist` returns null for an unknown current song; the anchor
  guards that path.)
- **Shuffle**: the queue always wins while non-empty; when it drains, the
  shuffle walk resumes as today.

## Adding to the queue (row menu)

- The **dead ⋯ "More" button** on desktop song rows becomes a `RowMenu`
  dropdown — local `open` state + outside-click close, same convention-break
  precedent as PlayerBar's `eqOpen`. Items: **Play next**, **Add to queue**.
- Each action fires the existing toast (`setNotification`): "Playing next:
  <title>" / "Added to queue: <title>".
- Callbacks (`onPlayNext(id)`, `onAddToQueue(id)`) are stable
  (`useCallback` + functional setState) to preserve `SortableRow`'s
  `React.memo` contract.
- **v1 limitation (accepted)**: mobile rows have no hover cluster, so mobile
  cannot add to the queue yet — same precedent as the heart (mobile favoriting
  is player-bar-only). Do not improvise a mobile affordance.

## The panel

- `src/components/QueuePanel.tsx`, following `LyricsPanel`'s pattern exactly:
  right-edge slide-in, `usePresence(open)`, always takes an `open` prop,
  `z-40`, backdrop fade. **Lazy-loaded** with a mount-once ref
  (`queueEverOpenedRef`) per the code-splitting rules in CLAUDE.md — never
  `{open && <QueuePanel/>}` (kills the exit animation), never eager.
- Three sections:
  1. **Now Playing** — static row (cover thumb, title, artist).
  2. **In queue** — the editable queue: per-row remove ×, drag-to-reorder via
     a panel-local `DndContext` + `SortableContext` (independent of App's
     top-level DndContext), and a "Clear" button. Empty state: "Queue is
     empty — use ⋯ on any song."
  3. **Up next** — read-only preview of the playlist flow after the queue:
     without shuffle, the next 10 songs following the current one (wrapping
     when `repeatMode === 'all'`; stopping at the end when `'none'`); with
     shuffle ON, only the single actually-preloaded pick (the memoized
     `nextSong`, when it is not a queue head) plus a "Shuffle is on" note —
     showing more would fabricate an order that doesn't exist (shuffle rolls
     per advance).
- **Openers**: a ListMusic toggle in the PlayerBar right cluster (desktop,
  `hidden lg:flex` like its neighbors); a queue button in `MobileNowPlaying`
  that also closes the full-screen view (same z-index reasoning as its Lyrics
  button); the **Q** key registered in `useKeyboardShortcuts` beside L.
  State `showQueue` lives in App.tsx.
- Queue mutations from the panel (remove, reorder, clear) are App callbacks
  (`onRemoveFromQueue(index)`, `onReorderQueue(from, to)`, `onClearQueue`);
  the panel stays presentational.

## Error handling / edge cases

- Queued song deleted from the library (app-wide delete): the delete handlers
  also filter it out of `queue` — a deleted song must not play.
- Queue head equals the current song: allowed (replays the song); no
  special-casing.
- Switching playlists with a non-empty queue: the queue is playlist-independent
  and keeps playing; the drain-back anchor only ever points into the *active*
  playlist, resetting as playlist songs play.
- Duplicate adds are allowed (queueing a song twice plays it twice) — queue
  rows therefore need index-based keys/ids (`queue-${index}-${song.id}`), not
  bare song ids.

## Testing

- `src/lib/queue.test.ts`: unit tests for `resolveNextSong` — queue
  precedence, repeat-one bypass, drain-back to playlist flow, empty-queue
  fallback equivalence with `nextInPlaylist`, shuffle + queue precedence.
- `src/components/QueuePanel.test.tsx`: renders sections, remove/clear fire
  callbacks, empty state, up-next preview list, shuffle note.
- `src/components/SongList.test.tsx` additions: ⋯ opens the menu; Play
  next / Add to queue fire the right callbacks with the song id and do not
  fire `onPlay` (stopPropagation).
- App.tsx wiring stays unit-untested by design; verified with the
  playwright-cli browser smoke test (queue two songs, watch order, drain).
- CLAUDE.md gains a "Queue" section documenting the semantics above.

## Out of scope

- Queue persistence (session-only decided).
- Mobile add-to-queue affordance.
- Changing repeat-one's manual-Next behavior.
- "Save queue as playlist", history view, or any queue-as-playlist editing.
