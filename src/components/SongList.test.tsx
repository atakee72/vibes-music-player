import { render, screen, fireEvent } from '@testing-library/react';
import { SongList } from './SongList';
import { makeSong } from '../test-utils';

function renderSongList(overrides: Partial<Parameters<typeof SongList>[0]> = {}) {
  const onPlay = vi.fn();
  const onPause = vi.fn();
  const onDelete = vi.fn();
  const onBatchDelete = vi.fn();
  const onReorder = vi.fn();
  const utils = render(
    <SongList
      songs={[]}
      currentSong={null}
      isPlaying={false}
      onPlay={onPlay}
      onPause={onPause}
      onDelete={onDelete}
      onBatchDelete={onBatchDelete}
      onReorder={onReorder}
      isFilterActive={false}
      {...overrides}
    />,
  );
  return { ...utils, onPlay, onPause, onDelete, onBatchDelete, onReorder };
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
      <SongList
        songs={[song]}
        currentSong={song}
        isPlaying={true}
        onPlay={onPlay}
        onPause={onPause}
        onDelete={vi.fn()}
        onBatchDelete={vi.fn()}
        onReorder={vi.fn()}
        isFilterActive={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('the active song title uses the purple highlight class', () => {
    const song = makeSong({ title: 'Highlighted' });
    renderSongList({ songs: [song], currentSong: song });
    expect(screen.getByText('Highlighted')).toHaveClass('text-purple-300');
  });

  it('shows drag handles when isFilterActive is false', () => {
    const song = makeSong();
    renderSongList({ songs: [song], isFilterActive: false });
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument();
  });

  it('hides drag handles when isFilterActive is true', () => {
    const song = makeSong();
    renderSongList({ songs: [song], isFilterActive: true });
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
  });

  it('shows batch delete toolbar when songs are selected via click', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    renderSongList({ songs });

    fireEvent.click(screen.getByText('A'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete selected')).toBeInTheDocument();
  });

  it('fires onBatchDelete with selected IDs when delete toolbar is clicked', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    const { onBatchDelete } = renderSongList({ songs });

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByLabelText('Delete selected'));
    expect(onBatchDelete).toHaveBeenCalledWith([songs[0].id]);
  });

  it('Ctrl+click toggles individual selection', () => {
    const songs = [makeSong({ title: 'A' }), makeSong({ title: 'B' })];
    renderSongList({ songs });

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('B'), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByText('A'), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
