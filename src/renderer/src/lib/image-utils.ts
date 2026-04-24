export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

/**
 * Zero the alpha of every pixel inside a filled circle (cx, cy, radius).
 * Mutates `data` in place — caller is responsible for history + version bump.
 */
export function eraseCircle(
  data: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    if (x >= 0 && y >= 0 && x < imageW && y < imageH) {
      data[(y * imageW + x) * 4 + 3] = 0;
    }
    return;
  }
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(imageW - 1, Math.floor(cx + r));
  const y1 = Math.min(imageH - 1, Math.floor(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const rowStart = y * imageW * 4;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) {
        data[rowStart + x * 4 + 3] = 0;
      }
    }
  }
}

/**
 * Thick line from (x0,y0) to (x1,y1) of `radius` — interpolated sample
 * circles every pixel of the travel distance so fast drags don't leave gaps
 * between frames.
 */
export function eraseStroke(
  data: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    eraseCircle(data, imageW, imageH, x0 + dx * t, y0 + dy * t, radius);
  }
}

/**
 * Return a new ImageData of `newW × newH`, with `src` centered inside and
 * transparent padding elsewhere. Used to give Select+Move extra room when a
 * crowded sheet needs sprites spread out before auto-detecting blobs.
 */
export function expandCanvas(src: ImageData, newW: number, newH: number): ImageData {
  const w = Math.max(src.width, Math.floor(newW));
  const h = Math.max(src.height, Math.floor(newH));
  const out = new Uint8ClampedArray(w * h * 4);
  const dx = Math.floor((w - src.width) / 2);
  const dy = Math.floor((h - src.height) / 2);
  const srcData = src.data;
  const srcW = src.width;
  const srcH = src.height;
  for (let y = 0; y < srcH; y++) {
    const srcStart = y * srcW * 4;
    const dstStart = ((y + dy) * w + dx) * 4;
    out.set(srcData.subarray(srcStart, srcStart + srcW * 4), dstStart);
  }
  return new ImageData(out, w, h);
}

export async function loadImageFromBytes(bytes: Uint8Array, mime = 'image/png'): Promise<ImageData> {
  // createImageBitmap decodes off the main thread — much faster than going
  // through an HTMLImageElement, and skips the URL.createObjectURL round-trip.
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export async function imageDataToPngBytes(data: ImageData): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  return await blob.arrayBuffer();
}

/** Clear (make transparent) a rectangle of `image` in-place. */
export function clearRect(
  image: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): void {
  const iw = image.width;
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(iw, Math.floor(rx + rw));
  const y1 = Math.min(image.height, Math.floor(ry + rh));
  const rowBytes = (x1 - x0) * 4;
  if (rowBytes <= 0) return;
  const data = image.data;
  // `Uint8ClampedArray.fill` walks native memory — far faster than a JS-level
  // nested per-pixel loop when the rect spans many rows.
  for (let y = y0; y < y1; y++) {
    const start = (y * iw + x0) * 4;
    data.fill(0, start, start + rowBytes);
  }
}

/** Extract a rectangular region as a new ImageData. Copies pixels directly. */
export function extractRect(
  image: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): ImageData {
  const w = Math.max(1, Math.floor(rw));
  const h = Math.max(1, Math.floor(rh));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx0 = Math.max(0, Math.floor(rx));
  const sy0 = Math.max(0, Math.floor(ry));
  const sx1 = Math.min(image.width, Math.floor(rx + rw));
  const sy1 = Math.min(image.height, Math.floor(ry + rh));
  const srcW = image.width;
  const src = image.data;
  for (let y = sy0; y < sy1; y++) {
    const srcStart = (y * srcW + sx0) * 4;
    const srcEnd = srcStart + (sx1 - sx0) * 4;
    const dstStart = ((y - Math.floor(ry)) * w + (sx0 - Math.floor(rx))) * 4;
    out.set(src.subarray(srcStart, srcEnd), dstStart);
  }
  return new ImageData(out, w, h);
}

/**
 * Source-over composite `floater` onto `image` at (dx, dy). Returns new ImageData.
 * Pure typed-array pass over just the floater pixels — avoids the two-canvas
 * + getImageData round-trip (which was 3-4 full-image memcpys) that the old
 * implementation used. The `image`-sized copy is a single `Uint8ClampedArray`
 * constructor call.
 */
export function compositeOnto(
  image: ImageData,
  floater: ImageData,
  dx: number,
  dy: number,
): ImageData {
  const iw = image.width;
  const ih = image.height;
  const fw = floater.width;
  const fh = floater.height;
  const out = new Uint8ClampedArray(image.data); // single memcpy of the base
  const src = floater.data;

  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(iw, Math.floor(dx + fw));
  const y1 = Math.min(ih, Math.floor(dy + fh));

  for (let y = y0; y < y1; y++) {
    const sy = y - Math.floor(dy);
    let si = (sy * fw + (x0 - Math.floor(dx))) * 4;
    let di = (y * iw + x0) * 4;
    for (let x = x0; x < x1; x++, si += 4, di += 4) {
      const sa = src[si + 3];
      if (sa === 0) continue;
      if (sa === 255) {
        // Fast path — sprite pixels are almost always fully opaque or fully
        // transparent, so this branch covers the vast majority of work.
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = 255;
        continue;
      }
      const a = sa / 255;
      const inv = 1 - a;
      const da = out[di + 3];
      out[di] = src[si] * a + out[di] * inv;
      out[di + 1] = src[si + 1] * a + out[di + 1] * inv;
      out[di + 2] = src[si + 2] * a + out[di + 2] * inv;
      out[di + 3] = sa + da * inv;
    }
  }
  return new ImageData(out, iw, ih);
}

// Cached 2×2-cell pattern canvas, keyed by cell size. Using a repeating
// CanvasPattern collapses the O(w·h/size²) fillRect loop into a single fillRect.
const checkerPatternCache = new Map<number, HTMLCanvasElement>();
function checkerPatternCanvas(size: number): HTMLCanvasElement {
  let off = checkerPatternCache.get(size);
  if (off) return off;
  off = document.createElement('canvas');
  off.width = size * 2;
  off.height = size * 2;
  const c = off.getContext('2d')!;
  c.fillStyle = '#3a3a44';
  c.fillRect(0, 0, size, size);
  c.fillRect(size, size, size, size);
  c.fillStyle = '#4a4a54';
  c.fillRect(size, 0, size, size);
  c.fillRect(0, size, size, size);
  checkerPatternCache.set(size, off);
  return off;
}

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  size = 8,
): void {
  const cellSize = Math.max(1, Math.round(size));
  const pattern = ctx.createPattern(checkerPatternCanvas(cellSize), 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
}
