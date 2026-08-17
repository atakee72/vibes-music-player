import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { EQ_FREQS, applyPreset, type EqPreset } from '../lib/eq';
import { fadeCurve } from '../lib/crossfade';

interface Chain {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  /** ReplayGain — an ABSOLUTE per-track ratio. Never ramp this for fades. */
  gain: GainNode;
  /** Crossfade envelope, 0..1. Separate node so it can't fight ReplayGain. */
  fade: GainNode;
}

/** A crossfade in flight: the element still sounding after the flip. */
interface FadingOut {
  audio: HTMLAudioElement;
  chain: Chain;
  timeoutId: number;
}

interface UseAudioEngineArgs {
  song: Song | null;
  nextSong?: Song | null;
  eqPreset?: EqPreset;
  volume?: number;
  /** Crossfade duration in seconds; 0 disables it (plain gapless). */
  crossfadeSeconds?: number;
  onEnded?: () => void;
  /**
   * "This track reached its end." Deliberately NOT the same signal as
   * `onEnded` ("app, advance your state"): they differ at repeat-one, which
   * replays in place and must NOT advance but IS a completed play. Also fires
   * at the top of a crossfade, where the DOM `ended` event never arrives
   * because the outgoing element is paused first.
   */
  onTrackFinished?: () => void;
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
  /** Ramp the master mixer to silence over `seconds`, then pause. */
  fadeOutAndPause: (seconds: number) => void;
  /** Abort a sleep fade in progress and restore full level. */
  cancelSleepFade: () => void;
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
  crossfadeSeconds = 0,
  onEnded,
  onTrackFinished,
}: UseAudioEngineArgs): UseAudioEngineResult {
  const audioRefA = useRef<HTMLAudioElement>(null);
  const audioRefB = useRef<HTMLAudioElement>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const chainARef = useRef<Chain | null>(null);
  const chainBRef = useRef<Chain | null>(null);
  const mixerRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef<'A' | 'B'>('A');
  const rafRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  const onTrackFinishedRef = useRef(onTrackFinished);
  const nextSongRef = useRef<Song | null>(nextSong ?? null);
  const crossfadeRef = useRef(crossfadeSeconds);
  /**
   * Non-null exactly while a crossfade is sounding. Doubles as the re-entry
   * guard for the trigger: no second "already faded this track" flag is
   * needed, and unlike one keyed on src it survives A → B → A.
   */
  const fadingOutRef = useRef<FadingOut | null>(null);
  const sleepFadeRef = useRef<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>([]);

  // Keep onEnded + nextSong + crossfade refs fresh without re-running setup
  useEffect(() => {
    onEndedRef.current = onEnded;
    onTrackFinishedRef.current = onTrackFinished;
    nextSongRef.current = nextSong ?? null;
    crossfadeRef.current = crossfadeSeconds;
  });

  /** ReplayGain ratio for a song (1 when the tag is absent). */
  const gainRatio = (s: Song | null | undefined) =>
    s?.replayGainDb !== undefined ? Math.pow(10, s.replayGainDb / 20) : 1;

  /**
   * Force an AudioParam to `value` immediately, even mid-fade.
   *
   * `setValueCurveAtTime` LOCKS the param for the curve's whole duration: a
   * bare `setValueAtTime` inside that window throws NotSupportedError, and
   * `cancelScheduledValues` does not remove a curve that has already started.
   * `cancelAndHoldAtTime` is the sanctioned escape but isn't universally
   * implemented — so try it, then fall back, and never let a cancel path throw
   * out of a click handler. Worst case the fade finishes on its own.
   */
  const forceGain = (param: AudioParam, ctx: AudioContext, value: number) => {
    const now = ctx.currentTime;
    try {
      (
        param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
      ).cancelAndHoldAtTime?.(now);
    } catch {
      // Not supported here — the cancelScheduledValues path below still tries.
    }
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    } catch {
      param.value = value;
    }
  };

  /**
   * End a crossfade immediately: silence + pause the outgoing element, reset
   * its fade envelope, and apply the ReplayGain write that was deferred while
   * that chain was still audible (see the `nextSong` effect).
   *
   * Idempotent — safe to call when no crossfade is in flight.
   */
  const endCrossfade = useCallback(() => {
    const fading = fadingOutRef.current;
    if (!fading) return;
    fadingOutRef.current = null;
    clearTimeout(fading.timeoutId);
    fading.audio.pause();

    const ctx = ctxRef.current;
    if (!ctx) return;
    // Usually called mid-curve (the user paused during the fade), so this must
    // go through forceGain rather than a bare setValueAtTime.
    forceGain(fading.chain.fade.gain, ctx, 1);
    // This chain is now the inactive one, and silent — safe to prime it.
    fading.chain.gain.gain.setValueAtTime(gainRatio(nextSongRef.current), ctx.currentTime);
  }, []);

  const cancelSleepFade = useCallback(() => {
    if (sleepFadeRef.current === null) return;
    clearTimeout(sleepFadeRef.current);
    sleepFadeRef.current = null;
    const ctx = ctxRef.current;
    const mixer = mixerRef.current;
    if (!ctx || !mixer) return;
    forceGain(mixer.gain, ctx, 1);
  }, []);

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
      const fade = ctx.createGain();
      fade.gain.value = 1;

      source.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);
      filters[filters.length - 1].connect(gain);
      gain.connect(fade);

      return { source, filters, gain, fade };
    };

    const chainA = buildChain(audioA);
    const chainB = buildChain(audioB);
    chainARef.current = chainA;
    chainBRef.current = chainB;

    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    mixerRef.current = mixer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    chainA.fade.connect(mixer);
    chainB.fade.connect(mixer);
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

      // The track played through to its end — true of every branch below,
      // including repeat-one, which returns early without advancing.
      onTrackFinishedRef.current?.();

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

      const target = e.target as HTMLAudioElement;
      const nextSong = nextSongRef.current;
      if (!nextSong || !(target.duration > 0) || !Number.isFinite(target.duration)) return;

      const xfade = crossfadeRef.current;
      const inactive = activeRef.current === 'A' ? audioB : audioA;
      const remaining = target.duration - target.currentTime;

      // Preload next song on the inactive element when we're near the end. The
      // lead must cover the crossfade, or the incoming track wouldn't be
      // loaded yet when the fade is due to start.
      //
      // Skipped entirely while a crossfade is sounding: "inactive" is then the
      // element still fading out, and writing its src would cut the tail dead.
      // (Reachable when the incoming track is shorter than the lead.)
      const preloadLead = Math.max(PRELOAD_LEAD_SECONDS, xfade + 1);
      if (!fadingOutRef.current && remaining < preloadLead && inactive.src !== nextSong.url) {
        inactive.src = nextSong.url;
        inactive.load();
      }

      if (
        xfade > 0 &&
        !fadingOutRef.current &&
        remaining <= xfade &&
        // Don't fade a track shorter than twice the fade — there'd be no
        // steady-state left in the middle.
        target.duration > xfade * 2 &&
        // Repeat-one replays the SAME element in place (see the ended
        // handler); one element cannot crossfade with itself.
        nextSong.url !== target.src &&
        inactive.src === nextSong.url
      ) {
        startCrossfade(target, inactive, xfade);
      }
    };

    /**
     * Overlap the outgoing and incoming tracks, flipping `activeRef` at the
     * START of the fade rather than the end.
     *
     * Flipping up front means there is no cancellable half-state: `seek` and
     * `togglePlayPause` address the incoming track immediately, the outgoing
     * element's eventual `ended`/`pause` events are swallowed by the
     * `!== activeAudio()` guards, and the UI advances when the fade begins —
     * which is what listeners expect.
     */
    const startCrossfade = (
      outgoing: HTMLAudioElement,
      incoming: HTMLAudioElement,
      seconds: number,
    ) => {
      const outChain = activeRef.current === 'A' ? chainARef.current : chainBRef.current;
      const inChain = activeRef.current === 'A' ? chainBRef.current : chainARef.current;
      if (!outChain || !inChain) return;

      const now = ctx.currentTime;
      inChain.fade.gain.cancelScheduledValues(now);
      inChain.fade.gain.setValueAtTime(0, now);
      inChain.fade.gain.setValueCurveAtTime(fadeCurve('in'), now, seconds);
      outChain.fade.gain.cancelScheduledValues(now);
      outChain.fade.gain.setValueCurveAtTime(fadeCurve('out'), now, seconds);

      activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
      incoming.play().catch(console.error);

      // Set BEFORE onEnded: that call synchronously schedules React state
      // updates whose effects consult this ref to know the outgoing chain is
      // still audible.
      fadingOutRef.current = {
        audio: outgoing,
        chain: outChain,
        timeoutId: window.setTimeout(endCrossfade, seconds * 1000),
      };

      // Before onEnded: the app's advance swaps currentSong, and the finish
      // belongs to the OUTGOING track. (Refs update on render, not
      // synchronously, so either order works — but the intent should be
      // explicit rather than accidental.)
      onTrackFinishedRef.current?.();
      onEndedRef.current?.();
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
      endCrossfade();
      audioRefA.current?.pause();
      audioRefB.current?.pause();
      return;
    }

    const active = activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
    const inactive = activeRef.current === 'A' ? audioRefB.current : audioRefA.current;
    if (!active || !inactive) return;

    // Already playing this song on the active element (e.g. the ended handler
    // or a crossfade already flipped before this effect ran). Must return
    // BEFORE endCrossfade below — this is the natural-advance path, where the
    // outgoing tail is supposed to keep fading.
    if (active.src === song.url) return;

    // Anything else is a jump away from the crossfade's incoming track (row
    // click, prev/next): cut the tail rather than leaving it audible under
    // the new song.
    endCrossfade();

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
    chain.gain.gain.setValueAtTime(gainRatio(song), ctx.currentTime);
  }, [song]);

  // Same for the inactive element when nextSong is set (so gapless swap has correct gain)
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    // During a crossfade the "inactive" chain is the one still FADING OUT and
    // audible. Writing the next-next track's gain onto it here would make the
    // outgoing track jump in level partway through the transition — by the dB
    // difference between two unrelated songs. Defer: endCrossfade() applies
    // this exact write once the chain is silent.
    if (fadingOutRef.current) return;
    const chain = activeRef.current === 'A' ? chainBRef.current : chainARef.current;
    if (!chain) return;
    chain.gain.gain.setValueAtTime(gainRatio(nextSong), ctx.currentTime);
  }, [nextSong]);

  // ---- EQ preset: apply to both chains ----
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (chainARef.current) applyPreset(chainARef.current.filters, eqPreset, ctx.currentTime);
    if (chainBRef.current) applyPreset(chainBRef.current.filters, eqPreset, ctx.currentTime);
  }, [eqPreset]);

  const togglePlayPause = useCallback(() => {
    // Any manual transport ends both fades. A crossfade has TWO elements
    // sounding — pausing only the active one would leave the outgoing track
    // audible on its own. A sleep fade must not survive the user pressing
    // play, or playback would resume into silence.
    cancelSleepFade();
    endCrossfade();
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
  }, [cancelSleepFade, endCrossfade]);

  useEffect(() => {
    if (audioRefA.current) audioRefA.current.volume = volume;
    if (audioRefB.current) audioRefB.current.volume = volume;
  }, [volume]);

  const seek = useCallback(
    (t: number) => {
      // Scrubbing the incoming track while the previous one is still fading
      // would leave two unrelated positions sounding at once.
      endCrossfade();
      const activeAudio =
        activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
      if (activeAudio) activeAudio.currentTime = t;
    },
    [endCrossfade],
  );

  /**
   * Sleep timer: ramp the MASTER mixer to silence, then pause.
   *
   * Deliberately not the `volume` state — that is persisted, so fading it
   * would write the faded value to storage and destroy the user's setting.
   * The analyser hangs off the mixer, so the visualizer fades along with the
   * audio; that's honest, not a bug.
   */
  const fadeOutAndPause = useCallback(
    (seconds: number) => {
      const ctx = ctxRef.current;
      const mixer = mixerRef.current;
      const activeAudio =
        activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
      if (!activeAudio) return;
      if (!ctx || !mixer) {
        activeAudio.pause();
        return;
      }

      cancelSleepFade();
      const now = ctx.currentTime;
      forceGain(mixer.gain, ctx, 1);
      mixer.gain.setValueCurveAtTime(fadeCurve('out'), now, seconds);

      sleepFadeRef.current = window.setTimeout(() => {
        sleepFadeRef.current = null;
        endCrossfade();
        const current =
          activeRef.current === 'A' ? audioRefA.current : audioRefB.current;
        current?.pause();
        // Restore level so the next play isn't silent.
        forceGain(mixer.gain, ctx, 1);
      }, seconds * 1000);
    },
    [cancelSleepFade, endCrossfade],
  );

  return {
    audioRefA,
    audioRefB,
    currentTime,
    duration,
    isPlaying,
    visualizerData,
    togglePlayPause,
    seek,
    fadeOutAndPause,
    cancelSleepFade,
  };
}
