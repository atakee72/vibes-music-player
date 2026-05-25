import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import { useAudioEngine } from './useAudioEngine';
import { makeSong } from '../test-utils';

// ---- AudioContext mock ------------------------------------------------------
// Tracks construction count + createMediaElementSource calls for the regression
// test ("multi-song bug fix"): exactly 1 context + 2 sources should ever exist
// regardless of how many times `song` changes.

let ctxConstructCount = 0;
let mediaSourceCount = 0;
const lastCtx = { close: vi.fn(), resume: vi.fn(), state: 'running' as AudioContextState };

function makeFilter() {
  return {
    type: '' as BiquadFilterType,
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0, setValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
}

function makeGain() {
  return {
    gain: { value: 1, setValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
}

function makeAnalyser() {
  return {
    fftSize: 0,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
  };
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = { connect: vi.fn() };
  close = lastCtx.close;
  resume = lastCtx.resume;

  constructor() {
    ctxConstructCount += 1;
  }
  createMediaElementSource() {
    mediaSourceCount += 1;
    return { connect: vi.fn() } as unknown as MediaElementAudioSourceNode;
  }
  createGain() {
    return makeGain() as unknown as GainNode;
  }
  createBiquadFilter() {
    return makeFilter() as unknown as BiquadFilterNode;
  }
  createAnalyser() {
    return makeAnalyser() as unknown as AnalyserNode;
  }
}

beforeEach(() => {
  ctxConstructCount = 0;
  mediaSourceCount = 0;
  lastCtx.close.mockReset().mockReturnValue(Promise.resolve());
  lastCtx.resume.mockReset().mockReturnValue(Promise.resolve());
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('webkitAudioContext', FakeAudioContext);
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Expose the hook's result so tests can call methods on it
type EngineResult = ReturnType<typeof useAudioEngine>;
const engineRef: { current: EngineResult | null } = { current: null };

function TestHarness({ song }: { song: ReturnType<typeof makeSong> | null }) {
  const engine = useAudioEngine({ song });
  useEffect(() => {
    engineRef.current = engine;
  });
  return (
    <>
      <audio ref={engine.audioRefA} />
      <audio ref={engine.audioRefB} />
    </>
  );
}

describe('useAudioEngine', () => {
  it('regression: creates exactly 1 AudioContext and 2 MediaElementSources across 3 song changes', async () => {
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    const songC = makeSong({ title: 'C' });

    const { rerender, unmount } = render(<TestHarness song={songA} />);
    await act(async () => {});

    rerender(<TestHarness song={songB} />);
    await act(async () => {});
    rerender(<TestHarness song={songC} />);
    await act(async () => {});

    expect(ctxConstructCount).toBe(1);
    expect(mediaSourceCount).toBe(2);

    unmount();
  });

  it('togglePlayPause calls play() on the active audio when paused', async () => {
    render(<TestHarness song={makeSong()} />);
    await act(async () => {});
    const playSpy = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
    const callsBefore = playSpy.mock.calls.length;

    Object.defineProperty(engineRef.current!.audioRefA.current, 'paused', {
      value: true,
      configurable: true,
    });

    act(() => engineRef.current!.togglePlayPause());
    expect(playSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
