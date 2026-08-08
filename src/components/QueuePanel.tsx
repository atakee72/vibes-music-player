import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import type { Song } from '../types';
import { usePresence } from '../hooks/usePresence';

interface QueuePanelProps {
  /** Drives the slide-in/out. Defaults to `true` (always-open) when omitted. */
  open?: boolean;
  currentSong: Song | null;
  queue: Song[];
  /** Read-only preview of the playlist flow after the queue (already computed
   *  by App — a plain walk, or the single preloaded pick under shuffle). */
  upNext: Song[];
  shuffle: boolean;
  onClose: () => void;
  /** `id` rides along so the handler can verify the index is still fresh —
   *  the queue can shrink between paint and click (auto-advance dequeue). */
  onRemove: (index: number, id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClear: () => void;
}

function SongLine({ song }: { song: Song }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-white/80">{song.title}</p>
      <p className="truncate text-xs text-white/40">{song.artist}</p>
    </div>
  );
}

function QueueRow({
  song,
  index,
  onRemove,
}: {
  song: Song;
  index: number;
  onRemove: (index: number, id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `q-${index}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1"
        aria-label={`Reorder ${song.title}`}
      >
        <GripVertical className="h-4 w-4 text-white/40" />
      </button>
      <SongLine song={song} />
      <button
        onClick={() => onRemove(index, song.id)}
        className="p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 rounded"
        aria-label={`Remove ${song.title} from queue`}
      >
        <X className="h-3.5 w-3.5 text-white/60" />
      </button>
    </div>
  );
}

export function QueuePanel({
  open = true,
  currentSong,
  queue,
  upNext,
  shuffle,
  onClose,
  onRemove,
  onReorder,
  onClear,
}: QueuePanelProps) {
  const { mounted, visible } = usePresence(open);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  if (!mounted) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).slice(2));
    const to = Number(String(over.id).slice(2));
    if (Number.isInteger(from) && Number.isInteger(to)) onReorder(from, to);
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 lg:hidden motion-safe:transition-opacity motion-safe:duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-0 z-40 lg:relative lg:z-auto lg:w-80 flex flex-col bg-surface/95 backdrop-blur-xl border-l border-white/10 motion-safe:transition-transform motion-safe:duration-300 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-sm font-medium text-white/80">Queue</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Close queue"
          >
            <X className="h-4 w-4 text-white/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {currentSong && (
            <section>
              <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-white/40">
                Now playing
              </h3>
              <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-2">
                {currentSong.coverArt && (
                  <img
                    src={currentSong.coverArt}
                    alt={currentSong.album}
                    className="h-8 w-8 rounded object-cover"
                  />
                )}
                <SongLine song={currentSong} />
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between px-2 pb-1">
              <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
                In queue
              </h3>
              {queue.length > 0 && (
                <button
                  onClick={onClear}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors"
                  aria-label="Clear queue"
                >
                  Clear
                </button>
              )}
            </div>
            {queue.length === 0 ? (
              <p className="px-2 py-3 text-sm text-white/40">
                Queue is empty — use ⋯ on any song.
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={queue.map((_, i) => `q-${i}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {queue.map((song, i) => (
                    <QueueRow key={`q-${i}-${song.id}`} song={song} index={i} onRemove={onRemove} />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </section>

          {(upNext.length > 0 || shuffle) && (
            <section>
              <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-white/40">
                Up next
              </h3>
              {shuffle && (
                <p className="px-2 pb-1 text-xs text-lilac">
                  Shuffle is on — only the next pick is decided.
                </p>
              )}
              {upNext.map((song, i) => (
                <div key={`u-${i}-${song.id}`} className="flex items-center gap-2 px-2 py-1.5">
                  <SongLine song={song} />
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
