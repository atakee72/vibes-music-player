import { render, screen, fireEvent } from '@testing-library/react';
import { MobileNowPlaying } from './MobileNowPlaying';
import { makeSong } from '../test-utils';

function renderView(overrides = {}) {
  const handlers = {
    onClose: vi.fn(),
    onPlayPause: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSeek: vi.fn(),
    onCycleRepeat: vi.fn(),
    onToggleShuffle: vi.fn(),
    onEqPresetChange: vi.fn(),
    onCrossfadeChange: vi.fn(),
    onSetSleepTimer: vi.fn(),
    onVolumeChange: vi.fn(),
    onToggleLyrics: vi.fn(),
    onToggleQueue: vi.fn(),
    onShare: vi.fn(),
  };
  const utils = render(
    <MobileNowPlaying
      open
      song={makeSong({ title: 'Cemalım', artist: 'Altın Gün', album: 'On' })}
      playlistName="Library"
      isPlaying={false}
      currentTime={0}
      duration={242}
      visualizerData={[]}
      repeatMode="none"
      shuffle={false}
      eqPreset="Off"
      volume={1}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('MobileNowPlaying', () => {
  it('renders transport in shuffle · prev · play · next · repeat order', () => {
    const { container } = renderView();
    const order = Array.from(container.querySelectorAll('button'))
      .map((b) => b.getAttribute('aria-label'))
      .filter((l): l is string => !!l && /^(Shuffle|Repeat|Previous|Next|Play|Pause)/.test(l));
    expect(order).toEqual([
      'Shuffle: off',
      'Previous',
      'Play',
      'Next',
      'Repeat: none',
    ]);
  });

  it('renders nothing when closed', () => {
    const { container } = renderView({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no song', () => {
    const { container } = renderView({ song: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the track title, artist · album, and the visualizer ring', () => {
    const { container } = renderView();
    expect(screen.getByText('Cemalım')).toBeInTheDocument();
    expect(screen.getByText(/Altın Gün/)).toBeInTheDocument();
    expect(screen.getByText(/On/)).toBeInTheDocument();
    expect(container.querySelectorAll('.from-coral')).toHaveLength(48); // the ring
  });

  it('closes via the chevron', () => {
    const { onClose } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Close now playing' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wires transport + secondary controls to their callbacks', () => {
    const view = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(view.onPlayPause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle lyrics' }));
    expect(view.onToggleLyrics).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Share current track' }));
    expect(view.onShare).toHaveBeenCalledOnce();
    // EQ is a popover now (was a <select>) — same treatment volume already had,
    // so the utility row is a uniform set of round icon buttons.
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bass Boost' }));
    expect(view.onEqPresetChange).toHaveBeenCalledWith('Bass Boost');
  });

  it('audio settings popover also sets crossfade', () => {
    const view = renderView();
    expect(screen.queryByRole('menu', { name: 'Audio settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '6s' }));
    expect(view.onCrossfadeChange).toHaveBeenCalledWith(6);
  });

  it('queue button fires onToggleQueue', () => {
    const { onToggleQueue } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle queue' }));
    expect(onToggleQueue).toHaveBeenCalledTimes(1);
  });

  it('volume is a popover: closed by default, tap opens slider, change fires callback', () => {
    const { onVolumeChange } = renderView();
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volume controls' }));
    const slider = screen.getByLabelText('Volume');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.4);
  });

  it('Escape closes the volume popover and refocuses its trigger', () => {
    renderView();
    const trigger = screen.getByRole('button', { name: 'Volume controls' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByLabelText('Volume'), { key: 'Escape' });
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('spreads the utility row edge to edge rather than huddling it', () => {
    renderView();
    // The row is identified by its first child, the lyrics button — happy-dom
    // has no layout, so the class IS the assertion here. Real edge-to-edge
    // spacing is confirmed in a browser (see the plan's Verification section).
    const row = screen.getByRole('button', { name: 'Toggle lyrics' }).parentElement;
    expect(row).toHaveClass('justify-between');
    // NOT `container.querySelector('.justify-between')` — the header row at
    // :159 already carries that class and would match first.
    expect(row).toHaveClass('flex', 'items-center');
  });
});
