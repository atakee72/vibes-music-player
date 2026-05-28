import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { Sidebar } from './Sidebar';
import { makePlaylist } from '../test-utils';

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const library = makePlaylist({ id: 'library', name: 'Library' });
  const mix = makePlaylist({ id: 'mix-1', name: 'Mix' });

  const utils = render(
    <DndContext>
      <Sidebar
        playlists={[library, mix]}
        activePlaylistId="library"
        onSelect={onSelect}
        onCreate={onCreate}
        onDelete={onDelete}
        isOpen={false}
        onClose={onClose}
        {...overrides}
      />
    </DndContext>,
  );
  return { ...utils, onSelect, onCreate, onDelete, onClose, library, mix };
}

describe('Sidebar', () => {
  it('renders the Vibes heading, New Playlist button, and each playlist name', () => {
    renderSidebar();
    expect(screen.getByRole('heading', { name: 'Vibes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Playlist' })).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Mix')).toBeInTheDocument();
  });

  it('clicking a non-active playlist row fires onSelect', () => {
    const { onSelect, mix } = renderSidebar();
    fireEvent.click(screen.getByText('Mix'));
    expect(onSelect).toHaveBeenCalledWith(mix.id);
  });

  it('auto-closes sidebar only on mobile-width viewports', () => {
    const original = window.matchMedia;
    // Mobile viewport: matches=false for "(min-width: 1024px)"
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const { onClose } = renderSidebar();
    fireEvent.click(screen.getByText('Mix'));
    expect(onClose).toHaveBeenCalledTimes(1);
    window.matchMedia = original;
  });

  it('does NOT auto-close on desktop-width viewports', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { onClose } = renderSidebar();
    fireEvent.click(screen.getByText('Mix'));
    expect(onClose).not.toHaveBeenCalled();
    window.matchMedia = original;
  });

  it('clicking a trash button on a non-library playlist fires onDelete and does NOT fire onSelect', () => {
    const { onSelect, onDelete, mix } = renderSidebar();
    const trash = screen.getByRole('button', { name: /Delete Mix/i });
    fireEvent.click(trash);
    expect(onDelete).toHaveBeenCalledWith(mix.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not render a trash button on the library row', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Delete Library/i })).not.toBeInTheDocument();
  });

  it('renders each playlist row inside a droppable wrapper (under DndContext)', () => {
    // The presence of useDroppable means each row gets a setNodeRef wrapper.
    // We assert the rows render without throwing, which is the main contract:
    // if useDroppable was outside a DndContext it would throw.
    renderSidebar();
    expect(screen.getByText('Mix')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
  });
});
