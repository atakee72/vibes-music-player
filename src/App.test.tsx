import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import App from './App';
import { makeSong, makePlaylist } from './test-utils';
import * as storage from './lib/storage';
import { encodeSharePayload } from './lib/share';
import type { Playlist } from './types';

// ---------------------------------------------------------------------------
// Harness mocks. The audio engine is the only real coupling App has to
// AudioContext/RAF — mocking the hook decouples the whole suite from audio.
// ---------------------------------------------------------------------------

const engine = vi.hoisted(() => ({
  onEnded: undefined as (() => void) | undefined,
  togglePlayPause: vi.fn(),
  seek: vi.fn(),
}));

vi.mock('./hooks/useAudioEngine', () => ({
  useAudioEngine: (args: { onEnded?: () => void }) => {
    engine.onEnded = args.onEnded;
    return {
      audioRefA: { current: null },
      audioRefB: { current: null },
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      visualizerData: [] as number[],
      togglePlayPause: engine.togglePlayPause,
      seek: engine.seek,
    };
  },
}));

vi.mock('./hooks/useMediaSession', () => ({ useMediaSession: () => {} }));

// App calls parseBlob directly in the cover self-heal + lyrics re-parse paths.
vi.mock('music-metadata', () => ({
  parseBlob: vi.fn(async () => ({ common: {}, format: {} })),
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
    addLibraryRoot: vi.fn(async () => null),
    ensurePersisted: vi.fn(async () => {}),
    getStorageEstimate: vi.fn(async () => store.estimate),
    formatStorageWarning: actual.formatStorageWarning,
    STORAGE_WARN_PERCENT: actual.STORAGE_WARN_PERCENT,
    StorageQuotaError: actual.StorageQuotaError,
  };
});

async function renderApp(seed?: { playlists?: Playlist[] }) {
  store.playlists = seed?.playlists ?? [];
  store.roots = [];
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
  vi.clearAllMocks();
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
    fireEvent.click(screen.getByRole('button', { name: 'Equalizer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bass Boost' }));
    await waitFor(() =>
      expect(vi.mocked(storage.saveEqPreset)).toHaveBeenCalledWith('Bass Boost'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(vi.mocked(storage.saveVolume)).toHaveBeenCalledWith(0));
  });
});
