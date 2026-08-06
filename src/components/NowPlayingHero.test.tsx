import { render, screen, fireEvent } from '@testing-library/react';
import { NowPlayingHero } from './NowPlayingHero';
import { makeSong } from '../test-utils';

function renderHero(overrides = {}, handlers = {}) {
  const onSeek = vi.fn();
  const onGenreClick = vi.fn();
  const onToggleFavorite = vi.fn();
  const song = makeSong({ title: 'Midnight', artist: 'Aurora', album: 'Dusk', ...overrides });
  render(
    <NowPlayingHero
      song={song}
      isPlaying={true}
      currentTime={42}
      duration={180}
      onSeek={onSeek}
      onGenreClick={onGenreClick}
      onToggleFavorite={onToggleFavorite}
      {...handlers}
    />,
  );
  return { onSeek, onGenreClick, onToggleFavorite, song };
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

  it('has no transport buttons (display-only; the heart is the sole button)', () => {
    renderHero({ genre: undefined });
    // Chip-less hero: the heart is the only button — no Play/Pause/Next/Prev.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Add to Favorites');
  });

  it('heart fires onToggleFavorite and reflects the unfavorited state', () => {
    const { onToggleFavorite } = renderHero();
    const btn = screen.getByRole('button', { name: 'Add to Favorites' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('heart shows the favorited state for a favorite song', () => {
    renderHero({ favorite: true });
    expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
