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
});
