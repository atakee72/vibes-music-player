import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SongList } from './SongList';
import { makeSong } from '../test-utils';

function renderSongList(overrides: Partial<Parameters<typeof SongList>[0]> = {}) {
  const onPlay = vi.fn();
  const onPause = vi.fn();
  const onDelete = vi.fn();
  const onBatchDelete = vi.fn();
  const onReorder = vi.fn();
  const onSelectionModeChange = vi.fn();
  const onToggleFavorite = vi.fn();
  const onPlayNext = vi.fn();
  const onAddToQueue = vi.fn();
  const utils = render(
    <DndContext>
      <SongList
        songs={[]}
        currentSong={null}
        isPlaying={false}
        selectionMode={false}
        onSelectionModeChange={onSelectionModeChange}
        onPlay={onPlay}
        onPause={onPause}
        onDelete={onDelete}
        onBatchDelete={onBatchDelete}
        onReorder={onReorder}
        onToggleFavorite={onToggleFavorite}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        isFilterActive={false}
        {...overrides}
      />
    </DndContext>,
  );
  return {
    ...utils,
    onPlay,
    onPause,
    onDelete,
    onBatchDelete,
    onReorder,
    onSelectionModeChange,
    onToggleFavorite,
    onPlayNext,
    onAddToQueue,
  };
}

