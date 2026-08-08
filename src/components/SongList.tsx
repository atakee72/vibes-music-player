import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  Clock,
  GripVertical,
  Heart,
  Music,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import type { Song } from '../types';
import { RowMenu } from './RowMenu';

interface SongListProps {
  songs: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  selectionMode: boolean;
  onSelectionModeChange: (active: boolean) => void;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onReorder: (songs: Song[]) => void;
  onPlayNext: (id: string) => void;
  onAddToQueue: (id: string) => void;
  isFilterActive: boolean;
  emptyHint?: { primary: string; secondary: string };
}

const DEFAULT_EMPTY_HINT = {
  primary: 'No songs in this playlist',
  secondary: 'Add some music files to get started',
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 5;

const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

interface SortableRowProps {
  song: Song;
  active: boolean;
  activePlaying: boolean;
  selected: boolean;
  selectionMode: boolean;
  isFilterActive: boolean;
  selectedIds: Set<string>;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlayNext: (id: string) => void;
  onAddToQueue: (id: string) => void;
  onRowClick: (song: Song, e: React.MouseEvent) => void;
  onLongPress: (song: Song) => void;
}

const SortableRow = memo(function SortableRow({
  song,
  active,
  activePlaying,
  selected,
  selectionMode,
  isFilterActive,
  selectedIds,
  onPlay,
  onPause,
  onDelete,
  onToggleFavorite,
  onPlayNext,
  onAddToQueue,
  onRowClick,
  onLongPress,
}: SortableRowProps) {
  // Derive drag payload inside the row so it's stable when selection state
  // hasn't changed. `selectedIds` Set reference is stable across renders
  // that don't touch selection — so memoization actually works.
  const dragIds = useMemo(
    () =>
      selectionMode && selected ? Array.from(selectedIds) : [song.id],
    [selectionMode, selected, selectedIds, song.id],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: song.id, data: { type: 'song', ids: dragIds } });

  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (selectionMode) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      onLongPress(song);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartRef.current || longPressTimerRef.current === null) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) clearLongPress();
  };

  const handlePointerUpOrCancel = () => {
    clearLongPress();
    pointerStartRef.current = null;
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // In selection mode (and this row is selected), attach drag listeners to the
  // whole row body so the user can drag the selection to another playlist.
  // Outside selection mode, listeners attach only to the GripVertical handle.
  const rowListeners = selectionMode && selected ? listeners : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...rowListeners}
      onClick={(e) => onRowClick(song, e)}
      onDoubleClick={() => onPlay(song)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onPointerLeave={handlePointerUpOrCancel}
      className={
        'group flex items-center space-x-3 p-3 lg:p-4 rounded-xl hover:bg-white/5 transition-all duration-200 cursor-default select-none ' +
        (selected ? 'ring-2 ring-amber/50 ' : '') +
        (active
          ? 'bg-gradient-to-r from-amber/10 to-coral/10 border border-amber/20'
          : '')
      }
    >
      {!isFilterActive && !selectionMode && (
        <div
          {...listeners}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 transition-opacity"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-white/40" />
        </div>
      )}

      {selectionMode && (
        <div
          className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected
              ? 'bg-amber border-amber'
              : 'border-white/30 bg-transparent'
          }`}
          aria-label={selected ? 'Selected' : 'Not selected'}
          role="checkbox"
          aria-checked={selected}
        >
          {selected && <Check className="h-3 w-3 text-deep" />}
        </div>
      )}

      <div className="relative flex-shrink-0 w-12 h-12">
        {song.coverArt ? (
          <img
            src={song.coverArt}
            alt={song.album}
            className="w-12 h-12 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <div className="w-12 h-12 bg-gradient-to-br from-surface to-surface-2 rounded-lg flex items-center justify-center border border-white/10">
            <Music className="h-6 w-6 text-white/40" />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            activePlaying ? onPause() : onPlay(song);
          }}
          className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200 backdrop-blur-sm"
          aria-label={activePlaying ? 'Pause' : 'Play'}
        >
          {activePlaying ? (
            <Pause className="h-5 w-5 text-white" fill="white" />
          ) : (
            <Play className="h-5 w-5 text-white" fill="white" />
          )}
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <p
              className={
                'text-sm lg:text-base font-medium font-display truncate ' +
                (active ? 'text-amber' : 'text-cream')
              }
            >
              {song.title}
            </p>
            <p className="text-xs lg:text-sm text-white/60 truncate">
              {song.artist}
              {song.album && song.album !== 'Unknown Album' && ` • ${song.album}`}
            </p>
            <div className="flex items-center space-x-3 mt-1 lg:hidden">
              {song.duration ? (
                <div className="flex items-center space-x-1 text-xs text-white/40">
                  <Clock className="h-3 w-3" />
                  <span className="font-mono">{formatTime(song.duration)}</span>
                </div>
              ) : null}
              {song.file && (
                <span className="text-xs text-white/40">
                  {(song.file.size / 1048576).toFixed(1)} MB
                </span>
              )}
            </div>
          </div>
          <div className="hidden lg:flex items-center space-x-4">
            {song.duration ? (
              <span className="text-sm text-white/60 font-mono">{formatTime(song.duration)}</span>
            ) : null}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(song.id);
              }}
              className={
                'p-2 hover:bg-white/10 rounded-lg transition-all ' +
                (song.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
              }
              aria-label={
                song.favorite
                  ? `Remove ${song.title} from Favorites`
                  : `Add ${song.title} to Favorites`
              }
              aria-pressed={!!song.favorite}
            >
              <Heart
                className={
                  'h-4 w-4 ' + (song.favorite ? 'text-coral fill-current' : 'text-white/60')
                }
              />
            </button>
            <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(song.id);
                }}
                className="p-2 hover:bg-danger/20 rounded-lg transition-colors"
                aria-label="Delete song"
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </button>
              <RowMenu
                songTitle={song.title}
                onPlayNext={() => onPlayNext(song.id)}
                onAddToQueue={() => onAddToQueue(song.id)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export function SongList({
  songs,
  currentSong,
  isPlaying,
  selectionMode,
  onSelectionModeChange,
  onPlay,
  onPause,
  onDelete,
  onToggleFavorite,
  onBatchDelete,
  onReorder,
  onPlayNext,
  onAddToQueue,
  isFilterActive,
  emptyHint = DEFAULT_EMPTY_HINT,
}: SongListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDesktop =
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 1024px)').matches;

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isDesktop ? 76 : 104),
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
    // Fallback when the scroll element has no dimensions (happy-dom in tests).
    // Real browsers override via the inner ResizeObserver path.
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return () => {};
      const measure = () => {
        const rect = el.getBoundingClientRect();
        cb(
          rect.width === 0 && rect.height === 0
            ? { width: 1024, height: 5000 }
            : { width: rect.width, height: rect.height },
        );
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    },
  });

  useEffect(() => {
    if (!selectionMode) {
      setSelectedIds(new Set());
      lastClickedRef.current = null;
    }
  }, [selectionMode]);

  // Refs to keep callbacks stable across renders. Wrapping these handlers in
  // useCallback([songs, selectionMode]) would defeat React.memo on SortableRow
  // because the callback identity would change on every list mutation.
  const songsRef = useRef(songs);
  const selectionModeRef = useRef(selectionMode);
  useEffect(() => {
    songsRef.current = songs;
  }, [songs]);
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const handleLongPress = useCallback(
    (song: Song) => {
      if (selectionModeRef.current) return;
      onSelectionModeChange(true);
      setSelectedIds(new Set([song.id]));
      lastClickedRef.current = song.id;
    },
    [onSelectionModeChange],
  );

  const handleRowClick = useCallback((song: Song, e: React.MouseEvent) => {
    if (!selectionModeRef.current) return;
    const list = songsRef.current;

    if (e.shiftKey && lastClickedRef.current) {
      const lastIdx = list.findIndex((s) => s.id === lastClickedRef.current);
      const curIdx = list.findIndex((s) => s.id === song.id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        const range = list.slice(from, to + 1).map((s) => s.id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          range.forEach((id) => next.add(id));
          return next;
        });
      }
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
    lastClickedRef.current = song.id;
  }, []);

  const handleSelectAll = () => {
    setSelectedIds(new Set(songs.map((s) => s.id)));
  };

  const handleCancel = () => {
    onSelectionModeChange(false);
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    onBatchDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    onSelectionModeChange(false);
  };

  if (songs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-white/60">
          <div className="w-20 h-20 bg-gradient-to-r from-amber/20 to-coral/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="h-10 w-10 text-amber" />
          </div>
          <p className="text-lg mb-2 font-medium">{emptyHint.primary}</p>
          <p className="text-sm text-white/40">{emptyHint.secondary}</p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto outline-none">
      {selectionMode && (
        <div className="sticky top-0 z-10 flex items-center justify-between bg-surface/95 backdrop-blur-xl border-b border-white/10 px-4 py-2">
          <span className="text-sm text-white/80">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSelectAll}
              className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-white/80 text-sm transition-colors"
              aria-label="Select all"
            >
              Select all
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="flex items-center space-x-1 px-3 py-1 bg-danger/20 hover:bg-danger/30 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-danger text-sm transition-colors"
              aria-label="Delete selected"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center space-x-1 px-3 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-white/80 text-sm transition-colors"
              aria-label="Cancel selection"
            >
              <X className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}
      <SortableContext
        items={songs.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
        disabled={isFilterActive || selectionMode}
      >
        <div
          className="p-2 lg:p-4"
          style={{ position: 'relative', height: `${totalSize}px` }}
        >
          {virtualItems.map((virtualItem) => {
            const song = songs[virtualItem.index];
            const active = currentSong?.id === song.id;
            const activePlaying = active && isPlaying;
            const isSelected = selectedIds.has(song.id);
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <SortableRow
                  song={song}
                  active={active}
                  activePlaying={activePlaying}
                  selected={isSelected}
                  selectionMode={selectionMode}
                  isFilterActive={isFilterActive}
                  selectedIds={selectedIds}
                  onPlay={onPlay}
                  onPause={onPause}
                  onDelete={onDelete}
                  onToggleFavorite={onToggleFavorite}
                  onPlayNext={onPlayNext}
                  onAddToQueue={onAddToQueue}
                  onRowClick={handleRowClick}
                  onLongPress={handleLongPress}
                />
              </div>
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}
