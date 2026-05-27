import { render, screen, fireEvent } from '@testing-library/react';
import { MiniPlayer } from './MiniPlayer';
import { makeSong } from '../test-utils';

function renderMiniPlayer(overrides: Partial<Parameters<typeof MiniPlayer>[0]> = {}) {
  const onPlayPause = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const defaults = {
    song: makeSong({ title: 'Test Song', artist: 'Test Artist' }),
    isPlaying: false,
    tintColor: null,
    onPlayPause,
    onPrev,
    onNext,
  };
  const utils = render(<MiniPlayer {...defaults} {...overrides} />);
  return { ...utils, onPlayPause, onPrev, onNext };
}

describe('MiniPlayer', () => {
  it('renders song title and artist', () => {
    renderMiniPlayer();
    expect(screen.getByText('Test Song')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
  });

  it('shows Play button when not playing', () => {
    renderMiniPlayer({ isPlaying: false });
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('shows Pause button when playing', () => {
    renderMiniPlayer({ isPlaying: true });
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('fires onPlayPause when play/pause is clicked', () => {
    const { onPlayPause } = renderMiniPlayer();
    fireEvent.click(screen.getByLabelText('Play'));
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it('fires onPrev when previous is clicked', () => {
    const { onPrev } = renderMiniPlayer();
    fireEvent.click(screen.getByLabelText('Previous'));
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('fires onNext when next is clicked', () => {
    const { onNext } = renderMiniPlayer();
    fireEvent.click(screen.getByLabelText('Next'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('renders cover art when available', () => {
    renderMiniPlayer({ song: makeSong({ coverArt: 'blob:cover' }) });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:cover');
  });

  it('renders fallback icon when no cover art', () => {
    renderMiniPlayer({ song: makeSong({ coverArt: undefined }) });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
