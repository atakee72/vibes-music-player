import { render, screen } from '@testing-library/react';
import { ScrollingText } from './ScrollingText';

describe('ScrollingText', () => {
  it('renders the text', () => {
    render(<ScrollingText text="Felekten Saadet Çalınmaz" />);
    expect(screen.getByText('Felekten Saadet Çalınmaz')).toBeInTheDocument();
  });

  it('renders a single copy when it fits (happy-dom has no layout → no overflow)', () => {
    // happy-dom reports scrollWidth/clientWidth as 0, so the marquee (which would
    // duplicate the text) never engages — exactly one node carries the text.
    const { container } = render(<ScrollingText text="Short" />);
    const matches = [...container.querySelectorAll('span')].filter((s) => s.textContent === 'Short');
    expect(matches).toHaveLength(1);
  });

  it('passes className through to the container', () => {
    const { container } = render(<ScrollingText text="x" className="font-display" />);
    expect(container.firstChild).toHaveClass('font-display', 'overflow-hidden');
  });
});
