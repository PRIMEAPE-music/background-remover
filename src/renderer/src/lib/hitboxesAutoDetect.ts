import type { HitboxRect } from "./hitboxes";

/**
 * Alpha-channel pixel sampling helpers used by the Hitboxes editor's
 * auto-fit / snap / pick features.
 *
 * Three operations:
 *   - `tightBoundsInFrame`: scan an entire frame and return the
 *     smallest rect containing all opaque pixels (default-body fit).
 *   - `tightBoundsInRect`: scan inside an existing rect and return the
 *     shrunk rect containing opaque pixels (snap-to-content).
 *   - `floodFillBounds`: BFS from a starting pixel through contiguous
 *     opaque pixels and return the bounding rect of the blob (alt-click
 *     region picker).
 *
 * Sheets are loaded once into an ImageData cache keyed by the blob URL
 * that the editor passes around, so repeated scans of the same sheet
 * don't pay for a fresh decode.
 */

/** Alpha value above which a pixel counts as "solid". 32 (out of 255)
 *  ignores faint antialiasing edges, which gives tighter, more useful
 *  bounding rects than `> 0` would. */
const ALPHA_THRESHOLD = 32;

const sheetCache = new Map<string, ImageData>();

/** Decode a blob-URL sprite sheet into ImageData once. Subsequent
 *  calls return the cached copy. Pass `bust=true` to force re-decode
 *  (e.g. after the underlying PNG changed on disk and the URL was
 *  re-blobbed). */
export async function loadSheetImageData(
  url: string,
  bust = false,
): Promise<ImageData> {
  if (!bust) {
    const cached = sheetCache.get(url);
    if (cached) return cached;
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("hitboxesAutoDetect: 2d context unavailable");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  sheetCache.set(url, data);
  return data;
}

/** Drop a cached sheet — call when the editor reloads or the sheet
 *  URL is revoked. */
export function invalidateSheetCache(url?: string): void {
  if (url) sheetCache.delete(url);
  else sheetCache.clear();
}

/** Compute the tight bounding rect of opaque pixels in a single
 *  frame. Returns null when the frame is entirely transparent. */
export function tightBoundsInFrame(
  sheetData: ImageData,
  frameIndex: number,
  frameWidth: number,
  frameHeight: number,
  alphaThreshold = ALPHA_THRESHOLD,
): HitboxRect | null {
  const startX = frameIndex * frameWidth;
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  const sheetW = sheetData.width;
  const data = sheetData.data;
  for (let y = 0; y < frameHeight; y++) {
    const rowOffset = y * sheetW * 4;
    for (let x = 0; x < frameWidth; x++) {
      const alpha = data[rowOffset + (startX + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

/** Snap an existing rect to the tight bounds of opaque pixels INSIDE
 *  it. Returns null when the rect is entirely over transparent
 *  pixels. The caller is responsible for preserving other rect fields
 *  (tag, damage, etc.) — this only returns x/y/w/h. */
export function tightBoundsInRect(
  sheetData: ImageData,
  frameIndex: number,
  frameWidth: number,
  frameHeight: number,
  searchRect: HitboxRect,
  alphaThreshold = ALPHA_THRESHOLD,
): HitboxRect | null {
  const startSheetX = frameIndex * frameWidth;
  // Clip search bounds to frame.
  const sx0 = Math.max(0, Math.floor(searchRect.x));
  const sy0 = Math.max(0, Math.floor(searchRect.y));
  const sx1 = Math.min(frameWidth, Math.ceil(searchRect.x + searchRect.w));
  const sy1 = Math.min(frameHeight, Math.ceil(searchRect.y + searchRect.h));
  if (sx1 <= sx0 || sy1 <= sy0) return null;
  let minX = sx1;
  let minY = sy1;
  let maxX = -1;
  let maxY = -1;
  const sheetW = sheetData.width;
  const data = sheetData.data;
  for (let y = sy0; y < sy1; y++) {
    const rowOffset = y * sheetW * 4;
    for (let x = sx0; x < sx1; x++) {
      const alpha = data[rowOffset + (startSheetX + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

/** Flood-fill from a starting pixel through contiguous opaque pixels
 *  (4-connectivity), returning the bounding rect of the entire blob.
 *  Returns null when the starting pixel is transparent.
 *
 *  Used by alt-click: user clicks a pixel inside a visible body part
 *  (head, weapon, etc.), the editor walks the connected region and
 *  hands back a tight rect for that part. */
export function floodFillBounds(
  sheetData: ImageData,
  frameIndex: number,
  frameWidth: number,
  frameHeight: number,
  startX: number,
  startY: number,
  alphaThreshold = ALPHA_THRESHOLD,
): HitboxRect | null {
  if (startX < 0 || startY < 0 || startX >= frameWidth || startY >= frameHeight) {
    return null;
  }
  const sheetStartX = frameIndex * frameWidth;
  const sheetW = sheetData.width;
  const data = sheetData.data;

  const isOpaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) return false;
    const idx = (y * sheetW + (sheetStartX + x)) * 4 + 3;
    return data[idx] > alphaThreshold;
  };
  if (!isOpaque(startX, startY)) return null;

  // Visited bitset — Uint8Array sized to the frame, 1 byte per pixel.
  // Cheaper than a Set<number> for 512×512 = 262144 pixels and avoids
  // hash overhead in the hot loop.
  const visited = new Uint8Array(frameWidth * frameHeight);
  visited[startY * frameWidth + startX] = 1;
  let minX = startX,
    minY = startY,
    maxX = startX,
    maxY = startY;

  // Stack-based DFS (LIFO). Faster than Array.shift() FIFO for blob
  // walks that go several thousand pixels deep.
  const stack: number[] = [startY * frameWidth + startX];
  while (stack.length > 0) {
    const packed = stack.pop()!;
    const x = packed % frameWidth;
    const y = (packed - x) / frameWidth;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    // 4-neighbor expansion.
    const tryPush = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= frameWidth || ny >= frameHeight) return;
      const k = ny * frameWidth + nx;
      if (visited[k]) return;
      if (!isOpaque(nx, ny)) return;
      visited[k] = 1;
      stack.push(k);
    };
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}
