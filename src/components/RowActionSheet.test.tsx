import { render, screen, fireEvent } from '@testing-library/react';
import { RowActionSheet } from './RowActionSheet';
import { makeSong } from '../test-utils';

function renderSheet(overrides = {}) {
  const onPlayNext = vi.fn();
  const onAddToQueue = vi.fn();
  const onToggleFavorite = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <RowActionSheet
      song={null}
      onPlayNext={onPlayNext}
      onAddToQueue={onAddToQueue}
      onToggleFavorite={onToggleFavorite}
      onDelete={onDelete}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onPlayNext, onAddToQueue, onToggleFavorite, onDelete, onClose };
}

describe('RowActionSheet', () => {
  it('renders nothing when song is null', () => {
    renderSheet();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the header and four actions when a song is set', () => {
    renderSheet({ song: makeSong({ title: 'Alpha', artist: 'Artist X' }) });
    expect(screen.getByRole('dialog', { name: 'Actions for Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Artist X')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Favorites' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('each action fires its callback with the song id and closes the sheet', () => {
    const song = makeSong({ title: 'Alpha' });
    const { onPlayNext, onAddToQueue, onDelete, onClose } = renderSheet({ song });
    fireEvent.click(screen.getByRole('button', { name: 'Play next' }));
    expect(onPlayNext).toHaveBeenCalledWith(song.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(onAddToQueue).toHaveBeenCalledWith(song.id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(song.id);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('favorite item reflects state via label and aria-pressed, and fires the toggle', () => {
    const fav = makeSong({ title: 'Bravo', favorite: true });
    const { onToggleFavorite } = renderSheet({ song: fav });
    const btn = screen.getByRole('button', { name: 'Remove from Favorites' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggleFavorite).toHaveBeenCalledWith(fav.id);
  });

  it('backdrop click closes', () => {
    const { onClose } = renderSheet({ song: makeSong() });
    fireEvent.click(document.querySelector('[data-sheet-backdrop]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes', () => {
    const { onClose } = renderSheet({ song: makeSong() });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
