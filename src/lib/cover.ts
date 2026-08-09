/**
 * Downscale embedded cover art before it is persisted: source files often
 * carry 1000px+ multi-MB art, while the UI never renders covers larger than
 * ~136px (the hero orb). Contract: NEVER worse than the original — any
 * failure, unsupported browser path, or already-small image returns the
 * original blob unchanged.
 *
 * Main-thread Image + canvas + toBlob on purpose (not OffscreenCanvas),
 * matching the documented rationale in src/lib/colors.ts — drawImage over
 * blob URLs has edge cases in some browser contexts that the regular canvas
 * path avoids. The per-image cost (~tens of ms) amortizes fine across ingest
 * since the CPU-heavy tag parsing now happens off-thread.
 */
export function downscaleCover(
  blob: Blob,
  max = 512,
  /** Safety net: environments whose Image never fires load/error (happy-dom)
   *  — and any stuck decode — resolve with the original after this long. */
  decodeTimeoutMs = 3000,
): Promise<Blob> {
  return new Promise((resolve) => {
    let url: string | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (result: Blob) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      resolve(result);
    };
    timer = setTimeout(() => done(blob), decodeTimeoutMs);
    try {
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const { naturalWidth: w, naturalHeight: h } = img;
          if (!w || !h || (w <= max && h <= max)) return done(blob);
          const scale = max / Math.max(w, h);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) return done(blob);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (out) => done(out && out.size > 0 && out.size < blob.size ? out : blob),
            'image/jpeg',
            0.85,
          );
        } catch {
          done(blob);
        }
      };
      img.onerror = () => done(blob);
      img.src = url;
    } catch {
      done(blob);
    }
  });
}
