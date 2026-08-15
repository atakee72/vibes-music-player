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

type FakeGain = ReturnType<typeof makeGain>;
/** Every gain node the fake context has handed out, in creation order. */
let createdGains: FakeGain[] = [];

function makeGain() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      setValueCurveAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
  };
}

/**
 * Gains are created in a fixed order by the mount effect:
 * chain A's ReplayGain, chain A's fade, chain B's ReplayGain, chain B's fade,
 * then the master mixer. Named accessors keep the tests readable.
 */
const gains = {
  get rgA() {
    return createdGains[0];
  },
  get fadeA() {
    return createdGains[1];
  },
  get rgB() {
    return createdGains[2];
  },
  get fadeB() {
    return createdGains[3];
  },
  get mixer() {
    return createdGains[4];
  },
};

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
    const g = makeGain();
    createdGains.push(g);
    return g as unknown as GainNode;
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
  createdGains = [];
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

type HarnessSong = ReturnType<typeof makeSong> | null;

function TestHarness({
  song,
  nextSong = null,
  crossfadeSeconds = 0,
  onEnded,
}: {
  song: HarnessSong;
  nextSong?: HarnessSong;
  crossfadeSeconds?: number;
  onEnded?: () => void;
}) {
  const engine = useAudioEngine({ song, nextSong, crossfadeSeconds, onEnded });
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

/**
 * Drive the engine's `timeupdate` handler at a chosen position. `duration` is
 * readonly on the real element, so both are defined onto the instance.
 */
function fireTimeUpdate(
  audio: HTMLAudioElement,
  { currentTime, duration }: { currentTime: number; duration: number },
) {
  Object.defineProperty(audio, 'duration', { value: duration, configurable: true });
  Object.defineProperty(audio, 'currentTime', { value: currentTime, configurable: true });
  audio.dispatchEvent(new Event('timeupdate'));
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

describe('useAudioEngine — crossfade', () => {
  // Only setTimeout is faked: the engine drives the visualizer with
  // requestAnimationFrame, and faking that would spin forever on advance.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render at song A with B queued next, then run A to the fade point. */
  async function renderAtFadePoint(crossfadeSeconds: number, onEnded?: () => void) {
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    const view = render(
      <TestHarness
        song={songA}
        nextSong={songB}
        crossfadeSeconds={crossfadeSeconds}
        onEnded={onEnded}
      />,
    );
    await act(async () => {});

    const audioA = engineRef.current!.audioRefA.current!;
    await act(async () => {
      fireTimeUpdate(audioA, { currentTime: 175, duration: 180 });
    });
    return { view, songA, songB, audioA, audioB: engineRef.current!.audioRefB.current! };
  }

  it('does not crossfade when the duration is 0 (off)', async () => {
    const onEnded = vi.fn();
    await renderAtFadePoint(0, onEnded);

    expect(gains.fadeA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(gains.fadeB.gain.setValueCurveAtTime).not.toHaveBeenCalled();
    // The old gapless path is untouched: advance still happens on `ended`.
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('ramps both fade nodes and advances exactly once', async () => {
    const onEnded = vi.fn();
    const { audioB } = await renderAtFadePoint(6, onEnded);

    expect(gains.fadeA.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    expect(gains.fadeB.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    // The incoming element was started.
    expect(audioB.play).toHaveBeenCalled();
  });

  it('ramps the ReplayGain node for NEITHER chain (fades use their own node)', async () => {
    await renderAtFadePoint(6);

    expect(gains.rgA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(gains.rgB.gain.setValueCurveAtTime).not.toHaveBeenCalled();
  });

  it('does not crossfade into itself (repeat-one replays in place)', async () => {
    const song = makeSong({ title: 'Loop' });
    const onEnded = vi.fn();
    render(
      <TestHarness song={song} nextSong={song} crossfadeSeconds={6} onEnded={onEnded} />,
    );
    await act(async () => {});

    await act(async () => {
      fireTimeUpdate(engineRef.current!.audioRefA.current!, {
        currentTime: 175,
        duration: 180,
      });
    });

    expect(gains.fadeA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  // A setValueCurveAtTime locks its param: a bare setValueAtTime inside the
  // curve window throws NotSupportedError in a real browser. Pausing mid-fade
  // hits exactly that path, so it must degrade rather than blow up the click.
  it('survives a param that rejects setValueAtTime mid-curve', async () => {
    await renderAtFadePoint(6);

    gains.fadeA.gain.setValueAtTime.mockImplementation(() => {
      throw new DOMException('locked by a curve', 'NotSupportedError');
    });

    expect(() => act(() => engineRef.current!.togglePlayPause())).not.toThrow();
    // Fell back to the direct assignment rather than leaving the gain at 0.
    expect(gains.fadeA.gain.value).toBe(1);
  });

  it('does not crossfade a track shorter than twice the fade', async () => {
    const songA = makeSong({ title: 'Short' });
    const songB = makeSong({ title: 'Next' });
    render(<TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} />);
    await act(async () => {});

    await act(async () => {
      fireTimeUpdate(engineRef.current!.audioRefA.current!, {
        currentTime: 5,
        duration: 10,
      });
    });

    expect(gains.fadeA.gain.setValueCurveAtTime).not.toHaveBeenCalled();
  });

  // Regression: a guard keyed on "the src that last crossfaded" would skip the
  // fade when a song comes back around. The in-flight ref must not do that.
  it('crossfades again when returning to a song already faded from (A → B → A)', async () => {
    const onEnded = vi.fn();
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });

    const { rerender } = render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} onEnded={onEnded} />,
    );
    await act(async () => {});

    // First fade: A (element A) → B (element B). The active element flips.
    await act(async () => {
      fireTimeUpdate(engineRef.current!.audioRefA.current!, {
        currentTime: 175,
        duration: 180,
      });
    });
    expect(onEnded).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // Same engine instance — advance the app to B, with A queued up again.
    rerender(
      <TestHarness song={songB} nextSong={songA} crossfadeSeconds={6} onEnded={onEnded} />,
    );
    await act(async () => {});

    // B is now playing on ELEMENT B, so that's the one driving timeupdate.
    await act(async () => {
      fireTimeUpdate(engineRef.current!.audioRefB.current!, {
        currentTime: 175,
        duration: 180,
      });
    });

    expect(onEnded).toHaveBeenCalledTimes(2);
    // Both directions ran: each fade node has now driven one fade-in and one
    // fade-out, which a src-keyed re-entry guard would have prevented.
    expect(gains.fadeA.gain.setValueCurveAtTime).toHaveBeenCalledTimes(2);
    expect(gains.fadeB.gain.setValueCurveAtTime).toHaveBeenCalledTimes(2);
  });

  // Regression: onEnded → playNext → the nextSong memo recomputes → the
  // inactive-chain ReplayGain effect fires. "Inactive" is the chain still
  // fading OUT, so writing to it would jump the outgoing track's level
  // mid-transition.
  it('defers the inactive-chain ReplayGain write while that chain is still fading', async () => {
    const songA = makeSong({ title: 'A' });
    const songB = makeSong({ title: 'B' });
    const songC = makeSong({ title: 'C', replayGainDb: -9 });

    const { rerender } = render(
      <TestHarness song={songA} nextSong={songB} crossfadeSeconds={6} />,
    );
    await act(async () => {});

    await act(async () => {
      fireTimeUpdate(engineRef.current!.audioRefA.current!, {
        currentTime: 175,
        duration: 180,
      });
    });

    const callsWhileFading = gains.rgA.gain.setValueAtTime.mock.calls.length;
    rerender(<TestHarness song={songB} nextSong={songC} crossfadeSeconds={6} />);
    await act(async () => {});

    expect(gains.rgA.gain.setValueAtTime.mock.calls.length).toBe(callsWhileFading);

    // ...and it lands once the fade finishes and the chain is silent.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(gains.rgA.gain.setValueAtTime.mock.calls.length).toBeGreaterThan(callsWhileFading);
  });
});

describe('useAudioEngine — sleep fade', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ramps the mixer and pauses when the fade completes', async () => {
    render(<TestHarness song={makeSong()} />);
    await act(async () => {});
    const pauseSpy = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;
    const pausesBefore = pauseSpy.mock.calls.length;

    act(() => engineRef.current!.fadeOutAndPause(10));
    expect(gains.mixer.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    expect(pauseSpy.mock.calls.length).toBe(pausesBefore);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(pauseSpy.mock.calls.length).toBeGreaterThan(pausesBefore);
  });

  it('restores the mixer and never pauses when cancelled mid-fade', async () => {
    render(<TestHarness song={makeSong()} />);
    await act(async () => {});
    const pauseSpy = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;
    const pausesBefore = pauseSpy.mock.calls.length;

    act(() => engineRef.current!.fadeOutAndPause(10));
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    act(() => engineRef.current!.cancelSleepFade());

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(pauseSpy.mock.calls.length).toBe(pausesBefore);
    expect(gains.mixer.gain.cancelScheduledValues).toHaveBeenCalled();
  });
});
