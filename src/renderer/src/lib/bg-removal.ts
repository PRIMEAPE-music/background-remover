import { rgbToLab, type RGB } from './color';

export type DistanceMode = 'lab' | 'rgb';

export interface RemovalOptions {
  tolerance: number;
  mode: DistanceMode;
}

// LAB distances are ~0-100 perceptual, RGB distances are ~0-441 raw.
// The UI feeds a 0-100 slider; convert to mode-appropriate threshold.
export function toleranceThreshold(tolerance: number, mode: DistanceMode): number {
  return mode === 'lab' ? tolerance : (tolerance / 100) * 441;
}

// Precomputed sRGB-to-linear table. Eliminates 3 `Math.pow` calls per pixel —
// by far the hottest operation in LAB-mode removal on large sheets.
const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

const D65_X_INV = 1 / 0.95047;
const D65_Z_INV = 1 / 1.08883;
const LAB_EPSILON = 0.008856;
const LAB_KAPPA = 7.787;
const LAB_OFFSET = 16 / 116; // 0.137931…

export function removeColorGlobal(
  data: Uint8ClampedArray,
  target: RGB,
  options: RemovalOptions,
): number {
  const threshold = toleranceThreshold(options.tolerance, options.mode);
  const thresholdSq = threshold * threshold;
  const lut = SRGB_TO_LINEAR;
  const n = data.length;
  let removed = 0;

  if (options.mode === 'rgb') {
    const tr = target.r;
    const tg = target.g;
    const tb = target.b;
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      const dr = data[i] - tr;
      const dg = data[i + 1] - tg;
      const db = data[i + 2] - tb;
      if (dr * dr + dg * dg + db * db <= thresholdSq) {
        data[i + 3] = 0;
        removed++;
      }
    }
    return removed;
  }

  // LAB path — all math inlined, no per-pixel allocations.
  const tLab = rgbToLab(target);
  const tL = tLab.l;
  const tA = tLab.a;
  const tB = tLab.b;
  for (let i = 0; i < n; i += 4) {
    if (data[i + 3] === 0) continue;
    const linR = lut[data[i]];
    const linG = lut[data[i + 1]];
    const linB = lut[data[i + 2]];
    const X = (linR * 0.4124564 + linG * 0.3575761 + linB * 0.1804375) * D65_X_INV;
    const Y = linR * 0.2126729 + linG * 0.7151522 + linB * 0.072175;
    const Z = (linR * 0.0193339 + linG * 0.119192 + linB * 0.9503041) * D65_Z_INV;
    const fx = X > LAB_EPSILON ? Math.cbrt(X) : LAB_KAPPA * X + LAB_OFFSET;
    const fy = Y > LAB_EPSILON ? Math.cbrt(Y) : LAB_KAPPA * Y + LAB_OFFSET;
    const fz = Z > LAB_EPSILON ? Math.cbrt(Z) : LAB_KAPPA * Z + LAB_OFFSET;
    const dL = 116 * fy - 16 - tL;
    const dA = 500 * (fx - fy) - tA;
    const dB = 200 * (fy - fz) - tB;
    if (dL * dL + dA * dA + dB * dB <= thresholdSq) {
      data[i + 3] = 0;
      removed++;
    }
  }
  return removed;
}

export function removeColorFlood(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  options: RemovalOptions,
): number {
  const startIdx = (startY * width + startX) * 4;
  if (data[startIdx + 3] === 0) return 0;
  const target: RGB = { r: data[startIdx], g: data[startIdx + 1], b: data[startIdx + 2] };
  const threshold = toleranceThreshold(options.tolerance, options.mode);
  const thresholdSq = threshold * threshold;
  const lut = SRGB_TO_LINEAR;

  const visited = new Uint8Array(width * height);
  // Typed-array stack avoids boxing every pixel index into a JS Number object.
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = startY * width + startX;

  let removed = 0;
  const isRgb = options.mode === 'rgb';
  const tr = target.r;
  const tg = target.g;
  const tb = target.b;
  let tL = 0;
  let tA = 0;
  let tB = 0;
  if (!isRgb) {
    const tLab = rgbToLab(target);
    tL = tLab.l;
    tA = tLab.a;
    tB = tLab.b;
  }

  while (top > 0) {
    const p = stack[--top];
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (data[i + 3] === 0) continue;

    let distSq: number;
    if (isRgb) {
      const dr = data[i] - tr;
      const dg = data[i + 1] - tg;
      const db = data[i + 2] - tb;
      distSq = dr * dr + dg * dg + db * db;
    } else {
      const linR = lut[data[i]];
      const linG = lut[data[i + 1]];
      const linB = lut[data[i + 2]];
      const X = (linR * 0.4124564 + linG * 0.3575761 + linB * 0.1804375) * D65_X_INV;
      const Y = linR * 0.2126729 + linG * 0.7151522 + linB * 0.072175;
      const Z = (linR * 0.0193339 + linG * 0.119192 + linB * 0.9503041) * D65_Z_INV;
      const fx = X > LAB_EPSILON ? Math.cbrt(X) : LAB_KAPPA * X + LAB_OFFSET;
      const fy = Y > LAB_EPSILON ? Math.cbrt(Y) : LAB_KAPPA * Y + LAB_OFFSET;
      const fz = Z > LAB_EPSILON ? Math.cbrt(Z) : LAB_KAPPA * Z + LAB_OFFSET;
      const dL = 116 * fy - 16 - tL;
      const dA = 500 * (fx - fy) - tA;
      const dB = 200 * (fy - fz) - tB;
      distSq = dL * dL + dA * dA + dB * dB;
    }

    if (distSq > thresholdSq) continue;
    data[i + 3] = 0;
    removed++;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack[top++] = p - 1;
    if (x < width - 1) stack[top++] = p + 1;
    if (y > 0) stack[top++] = p - width;
    if (y < height - 1) stack[top++] = p + width;
  }
  return removed;
}

// Sample the four image corners and return the most common color.
export function detectBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sampleSize = 4,
): RGB {
  const samples: RGB[] = [];
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      for (let dy = 0; dy < sampleSize; dy++) {
        for (let dx = 0; dx < sampleSize; dx++) {
          const x = cx === 0 ? dx : width - 1 - dx;
          const y = cy === 0 ? dy : height - 1 - dy;
          const i = (y * width + x) * 4;
          if (data[i + 3] === 0) continue;
          samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        }
      }
    }
  }
  if (samples.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const s of samples) {
    r += s.r;
    g += s.g;
    b += s.b;
  }
  return {
    r: Math.round(r / samples.length),
    g: Math.round(g / samples.length),
    b: Math.round(b / samples.length),
  };
}
