import { render, screen, fireEvent } from '@testing-library/react';
import { NowPlayingHero } from './NowPlayingHero';
import { makeSong } from '../test-utils';

function renderHero(overrides = {}, handlers = {}) {
  const onSeek = vi.fn();
  const onGenreClick = vi.fn();
  const song = makeSong({ title: 'Midnight', artist: 'Aurora', album: 'Dusk', ...overrides });
  render(
    <NowPlayingHero
      song={song}
      isPlaying={true}
      currentTime={42}
      duration={180}
      onSeek={onSeek}
      onGenreClick={onGenreClick}
      {...handlers}
    />,
  );
  return { onSeek, onGenreClick, song };
}

describe('NowPlayingHero', () => {
  it('renders the title and artist · album', () => {
    renderHero();
    expect(screen.getByText('Midnight')).toBeInTheDocument();
    expect(screen.getByText(/Aurora/)).toBeInTheDocument();
    expect(screen.getByText(/Dusk/)).toBeInTheDocument();
  });

  it('shows a genre chip and a BPM chip when present', () => {
    renderHero({ genre: 'Dreampop', bpm: 124 });
    expect(screen.getByRole('button', { name: /Dreampop/ })).toBeInTheDocument();
    expect(screen.getByText('124 BPM')).toBeInTheDocument();
  });

  it('omits the BPM chip when there is no bpm', () => {
    renderHero({ genre: 'Ambient' });
    expect(screen.getByRole('button', { name: /Ambient/ })).toBeInTheDocument();
    expect(screen.queryByText(/BPM/)).not.toBeInTheDocument();
  });

  it('renders no chips when neither genre nor bpm exist', () => {
    renderHero({ genre: undefined, bpm: undefined });
    expect(screen.queryByText(/BPM/)).not.toBeInTheDocument();
  });

  it('calls onGenreClick with the genre when the chip is clicked', () => {
    const { onGenreClick } = renderHero({ genre: 'Dreampop' });
    fireEvent.click(screen.getByRole('button', { name: /Dreampop/ }));
    expect(onGenreClick).toHaveBeenCalledWith('Dreampop');
  });

  it('calls onSeek when the progress bar is clicked', () => {
    const { onSeek } = renderHero();
    // The track is the only element wired with a seek click handler.
    fireEvent.click(screen.getByText('0:42').nextElementSibling!);
    expect(onSeek).toHaveBeenCalled();
  });

  it('has no transport buttons (display-only)', () => {
    renderHero({ genre: undefined });
    // The only button in a chip-less hero would be a control; there are none.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
