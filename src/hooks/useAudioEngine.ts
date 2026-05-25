import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../types';

const EQ_FREQS = [60, 230, 910, 3600, 14000] as const;

interface Chain {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
}

interface UseAudioEngineArgs {
  song: Song | null;
  onEnded?: () => void;
}

interface UseAudioEngineResult {
  audioRefA: React.RefObject<HTMLAudioElement>;
  audioRefB: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  visualizerData: number[];
  togglePlayPause: () => void;
  seek: (t: number) => void;
}

/**
 * Single-AudioContext audio engine with two `<audio>` elements (audioA active,
 * audioB reserved for gapless preload — wired in Phase 3 commit b).
 *
 * Fixes the multi-song visualizer bug from the original App.tsx: previously
 * each song-change rebuilt the AudioContext and called createMediaElementSource
 * on the same element a second time, which throws InvalidStateError and silently
 * broke the analyser from song 2 onward.
 *
 * Architecture (per element):
 *   audio → MediaElementSource → [5 BiquadFilters, flat] → GainNode → mixer
 *                                                                       ↓
 *                                                              analyser → destination
 */
export function useAudioEngine({ song, onEnded }: UseAudioEngineArgs): UseAudioEngineResult {
  const audioRefA = useRef<HTMLAudioElement>(null);
  const audioRefB = useRef<HTMLAudioElement>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const chainARef = useRef<Chain | null>(null);
  const chainBRef = useRef<Chain | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef<'A' | 'B'>('A');
  const rafRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>([]);

  // Keep onEnded ref fresh without re-running setup
  useEffect(() => {
    onEndedRef.current = onEnded;
  });

  // ---- Mount: build the entire graph exactly once ----
  // Skip re-init via ctxRef guard: React 18 StrictMode runs effects twice in dev,
  // and createMediaElementSource permanently marks the audio element — second call
  // throws InvalidStateError. We let the AudioContext live for the page's lifetime;
  // browser cleans it up on tab close. No cleanup function.
  useEffect(() => {
    if (ctxRef.current) return;
    const audioA = audioRefA.current;
    const audioB = audioRefB.current;
    if (!audioA || !audioB) return;

    let ctx: AudioContext;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    } catch (err) {
      console.error('AudioContext init failed:', err);
      return;
    }
    ctxRef.current = ctx;

    const buildChain = (audio: HTMLAudioElement): Chain => {
      const source = ctx.createMediaElementSource(audio);
      const filters = EQ_FREQS.map((freq) => {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1;
        f.gain.value = 0;
        return f;
      });
      const gain = ctx.createGain();
      gain.gain.value = 1;

      source.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);
      filters[filters.length - 1].connect(gain);

      return { source, filters, gain };
    };

    const chainA = buildChain(audioA);
    const chainB = buildChain(audioB);
    chainARef.current = chainA;
    chainBRef.current = chainB;

    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    chainA.gain.connect(mixer);
    chainB.gain.connect(mixer);
    mixer.connect(analyser);
    analyser.connect(ctx.destination);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setVisualizerData(Array.from(data));
      rafRef.current = requestAnimationFrame(tick);
    };

    const activeAudio = () => (activeRef.current === 'A' ? audioA : audioB);

    const onPlay = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setIsPlaying(true);
      if (rafRef.current === null) tick();
    };
    const onPause = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setIsPlaying(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onAudioEnded = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setIsPlaying(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      onEndedRef.current?.();
    };
    const onTime = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setCurrentTime((e.target as HTMLAudioElement).currentTime);
    };
    const onLoaded = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setDuration((e.target as HTMLAudioElement).duration);
    };

    for (const audio of [audioA, audioB]) {
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onAudioEnded);
      audio.addEventListener('timeupdate', onTime);
      audio.addEventListener('loadedmetadata', onLoaded);
    }

    // No cleanup — see comment above the effect.
  }, []);

  // ---- Song change: load on active element and play ----
  useEffect(() => {
    const ctx = ctxRef.current;
    const activeAudio =
      activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!ctx || !activeAudio) return;

    if (!song) {
      audioRefA.current?.pause();
      audioRefB.current?.pause();
      return;
    }

    activeAudio.src = song.url;
    activeAudio.load();
    (async () => {
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // ignore — will retry next user gesture
        }
      }
      activeAudio.play().catch(console.error);
    })();
  }, [song]);

  const togglePlayPause = useCallback(() => {
    const activeAudio =
      activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (!activeAudio) return;
    if (activeAudio.paused) {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().finally(() => activeAudio.play().catch(console.error));
      } else {
        activeAudio.play().catch(console.error);
      }
    } else {
      activeAudio.pause();
    }
  }, []);

  const seek = useCallback((t: number) => {
    const activeAudio =
      activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
    if (activeAudio) activeAudio.currentTime = t;
  }, []);

  return {
    audioRefA,
    audioRefB,
    currentTime,
    duration,
    isPlaying,
    visualizerData,
    togglePlayPause,
    seek,
  };
}
