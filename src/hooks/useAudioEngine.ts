import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { EQ_FREQS, applyPreset, type EqPreset } from '../lib/eq';

interface Chain {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
}

interface UseAudioEngineArgs {
  song: Song | null;
  nextSong?: Song | null;
  eqPreset?: EqPreset;
  volume?: number;
  onEnded?: () => void;
}

const PRELOAD_LEAD_SECONDS = 5;

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
export function useAudioEngine({
  song,
  nextSong,
  eqPreset = 'Off',
  volume = 1,
  onEnded,
}: UseAudioEngineArgs): UseAudioEngineResult {
  const audioRefA = useRef<HTMLAudioElement>(null);
  const audioRefB = useRef<HTMLAudioElement>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const chainARef = useRef<Chain | null>(null);
  const chainBRef = useRef<Chain | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef<'A' | 'B'>('A');
  const rafRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  const nextSongRef = useRef<Song | null>(nextSong ?? null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>([]);

  // Keep onEnded + nextSong refs fresh without re-running setup
  useEffect(() => {
    onEndedRef.current = onEnded;
    nextSongRef.current = nextSong ?? null;
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
      const ended = e.target as HTMLAudioElement;
      if (ended !== activeAudio()) return;

      const nextUrl = nextSongRef.current?.url;
      const inactive = activeRef.current === 'A' ? audioB : audioA;
      if (nextUrl && ended.src === nextUrl) {
        // Repeat-one (or repeat-all on a single track): the "next" song is the
        // same file already on this element. Replay it in place — flipping to
        // the inactive element would start it from its parked end position, so
        // the loop stalls after the first pass. Return WITHOUT calling onEnded:
        // no React state changes (same song), and its repeat-one branch would
        // re-pause this element via a stale-`isPlaying` toggle.
        ended.currentTime = 0;
        ended.play().catch(console.error);
        return;
      } else if (nextUrl && inactive.src === nextUrl) {
        // Gapless swap: a *different* next track is preloaded on the inactive
        // element — flip + play immediately, before notifying the app.
        activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
        inactive.play().catch(console.error);
      } else {
        setIsPlaying(false);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      }
      onEndedRef.current?.();
    };
    const onTime = (e: Event) => {
      if (e.target !== activeAudio()) return;
      setCurrentTime((e.target as HTMLAudioElement).currentTime);

      // Preload next song on the inactive element when we're near the end
      const target = e.target as HTMLAudioElement;
      const nextSong = nextSongRef.current;
      if (
        nextSong &&
        target.duration > 0 &&
        target.duration - target.currentTime < PRELOAD_LEAD_SECONDS
      ) {
        const inactive = activeRef.current === 'A' ? audioB : audioA;
        if (inactive.src !== nextSong.url) {
          inactive.src = nextSong.url;
          inactive.load();
        }
      }
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

  // ---- Song change ----
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    if (!song) {
      audioRefA.current?.pause();
      audioRefB.current?.pause();
      return;
    }

    const active = activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
    const inactive = activeRef.current === 'A' ? audioRefB.current : audioRefA.current;
    if (!active || !inactive) return;

    // Already playing this song on the active element (e.g. ended-handler
    // already did the gapless swap before this effect ran)
    if (active.src === song.url) return;

    const resumeAndPlay = async (audio: HTMLAudioElement) => {
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // ignore — retry on next user gesture
        }
      }
      audio.play().catch(console.error);
    };

    // Preloaded on inactive — flip + play
    if (inactive.src === song.url) {
      active.pause();
      activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
      resumeAndPlay(inactive);
      return;
    }

    // Random click on a non-sequential song — load on active and play
    active.src = song.url;
    active.load();
    resumeAndPlay(active);
  }, [song]);

  // ---- ReplayGain: apply per-song gain on whichever element is loading it ----
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const chain = activeRef.current === 'A' ? chainARef.current : chainBRef.current;
    if (!chain) return;
    const ratio =
      song?.replayGainDb !== undefined ? Math.pow(10, song.replayGainDb / 20) : 1;
    chain.gain.gain.setValueAtTime(ratio, ctx.currentTime);
  }, [song]);

  // Same for the inactive element when nextSong is set (so gapless swap has correct gain)
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const chain = activeRef.current === 'A' ? chainBRef.current : chainARef.current;
    if (!chain) return;
    const ratio =
      nextSong?.replayGainDb !== undefined ? Math.pow(10, nextSong.replayGainDb / 20) : 1;
    chain.gain.gain.setValueAtTime(ratio, ctx.currentTime);
  }, [nextSong]);

  // ---- EQ preset: apply to both chains ----
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (chainARef.current) applyPreset(chainARef.current.filters, eqPreset, ctx.currentTime);
    if (chainBRef.current) applyPreset(chainBRef.current.filters, eqPreset, ctx.currentTime);
  }, [eqPreset]);

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

  useEffect(() => {
    if (audioRefA.current) audioRefA.current.volume = volume;
    if (audioRefB.current) audioRefB.current.volume = volume;
  }, [volume]);

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
