function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s * 100, l * 100];
}

export function dominantColorFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const bucketCount = 30;
  const bucketSize = 360 / bucketCount;
  const counts = new Float64Array(bucketCount);
  const satSums = new Float64Array(bucketCount);
  const litSums = new Float64Array(bucketCount);
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const off = i * 4;
    const [h, s, l] = rgbToHsl(data[off], data[off + 1], data[off + 2]);
    if (l < 15 || l > 85 || s < 20) continue;
    const bucket = Math.min(Math.floor(h / bucketSize), bucketCount - 1);
    counts[bucket]++;
    satSums[bucket] += s;
    litSums[bucket] += l;
  }

  let best = -1;
  let bestCount = 0;
  for (let i = 0; i < bucketCount; i++) {
    if (counts[i] > bestCount) {
      bestCount = counts[i];
      best = i;
    }
  }

  if (best === -1) return null;

  const hue = Math.round((best + 0.5) * bucketSize);
  const sat = Math.round(Math.max(40, Math.min(70, satSums[best] / counts[best])));
  const lit = Math.round(Math.max(30, Math.min(50, litSums[best] / counts[best])));
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

export async function extractDominantColor(imageUrl: string): Promise<string | null> {
  const size = 20;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imageUrl;
    });

    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(size, size).getContext('2d');
    } else {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      ctx = c.getContext('2d');
    }
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    return dominantColorFromPixels(data, size, size);
  } catch {
    return null;
  }
}
