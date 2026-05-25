import { render, screen, fireEvent } from '@testing-library/react';
import { SongList } from './SongList';
import { makeSong } from '../test-utils';

function renderSongList(overrides: Partial<Parameters<typeof SongList>[0]> = {}) {
  const onPlay = vi.fn();
  const onPause = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <SongList
      songs={[]}
      currentSong={null}
      isPlaying={false}
      onPlay={onPlay}
      onPause={onPause}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { ...utils, onPlay, onPause, onDelete };
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
    // artist + album joined with " • "
    expect(screen.getByText(/Artist A/)).toBeInTheDocument();
    expect(screen.getByText(/Artist B/)).toBeInTheDocument();
  });

  it('clicking play overlay on a non-active song fires onPlay; on the active+playing song fires onPause', () => {
    const song = makeSong({ title: 'Target' });
    const { onPlay, onPause, rerender } = renderSongList({ songs: [song] });

    // Non-active state — overlay should call onPlay
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledWith(song);
    expect(onPause).not.toHaveBeenCalled();

    // Now rerender with this song active + playing — overlay should call onPause
    rerender(
      <SongList
        songs={[song]}
        currentSong={song}
        isPlaying={true}
        onPlay={onPlay}
        onPause={onPause}
        onDelete={vi.fn()}
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
});
