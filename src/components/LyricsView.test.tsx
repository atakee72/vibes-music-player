import { render, screen, fireEvent } from '@testing-library/react';
import { LyricsView } from './LyricsView';

describe('LyricsView', () => {
  it('offers a fetch button when there are no lyrics', () => {
    const onFetch = vi.fn();
    render(<LyricsView lyrics={undefined} currentTime={0} onFetch={onFetch} />);

    expect(screen.getByText('No lyrics available for this track.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Find lyrics' }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it('renders an unsynced block as plain text', () => {
    render(<LyricsView lyrics={[{ time: 0, text: 'one\ntwo' }]} currentTime={0} />);
    // getByText's default normalizer collapses whitespace (incl. newlines) in the
    // DOM text before comparing, but does not normalize the string matcher — so a
    // literal 'one\ntwo' string can never match. Assert on textContent directly to
    // verify the newline is actually preserved (this component renders it via
    // `whitespace-pre-wrap`).
    expect(
      screen.getByText((_, node) => node?.textContent === 'one\ntwo', { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('seeks to a line when synced lyrics are clicked', () => {
    const onSeek = vi.fn();
    render(
      <LyricsView
        lyrics={[
          { time: 0, text: 'first' },
          { time: 10, text: 'second' },
        ]}
        currentTime={0}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByText('second'));
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it('does not make lines clickable without onSeek', () => {
    render(
      <LyricsView
        lyrics={[
          { time: 0, text: 'first' },
          { time: 10, text: 'second' },
        ]}
        currentTime={0}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
