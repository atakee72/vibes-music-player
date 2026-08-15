import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import App from './App';
import { makeSong, makePlaylist } from './test-utils';
import * as storage from './lib/storage';
import { encodeSharePayload } from './lib/share';
import { SLEEP_FADE_SECONDS } from './lib/sleep';
import type { Playlist, Song } from './types';
import { parseBlob } from 'music-metadata';

// ---------------------------------------------------------------------------
// Harness mocks. The audio engine is the only real coupling App has to
// AudioContext/RAF — mocking the hook decouples the whole suite from audio.
// ---------------------------------------------------------------------------

const engine = vi.hoisted(() => ({
  onEnded: undefined as (() => void) | undefined,
  togglePlayPause: vi.fn(),
  seek: vi.fn(),
  fadeOutAndPause: vi.fn(),
  cancelSleepFade: vi.fn(),
  // Settable: the sleep timer skips the fade when playback is already
  // paused, so tests covering it must be able to report "playing".
  isPlaying: false,
  // Captures the `song` arg passed to useAudioEngine on the latest render —
  // lets re-scan tests assert on the exact Song object (url/file) the real
  // engine would have received, without needing a live AudioContext.
  song: undefined as Song | null | undefined,
  crossfadeSeconds: undefined as number | undefined,
}));

vi.mock('./hooks/useAudioEngine', () => ({
  useAudioEngine: (args: {
    onEnded?: () => void;
    song: Song | null;
    crossfadeSeconds?: number;
  }) => {
    engine.onEnded = args.onEnded;
    engine.song = args.song;
    engine.crossfadeSeconds = args.crossfadeSeconds;
    return {
      audioRefA: { current: null },
      audioRefB: { current: null },
      currentTime: 0,
      duration: 0,
      isPlaying: engine.isPlaying,
      visualizerData: [] as number[],
      togglePlayPause: engine.togglePlayPause,
      seek: engine.seek,
      fadeOutAndPause: engine.fadeOutAndPause,
      cancelSleepFade: engine.cancelSleepFade,
    };
  },
}));

vi.mock('./hooks/useMediaSession', () => ({ useMediaSession: () => {} }));

// App calls parseBlob directly in the cover self-heal + lyrics re-parse paths.
vi.mock('music-metadata', () => ({
  parseBlob: vi.fn(async () => ({ common: {}, format: {} })),
}));

// Identity passthrough: the real downscaleCover decodes via an <img>, which
// never fires load/error under happy-dom — it would otherwise hang every
// cover-bearing re-scan test on its 3s decode-timeout fallback. Identity
// also keeps the re-scan cover-size tests in control of the exact byte size
// (the input Uint8Array's length), since real downscaling could change it.
vi.mock('./lib/cover', () => ({
  downscaleCover: vi.fn(async (blob: Blob) => blob),
}));

const store = vi.hoisted(() => ({
  playlists: [] as unknown[],
  roots: [] as unknown[],
  estimate: null as null | { usage: number; quota: number; percent: number },
}));

vi.mock('./lib/storage', async () => {
  // Keep the REAL pure pieces (threshold logic, error class) so the warning
  // test exercises genuine formatting, not a mock echoing itself.
  const actual = await vi.importActual<typeof import('./lib/storage')>('./lib/storage');
  return {
    getPlaylists: vi.fn(async () => store.playlists),
    getLibraryRoots: vi.fn(async () => store.roots),
    savePlaylists: vi.fn(async () => {}),
    getEqPreset: vi.fn(async () => 'Off'),
    saveEqPreset: vi.fn(async () => {}),
    getVolume: vi.fn(async () => 1),
    saveVolume: vi.fn(async () => {}),
    getCrossfade: vi.fn(async () => 0),
    saveCrossfade: vi.fn(async () => {}),
    addLibraryRoot: vi.fn(async () => null),
    ensurePersisted: vi.fn(async () => {}),
    getStorageEstimate: vi.fn(async () => store.estimate),
    formatStorageWarning: actual.formatStorageWarning,
    STORAGE_WARN_PERCENT: actual.STORAGE_WARN_PERCENT,
    StorageQuotaError: actual.StorageQuotaError,
  };
});

