import { render, screen, fireEvent } from '@testing-library/react';
import { RowMenu } from './RowMenu';

function renderMenu() {
  const onPlayNext = vi.fn();
  const onAddToQueue = vi.fn();
  render(<RowMenu songTitle="Alpha" onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} />);
  return { onPlayNext, onAddToQueue };
}

describe('RowMenu', () => {
  it('menu is closed until the trigger is clicked', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Play next fires the callback and closes the menu', () => {
    const { onPlayNext } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Play next/ }));
    expect(onPlayNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Add to queue fires the callback and closes the menu', () => {
    const { onAddToQueue } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to queue/ }));
    expect(onAddToQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('outside mousedown closes the menu', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('focuses the first item on open; Escape closes and refocuses the trigger', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'More actions for Alpha' });
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('arrow keys move focus between menu items and wrap', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }));
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[1]).toHaveFocus();
  });

  it('notifies onOpenChange on trigger toggle, item click, and outside click', () => {
    const onOpenChange = vi.fn();
    render(
      <RowMenu
        songTitle="Alpha"
        onPlayNext={vi.fn()}
        onAddToQueue={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Alpha' });

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('menuitem', { name: /Play next/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
