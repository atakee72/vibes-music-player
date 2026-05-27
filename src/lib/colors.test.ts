import { dominantColorFromPixels } from './colors';

function makePixels(
  colors: Array<[number, number, number]>,
  width: number,
  height: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = colors[i % colors.length];
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('dominantColorFromPixels', () => {
  it('returns null for all-black image', () => {
    const data = makePixels([[0, 0, 0]], 4, 4);
    expect(dominantColorFromPixels(data, 4, 4)).toBeNull();
  });

  it('returns null for all-white image', () => {
    const data = makePixels([[255, 255, 255]], 4, 4);
    expect(dominantColorFromPixels(data, 4, 4)).toBeNull();
  });

  it('returns null for all-gray image', () => {
    const data = makePixels([[128, 128, 128]], 4, 4);
    expect(dominantColorFromPixels(data, 4, 4)).toBeNull();
  });

  it('returns hue near 0° for a red image', () => {
    const data = makePixels([[200, 50, 50]], 4, 4);
    const result = dominantColorFromPixels(data, 4, 4);
    expect(result).not.toBeNull();
    const hue = parseInt(result!.match(/hsl\((\d+)/)![1]);
    expect(hue).toBeLessThanOrEqual(12);
  });

  it('returns hue near 120° for a green image', () => {
    const data = makePixels([[50, 180, 50]], 4, 4);
    const result = dominantColorFromPixels(data, 4, 4);
    expect(result).not.toBeNull();
    const hue = parseInt(result!.match(/hsl\((\d+)/)![1]);
    expect(hue).toBeGreaterThanOrEqual(108);
    expect(hue).toBeLessThanOrEqual(132);
  });

  it('returns the most frequent color when mixed', () => {
    const blues: Array<[number, number, number]> = Array(12).fill([50, 50, 200]);
    const reds: Array<[number, number, number]> = Array(4).fill([200, 50, 50]);
    const data = makePixels([...blues, ...reds], 4, 4);
    const result = dominantColorFromPixels(data, 4, 4);
    expect(result).not.toBeNull();
    const hue = parseInt(result!.match(/hsl\((\d+)/)![1]);
    expect(hue).toBeGreaterThanOrEqual(228);
    expect(hue).toBeLessThanOrEqual(252);
  });

  it('clamps saturation and lightness to expected ranges', () => {
    const data = makePixels([[255, 0, 0]], 4, 4);
    const result = dominantColorFromPixels(data, 4, 4)!;
    const sat = parseInt(result.match(/(\d+)%/)![1]);
    const lit = parseInt(result.match(/(\d+)%,\s*(\d+)%/)![2]);
    expect(sat).toBeGreaterThanOrEqual(50);
    expect(sat).toBeLessThanOrEqual(80);
    expect(lit).toBeGreaterThanOrEqual(35);
    expect(lit).toBeLessThanOrEqual(55);
  });
});
