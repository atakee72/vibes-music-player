import { render, screen, fireEvent } from '@testing-library/react';
import { QueuePanel } from './QueuePanel';
import { makeSong } from '../test-utils';

function renderPanel(overrides = {}) {
  const onClose = vi.fn();
  const onRemove = vi.fn();
  const onReorder = vi.fn();
  const onClear = vi.fn();
  render(
    <QueuePanel
      currentSong={null}
      queue={[]}
      upNext={[]}
      shuffle={false}
      onClose={onClose}
      onRemove={onRemove}
      onReorder={onReorder}
      onClear={onClear}
      {...overrides}
    />,
  );
  return { onClose, onRemove, onReorder, onClear };
}

describe('QueuePanel', () => {
  it('shows the empty-queue hint when the queue is empty', () => {
    renderPanel();
    expect(screen.getByText('Queue is empty — use ⋯ on any song.')).toBeInTheDocument();
  });

  it('renders the now-playing row when a song is playing', () => {
    renderPanel({ currentSong: makeSong({ title: 'Current Jam' }) });
    expect(screen.getByText('Now playing')).toBeInTheDocument();
    expect(screen.getByText('Current Jam')).toBeInTheDocument();
  });

  it('queue rows render with remove buttons firing onRemove with the index', () => {
    const a = makeSong({ title: 'Alpha' });
    const b = makeSong({ title: 'Bravo' });
    const { onRemove } = renderPanel({ queue: [a, b] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bravo from queue' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('duplicate queue entries render one row each', () => {
    const a = makeSong({ title: 'Alpha' });
    renderPanel({ queue: [a, a] });
    expect(screen.getAllByText('Alpha')).toHaveLength(2);
  });

  it('Clear queue fires onClear', () => {
    const { onClear } = renderPanel({ queue: [makeSong()] });
    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders the up-next preview list', () => {
    renderPanel({ upNext: [makeSong({ title: 'Charlie' }), makeSong({ title: 'Delta' })] });
    expect(screen.getByText('Up next')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Delta')).toBeInTheDocument();
  });

  it('shows the shuffle note when shuffle is on', () => {
    renderPanel({ shuffle: true, upNext: [makeSong({ title: 'Next Pick' })] });
    expect(screen.getByText(/Shuffle is on/)).toBeInTheDocument();
    expect(screen.getByText('Next Pick')).toBeInTheDocument();
  });

  it('close button fires onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close queue' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
