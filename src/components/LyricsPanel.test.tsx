import { render, screen, fireEvent } from '@testing-library/react';
import { LyricsPanel } from './LyricsPanel';
import type { LyricLine } from '../types';

function renderPanel(overrides: Partial<Parameters<typeof LyricsPanel>[0]> = {}) {
  const onClose = vi.fn();
  const defaults = {
    lyrics: undefined as LyricLine[] | undefined,
    currentTime: 0,
    onClose,
  };
  const utils = render(<LyricsPanel {...defaults} {...overrides} />);
  return { ...utils, onClose };
}

describe('LyricsPanel', () => {
  it('shows placeholder when no lyrics', () => {
    renderPanel();
    expect(screen.getByText('No lyrics available for this track.')).toBeInTheDocument();
  });

  it('shows placeholder when lyrics is empty array', () => {
    renderPanel({ lyrics: [] });
    expect(screen.getByText('No lyrics available for this track.')).toBeInTheDocument();
  });

  it('renders synced lyric lines', () => {
    const lyrics: LyricLine[] = [
      { time: 0, text: 'First line' },
      { time: 5, text: 'Second line' },
    ];
    renderPanel({ lyrics });
    expect(screen.getByText('First line')).toBeInTheDocument();
    expect(screen.getByText('Second line')).toBeInTheDocument();
  });

  it('highlights the active line', () => {
    const lyrics: LyricLine[] = [
      { time: 0, text: 'Inactive' },
      { time: 5, text: 'Active' },
      { time: 10, text: 'Future' },
    ];
    renderPanel({ lyrics, currentTime: 7 });
    expect(screen.getByText('Active')).toHaveClass('text-amber');
    expect(screen.getByText('Inactive')).toHaveClass('text-white/40');
  });

  it('renders unsynced lyrics as a text block', () => {
    const lyrics: LyricLine[] = [{ time: 0, text: 'Full song\nlyrics here' }];
    renderPanel({ lyrics });
    expect(screen.getByText(/Full song/)).toBeInTheDocument();
  });

  it('fires onClose when close button is clicked', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByLabelText('Close lyrics'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
