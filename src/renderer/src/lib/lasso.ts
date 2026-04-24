import type { Rect } from './slicing';

export interface Point {
  x: number;
  y: number;
}

export function polygonBounds(pts: Point[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
  };
}

/**
 * Zero the alpha of any pixel in `data` that falls outside `polygon`.
 * Polygon points are in image coords; `rectX`/`rectY` is where `data` sits
 * inside the source image, so we translate into local data coords.
 * Uses a per-row scanline fill (even-odd rule).
 */
export function applyPolygonMask(
  data: ImageData,
  polygon: Point[],
  rectX: number,
  rectY: number,
): void {
  const n = polygon.length;
  if (n < 3) {
    // Degenerate — clear everything so caller gets an empty floater rather
    // than the full rect.
    data.data.fill(0);
    return;
  }
  const local: Point[] = polygon.map((p) => ({ x: p.x - rectX, y: p.y - rectY }));
  const { width, height } = data;
  const px = data.data;
  const nodes = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const yy = y + 0.5;
    let count = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = local[i].y;
      const yj = local[j].y;
      if ((yi <= yy && yj > yy) || (yj <= yy && yi > yy)) {
        nodes[count++] = local[i].x + ((yy - yi) / (yj - yi)) * (local[j].x - local[i].x);
      }
    }
    // Sort just the populated portion.
    const active = Array.from(nodes.subarray(0, count)).sort((a, b) => a - b);
    const rowStart = y * width * 4;
    let cursor = 0;
    for (let k = 0; k + 1 < active.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(active[k]));
      const xEnd = Math.min(width, Math.floor(active[k + 1]));
      for (let xi = cursor; xi < xStart; xi++) px[rowStart + xi * 4 + 3] = 0;
      cursor = Math.max(cursor, xEnd);
    }
    for (let xi = cursor; xi < width; xi++) px[rowStart + xi * 4 + 3] = 0;
  }
}

/** SVG-path "d" attribute for a closed polyline. */
export function polygonToPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d + ' Z';
}
