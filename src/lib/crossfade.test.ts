import { CROSSFADE_OPTIONS, fadeCurve, formatCrossfade } from './crossfade';

describe('fadeCurve', () => {
  it('has exact endpoints (0→1 in, 1→0 out)', () => {
    const fadeIn = fadeCurve('in');
    const fadeOut = fadeCurve('out');

    expect(fadeIn[0]).toBeCloseTo(0, 6);
    expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
    expect(fadeOut[0]).toBeCloseTo(1, 6);
    expect(fadeOut[fadeOut.length - 1]).toBeCloseTo(0, 6);
  });

  it('is monotonic in both directions', () => {
    const fadeIn = fadeCurve('in');
    const fadeOut = fadeCurve('out');

    for (let i = 1; i < fadeIn.length; i += 1) {
      expect(fadeIn[i]).toBeGreaterThanOrEqual(fadeIn[i - 1]);
      expect(fadeOut[i]).toBeLessThanOrEqual(fadeOut[i - 1]);
    }
  });

  // The whole point of equal power: two uncorrelated signals sum in POWER, so
  // the SQUARES must sum to 1 at every sample. A linear pair sums to 1 in
  // amplitude but dips to 0.5 in power at the midpoint — the audible hole.
  it('keeps constant power across the transition (squares sum to 1)', () => {
    const fadeIn = fadeCurve('in');
    const fadeOut = fadeCurve('out');

    for (let i = 0; i < fadeIn.length; i += 1) {
      expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 5);
    }
  });

  it('rejects the linear alternative it exists to replace', () => {
    // Guards the property above from being "fixed" into a linear ramp: a
    // linear pair is exactly 0.5 in power at the midpoint.
    const samples = 65;
    const mid = Math.floor(samples / 2);
    const linearIn = mid / (samples - 1);
    const linearOut = 1 - linearIn;
    expect(linearIn ** 2 + linearOut ** 2).toBeCloseTo(0.5, 5);

    const equalPower = fadeCurve('in', samples)[mid] ** 2 + fadeCurve('out', samples)[mid] ** 2;
    expect(equalPower).toBeCloseTo(1, 5);
  });

  it('honours a custom sample count', () => {
    expect(fadeCurve('in', 8)).toHaveLength(8);
  });
});

describe('CROSSFADE_OPTIONS', () => {
  it('starts at Off and ascends', () => {
    expect(CROSSFADE_OPTIONS[0]).toBe(0);
    const ascending = [...CROSSFADE_OPTIONS].every(
      (v, i, arr) => i === 0 || v > arr[i - 1],
    );
    expect(ascending).toBe(true);
  });
});

describe('formatCrossfade', () => {
  it('labels 0 as Off and everything else in seconds', () => {
    expect(formatCrossfade(0)).toBe('Off');
    expect(formatCrossfade(6)).toBe('6s');
  });
});
