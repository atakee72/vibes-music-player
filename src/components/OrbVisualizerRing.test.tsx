import { render } from '@testing-library/react';
import { OrbVisualizerRing } from './OrbVisualizerRing';

describe('OrbVisualizerRing', () => {
  it('always renders the full ring of bars (even with empty data)', () => {
    const { container } = render(<OrbVisualizerRing data={[]} isPlaying={false} />);
    expect(container.querySelectorAll('.from-coral')).toHaveLength(48);
  });

  it('bar length reflects its analyser bin while playing', () => {
    // High energy in bin 0, none in bin 1.
    const data = [255, 0];
    const { container } = render(<OrbVisualizerRing data={data} isPlaying={true} />);
    const bars = container.querySelectorAll<HTMLElement>('.from-coral');
    expect(bars[0].style.height).not.toBe(bars[1].style.height);
    // Idle bins fall back to the rest length.
    expect(bars[1].style.height).toBe('3px');
  });

  it('sits at rest (no reaction) when not playing', () => {
    const data = [255, 255];
    const { container } = render(<OrbVisualizerRing data={data} isPlaying={false} />);
    const bars = container.querySelectorAll<HTMLElement>('.from-coral');
    expect(bars[0].style.height).toBe('3px');
  });
});
