export const EQ_FREQS = [60, 230, 910, 3600, 14000] as const;

export type EqPreset = 'Off' | 'Bass Boost' | 'Vocal Boost' | 'Treble Boost' | 'Acoustic';

export const EQ_PRESETS: Record<EqPreset, number[]> = {
  Off: [0, 0, 0, 0, 0],
  'Bass Boost': [8, 5, 0, 0, 0],
  'Vocal Boost': [-2, 0, 5, 6, 1],
  'Treble Boost': [0, 0, 0, 5, 7],
  Acoustic: [5, 3, -2, 4, 5],
};

export const EQ_PRESET_NAMES: EqPreset[] = [
  'Off',
  'Bass Boost',
  'Vocal Boost',
  'Treble Boost',
  'Acoustic',
];

/**
 * Apply a preset's dB gains to a chain of 5 BiquadFilters.
 * Uses `setValueAtTime(value, ctxTime)` for sample-accurate updates.
 */
export function applyPreset(
  filters: BiquadFilterNode[],
  preset: EqPreset,
  ctxTime: number,
): void {
  const gains = EQ_PRESETS[preset];
  for (let i = 0; i < filters.length && i < gains.length; i += 1) {
    filters[i].gain.setValueAtTime(gains[i], ctxTime);
  }
}
