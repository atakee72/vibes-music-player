import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

function renderModal(overrides: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmModal
      open={true}
      title="Delete song?"
      message="This action cannot be undone."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe('ConfirmModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = renderModal({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders title and message when open', () => {
    renderModal();
    expect(screen.getByText('Delete song?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('fires onConfirm when confirm button is clicked', () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('fires onCancel when cancel button is clicked', () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('fires onCancel when backdrop is clicked', () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('fires onCancel when Escape is pressed', () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom confirmLabel when provided', () => {
    renderModal({ confirmLabel: 'Remove' });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('confirm button is non-destructive style when destructive=false', () => {
    renderModal({ destructive: false });
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).not.toHaveClass('bg-red-500');
  });
});
