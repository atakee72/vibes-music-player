import { useEffect, useRef, useState } from 'react';
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
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import type { Song } from '../types';

interface SongListProps {
  songs: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  selectionMode: boolean;
  onSelectionModeChange: (active: boolean) => void;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onDelete: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onReorder: (songs: Song[]) => void;
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
  dragIds: string[];
  onPlay: (song: Song) => void;
  onPause: () => void;
  onDelete: (id: string) => void;
  onRowClick: (song: Song, e: React.MouseEvent) => void;
  onLongPress: (song: Song) => void;
}

function SortableRow({
  song,
  active,
  activePlaying,
  selected,
  selectionMode,
  isFilterActive,
  dragIds,
  onPlay,
  onPause,
  onDelete,
  onRowClick,
  onLongPress,
}: SortableRowProps) {
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
        'group flex items-center space-x-3 p-3 lg:p-4 rounded-xl hover:bg-white/5 transition-all duration-200 cursor-default ' +
        (selected ? 'ring-2 ring-purple-400/50 ' : '') +
        (active
          ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20'
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
              ? 'bg-purple-500 border-purple-500'
              : 'border-white/30 bg-transparent'
          }`}
          aria-label={selected ? 'Selected' : 'Not selected'}
          role="checkbox"
          aria-checked={selected}
        >
          {selected && <Check className="h-3 w-3 text-white" />}
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
          <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center border border-white/10">
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
                'text-sm lg:text-base font-medium truncate ' +
                (active ? 'text-purple-300' : 'text-white')
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
                  <span>{formatTime(song.duration)}</span>
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
              <span className="text-sm text-white/60">{formatTime(song.duration)}</span>
            ) : null}
            <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(song.id);
                }}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                aria-label="Delete song"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
              <button
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                aria-label="More"
              >
                <MoreHorizontal className="h-4 w-4 text-white/60" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex lg:hidden items-center space-x-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(song.id);
          }}
          className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
          aria-label="Delete song"
        >
          <Trash2 className="h-4 w-4 text-red-400" />
        </button>
      </div>
    </div>
  );
}

export function SongList({
  songs,
  currentSong,
  isPlaying,
  selectionMode,
  onSelectionModeChange,
  onPlay,
  onPause,
  onDelete,
  onBatchDelete,
  onReorder,
  isFilterActive,
  emptyHint = DEFAULT_EMPTY_HINT,
}: SongListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectionMode) {
      setSelectedIds(new Set());
      lastClickedRef.current = null;
    }
  }, [selectionMode]);

  const handleLongPress = (song: Song) => {
    if (selectionMode) return;
    onSelectionModeChange(true);
    setSelectedIds(new Set([song.id]));
    lastClickedRef.current = song.id;
  };

  const handleRowClick = (song: Song, e: React.MouseEvent) => {
    if (!selectionMode) return;

    if (e.shiftKey && lastClickedRef.current) {
      const lastIdx = songs.findIndex((s) => s.id === lastClickedRef.current);
      const curIdx = songs.findIndex((s) => s.id === song.id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        const range = songs.slice(from, to + 1).map((s) => s.id);
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
  };

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
          <div className="w-20 h-20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="h-10 w-10 text-purple-400" />
          </div>
          <p className="text-lg mb-2 font-medium">{emptyHint.primary}</p>
          <p className="text-sm text-white/40">{emptyHint.secondary}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto outline-none">
      {selectionMode && (
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-800/95 backdrop-blur-xl border-b border-white/10 px-4 py-2">
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
              className="flex items-center space-x-1 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-red-400 text-sm transition-colors"
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
        <div className="space-y-1 p-2 lg:p-4">
          {songs.map((song) => {
            const active = currentSong?.id === song.id;
            const activePlaying = active && isPlaying;
            const isSelected = selectedIds.has(song.id);
            return (
              <SortableRow
                key={song.id}
                song={song}
                active={active}
                activePlaying={activePlaying}
                selected={isSelected}
                selectionMode={selectionMode}
                isFilterActive={isFilterActive}
                dragIds={
                  selectionMode && isSelected
                    ? Array.from(selectedIds)
                    : [song.id]
                }
                onPlay={onPlay}
                onPause={onPause}
                onDelete={onDelete}
                onRowClick={handleRowClick}
                onLongPress={handleLongPress}
              />
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}
