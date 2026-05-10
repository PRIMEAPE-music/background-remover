/**
 * Auto-detect a walkable region for a platform sprite by analyzing the
 * alpha channel of the source image.
 *
 * Algorithm (median column-top):
 *  1. For each column, scan top-down and record the y of the first
 *     opaque pixel (alpha > threshold). Skip fully-transparent columns.
 *  2. Take the MEDIAN of those column-tops as the proposed walking
 *     surface y. The median is robust against narrow protrusions
 *     (stalactites, foliage that pokes up above the main top edge) and
 *     dropout columns at the edges of organic-shaped sprites.
 *  3. Build a single full-width region (with side margins to avoid
 *     dangling foliage) anchored at that y.
 *
 * Falls back to "image vertical center" only when the alpha analysis
 * doesn't have enough opaque pixels to be meaningful.
 *
 * Returns at most one region. The user can hand-tune it (or draw extra
 * regions for multi-tier / bridge platforms) in the Walkable editor.
 */
export interface DetectedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rightTopOffset?: number;
}

const ALPHA_THRESHOLD = 96; // ~38% — anything fainter is treated as background
const DEFAULT_BAND_HEIGHT = 32;
/** Fraction of the source width to leave clear on each side, so the
 *  proposal doesn't run all the way into ragged organic edges. */
const SIDE_MARGIN_FRAC = 0.04;
/** If fewer than this fraction of columns contain ANY opaque pixels,
 *  the image is too sparse to trust the median — fall back to center. */
const MIN_OPAQUE_COLUMN_FRAC = 0.4;

export function detectWalkableRegions(image: ImageData): DetectedRegion[] {
  const w = image.width;
  const h = image.height;
  if (w === 0 || h === 0) return [];

  const margin = Math.round(w * SIDE_MARGIN_FRAC);
  const left = margin;
  const right = w - margin;
  const width = Math.max(8, right - left);
  const data = image.data;

  // 1. Topmost opaque y per column. Skip the side-margin columns since
  //    they often catch shaggy edges that don't represent the walking
  //    surface.
  const tops: number[] = [];
  for (let x = left; x < right; x++) {
    for (let y = 0; y < h; y++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        tops.push(y);
        break;
      }
    }
  }

  // 2. Decide the surface y. Median when we have enough columns to
  //    be confident, else fall back to image vertical center.
  const minOpaque = Math.max(8, Math.round(width * MIN_OPAQUE_COLUMN_FRAC));
  let surfaceY: number;
  if (tops.length >= minOpaque) {
    tops.sort((a, b) => a - b);
    surfaceY = tops[Math.floor(tops.length / 2)];
  } else {
    surfaceY = Math.round(h / 2);
  }

  // 3. Anchor the band at surfaceY. Clamp height so the band stays
  //    inside the image bounds even when surfaceY is near the bottom.
  const height = Math.min(DEFAULT_BAND_HEIGHT, Math.max(8, h - surfaceY));
  return [{ x: left, y: surfaceY, width, height }];
}
