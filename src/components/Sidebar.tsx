import { useDroppable } from '@dnd-kit/core';
import { Music, PanelLeftClose, Plus, Trash2 } from 'lucide-react';
import type { Playlist } from '../types';

interface SidebarProps {
  playlists: Playlist[];
  activePlaylistId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface PlaylistRowProps {
  playlist: Playlist;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function PlaylistRow({ playlist, active, onSelect, onDelete, onClose }: PlaylistRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `playlist-${playlist.id}` });
  return (
    <div
      ref={setNodeRef}
      onClick={() => {
        onSelect(playlist.id);
        // Only auto-close on mobile (where sidebar is an overlay).
        // On desktop the sidebar is persistent — closing it on every click is annoying.
        if (!window.matchMedia('(min-width: 1024px)').matches) onClose();
      }}
      className={
        'group flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer transition-all duration-200 mb-1 select-none ' +
        (isOver ? 'ring-2 ring-amber ' : '') +
        (active
          ? 'bg-white/15 text-lilac border border-white/10'
          : 'text-white/70 hover:bg-white/5 hover:text-white')
      }
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{playlist.name}</p>
        <p className="text-xs text-white/50">{playlist.songs.length} songs</p>
      </div>
      {playlist.id !== 'library' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(playlist.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-danger/20 rounded transition-all"
          aria-label={`Delete ${playlist.name}`}
        >
          <Trash2 className="h-3 w-3 text-danger" />
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  playlists,
  activePlaylistId,
  onSelect,
  onCreate,
  onDelete,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <div
      className={`fixed lg:relative inset-y-0 left-0 z-50 w-64 overflow-hidden flex flex-col transform transition-transform lg:transition-[width] duration-300 ease-in-out lg:translate-x-0 ${
        isOpen ? 'translate-x-0 lg:w-64' : '-translate-x-full lg:w-0'
      }`}
    >
      <div className="w-64 shrink-0 flex flex-col h-full bg-surface/95 backdrop-blur-xl border-r border-white/10">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-amber to-coral rounded-lg flex items-center justify-center">
              <Music className="h-5 w-5 text-deep" />
            </div>
            <h1 className="text-lg font-semibold font-display bg-gradient-to-r from-amber to-coral bg-clip-text text-transparent">
              Vibes
            </h1>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={onCreate}
          className="w-full flex items-center space-x-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-amber/40 rounded-lg transition-all duration-200 text-sm font-medium text-white/80"
        >
          <Plus className="h-4 w-4 text-amber" />
          <span>New Playlist</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {playlists.map((p) => (
          <PlaylistRow
            key={p.id}
            playlist={p}
            active={p.id === activePlaylistId}
            onSelect={onSelect}
            onDelete={onDelete}
            onClose={onClose}
          />
        ))}
      </div>
      </div>
    </div>
  );
}
