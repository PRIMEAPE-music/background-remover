export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
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
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(image.width, Math.floor(rx + rw));
  const y1 = Math.min(image.height, Math.floor(ry + rh));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 0;
      image.data[i + 1] = 0;
      image.data[i + 2] = 0;
      image.data[i + 3] = 0;
    }
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

/** Source-over composite `floater` onto `image` at (dx, dy). Returns new ImageData. */
export function compositeOnto(
  image: ImageData,
  floater: ImageData,
  dx: number,
  dy: number,
): ImageData {
  const base = document.createElement('canvas');
  base.width = image.width;
  base.height = image.height;
  const bctx = base.getContext('2d')!;
  bctx.putImageData(image, 0, 0);
  const fl = document.createElement('canvas');
  fl.width = floater.width;
  fl.height = floater.height;
  fl.getContext('2d')!.putImageData(floater, 0, 0);
  bctx.drawImage(fl, dx, dy);
  return bctx.getImageData(0, 0, image.width, image.height);
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
