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
    // Active line scales up as it scrolls into focus (motion-safe gated).
    expect(screen.getByText('Active')).toHaveClass('motion-safe:scale-105');
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

  it('shows a "Find lyrics" button in the empty state when onFetch is given', () => {
    const onFetch = vi.fn();
    renderPanel({ onFetch });
    fireEvent.click(screen.getByRole('button', { name: 'Find lyrics' }));
    expect(onFetch).toHaveBeenCalledOnce();
  });

  it('shows the searching state and any fetch error', () => {
    renderPanel({ onFetch: vi.fn(), fetching: true });
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    renderPanel({ onFetch: vi.fn(), fetchError: 'No lyrics found.' });
    expect(screen.getByText('No lyrics found.')).toBeInTheDocument();
  });

  it('has no Find-lyrics button without onFetch (default)', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Find lyrics' })).not.toBeInTheDocument();
  });

  it('seeks to a line\'s timestamp when a synced line is clicked', () => {
    const onSeek = vi.fn();
    const lyrics: LyricLine[] = [
      { time: 0, text: 'First' },
      { time: 12.5, text: 'Second' },
    ];
    renderPanel({ lyrics, onSeek });
    fireEvent.click(screen.getByText('Second'));
    expect(onSeek).toHaveBeenCalledWith(12.5);
  });

  it('does not make lines clickable without onSeek', () => {
    const lyrics: LyricLine[] = [
      { time: 0, text: 'First' },
      { time: 5, text: 'Second' },
    ];
    renderPanel({ lyrics });
    expect(screen.getByText('Second')).not.toHaveAttribute('role', 'button');
  });
});
