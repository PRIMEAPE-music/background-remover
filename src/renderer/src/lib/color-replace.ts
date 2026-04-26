import { rgbToLab, type RGB } from './color';
import { toleranceThreshold, type DistanceMode } from './bg-removal';

export interface ReplaceOptions {
  source: RGB;
  fill: RGB;
  /** 0-100 slider, defines the matched-pixel sphere around `source`. */
  sourceTolerance: number;
  /** 0-100 slider. fill==source preserves original variation; 0 = flat fill. */
  fillTolerance: number;
  mode: DistanceMode;
}

export interface HueShiftOptions {
  source: RGB;
  fill: RGB;
  sourceTolerance: number;
  mode: DistanceMode;
}

// Same precomputed sRGB→linear LUT as bg-removal — kept private to this file
// so neither has to expose its internals just to share the table.
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
const LAB_OFFSET = 16 / 116;

/**
 * Replace pixels near `source` with the equivalent point in a sphere around
 * `fill`. The new pixel = `fill + (pixel - source) * (fillTolerance/sourceTolerance)`,
 * computed in the chosen color space.
 *
 * Defaults that match the user's mental model:
 *   • `fillTolerance = sourceTolerance` → preserves shading variation.
 *   • `fillTolerance = 0` → flat fill: every matched pixel becomes exactly `fill`.
 *
 * Mutates `data` in place. Returns the number of pixels replaced.
 */
export function replaceColorGlobal(
  data: Uint8ClampedArray,
  options: ReplaceOptions,
): number {
  const sT = toleranceThreshold(options.sourceTolerance, options.mode);
  const fT = toleranceThreshold(options.fillTolerance, options.mode);
  // sT==0 only matches the exact source pixel; that single pixel becomes fill.
  // (Avoid a div-by-zero in the scale calc.)
  const scale = sT > 0 ? fT / sT : 0;
  const sTSq = sT * sT;
  const n = data.length;
  let replaced = 0;

  if (options.mode === 'rgb') {
    const sr = options.source.r;
    const sg = options.source.g;
    const sb = options.source.b;
    const fr = options.fill.r;
    const fg = options.fill.g;
    const fb = options.fill.b;
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      const dr = data[i] - sr;
      const dg = data[i + 1] - sg;
      const db = data[i + 2] - sb;
      if (dr * dr + dg * dg + db * db > sTSq) continue;
      const nr = fr + dr * scale;
      const ng = fg + dg * scale;
      const nb = fb + db * scale;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      replaced++;
    }
    return replaced;
  }

  // LAB path — match in LAB, build new LAB by scaled delta, convert back.
  // The forward pass is inlined like bg-removal.removeColorGlobal's. The
  // reverse path is in a tight helper; only matched pixels pay that cost.
  const sLab = rgbToLab(options.source);
  const fLab = rgbToLab(options.fill);
  const sL = sLab.l;
  const sA = sLab.a;
  const sB = sLab.b;
  const fL = fLab.l;
  const fA = fLab.a;
  const fB = fLab.b;
  const lut = SRGB_TO_LINEAR;
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
    const pL = 116 * fy - 16;
    const pA = 500 * (fx - fy);
    const pB = 200 * (fy - fz);
    const dL = pL - sL;
    const dA = pA - sA;
    const dB = pB - sB;
    if (dL * dL + dA * dA + dB * dB > sTSq) continue;
    const nLab_l = fL + dL * scale;
    const nLab_a = fA + dA * scale;
    const nLab_b = fB + dB * scale;
    // LAB → XYZ → linear sRGB → sRGB. Inlined to avoid the per-pixel
    // function-call + small-allocation overhead of color.labToRgb.
    const nfy = (nLab_l + 16) / 116;
    const nfx = nLab_a / 500 + nfy;
    const nfz = nfy - nLab_b / 200;
    const fx3 = nfx * nfx * nfx;
    const fy3 = nfy * nfy * nfy;
    const fz3 = nfz * nfz * nfz;
    const nX = (fx3 > LAB_EPSILON ? fx3 : (nfx - LAB_OFFSET) / LAB_KAPPA) * 0.95047;
    const nY = fy3 > LAB_EPSILON ? fy3 : (nfy - LAB_OFFSET) / LAB_KAPPA;
    const nZ = (fz3 > LAB_EPSILON ? fz3 : (nfz - LAB_OFFSET) / LAB_KAPPA) * 1.08883;
    const lR = 3.2404542 * nX + -1.5371385 * nY + -0.4985314 * nZ;
    const lG = -0.9692660 * nX + 1.8760108 * nY + 0.0415560 * nZ;
    const lB = 0.0556434 * nX + -0.2040259 * nY + 1.0572252 * nZ;
    const cR = lR < 0 ? 0 : lR > 1 ? 1 : lR;
    const cG = lG < 0 ? 0 : lG > 1 ? 1 : lG;
    const cB = lB < 0 ? 0 : lB > 1 ? 1 : lB;
    const sR = cR <= 0.0031308 ? 12.92 * cR : 1.055 * Math.pow(cR, 1 / 2.4) - 0.055;
    const sG = cG <= 0.0031308 ? 12.92 * cG : 1.055 * Math.pow(cG, 1 / 2.4) - 0.055;
    const sBch = cB <= 0.0031308 ? 12.92 * cB : 1.055 * Math.pow(cB, 1 / 2.4) - 0.055;
    data[i] = (sR * 255 + 0.5) | 0;
    data[i + 1] = (sG * 255 + 0.5) | 0;
    data[i + 2] = (sBch * 255 + 0.5) | 0;
    replaced++;
  }
  return replaced;
}

