import { render } from '@testing-library/react';
import { VibeOrb } from './VibeOrb';

describe('VibeOrb', () => {
  it('renders the cover art as an <img> when provided', () => {
    const { container } = render(
      <VibeOrb coverArt="blob:cover" isPlaying={false} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:cover');
    // Cross-dissolves in on track change (motion-safe so reduced-motion skips it).
    expect(img).toHaveClass('motion-safe:animate-fade-in');
  });

  it('renders the generative gradient fallback when there is no cover art', () => {
    const { container } = render(<VibeOrb isPlaying={false} />);
    expect(container.querySelector('img')).toBeNull();
    // The fallback disc uses an inline radial-gradient background.
    expect(container.innerHTML).toContain('radial-gradient');
  });

  it('animates (breathe + spin) only while playing', () => {
    const { container, rerender } = render(<VibeOrb isPlaying={false} />);
    expect(container.innerHTML).not.toContain('animate-spin-slow');
    expect(container.innerHTML).not.toContain('animate-breathe');

    rerender(<VibeOrb isPlaying={true} />);
    expect(container.innerHTML).toContain('motion-safe:animate-spin-slow');
    expect(container.innerHTML).toContain('motion-safe:animate-breathe');
  });
});