describe('SongList', () => {
  it('renders the empty state when songs is empty', () => {
    renderSongList();
    expect(screen.getByText('No songs in this playlist')).toBeInTheDocument();
    expect(screen.getByText('Add some music files to get started')).toBeInTheDocument();
  });

  it('renders the custom emptyHint copy when provided', () => {
    renderSongList({ emptyHint: { primary: 'No matches for "beat"', secondary: 'Try a different search' } });
    expect(screen.getByText('No matches for "beat"')).toBeInTheDocument();
    expect(screen.getByText('Try a different search')).toBeInTheDocument();
  });

  it('renders one row per song with title and artist', () => {
    const a = makeSong({ title: 'Alpha', artist: 'Artist A' });
    const b = makeSong({ title: 'Bravo', artist: 'Artist B' });
    renderSongList({ songs: [a, b] });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText(/Artist A/)).toBeInTheDocument();
    expect(screen.getByText(/Artist B/)).toBeInTheDocument();
  });

  it('clicking play overlay on a non-active song fires onPlay; on the active+playing song fires onPause', () => {
    const song = makeSong({ title: 'Target' });
    const { onPlay, onPause, rerender } = renderSongList({ songs: [song] });

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledWith(song);
    expect(onPause).not.toHaveBeenCalled();

    rerender(
      <DndContext>
        <SongList
          songs={[song]}
          currentSong={song}
          isPlaying={true}
          selectionMode={false}
          onSelectionModeChange={vi.fn()}
          onPlay={onPlay}
          onPause={onPause}
          onDelete={vi.fn()}
          onToggleFavorite={vi.fn()}
          onBatchDelete={vi.fn()}
          onReorder={vi.fn()}
          onPlayNext={vi.fn()}
          onAddToQueue={vi.fn()}
          isFilterActive={false}
        />
      </DndContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('the active song title uses the amber highlight class', () => {
    const song = makeSong({ title: 'Highlighted' });
    renderSongList({ songs: [song], currentSong: song });
    expect(screen.getByText('Highlighted')).toHaveClass('text-amber');
  });

  it('shows drag handles when not in selection mode and no filter', () => {
    const song = makeSong();
    renderSongList({ songs: [song] });
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument();
  });

  it('hides drag handles when isFilterActive is true', () => {
    const song = makeSong();
    renderSongList({ songs: [song], isFilterActive: true });
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
  });

  it('hides drag handles in selection mode (replaced by checkboxes)', () => {
    const song = makeSong();
    renderSongList({ songs: [song], selectionMode: true });
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('double-click on a row fires onPlay', () => {
    const song = makeSong({ title: 'DoubleClicked' });
    const { onPlay } = renderSongList({ songs: [song] });
    fireEvent.doubleClick(screen.getByText('DoubleClicked'));
    expect(onPlay).toHaveBeenCalledWith(song);
  });

  it('single-click on a row does nothing outside selection mode', () => {
    const song = makeSong({ title: 'SingleClicked' });
    const { onPlay } = renderSongList({ songs: [song] });
    fireEvent.click(screen.getByText('SingleClicked'));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('selection toolbar with all buttons appears in selection mode', () => {
    renderSongList({ songs: [makeSong()], selectionMode: true });
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel selection' })).toBeInTheDocument();
  });

  it('Select all selects all visible songs', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    renderSongList({ songs, selectionMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('Cancel button fires onSelectionModeChange(false)', () => {
    const { onSelectionModeChange } = renderSongList({ songs: [makeSong()], selectionMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(onSelectionModeChange).toHaveBeenCalledWith(false);
  });

  it('clicks toggle individual selection in selection mode', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    renderSongList({ songs, selectionMode: true });
    fireEvent.click(screen.getByText('A'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('B'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('A'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('fires onBatchDelete with selected IDs when Delete is clicked', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    const { onBatchDelete, onSelectionModeChange } = renderSongList({ songs, selectionMode: true });
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(onBatchDelete).toHaveBeenCalledWith([songs[0].id]);
    expect(onSelectionModeChange).toHaveBeenCalledWith(false);
  });

  it('heart button fires onToggleFavorite with the song id, not onPlay', () => {
    const song = makeSong({ title: 'Alpha' });
    const { onToggleFavorite, onPlay } = renderSongList({ songs: [song] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Alpha to Favorites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(song.id);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('heart reflects favorite state via label and aria-pressed', () => {
    const fav = makeSong({ title: 'Bravo', favorite: true });
    renderSongList({ songs: [fav] });
    const btn = screen.getByRole('button', { name: 'Remove Bravo from Favorites' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('row menu Play next fires onPlayNext with the song id, not onPlay', () => {
    const song = makeSong({ title: 'Alpha' });
    const { onPlayNext, onPlay } = renderSongList({ songs: [song] });
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Play next/ }));
    expect(onPlayNext).toHaveBeenCalledWith(song.id);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('row menu Add to queue fires onAddToQueue with the song id', () => {
    const song = makeSong({ title: 'Bravo' });
    const { onAddToQueue } = renderSongList({ songs: [song] });
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Bravo' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to queue/ }));
    expect(onAddToQueue).toHaveBeenCalledWith(song.id);
  });

  it('rows are not marked aria-disabled in filtered views (dnd disabled ≠ row disabled)', () => {
    const song = makeSong({ title: 'Alpha' });
    renderSongList({ songs: [song], isFilterActive: true });
    const row = screen.getByRole('button', { name: /^Alpha Artist/ });
    expect(row).not.toHaveAttribute('aria-disabled');
  });

  it('mobile ⋯ opens the action sheet for that song', () => {
    const song = makeSong({ title: 'Alpha', artist: 'Artist X' });
    renderSongList({ songs: [song] });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    expect(screen.getByRole('dialog', { name: 'Actions for Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play next' })).toBeInTheDocument();
  });

  it('mobile ⋯ is hidden in selection mode', () => {
    const song = makeSong({ title: 'Alpha' });
    renderSongList({ songs: [song], selectionMode: true });
    expect(screen.queryByRole('button', { name: 'Actions for Alpha' })).not.toBeInTheDocument();
  });

  it('sheet actions route to the SongList props with the song id', () => {
    const song = makeSong({ title: 'Alpha' });
    const { onAddToQueue } = renderSongList({ songs: [song] });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(onAddToQueue).toHaveBeenCalledWith(song.id);
  });

  it('mobile rows show a favorited indicator when the song is hearted', () => {
    const fav = makeSong({ title: 'Bravo', favorite: true });
    renderSongList({ songs: [fav] });
    expect(screen.getByLabelText('Favorited')).toBeInTheDocument();
  });
});
