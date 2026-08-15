import { SLEEP_OPTIONS_MINUTES, formatRemaining } from './sleep';

describe('formatRemaining', () => {
  it('formats whole minutes', () => {
    expect(formatRemaining(15 * 60_000)).toBe('15:00');
  });

  it('pads seconds', () => {
    expect(formatRemaining(65_000)).toBe('1:05');
  });

  // Ceil, not floor: with 59.4s left the label should read 1:00 and tick down,
  // never jump to 0:59 while nearly a full second remains.
  it('rounds up partial seconds', () => {
    expect(formatRemaining(59_400)).toBe('1:00');
    expect(formatRemaining(1_200)).toBe('0:02');
  });

  it('crosses the minute boundary', () => {
    expect(formatRemaining(60_000)).toBe('1:00');
    expect(formatRemaining(59_000)).toBe('0:59');
  });

  it('clamps at zero for an overdue deadline', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5_000)).toBe('0:00');
  });
});

describe('SLEEP_OPTIONS_MINUTES', () => {
  it('ascends and holds only positive durations', () => {
    expect(SLEEP_OPTIONS_MINUTES.every((m) => m > 0)).toBe(true);
    const ascending = [...SLEEP_OPTIONS_MINUTES].every(
      (v, i, arr) => i === 0 || v > arr[i - 1],
    );
    expect(ascending).toBe(true);
  });
});
