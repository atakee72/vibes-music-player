import { downscaleCover } from './cover';

// happy-dom has no real image decoding/canvas rasterization, so these tests
// cover the guard rails (never-worse-than-original contract); the actual
// pixel path is verified in the browser smoke test.

describe('downscaleCover', () => {
  it('returns the original blob when the image cannot be decoded (never worse)', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const out = await downscaleCover(blob, 512, 50);
    expect(out).toBe(blob);
  });

  it('returns the original blob for non-image data', async () => {
    const blob = new Blob(['not an image'], { type: 'text/plain' });
    const out = await downscaleCover(blob, 512, 50);
    expect(out).toBe(blob);
  });
});
