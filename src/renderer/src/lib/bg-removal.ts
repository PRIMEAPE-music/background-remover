import { labDistance, rgbToLab, type RGB } from './color';

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

function channelDistance(
  rgb: RGB,
  target: RGB,
  targetLab: { l: number; a: number; b: number },
  mode: DistanceMode,
): number {
  if (mode === 'lab') {
    return labDistance(rgbToLab(rgb), targetLab);
  }
  const dr = rgb.r - target.r;
  const dg = rgb.g - target.g;
  const db = rgb.b - target.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function removeColorGlobal(
  data: Uint8ClampedArray,
  target: RGB,
  options: RemovalOptions,
): number {
  const targetLab = rgbToLab(target);
  const threshold = toleranceThreshold(options.tolerance, options.mode);
  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const d = channelDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      target,
      targetLab,
      options.mode,
    );
    if (d <= threshold) {
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
  const targetLab = rgbToLab(target);
  const threshold = toleranceThreshold(options.tolerance, options.mode);

  const visited = new Uint8Array(width * height);
  const stack: number[] = [startY * width + startX];
  let removed = 0;

  while (stack.length > 0) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    const d = channelDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      target,
      targetLab,
      options.mode,
    );
    if (d > threshold) continue;
    data[i + 3] = 0;
    removed++;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
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
  // Average the samples — cheap, works well for uniform backgrounds.
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
