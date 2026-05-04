import { renderProceduralTexture } from './proceduralTexture';

/**
 * A built-in texture is a named, pre-rendered ImageData factory. The seeder
 * (lib/particles/seedBuiltins.ts) PNG-encodes each one and writes it into the
 * cross-project texture bank on first run, so they appear alongside any
 * custom textures the user imports. Most are pre-rendered procedural variants
 * that would otherwise need awkward parameter tweaking; a few are custom
 * compositions that aren't expressible as a single procedural shape.
 */
export interface BuiltinTexture {
  /** Bank filename without extension. Becomes `<name>.png` on disk. */
  name: string;
  description: string;
  generate(): ImageData;
}

export const BUILTIN_TEXTURES: BuiltinTexture[] = [
  // Dots & circles.
  { name: 'dot-tiny',     description: 'Tiny hard pixel dot (4×4)',         generate: () => renderProceduralTexture('circle', 4, 0) },
  { name: 'dot-small',    description: 'Small hard circle (6×6)',           generate: () => renderProceduralTexture('circle', 6, 0) },
  { name: 'dot-soft',     description: 'Soft falloff dot (8×8)',            generate: () => renderProceduralTexture('circle', 8, 0.7) },
  { name: 'circle-soft',  description: 'Soft circle (16×16)',               generate: () => renderProceduralTexture('circle', 16, 0.6) },
  { name: 'circle-large', description: 'Large hard circle (12×12)',         generate: () => renderProceduralTexture('circle', 12, 0) },
  { name: 'glow-soft',    description: 'Wide soft halo (24×24)',            generate: () => renderProceduralTexture('circle', 24, 0.85) },

  // Squares.
  { name: 'pixel',        description: '1×1 white pixel',                   generate: () => makePixel() },
  { name: 'square-small', description: '4×4 hard square',                   generate: () => renderProceduralTexture('square', 4, 0) },
  { name: 'square-soft',  description: 'Soft 8×8 square',                   generate: () => renderProceduralTexture('square', 8, 0.5) },

  // Diamonds.
  { name: 'diamond-small', description: 'Small diamond (6×6)',              generate: () => renderProceduralTexture('diamond', 6, 0) },
  { name: 'diamond-soft',  description: 'Soft diamond (10×10)',             generate: () => renderProceduralTexture('diamond', 10, 0.4) },

  // Stars.
  { name: 'star-small',   description: '5-point star (8×8)',                generate: () => renderProceduralTexture('star', 8, 0) },
  { name: 'star-soft',    description: 'Soft 5-point star (12×12)',         generate: () => renderProceduralTexture('star', 12, 0.4) },

  // Triangles.
  { name: 'triangle-small', description: 'Small triangle (6×6)',            generate: () => renderProceduralTexture('triangle', 6, 0) },

  // Custom compositions — not expressible as a single procedural shape.
  { name: 'spark-h',      description: 'Horizontal hard spark (10×3)',      generate: () => makeSpark(10, 3, 0) },
  { name: 'spark-v',      description: 'Vertical hard spark (3×10)',        generate: () => makeSpark(3, 10, 0) },
  { name: 'spark-soft',   description: 'Soft horizontal spark (12×4)',      generate: () => makeSpark(12, 4, 0.6) },
  { name: 'ring',         description: 'Hollow circle ring (12×12)',        generate: () => makeRing(12, 0.65, 0) },
  { name: 'ring-soft',    description: 'Soft hollow ring (16×16)',          generate: () => makeRing(16, 0.55, 0.6) },
  { name: 'cross',        description: 'Plus sign (8×8)',                   generate: () => makeCross(8) },
  { name: 'ember',        description: 'Hot ember w/ halo (10×10)',         generate: () => makeEmber(10) },
];

// ---- Custom compositions -----------------------------------------------

function makePixel(): ImageData {
  return new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1);
}

/**
 * Long thin spark. `softness` 0–1 controls a longitudinal falloff: 0 = hard
 * rectangle, 1 = bright center fading to invisible at the long-axis ends and
 * a faint glow around the edges.
 */
function makeSpark(w: number, h: number, softness: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const halfLong = Math.max(w, h) / 2;
  const halfShort = Math.min(w, h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / halfLong;            // -1..1 along the long axis
      const dy = (y - cy) / Math.max(1, halfShort); // -1..1 across short axis
      // Hard rectangle inside the bounds; soft fade applies a smooth falloff
      // that's stronger along the long axis (typical spark look).
      const longFade = softness > 0 ? 1 - Math.abs(dx) ** 2 : 1;
      const shortFade = 1 - Math.abs(dy) ** (softness > 0 ? 2 : 8);
      const alpha = clamp01(longFade * shortFade);
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  return new ImageData(data, w, h);
}

/**
 * Hollow circle. `holeRatio` is the inner-radius / outer-radius (e.g. 0.6
 * leaves a ring 40% as thick as the outer radius). `softness` smooths both
 * the outer edge and the inner hole.
 */
function makeRing(size: number, holeRatio: number, softness: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  const rOuter = (size - 1) / 2;
  const rInner = rOuter * holeRatio;
  const fade = Math.max(0.0001, softness * (rOuter - rInner) * 0.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      let alpha = 0;
      if (r <= rInner - fade) {
        alpha = 0; // inside the hole
      } else if (r < rInner) {
        alpha = (r - (rInner - fade)) / fade; // fade in at hole edge
      } else if (r <= rOuter - fade) {
        alpha = 1; // ring body
      } else if (r <= rOuter) {
        alpha = 1 - (r - (rOuter - fade)) / fade; // fade out at outer edge
      }
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return new ImageData(data, size, size);
}

function makeCross(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  // Vertical and horizontal arms of equal thickness.
  const armHalf = Math.max(1, Math.round(size * 0.15));
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onH = Math.abs(y - c) <= armHalf;
      const onV = Math.abs(x - c) <= armHalf;
      const alpha = onH || onV ? 1 : 0;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  return new ImageData(data, size, size);
}

/**
 * Bright hot center with a soft glow halo. Uses a two-zone Euclidean falloff:
 * inner solid white core, outer falloff that approaches 0 at the bounds.
 */
function makeEmber(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  const r = (size - 1) / 2;
  const coreR = r * 0.35;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let alpha: number;
      if (d <= coreR) {
        alpha = 1;
      } else if (d <= r) {
        // Quadratic falloff for a glow-like haze rather than a linear ramp.
        const t = (d - coreR) / (r - coreR);
        alpha = (1 - t) * (1 - t);
      } else {
        alpha = 0;
      }
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return new ImageData(data, size, size);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
