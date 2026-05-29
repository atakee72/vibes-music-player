import { render, screen, fireEvent } from '@testing-library/react';
import { SharedTrackModal } from './SharedTrackModal';
import type { SharedTrack } from '../lib/share';

const track: SharedTrack = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 354,
};

function renderModal(overrides: Partial<SharedTrack> | null = {}) {
  const onClose = vi.fn();
  const utils = render(
    <SharedTrackModal
      track={overrides === null ? null : { ...track, ...overrides }}
      onClose={onClose}
    />,
  );
  return { ...utils, onClose };
}

describe('SharedTrackModal', () => {
  it('renders nothing when track is null', () => {
    const { container } = renderModal(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the shared track metadata', () => {
    renderModal();
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Queen')).toBeInTheDocument();
    expect(screen.getByText('A Night at the Opera')).toBeInTheDocument();
  });

  it('formats the duration (5:54) in the note', () => {
    renderModal();
    expect(screen.getByText(/5:54/)).toBeInTheDocument();
  });

  it('states that audio files are never shared', () => {
    renderModal();
    expect(screen.getByText(/never shares audio files/i)).toBeInTheDocument();
  });

  it('fires onClose when the Close button is clicked', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fires onClose when the backdrop is clicked', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fires onClose when Escape is pressed', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('falls back to placeholders for empty title/artist', () => {
    renderModal({ title: '', artist: '', album: '' });
    expect(screen.getByText('Unknown title')).toBeInTheDocument();
    expect(screen.getByText('Unknown artist')).toBeInTheDocument();
  });
});
