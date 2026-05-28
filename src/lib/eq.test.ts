import { EQ_PRESETS, EQ_PRESET_NAMES, applyPreset } from './eq';

describe('EQ presets', () => {
  it('every named preset has exactly 5 band gains', () => {
    for (const name of EQ_PRESET_NAMES) {
      expect(EQ_PRESETS[name]).toHaveLength(5);
    }
  });

  it('"Off" is all zeros', () => {
    expect(EQ_PRESETS.Off).toEqual([0, 0, 0, 0, 0]);
  });

  it('applyPreset calls setValueAtTime on each filter with the preset gain at ctxTime', () => {
    const filters = Array.from({ length: 5 }, () => ({
      gain: { setValueAtTime: vi.fn() },
    })) as unknown as BiquadFilterNode[];

    applyPreset(filters, 'Bass Boost', 1.234);

    expect(filters[0].gain.setValueAtTime).toHaveBeenCalledWith(8, 1.234);
    expect(filters[1].gain.setValueAtTime).toHaveBeenCalledWith(5, 1.234);
    expect(filters[2].gain.setValueAtTime).toHaveBeenCalledWith(0, 1.234);
    expect(filters[3].gain.setValueAtTime).toHaveBeenCalledWith(0, 1.234);
    expect(filters[4].gain.setValueAtTime).toHaveBeenCalledWith(0, 1.234);
  });
});
