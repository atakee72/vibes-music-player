import { render, screen, fireEvent } from '@testing-library/react';
import { Share2, RefreshCw } from 'lucide-react';
import { HeaderMenu, type HeaderAction } from './HeaderMenu';

const actions: HeaderAction[] = [
  { key: 'share', label: 'Share', icon: Share2, onClick: vi.fn() },
  { key: 'refresh', label: 'Refresh library', icon: RefreshCw, onClick: vi.fn() },
];

describe('HeaderMenu', () => {
  it('renders nothing when there are no actions', () => {
    const { container } = render(<HeaderMenu actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed until the ⋯ button is clicked', () => {
    render(<HeaderMenu actions={actions} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Share/ })).toBeInTheDocument();
  });

  it('fires the action and closes the menu when an item is clicked', () => {
    const onClick = vi.fn();
    render(<HeaderMenu actions={[{ key: 'share', label: 'Share', icon: Share2, onClick }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Share/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu and refocuses the trigger', () => {
    render(<HeaderMenu actions={[{ key: 'share', label: 'Share', icon: Share2, onClick: vi.fn() }]} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
