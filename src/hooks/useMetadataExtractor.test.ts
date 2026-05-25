import { renderHook, act } from '@testing-library/react';
import { useMetadataExtractor } from './useMetadataExtractor';

const parseBlobMock = vi.fn();

vi.mock('music-metadata', () => ({
  parseBlob: (file: File) => parseBlobMock(file),
}));

describe('useMetadataExtractor', () => {
  beforeEach(() => {
    parseBlobMock.mockReset();
    // happy-dom doesn't always have createObjectURL — stub a deterministic one
    URL.createObjectURL = vi.fn(() => 'blob:stub-url');
  });

  it('returns a Song with metadata fields when parseBlob resolves', async () => {
    parseBlobMock.mockResolvedValue({
      common: { title: 'My Title', artist: 'Me', album: 'My Album', year: 2026 },
      format: { duration: 240, bitrate: 320000 },
    });

    const file = new File([], 'whatever.mp3', { type: 'audio/mpeg' });
    const { result } = renderHook(() => useMetadataExtractor());

    let song: Awaited<ReturnType<typeof result.current.extractMetadata>>;
    await act(async () => {
      song = await result.current.extractMetadata(file);
    });

    expect(song!.title).toBe('My Title');
    expect(song!.artist).toBe('Me');
    expect(song!.album).toBe('My Album');
    expect(song!.duration).toBe(240);
    expect(song!.year).toBe(2026);
    expect(song!.bitrate).toBe(320000);
    expect(song!.coverArt).toBeUndefined();
    expect(song!.file).toBe(file);
  });

  it('captures replayGainDb from meta.common.replaygain_track_gain.dB', async () => {
    parseBlobMock.mockResolvedValue({
      common: {
        title: 'X',
        artist: 'Y',
        album: 'Z',
        replaygain_track_gain: { dB: -6.4, ratio: 0.479 },
      },
      format: { duration: 100 },
    });

    const { result } = renderHook(() => useMetadataExtractor());
    let song: Awaited<ReturnType<typeof result.current.extractMetadata>>;
    await act(async () => {
      song = await result.current.extractMetadata(new File([], 'rg.mp3'));
    });
    expect(song!.replayGainDb).toBe(-6.4);
  });

  it('extracts coverArt when picture data is present', async () => {
    parseBlobMock.mockResolvedValue({
      common: {
        title: 'X',
        artist: 'Y',
        album: 'Z',
        picture: [{ data: new Uint8Array([0, 1, 2]), format: 'image/jpeg' }],
      },
      format: { duration: 100 },
    });

    const file = new File([], 'art.mp3');
    const { result } = renderHook(() => useMetadataExtractor());

    let song: Awaited<ReturnType<typeof result.current.extractMetadata>>;
    await act(async () => {
      song = await result.current.extractMetadata(file);
    });

    expect(song!.coverArt).toBe('blob:stub-url');
    // Called twice: once for the cover blob, once for the song url
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('falls back when parseBlob throws — title from filename, Unknown Artist/Album', async () => {
    parseBlobMock.mockRejectedValue(new Error('corrupt file'));

    const file = new File([], 'broken-tune.flac');
    const { result } = renderHook(() => useMetadataExtractor());

    let song: Awaited<ReturnType<typeof result.current.extractMetadata>>;
    await act(async () => {
      song = await result.current.extractMetadata(file);
    });

    expect(song!.title).toBe('broken-tune');
    expect(song!.artist).toBe('Unknown Artist');
    expect(song!.album).toBe('Unknown Album');
    expect(song!.duration).toBe(0);
    expect(song!.file).toBe(file);
  });
});