/**
 * Hue-shift mode: in-range pixels keep their lightness L and chroma magnitude
 * C, but their hue angle is rotated to match `fill`'s hue. Equivalent to a
 * Photoshop "Replace Color" hue swap done in LCH space (LAB's polar form).
 *
 * Use when:
 *   • You want a pure recolor with shading exactly preserved per pixel.
 *   • The source is a tint cast over varying brightness (e.g. magenta backlight).
 *
 * `fillTolerance` from the delta-scale flow is irrelevant here — the operation
 * doesn't have a "spread" knob; chroma comes from each source pixel.
 */
export function replaceColorHueShift(
  data: Uint8ClampedArray,
  options: HueShiftOptions,
): number {
  const sT = toleranceThreshold(options.sourceTolerance, options.mode);
  const sTSq = sT * sT;
  const fLab = rgbToLab(options.fill);
  // Fill hue as a unit vector — multiplying by the source pixel's chroma C
  // gives the new (a, b) in one shot.
  const fChroma = Math.sqrt(fLab.a * fLab.a + fLab.b * fLab.b);
  // If fill is grey (zero chroma), the hue is undefined. Treat that as
  // "desaturate" — set new a,b to zero so result is pure greyscale.
  const fCos = fChroma > 0 ? fLab.a / fChroma : 0;
  const fSin = fChroma > 0 ? fLab.b / fChroma : 0;
  const desaturate = fChroma === 0;
  const n = data.length;
  const lut = SRGB_TO_LINEAR;
  let replaced = 0;

  // Forward LAB pre-compute — used both for matching (LAB mode) and for the
  // hue-rotation transform (always). We always inline the forward pass so we
  // pay one conversion per pixel, not two.
  const sLabFull = rgbToLab(options.source);
  const sL = sLabFull.l;
  const sA = sLabFull.a;
  const sB = sLabFull.b;
  // RGB-mode match center (used only when options.mode === 'rgb').
  const sr = options.source.r;
  const sg = options.source.g;
  const sb = options.source.b;
  const matchInRgb = options.mode === 'rgb';

  for (let i = 0; i < n; i += 4) {
    if (data[i + 3] === 0) continue;

    // Forward: sRGB → linear → XYZ → LAB.
    const linR = lut[data[i]];
    const linG = lut[data[i + 1]];
    const linB = lut[data[i + 2]];
    const X = (linR * 0.4124564 + linG * 0.3575761 + linB * 0.1804375) * D65_X_INV;
    const Y = linR * 0.2126729 + linG * 0.7151522 + linB * 0.072175;
    const Z = (linR * 0.0193339 + linG * 0.119192 + linB * 0.9503041) * D65_Z_INV;
    const fx = X > LAB_EPSILON ? Math.cbrt(X) : LAB_KAPPA * X + LAB_OFFSET;
    const fy = Y > LAB_EPSILON ? Math.cbrt(Y) : LAB_KAPPA * Y + LAB_OFFSET;
    const fz = Z > LAB_EPSILON ? Math.cbrt(Z) : LAB_KAPPA * Z + LAB_OFFSET;
    const pL = 116 * fy - 16;
    const pA = 500 * (fx - fy);
    const pB = 200 * (fy - fz);

    // Match: distance² either in RGB or LAB.
    if (matchInRgb) {
      const dr = data[i] - sr;
      const dg = data[i + 1] - sg;
      const db = data[i + 2] - sb;
      if (dr * dr + dg * dg + db * db > sTSq) continue;
    } else {
      const dL = pL - sL;
      const dA = pA - sA;
      const dB = pB - sB;
      if (dL * dL + dA * dA + dB * dB > sTSq) continue;
    }

    // Rotate hue: keep L, keep chroma magnitude, replace direction.
    const C = Math.sqrt(pA * pA + pB * pB);
    const nLab_a = desaturate ? 0 : C * fCos;
    const nLab_b = desaturate ? 0 : C * fSin;

    // Reverse: LAB → XYZ → linear sRGB → sRGB. Inlined.
    const nfy = (pL + 16) / 116;
    const nfx = nLab_a / 500 + nfy;
    const nfz = nfy - nLab_b / 200;
    const fx3 = nfx * nfx * nfx;
    const fy3 = nfy * nfy * nfy;
    const fz3 = nfz * nfz * nfz;
    const nX = (fx3 > LAB_EPSILON ? fx3 : (nfx - LAB_OFFSET) / LAB_KAPPA) * 0.95047;
    const nY = fy3 > LAB_EPSILON ? fy3 : (nfy - LAB_OFFSET) / LAB_KAPPA;
    const nZ = (fz3 > LAB_EPSILON ? fz3 : (nfz - LAB_OFFSET) / LAB_KAPPA) * 1.08883;
    const lR = 3.2404542 * nX + -1.5371385 * nY + -0.4985314 * nZ;
    const lG = -0.9692660 * nX + 1.8760108 * nY + 0.0415560 * nZ;
    const lB = 0.0556434 * nX + -0.2040259 * nY + 1.0572252 * nZ;
    const cR = lR < 0 ? 0 : lR > 1 ? 1 : lR;
    const cG = lG < 0 ? 0 : lG > 1 ? 1 : lG;
    const cB = lB < 0 ? 0 : lB > 1 ? 1 : lB;
    const sR = cR <= 0.0031308 ? 12.92 * cR : 1.055 * Math.pow(cR, 1 / 2.4) - 0.055;
    const sG = cG <= 0.0031308 ? 12.92 * cG : 1.055 * Math.pow(cG, 1 / 2.4) - 0.055;
    const sBch = cB <= 0.0031308 ? 12.92 * cB : 1.055 * Math.pow(cB, 1 / 2.4) - 0.055;
    data[i] = (sR * 255 + 0.5) | 0;
    data[i + 1] = (sG * 255 + 0.5) | 0;
    data[i + 2] = (sBch * 255 + 0.5) | 0;
    replaced++;
  }
  return replaced;
}
