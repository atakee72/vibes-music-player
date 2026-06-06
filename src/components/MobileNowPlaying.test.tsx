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
    onVolumeChange: vi.fn(),
    onToggleLyrics: vi.fn(),
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
    fireEvent.change(screen.getByLabelText('Equalizer preset'), {
      target: { value: 'Bass Boost' },
    });
    expect(view.onEqPresetChange).toHaveBeenCalledWith('Bass Boost');
  });
});
