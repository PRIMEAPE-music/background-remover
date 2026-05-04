import type { SliceBorders } from './platforms';

/**
 * Render a 9-sliced platform sprite to a canvas at a target size.
 *
 * Splits the source into 9 regions using the slice borders, then for each
 * region picks the right destination geometry: corners stay at fixed size,
 * edges stretch along their long axis, middle stretches both axes. For
 * AscensionGame's platform use case the height is typically the source's
 * native height (32 px) — only the horizontal axis stretches.
 *
 * Pure: returns a fresh canvas, doesn't mutate state. Used by the editor's
 * live preview and (in Slice 5) by AscensionGame's PlatformTextureManager.
 */
export function renderNineSlice(
  source: HTMLCanvasElement | ImageData,
  borders: SliceBorders,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(targetWidth));
  out.height = Math.max(1, Math.round(targetHeight));
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.imageSmoothingEnabled = false;

  // Stage the source as a canvas — drawImage takes canvases or ImageBitmaps,
  // not raw ImageData.
  const srcCanvas =
    source instanceof HTMLCanvasElement ? source : imageDataToCanvas(source);
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  // Clamp borders to source dimensions and to non-overlapping configurations.
  // If left + right > sw, the middle would have negative width — fall back to
  // a hard cap that puts left/right against each other and squashes the
  // middle to zero.
  const bl = clamp(borders.left, 0, sw);
  const br = clamp(borders.right, 0, sw - bl);
  const bt = clamp(borders.top, 0, sh);
  const bb = clamp(borders.bottom, 0, sh - bt);

  // Source slice rectangles.
  const sLeftEnd = bl;
  const sRightStart = sw - br;
  const sMidW = Math.max(0, sRightStart - sLeftEnd);
  const sTopEnd = bt;
  const sBottomStart = sh - bb;
  const sMidH = Math.max(0, sBottomStart - sTopEnd);

  // Target slice rectangles. Corners stay native size. If target is smaller
  // than the corners combined, the middle gets a negative size and we skip it.
  const tLeftEnd = bl;
  const tRightStart = out.width - br;
  const tMidW = Math.max(0, tRightStart - tLeftEnd);
  const tTopEnd = bt;
  const tBottomStart = out.height - bb;
  const tMidH = Math.max(0, tBottomStart - tTopEnd);

  const draw = (
    sx: number,
    sy: number,
    sWidth: number,
    sHeight: number,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ) => {
    if (sWidth <= 0 || sHeight <= 0 || dWidth <= 0 || dHeight <= 0) return;
    ctx.drawImage(srcCanvas, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
  };

  // Top row: TL, TC, TR
  draw(0, 0, bl, bt, 0, 0, bl, bt);
  draw(sLeftEnd, 0, sMidW, bt, tLeftEnd, 0, tMidW, bt);
  draw(sRightStart, 0, br, bt, tRightStart, 0, br, bt);

  // Middle row: ML, MC, MR
  draw(0, sTopEnd, bl, sMidH, 0, tTopEnd, bl, tMidH);
  draw(sLeftEnd, sTopEnd, sMidW, sMidH, tLeftEnd, tTopEnd, tMidW, tMidH);
  draw(sRightStart, sTopEnd, br, sMidH, tRightStart, tTopEnd, br, tMidH);

  // Bottom row: BL, BC, BR
  draw(0, sBottomStart, bl, bb, 0, tBottomStart, bl, bb);
  draw(sLeftEnd, sBottomStart, sMidW, bb, tLeftEnd, tBottomStart, tMidW, bb);
  draw(sRightStart, sBottomStart, br, bb, tRightStart, tBottomStart, br, bb);

  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(img, 0, 0);
  return c;
}
