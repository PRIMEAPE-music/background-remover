import type { ProcShape } from '../builder';

/**
 * Render a procedural particle texture. White RGB everywhere; only alpha
 * varies. Phaser tints at emit time, so a single white texture serves every
 * color at runtime — and the generator stays simple.
 *
 * `softness` is 0–1: 0 = hard edge (1px transition), 1 = entire shape fades
 * radially from center. Each shape uses its own natural distance metric
 * (Euclidean for circle, Chebyshev for square, Manhattan for diamond, etc.)
 * so soft variants look "right" rather than always being a fuzzy circle
 * mask.
 */
export function renderProceduralTexture(
  shape: ProcShape,
  size: number,
  softness: number,
): ImageData {
  const s = Math.max(1, Math.floor(size));
  const data = new Uint8ClampedArray(s * s * 4);
  const soft = Math.max(0, Math.min(1, softness));
  switch (shape) {
    case 'circle':
      drawAnalytical(data, s, soft, distEuclid);
      break;
    case 'square':
      drawAnalytical(data, s, soft, distChebyshev);
      break;
    case 'diamond':
      drawAnalytical(data, s, soft, distManhattan);
      break;
    case 'triangle':
      drawTriangle(data, s, soft);
      break;
    case 'star':
      drawStar(data, s, soft);
      break;
  }
  return new ImageData(data, s, s);
}

// Distance functions: dx/dy are offsets from the shape's center.
type DistFn = (dx: number, dy: number) => number;

const distEuclid: DistFn = (dx, dy) => Math.hypot(dx, dy);
const distChebyshev: DistFn = (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy));
const distManhattan: DistFn = (dx, dy) => Math.abs(dx) + Math.abs(dy);

/**
 * Fill `data` (size × size, RGBA) with a shape whose alpha falls off according
 * to `dist`. Inside `inner`, alpha = 1; between `inner` and `r`, linear fade
 * to 0; outside `r`, alpha = 0.
 */
function drawAnalytical(
  data: Uint8ClampedArray,
  size: number,
  softness: number,
  dist: DistFn,
): void {
  const c = (size - 1) / 2;
  const r = (size - 1) / 2;
  const inner = r * (1 - softness);
  const fadeRange = Math.max(0.0001, r - inner);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = dist(x - c, y - c);
      let alpha: number;
      if (d <= inner) alpha = 1;
      else if (d <= r) alpha = 1 - (d - inner) / fadeRange;
      else alpha = 0;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
}

/**
 * Filled upward-pointing triangle. Uses 2D edge functions: a point is inside
 * iff all three signed edge tests have the same sign. The minimum signed
 * distance to any edge gives a smooth alpha falloff for soft variants.
 */
function drawTriangle(data: Uint8ClampedArray, size: number, softness: number): void {
  const top = { x: (size - 1) / 2, y: 0 };
  const bl = { x: 0, y: size - 1 };
  const br = { x: size - 1, y: size - 1 };
  // Reference sign from centroid (definitely inside).
  const cx = (top.x + bl.x + br.x) / 3;
  const cy = (top.y + bl.y + br.y) / 3;
  const refSign = Math.sign(edgeFn(top, bl, cx, cy));
  const falloff = Math.max(0.0001, softness * (size * 0.25));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Per-edge signed perpendicular distance, oriented so positive = inside.
      const d0 = (refSign * edgeFn(top, bl, x, y)) / edgeLen(top, bl);
      const d1 = (refSign * edgeFn(bl, br, x, y)) / edgeLen(bl, br);
      const d2 = (refSign * edgeFn(br, top, x, y)) / edgeLen(br, top);
      const minDist = Math.min(d0, d1, d2);
      let alpha: number;
      if (minDist >= falloff) alpha = 1;
      else if (minDist >= 0) alpha = minDist / falloff;
      else alpha = 0;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
}

// 2× signed area of triangle (P, a, b). Sign tells which side of edge a→b P is on.
function edgeFn(a: { x: number; y: number }, b: { x: number; y: number }, px: number, py: number): number {
  return (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
}
function edgeLen(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 5-point star. Polar coords: edge radius oscillates between an outer radius
 * (at the points) and an inner radius (between points) with a triangle wave
 * indexed by angle. A point is inside if its radius is ≤ the local edge
 * radius. Softness fades alpha across the local-edge-radius transition.
 */
function drawStar(data: Uint8ClampedArray, size: number, softness: number): void {
  const c = (size - 1) / 2;
  const rOuter = (size - 1) / 2;
  const rInner = rOuter * 0.4;
  const points = 5;
  const period = (Math.PI * 2) / points;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      // Normalize angle so 0 lands at the top point and grows clockwise.
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      const TWO_PI = Math.PI * 2;
      a = ((a % TWO_PI) + TWO_PI) % TWO_PI;
      const localT = (a % period) / period;        // 0..1 across one point
      const tri = localT < 0.5 ? localT * 2 : (1 - localT) * 2; // tent
      const edgeR = rOuter * (1 - tri) + rInner * tri;
      const inner = edgeR * (1 - softness);
      const fade = Math.max(0.0001, edgeR - inner);
      let alpha: number;
      if (r <= inner) alpha = 1;
      else if (r <= edgeR) alpha = 1 - (r - inner) / fade;
      else alpha = 0;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
