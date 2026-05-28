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
        isFilterActive={false}
        {...overrides}
      />
    </DndContext>,
  );
  return { ...utils, onPlay, onPause, onDelete, onBatchDelete, onReorder, onSelectionModeChange };
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
          onBatchDelete={vi.fn()}
          onReorder={vi.fn()}
          isFilterActive={false}
        />
      </DndContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('the active song title uses the purple highlight class', () => {
    const song = makeSong({ title: 'Highlighted' });
    renderSongList({ songs: [song], currentSong: song });
    expect(screen.getByText('Highlighted')).toHaveClass('text-purple-300');
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
});
