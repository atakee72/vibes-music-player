import { render, screen, fireEvent } from '@testing-library/react';
import { LyricsSheet } from './LyricsSheet';

const lines = [
  { time: 0, text: 'first' },
  { time: 10, text: 'second' },
];

function renderSheet(overrides = {}) {
  const onClose = vi.fn();
  const utils = render(
    <LyricsSheet open onClose={onClose} lyrics={lines} currentTime={0} {...overrides} />,
  );
  return { ...utils, onClose };
}

describe('LyricsSheet', () => {
  it('renders the lyrics as a labelled complementary region', () => {
    renderSheet();
    expect(screen.getByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<LyricsSheet open={false} onClose={vi.fn()} lyrics={lines} currentTime={0} />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('closes from the close button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close lyrics' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the handle is dragged down', () => {
    const { onClose } = renderSheet();
    const handle = screen.getByTestId('lyrics-sheet-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 220 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the handle is dragged up', () => {
    const { onClose } = renderSheet();
    const handle = screen.getByTestId('lyrics-sheet-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 220 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops swallowing taps while it is mid-exit', () => {
    const { rerender } = renderSheet();

    rerender(<LyricsSheet open={false} onClose={vi.fn()} lyrics={lines} currentTime={0} />);

    // usePresence keeps the sheet mounted (translate-y-full) through its
    // ~300ms exit animation — while still mounted, it must not sit on top
    // of the transport/scrubber underneath eating taps.
    const sheet = screen.getByRole('complementary', { name: 'Lyrics' });
    expect(sheet).toHaveClass('translate-y-full');
    expect(sheet).toHaveClass('pointer-events-none');
  });
});
