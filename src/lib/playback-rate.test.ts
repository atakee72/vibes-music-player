import { describe, it, expect } from 'vitest';
import { RATE_OPTIONS, DEFAULT_RATE, clampRate, formatRate } from './playback-rate';

describe('clampRate', () => {
  it('passes through a rate inside the range', () => {
    expect(clampRate(1.5)).toBe(1.5);
  });

  it('clamps above the maximum', () => {
    expect(clampRate(4)).toBe(2);
  });

  it('clamps below the minimum', () => {
    expect(clampRate(0.1)).toBe(0.5);
  });

  it('rejects zero, which the browser accepts as a silent pause', () => {
    // Verified in Chromium: `audio.playbackRate = 0` does NOT throw, it just
    // stops the audio with no state change anywhere in the app — the worst
    // possible failure, because nothing looks wrong.
    expect(clampRate(0)).toBe(DEFAULT_RATE);
  });

  it('rejects a negative rate, which throws NotSupportedError on a real element', () => {
    expect(clampRate(-1)).toBe(DEFAULT_RATE);
  });

  it.each([NaN, Infinity, -Infinity])('rejects the non-finite value %p', (bad) => {
    expect(clampRate(bad)).toBe(DEFAULT_RATE);
  });

  it('coerces a non-number to the default rather than poisoning the audio element', () => {
    expect(clampRate(undefined as unknown as number)).toBe(DEFAULT_RATE);
  });
});

describe('RATE_OPTIONS', () => {
  it('spans 0.5x to 2x and includes normal speed', () => {
    expect(RATE_OPTIONS[0]).toBe(0.5);
    expect(RATE_OPTIONS[RATE_OPTIONS.length - 1]).toBe(2);
    expect(RATE_OPTIONS).toContain(DEFAULT_RATE);
  });

  it('every option survives its own clamp', () => {
    for (const r of RATE_OPTIONS) expect(clampRate(r)).toBe(r);
  });
});

describe('formatRate', () => {
  it.each([
    [1, '1x'],
    [1.5, '1.5x'],
    [0.5, '0.5x'],
    [2, '2x'],
  ])('renders %p as %s', (rate, label) => {
    expect(formatRate(rate)).toBe(label);
  });

  it('drops a trailing .0 so normal speed reads "1x", not "1.0x"', () => {
    expect(formatRate(1.0)).toBe('1x');
  });
});
