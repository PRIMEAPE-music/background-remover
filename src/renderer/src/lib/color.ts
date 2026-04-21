export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface LAB {
  l: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// sRGB → XYZ → LAB (D65 illuminant)
export function rgbToLab({ r, g, b }: RGB): LAB {
  const srgb = [r / 255, g / 255, b / 255].map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  const [R, G, B] = srgb;
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Inverse of `rgbToLab`. Clamps out-of-gamut results to valid sRGB. */
export function labToRgb(lab: LAB): RGB {
  const fy = (lab.l + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const fx3 = fx * fx * fx;
  const fy3 = fy * fy * fy;
  const fz3 = fz * fz * fz;
  const X = (fx3 > 0.008856 ? fx3 : (fx - 16 / 116) / 7.787) * 0.95047;
  const Y = fy3 > 0.008856 ? fy3 : (fy - 16 / 116) / 7.787;
  const Z = (fz3 > 0.008856 ? fz3 : (fz - 16 / 116) / 7.787) * 1.08883;
  const linR = 3.2404542 * X + -1.5371385 * Y + -0.4985314 * Z;
  const linG = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const linB = 0.0556434 * X + -0.2040259 * Y + 1.0572252 * Z;
  const toSrgb = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    const c = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return { r: toSrgb(linR), g: toSrgb(linG), b: toSrgb(linB) };
}

export function labDistance(a: LAB, b: LAB): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function rgbDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
