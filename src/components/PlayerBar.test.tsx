import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerBar } from './PlayerBar';
import { makeSong } from '../test-utils';

function renderPlayerBar(overrides: Partial<Parameters<typeof PlayerBar>[0]> = {}) {
  const onPlayPause = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onSeek = vi.fn();
  const onCycleRepeat = vi.fn();
  const onEqPresetChange = vi.fn();
  const onVolumeChange = vi.fn();
  const utils = render(
    <PlayerBar
      song={null}
      isPlaying={false}
      currentTime={0}
      duration={0}
      visualizerData={[]}
      repeatMode="none"
      eqPreset="Off"
      volume={1}
      onPlayPause={onPlayPause}
      onPrev={onPrev}
      onNext={onNext}
      onSeek={onSeek}
      onCycleRepeat={onCycleRepeat}
      onEqPresetChange={onEqPresetChange}
      onVolumeChange={onVolumeChange}
      {...overrides}
    />,
  );
  return { ...utils, onPlayPause, onPrev, onNext, onSeek, onCycleRepeat, onEqPresetChange, onVolumeChange };
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
        eqPreset="Off"
        volume={1}
        onPlayPause={onPlayPause}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onSeek={vi.fn()}
        onCycleRepeat={vi.fn()}
        onEqPresetChange={vi.fn()}
        onVolumeChange={vi.fn()}
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
        eqPreset="Off"
        volume={1}
        onPlayPause={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onSeek={vi.fn()}
        onCycleRepeat={onCycleRepeat}
        onEqPresetChange={vi.fn()}
        onVolumeChange={vi.fn()}
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

  it('EQ button opens a popover with all 5 presets and fires onEqPresetChange', () => {
    const song = makeSong();
    const { onEqPresetChange } = renderPlayerBar({ song });

    const eqButton = screen.getByRole('button', { name: 'Equalizer' });
    fireEvent.click(eqButton);

    // Popover should list all five presets
    const popoverButtons = screen.getAllByRole('button').filter(
      (b) => ['Off', 'Bass Boost', 'Vocal Boost', 'Treble Boost', 'Acoustic'].includes(
        b.textContent ?? '',
      ),
    );
    expect(popoverButtons).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Bass Boost' }));
    expect(onEqPresetChange).toHaveBeenCalledWith('Bass Boost');
  });

  it('EQ button has the amber tint when a non-Off preset is active', () => {
    const song = makeSong();
    renderPlayerBar({ song, eqPreset: 'Bass Boost' });
    const eqButton = screen.getByRole('button', { name: 'Equalizer' });
    expect(eqButton).toHaveClass('text-amber');
  });

  it('visualizer caps at 15 bars regardless of input length', () => {
    const song = makeSong();
    // 30 values -> should only render 15 bars
    const longData = Array.from({ length: 30 }, (_, i) => i * 8);
    const { container } = renderPlayerBar({ song, visualizerData: longData });
    const bars = container.querySelectorAll('.bg-gradient-to-t.from-coral');
    expect(bars).toHaveLength(15);
  });

  it('does not render PiP button when supportsPip is false', () => {
    renderPlayerBar({ song: makeSong(), supportsPip: false });
    expect(screen.queryByRole('button', { name: 'Picture-in-Picture' })).not.toBeInTheDocument();
  });

  it('renders PiP button when supportsPip is true', () => {
    renderPlayerBar({ song: makeSong(), supportsPip: true });
    expect(screen.getByRole('button', { name: 'Picture-in-Picture' })).toBeInTheDocument();
  });

  it('fires onTogglePip when PiP button is clicked', () => {
    const onTogglePip = vi.fn();
    renderPlayerBar({ song: makeSong(), supportsPip: true, onTogglePip });
    fireEvent.click(screen.getByRole('button', { name: 'Picture-in-Picture' }));
    expect(onTogglePip).toHaveBeenCalledOnce();
  });

  it('volume slider fires onVolumeChange when moved', () => {
    const { onVolumeChange } = renderPlayerBar({ song: makeSong(), volume: 1 });
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '50' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.5);
  });

  it('mute button toggles to 0 when volume > 0', () => {
    const { onVolumeChange } = renderPlayerBar({ song: makeSong(), volume: 0.8 });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onVolumeChange).toHaveBeenCalledWith(0);
  });

  it('mute button restores previous volume when muted', () => {
    const { onVolumeChange } = renderPlayerBar({ song: makeSong(), volume: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    // Restores to the default lastVolumeRef (1 on first mount with volume=0)
    expect(onVolumeChange).toHaveBeenCalledWith(1);
  });
});
