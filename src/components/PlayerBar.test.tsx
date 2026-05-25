import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerBar } from './PlayerBar';
import { makeSong } from '../test-utils';

function renderPlayerBar(overrides: Partial<Parameters<typeof PlayerBar>[0]> = {}) {
  const onPlayPause = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onSeek = vi.fn();
  const onCycleRepeat = vi.fn();
  const utils = render(
    <PlayerBar
      song={null}
      isPlaying={false}
      currentTime={0}
      duration={0}
      visualizerData={[]}
      repeatMode="none"
      onPlayPause={onPlayPause}
      onPrev={onPrev}
      onNext={onNext}
      onSeek={onSeek}
      onCycleRepeat={onCycleRepeat}
      {...overrides}
    />,
  );
  return { ...utils, onPlayPause, onPrev, onNext, onSeek, onCycleRepeat };
}

describe('PlayerBar', () => {
  it('renders only "No song playing" when song is null', () => {
    renderPlayerBar();
    expect(screen.getByText('No song playing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('renders the full bar with title, artist, and transport when a song is present', () => {
    const song = makeSong({ title: 'Now Playing', artist: 'Some Artist' });
    renderPlayerBar({ song, duration: 200 });
    expect(screen.getByText('Now Playing')).toBeInTheDocument();
    expect(screen.getByText('Some Artist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByText('No song playing')).not.toBeInTheDocument();
  });

  it('shows Play when not playing and Pause when playing', () => {
    const song = makeSong();
    const { rerender, onPlayPause } = renderPlayerBar({ song });
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    rerender(
      <PlayerBar
        song={song}
        isPlaying={true}
        currentTime={0}
        duration={100}
        visualizerData={[]}
        repeatMode="none"
        onPlayPause={onPlayPause}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onSeek={vi.fn()}
        onCycleRepeat={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('swaps Repeat icon for Repeat1 when repeatMode is "one"', () => {
    const song = makeSong();
    const { rerender, onCycleRepeat } = renderPlayerBar({ song, repeatMode: 'all' });
    // "all" — both desktop and mobile repeat buttons render
    expect(screen.getAllByRole('button', { name: 'Repeat: all' })).toHaveLength(2);

    rerender(
      <PlayerBar
        song={song}
        isPlaying={false}
        currentTime={0}
        duration={100}
        visualizerData={[]}
        repeatMode="one"
        onPlayPause={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onSeek={vi.fn()}
        onCycleRepeat={onCycleRepeat}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Repeat: one' })).toHaveLength(2);
  });

  it('transport buttons fire the right callbacks', () => {
    const song = makeSong();
    const { onPlayPause, onPrev, onNext } = renderPlayerBar({ song });

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('visualizer caps at 15 bars regardless of input length', () => {
    const song = makeSong();
    // 30 values -> should only render 15 bars
    const longData = Array.from({ length: 30 }, (_, i) => i * 8);
    const { container } = renderPlayerBar({ song, visualizerData: longData });
    const bars = container.querySelectorAll('.bg-gradient-to-t.from-purple-500');
    expect(bars).toHaveLength(15);
  });
});