async function renderApp(seed?: { playlists?: Playlist[]; roots?: unknown[] }) {
  store.playlists = seed?.playlists ?? [];
  store.roots = seed?.roots ?? [];
  store.estimate = null;
  const utils = render(<App />);
  // Mount-load settled once the Library playlist row is in the sidebar.
  await screen.findAllByText('Library');
  return utils;
}

const playRow = (index = 0) => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[index]);
};

const openRowMenuAnd = (songTitle: string, item: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${songTitle}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

const activeRowTitle = () =>
  screen
    .getAllByText(/./, { selector: 'p.font-display' })
    .find((el) => el.className.includes('text-amber'))?.textContent;

afterEach(() => {
  engine.onEnded = undefined;
  engine.song = undefined;
  vi.clearAllMocks();
  engine.isPlaying = false;
  window.location.hash = '';
});

describe('App', () => {
  it('inserts the Library playlist when the store has none', async () => {
    await renderApp();
    expect(screen.getAllByText('Library').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('No songs in this playlist')).toBeInTheDocument();
  });

  it('creates a playlist through the prompt flow', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'New Playlist' }));
    fireEvent.change(await screen.findByPlaceholderText('Playlist name'), { target: { value: 'Chill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Chill')).toBeInTheDocument();
  });

  it('renames a playlist via the prefilled prompt', async () => {
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library' }), makePlaylist({ name: 'Old' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Old' }));
    const input = (await screen.findByPlaceholderText('Playlist name')) as HTMLInputElement;
    expect(input.value).toBe('Old');
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByText('New')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('deletes a playlist and falls back to Library as the active view', async () => {
    const mix = makePlaylist({ name: 'Mix', songs: [makeSong({ title: 'Alpha' })] });
    await renderApp({ playlists: [makePlaylist({ id: 'library', name: 'Library' }), mix] });
    fireEvent.click(screen.getByText('Mix'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mix' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Mix')).not.toBeInTheDocument());
    // Back on Library (header shows it as the active view)
    expect(screen.getAllByText('Library').length).toBeGreaterThanOrEqual(2);
  });

  it('deleting a song from a user playlist is scoped — Library keeps it', async () => {
    const song = makeSong({ title: 'Shared Song' });
    await renderApp({
      playlists: [
        makePlaylist({ id: 'library', name: 'Library', songs: [song] }),
        makePlaylist({ name: 'Mix', songs: [song] }),
      ],
    });
    fireEvent.click(screen.getByText('Mix'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete song' }));
    // find*: ConfirmModal is lazy-loaded — sync get* races the chunk import
    expect(await screen.findByText(/Song remains in Library/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.getByText('No songs in this playlist')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getAllByText('Library')[0]);
    expect(await screen.findByText('Shared Song')).toBeInTheDocument();
  });

  it('deleting a song from Library is app-wide — user playlists and queue lose it', async () => {
    const song = makeSong({ title: 'Doomed' });
    await renderApp({
      playlists: [
        makePlaylist({ id: 'library', name: 'Library', songs: [song] }),
        makePlaylist({ name: 'Mix', songs: [song] }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete song' }));
    expect(
      await screen.findByText(/Permanently removes from your library and all playlists/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Doomed')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Mix'));
    expect(screen.getByText('No songs in this playlist')).toBeInTheDocument();
  });

  it('hearting a song adds it to the Favorites view; unhearting empties it', async () => {
    const song = makeSong({ title: 'Loved' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Loved to Favorites' }));
    fireEvent.click(screen.getByText('Favorites'));
    expect(screen.getByText('Loved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Loved from Favorites' }));
    expect(await screen.findByText('No favorites yet')).toBeInTheDocument();
  });

  it('the virtual Favorites playlist is never persisted', async () => {
    const song = makeSong({ title: 'Kept' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Kept to Favorites' }));
    await waitFor(
      () => expect(vi.mocked(storage.savePlaylists)).toHaveBeenCalled(),
      { timeout: 2000 },
    );
    const lastCall = vi.mocked(storage.savePlaylists).mock.lastCall?.[0] as Playlist[];
    expect(lastCall.some((p) => p.id === 'favorites')).toBe(false);
  });

  it('a queued song plays on track end and leaves the queue', async () => {
    const a = makeSong({ title: 'AlphaQ' });
    const c = makeSong({ title: 'GammaQ' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [a, c] })],
    });
    playRow(0);
    openRowMenuAnd('GammaQ', /Play next/);
    expect(screen.getByText('Playing next: GammaQ')).toBeInTheDocument();
    act(() => engine.onEnded?.());
    await waitFor(() => expect(activeRowTitle()).toBe('GammaQ'));
  });

  it('queueing the currently-playing song shows the guard toast and queues nothing', async () => {
    const a = makeSong({ title: 'Solo' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [a] })],
    });
    playRow(0);
    openRowMenuAnd('Solo', /Add to queue/);
    expect(screen.getByText('Already playing')).toBeInTheDocument();
    expect(screen.queryByText(/Added to queue/)).not.toBeInTheDocument();
  });

  it('Escape closes the queue panel before clearing the search text', async () => {
    await renderApp();
    fireEvent.change(screen.getByPlaceholderText(/Search this playlist/), {
      target: { value: 'beat' },
    });
    fireEvent.keyDown(document.body, { code: 'KeyQ' });
    expect(await screen.findByRole('button', { name: 'Close queue' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { code: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close queue' })).not.toBeInTheDocument(),
    );
    // Search text survived the first Escape…
    expect(screen.getByDisplayValue('beat')).toBeInTheDocument();
    // …and clears on the next.
    fireEvent.keyDown(document.body, { code: 'Escape' });
    expect(screen.queryByDisplayValue('beat')).not.toBeInTheDocument();
  });

  it('Escape closes the sidebar only below lg', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    try {
      await renderApp();
      // Mobile init: sidebar starts closed — open it first.
      fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
      expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { code: 'Escape' });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument(),
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it('search filters the visible list', async () => {
    await renderApp({
      playlists: [
        makePlaylist({
          id: 'library',
          name: 'Library',
          songs: [makeSong({ title: 'Sunrise' }), makeSong({ title: 'Moonfall' })],
        }),
      ],
    });
    fireEvent.change(screen.getByPlaceholderText(/Search this playlist/), {
      target: { value: 'moon' },
    });
    expect(screen.getByText('Moonfall')).toBeInTheDocument();
    expect(screen.queryByText('Sunrise')).not.toBeInTheDocument();
  });

  it('a share link opens the shared-track modal and strips the hash', async () => {
    const shared = makeSong({ title: 'Şarkı', artist: 'Sanatçı', album: 'Albüm', duration: 200 });
    window.location.hash = `#s=${encodeSharePayload(shared).split('#s=')[1] ?? ''}`;
    await renderApp();
    expect(await screen.findByText('Şarkı')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('shows the 90% storage warning once after a save', async () => {
    await renderApp();
    store.estimate = { usage: 92, quota: 100, percent: 92 };
    // Any playlists mutation schedules the debounced save.
    fireEvent.click(screen.getByRole('button', { name: 'New Playlist' }));
    fireEvent.change(await screen.findByPlaceholderText('Playlist name'), { target: { value: 'Filler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText(/Storage almost full \(92% used\)/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // "Once per session": wait for the toast to auto-dismiss, mutate again,
    // let the next debounced save land — no second warning appears.
    await waitFor(
      () => expect(screen.queryByText(/Storage almost full/)).not.toBeInTheDocument(),
      { timeout: 6000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Playlist' }));
    fireEvent.change(await screen.findByPlaceholderText('Playlist name'), {
      target: { value: 'Filler2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('Filler2');
    await new Promise((r) => setTimeout(r, 700)); // let the debounce fire
    expect(screen.queryByText(/Storage almost full/)).not.toBeInTheDocument();
  }, 15000); // the toast's 5s auto-dismiss is part of the once-per-session check

  it('an .m3u upload creates a playlist and is not ingested as a song', async () => {
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const m3u = new File(['#EXTM3U\nsome-song.mp3\n'], 'roadtrip.m3u', {
      type: 'audio/x-mpegurl',
    });
    fireEvent.change(input, { target: { files: [m3u] } });
    expect(await screen.findByText(/Created "roadtrip"/)).toBeInTheDocument();
    // Library view still shows the empty state — the .m3u never became a song.
    expect(screen.getByText('No songs in this playlist')).toBeInTheDocument();
  });

  it('ingests audio files whose browser MIME type is empty (Windows .flac/.m4a)', async () => {
    await renderApp({ playlists: [makePlaylist({ id: 'library', name: 'Library' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([], 'nomime.flac'), new File([], 'nomime2.m4a')] },
    });
    // Both land in the Library instead of the old "Please select audio files" dead end
    expect(await screen.findByText('nomime')).toBeInTheDocument();
    expect(screen.getByText('nomime2')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to add/)).not.toBeInTheDocument();
  });

  it('reports a non-audio drop with a toast, never a blocking alert()', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await renderApp({ playlists: [makePlaylist({ id: 'library', name: 'Library' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByText(/Nothing to add/)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('re-importing the same .m3u UPDATES the linked playlist instead of duplicating', async () => {
    const song = makeSong({ title: 'Alpha', file: new File([], 'alpha.mp3', { type: 'audio/mpeg' }) });
    const other = makeSong({ title: 'Bravo', file: new File([], 'bravo.mp3', { type: 'audio/mpeg' }) });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song, other] })],
    });
    const importM3u = async (body: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [new File([body], 'roadtrip.m3u', { type: 'audio/x-mpegurl' })] },
      });
    };

    await importM3u('#EXTM3U\nalpha.mp3\nbravo.mp3\n');
    expect(await screen.findByText(/Created "roadtrip"/)).toBeInTheDocument();

    // Same file name, one track dropped → update, not a second playlist
    await importM3u('#EXTM3U\nalpha.mp3\n');
    expect(await screen.findByText(/Updated "roadtrip" — 1 track \(\+0, -1\)/)).toBeInTheDocument();
    expect(screen.getAllByText('roadtrip')).toHaveLength(1);

    fireEvent.click(screen.getByText('roadtrip'));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument();
  });

  it('a linked playlist renamed inside Vibes still updates under its new name', async () => {
    const song = makeSong({ title: 'Alpha', file: new File([], 'alpha.mp3', { type: 'audio/mpeg' }) });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    const importM3u = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [new File(['#EXTM3U\nalpha.mp3\n'], 'roadtrip.m3u', { type: 'audio/x-mpegurl' })],
        },
      });
    };

    await importM3u();
    await screen.findByText(/Created "roadtrip"/);
    fireEvent.click(screen.getByRole('button', { name: 'Rename roadtrip' }));
    fireEvent.change(await screen.findByPlaceholderText('Playlist name'), {
      target: { value: 'Trip Mix' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await screen.findByText('Trip Mix');

    await importM3u();
    expect(await screen.findByText(/Updated "Trip Mix"/)).toBeInTheDocument();
    expect(screen.queryByText('roadtrip')).not.toBeInTheDocument();
  });

  it('a file named library.m3u creates a normal playlist and never hijacks Library', async () => {
    const song = makeSong({ title: 'Alpha', file: new File([], 'alpha.mp3', { type: 'audio/mpeg' }) });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(['#EXTM3U\nalpha.mp3\n'], 'library.m3u', { type: 'audio/x-mpegurl' })],
      },
    });
    expect(await screen.findByText(/Created "library"/)).toBeInTheDocument();
    // The real Library is untouched and still selectable
    fireEvent.click(screen.getAllByText('Library')[0]);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });

  it('songs and an .m3u dropped TOGETHER produce a populated playlist', async () => {
    // Regression guard: playlist import used to run before audio ingest, so a
    // combined drop matched against an empty library and created empty playlists.
    await renderApp({ playlists: [makePlaylist({ id: 'library', name: 'Library' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File([], 'alpha.mp3', { type: 'audio/mpeg' }),
          new File(['#EXTM3U\nalpha.mp3\n'], 'roadtrip.m3u', { type: 'audio/x-mpegurl' }),
        ],
      },
    });
    expect(await screen.findByText(/Created "roadtrip" with 1 of 1 tracks/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('roadtrip'));
    expect(await screen.findByText('alpha')).toBeInTheDocument();
  });

  it('drain-back is Spotify-style: after a queued detour, the walk resumes from the bookmark', async () => {
    const a = makeSong({ title: 'TrackA' });
    const b = makeSong({ title: 'TrackB' });
    const c = makeSong({ title: 'TrackC' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [a, b, c] })],
    });
    playRow(0); // TrackA
    openRowMenuAnd('TrackC', /Play next/);
    act(() => engine.onEnded?.());
    await waitFor(() => expect(activeRowTitle()).toBe('TrackC'));
    act(() => engine.onEnded?.());
    // Old behavior would stop (C is last under repeat=none); Spotify-style
    // resumes after the bookmark (A) → TrackB.
    await waitFor(() => expect(activeRowTitle()).toBe('TrackB'));
  });

  it('never overwrites the stored library while a folder permission is pending', async () => {
    // Data-loss guard: on a Chromium restart FS Access grants are forgotten,
    // so the app boots into 'needs-prompt' with an EMPTY in-memory library.
    // The debounced save must NOT persist that emptiness over the real data —
    // the restore banner reads it back moments later.
    store.playlists = [
      makePlaylist({ id: 'library', name: 'Library', songs: [makeSong({ title: 'Precious' })] }),
    ];
    store.roots = [
      { id: 'root-1', name: 'Music', handle: { queryPermission: async () => 'prompt' } },
    ];
    render(<App />);
    await screen.findByText(/Welcome back/);
    await new Promise((r) => setTimeout(r, 700)); // past the 500ms debounce
    expect(vi.mocked(storage.savePlaylists)).not.toHaveBeenCalled();
  });

  it('EQ preset and mute changes persist via storage', async () => {
    const song = makeSong({ title: 'Audible' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    playRow(0);
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bass Boost' }));
    await waitFor(() =>
      expect(vi.mocked(storage.saveEqPreset)).toHaveBeenCalledWith('Bass Boost'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(vi.mocked(storage.saveVolume)).toHaveBeenCalledWith(0));
  });

  it('crossfade persists and reaches the audio engine', async () => {
    const song = makeSong({ title: 'Audible' });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
    });
    playRow(0);
    expect(engine.crossfadeSeconds).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '6s' }));

    await waitFor(() => expect(vi.mocked(storage.saveCrossfade)).toHaveBeenCalledWith(6));
    expect(engine.crossfadeSeconds).toBe(6);
  });
});

describe('sleep timer', () => {
  // Timers are faked only AFTER renderApp: the helper awaits findAllByText,
  // whose polling is itself timer-driven and would hang under fake timers.
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderPlayingApp = async () => {
    await renderApp({
      playlists: [
        makePlaylist({
          id: 'library',
          name: 'Library',
          songs: [makeSong({ title: 'Nocturne' })],
        }),
      ],
    });
    engine.isPlaying = true;
    playRow(0);
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  };

  const armTimer = (label: string) => {
    // Once armed the label carries the countdown ("Sleep timer, 14:59 remaining").
    fireEvent.click(screen.getByRole('button', { name: /Sleep timer/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
  };

  it('fades out and pauses when the deadline passes', async () => {
    await renderPlayingApp();
    armTimer('15 minutes');

    expect(engine.fadeOutAndPause).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000);
    });
    expect(engine.fadeOutAndPause).toHaveBeenCalledWith(SLEEP_FADE_SECONDS);
  });

  it('selecting Off disarms — the deadline never fires', async () => {
    await renderPlayingApp();
    armTimer('15 minutes');
    armTimer('Off');

    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(engine.fadeOutAndPause).not.toHaveBeenCalled();
    expect(engine.cancelSleepFade).toHaveBeenCalled();
  });
});

describe('re-scan tags', () => {
  const grantedRoot = () => ({
    id: 'root1',
    name: 'Music',
    handle: {
      requestPermission: async () => 'granted',
      queryPermission: async () => 'granted',
    },
    addedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const handleFor = (name: string) =>
    ({
      getFile: async () => new File([], name, { type: 'audio/mpeg' }),
    }) as unknown as FileSystemFileHandle;

  // The harness's `vi.mock('music-metadata')` supplies parseBlob as a vi.fn;
  // overriding its return IS "the file on disk changed" in this suite.
  // Reset it so later tests keep the harness default.
  afterEach(() => {
    // `as never` satisfies the mock's narrowly-inferred return type — tsc
    // typechecks test files (tsconfig `include: ["src"]`), so this cast is
    // load-bearing, not decoration.
    vi.mocked(parseBlob).mockResolvedValue({ common: {}, format: {} } as never);
  });

  const clickRescan = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Re-scan tags' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-scan' }));
  };

  it('offers no re-scan button without a folder-based library', async () => {
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [makeSong()] })],
    });
    expect(screen.queryByRole('button', { name: 'Re-scan tags' })).toBeNull();
  });

  it('re-reads tags from disk while keeping the id and the heart', async () => {
    const song = makeSong({
      id: 'root1/a.mp3',
      title: 'Stale Title',
      favorite: true,
      fileHandle: handleFor('a.mp3'),
    });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
      roots: [grantedRoot()],
    });

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'Beets Title', artist: 'Beets Artist', bpm: 128 },
      format: { duration: 300 },
    } as never);

    await clickRescan();

    expect(await screen.findByText('Beets Title')).toBeInTheDocument();
    expect(screen.queryByText('Stale Title')).toBeNull();
    // The row heart's accessible name is built from the CURRENT title, so this
    // one assertion proves both halves: the tag landed AND the favorite flag
    // rode through the patch on the same song id.
    expect(
      screen.getByRole('button', { name: 'Remove Beets Title from Favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports how many tracks changed', async () => {
    await renderApp({
      playlists: [
        makePlaylist({
          id: 'library',
          name: 'Library',
          songs: [makeSong({ id: 'root1/a.mp3', fileHandle: handleFor('a.mp3') })],
        }),
      ],
      roots: [grantedRoot()],
    });

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'Beets Title', artist: 'Beets Artist' },
      format: { duration: 300 },
    } as never);

    await clickRescan();

    expect(await screen.findByText(/Re-scan complete: 1 of 1 track updated/)).toBeInTheDocument();
  });

  it('skips songs that have no file handle', async () => {
    const blobSong = makeSong({ id: 'blob-only', title: 'Blob Song' });
    await renderApp({
      playlists: [
        makePlaylist({
          id: 'library',
          name: 'Library',
          songs: [makeSong({ id: 'root1/a.mp3', fileHandle: handleFor('a.mp3') }), blobSong],
        }),
      ],
      roots: [grantedRoot()],
    });

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'Beets Title', artist: 'Beets Artist' },
      format: { duration: 300 },
    } as never);

    await clickRescan();

    expect(await screen.findByText('Beets Title')).toBeInTheDocument();
    // The blob-backed song was never re-read, so its title is untouched.
    expect(screen.getByText('Blob Song')).toBeInTheDocument();
  });

  it('keeps the playing song on its original url and file across a re-scan', async () => {
    const song = makeSong({
      id: 'root1/a.mp3',
      title: 'Stale Title',
      fileHandle: handleFor('a.mp3'),
    });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
      roots: [grantedRoot()],
    });

    playRow(0);
    const originalUrl = song.url;
    const originalFile = song.file;
    expect(engine.song?.url).toBe(originalUrl);

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'Beets Title', artist: 'Beets Artist' },
      format: { duration: 300 },
    } as never);

    await clickRescan();

    // Tags landed — a playing song renders its title in multiple surfaces
    // (row, hero, player bar), hence findAllByText.
    expect((await screen.findAllByText('Beets Title')).length).toBeGreaterThan(0);
    // ...but the url/file the engine is holding must not move: swapping
    // either would reload the <audio> element and restart the track from 0.
    expect(engine.song?.url).toBe(originalUrl);
    expect(engine.song?.file).toBe(originalFile);
  });

  it('protects a song that starts playing mid-sweep, after its own tag check already ran', async () => {
    // Regression for the apply-time race: the per-song "is this playing?"
    // check runs as soon as THAT song's own file read/parse resolves, but
    // the batch write happens once for the WHOLE sweep. A song checked
    // early (while not playing) can become the playing song before the
    // sweep finishes. Reproduced here with two songs: A resolves fast (so
    // its check runs and — wrongly, absent the apply-time re-check — marks
    // it swap-eligible) while B is held open on a gate (at its OWN file
    // read, not shared mock state, so there's no race with A's concurrent
    // parseBlob call), keeping the batch write from happening until we
    // choose to release it.
    const songA = makeSong({ id: 'root1/a.mp3', title: 'A Title', fileHandle: handleFor('a.mp3') });

    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const gatedHandleB = {
      getFile: async () => {
        await gate;
        return new File([], 'b.mp3', { type: 'audio/mpeg' });
      },
    } as unknown as FileSystemFileHandle;
    const songB = makeSong({ id: 'root1/b.mp3', title: 'B Title', fileHandle: gatedHandleB });

    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [songA, songB] })],
      roots: [grantedRoot()],
    });

    const originalUrlA = songA.url;

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'A Rescanned' },
      format: { duration: 300 },
    } as never);

    fireEvent.click(screen.getByRole('button', { name: 'Re-scan tags' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-scan' }));

    // Let songA's own per-song check run to completion — it isn't playing
    // yet, so (absent the fix) it gets recorded as swap-eligible — while
    // songB stays gated at its own getFile(), holding the whole sweep open
    // past that point. A bare macrotask tick is enough: songA's chain
    // (getFile → dynamic import → parseBlob → the check) is all microtasks
    // with no gate.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // NOW start playing songA — mid-sweep, after its own check already ran.
    playRow(0);
    expect(engine.song?.id).toBe(songA.id);

    // Let songB (and therefore the whole sweep) finish.
    resolveGate();

    await screen.findByText(/Re-scan complete/);

    // The apply-time re-check must have caught this and restored songA's
    // original url/file — the fetch-time check alone is stale by now.
    expect(engine.song?.url).toBe(originalUrlA);
  });

  it('keeps a heart toggled mid-sweep after the batch write lands', async () => {
    // Regression for the batch-write-clobbers-live-mutations bug: patches
    // built from the pre-sweep SNAPSHOT and written wholesale would revert
    // any live-state change that happened while the sweep was still
    // running — a heart toggled, lyrics fetched via LRCLIB, etc. Same
    // two-song gating technique as the url/file mid-sweep test above: A
    // resolves fast and gets patched, B stays gated (at its own getFile(),
    // not shared mock state) so the batch write doesn't land until we
    // release it — giving a real window to mutate A's live state in
    // between.
    const songA = makeSong({ id: 'root1/a.mp3', title: 'A Title', fileHandle: handleFor('a.mp3') });

    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const gatedHandleB = {
      getFile: async () => {
        await gate;
        return new File([], 'b.mp3', { type: 'audio/mpeg' });
      },
    } as unknown as FileSystemFileHandle;
    const songB = makeSong({ id: 'root1/b.mp3', title: 'B Title', fileHandle: gatedHandleB });

    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [songA, songB] })],
      roots: [grantedRoot()],
    });

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'A Rescanned' },
      format: { duration: 300 },
    } as never);

    fireEvent.click(screen.getByRole('button', { name: 'Re-scan tags' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-scan' }));

    // Let songA's own fetch/patch complete while songB stays gated, holding
    // the whole sweep's batch write open.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Heart songA MID-SWEEP, after its patch was already built from the
    // pre-sweep snapshot.
    fireEvent.click(screen.getByRole('button', { name: 'Add A Title to Favorites' }));

    // Let songB (and therefore the whole sweep's batch write) finish.
    resolveGate();

    await screen.findByText(/Re-scan complete/);

    // The tag landed (proves the merge ran) — a row's title can render in
    // more than one place (desktop/mobile variants both in the DOM under
    // happy-dom, toggled by CSS the test environment doesn't evaluate).
    expect((await screen.findAllByText('A Rescanned')).length).toBeGreaterThan(0);
    // ...and the heart survived it (proves the merge was against the LIVE
    // song, not the pre-sweep snapshot that predates the heart).
    expect(
      screen.getByRole('button', { name: 'Remove A Rescanned from Favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('revokes replaced object urls for changed songs, and never for the playing song — including the freshly-created one it discards', async () => {
    // The playing-vs-not decision moved to APPLY time: every candidate,
    // including the playing song, gets a fresh url built at fetch time
    // (`{ file, url: URL.createObjectURL(file) }`, unconditional). `apply`
    // then DISCARDS that fresh url for the playing song (keeps the live
    // one instead) — so unlike `otherUrl` below (an OLD url, tracked in
    // `staleUrls`), this discarded url is never assigned to any song and
    // nothing else will ever revoke it. Captures the File `getFile()`
    // returns for the playing song so the corresponding `createObjectURL`
    // call (and its result, the leaked url) can be found afterward.
    let playingFile: File | undefined;
    const playingHandle = {
      getFile: async () => {
        const f = new File([], 'a.mp3', { type: 'audio/mpeg' });
        playingFile = f;
        return f;
      },
    } as unknown as FileSystemFileHandle;
    const playing = makeSong({ id: 'root1/a.mp3', fileHandle: playingHandle });
    const other = makeSong({ id: 'root1/b.mp3', fileHandle: handleFor('b.mp3') });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [playing, other] })],
      roots: [grantedRoot()],
    });

    playRow(0);
    const playingUrl = playing.url;
    const otherUrl = other.url;

    vi.mocked(parseBlob).mockResolvedValue({
      common: { title: 'Beets Title', artist: 'Beets Artist' },
      format: { duration: 300 },
    } as never);

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const createSpy = vi.spyOn(URL, 'createObjectURL');

    await clickRescan();
    await screen.findByText(/Re-scan complete/);

    // The deferred revoke (setTimeout(0)) has had time to fire by now.
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(otherUrl));
    // The playing song's ORIGINAL (still in use) url must never be revoked.
    expect(revokeSpy).not.toHaveBeenCalledWith(playingUrl);

    // ...but the fresh url built for it and then discarded by `apply` must
    // be — otherwise every re-scan performed while a song is playing leaks
    // one blob url pinning a whole audio file.
    expect(playingFile).toBeDefined();
    const discardedCallIndex = createSpy.mock.calls.findIndex(([blob]) => blob === playingFile);
    expect(discardedCallIndex).toBeGreaterThanOrEqual(0);
    const discardedUrl = createSpy.mock.results[discardedCallIndex]?.value as string;
    expect(discardedUrl).not.toBe(playingUrl);
    expect(revokeSpy).toHaveBeenCalledWith(discardedUrl);
  });

  it('treats re-embedded art of the SAME size as a no-op — no revoke, honest "0 updated"', async () => {
    // Regression: hasMetaChanged used to compare coverBlob BY REFERENCE, and
    // the app always built a FRESH Blob for any song with embedded art —
    // so the reference always differed, even when the tagger re-embedded
    // the exact same artwork (the common beets `embedart` case). That
    // permanently reported every such track as "changed". The fix is two
    // parts: the app only creates a cover replacement when the downscaled
    // blob's size differs from the existing one, and hasMetaChanged
    // compares by size. This test exercises the APP-LEVEL trigger (the
    // size-gated replacement decision); rescan.test.ts covers
    // hasMetaChanged's own size comparison in isolation.
    const existingCoverBlob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const song = makeSong({
      id: 'root1/a.mp3',
      fileHandle: handleFor('a.mp3'),
      coverArt: 'blob:old-cover',
      coverBlob: existingCoverBlob,
    });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
      roots: [grantedRoot()],
    });

    // Same title/artist/album/duration as the existing song, and the SAME
    // picture byte length (downscaleCover is mocked to identity, so the
    // Uint8Array length IS the resulting Blob size) — the only thing that
    // could flip "changed" is the cover, isolating the bug.
    vi.mocked(parseBlob).mockResolvedValue({
      common: {
        title: song.title,
        artist: song.artist,
        album: song.album,
        picture: [{ data: new Uint8Array(10), format: 'image/jpeg' }],
      },
      format: { duration: song.duration },
    } as never);

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    await clickRescan();

    expect(
      await screen.findByText(/Re-scan complete: 0 of 1 track updated/),
    ).toBeInTheDocument();
    // No fresh cover replacement means nothing to revoke — this is the
    // signal that the swap was skipped, not just that the count read 0.
    expect(revokeSpy).not.toHaveBeenCalledWith('blob:old-cover');
  });

  it('swaps re-embedded art of a DIFFERENT size, revokes the old cover url, and counts as changed', async () => {
    const existingCoverBlob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const song = makeSong({
      id: 'root1/a.mp3',
      fileHandle: handleFor('a.mp3'),
      coverArt: 'blob:old-cover',
      coverBlob: existingCoverBlob,
    });
    await renderApp({
      playlists: [makePlaylist({ id: 'library', name: 'Library', songs: [song] })],
      roots: [grantedRoot()],
    });

    vi.mocked(parseBlob).mockResolvedValue({
      common: {
        title: song.title,
        artist: song.artist,
        album: song.album,
        picture: [{ data: new Uint8Array(999), format: 'image/jpeg' }],
      },
      format: { duration: song.duration },
    } as never);

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    await clickRescan();

    expect(
      await screen.findByText(/Re-scan complete: 1 of 1 track updated/),
    ).toBeInTheDocument();
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith('blob:old-cover'));
  });
});
