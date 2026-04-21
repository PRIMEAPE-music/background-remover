export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridConfig {
  cols: number;
  rows: number;
  marginX: number;
  marginY: number;
  spacingX: number;
  spacingY: number;
}

export interface GuidesConfig {
  verticals: number[];
  horizontals: number[];
}

export interface BoxesConfig {
  rects: Rect[];
}

export type SliceMode = 'grid' | 'guides' | 'boxes';

export interface CellOverride {
  flipH?: boolean;
  flipV?: boolean;
  /** Custom name used in atlas export (falls back to index-based). */
  name?: string;
}

export type AnchorKind =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type NormalizeScaleMode = 'none' | 'fit' | 'content-height';

export interface NormalizationOptions {
  enabled: boolean;
  targetWidth: number;
  targetHeight: number;
  /** Trim transparent borders before placing into target canvas. */
  trim: boolean;
  /** Where the content anchors inside the target canvas. */
  anchor: AnchorKind;
  /** Scaling behavior. `content-height` matches each sprite's opaque height to the target (minus padding). */
  scaleMode: NormalizeScaleMode;
  /** Padding from content to canvas edge (all sides) in target pixels. */
  padding: number;
}

export interface SliceConfig {
  mode: SliceMode;
  grid: GridConfig;
  guides: GuidesConfig;
  boxes: BoxesConfig;
  overrides: Record<number, CellOverride>;
  normalize: NormalizationOptions;
}

export const DEFAULT_GRID: GridConfig = {
  cols: 4,
  rows: 1,
  marginX: 0,
  marginY: 0,
  spacingX: 0,
  spacingY: 0,
};

export const DEFAULT_NORMALIZE: NormalizationOptions = {
  enabled: false,
  targetWidth: 92,
  targetHeight: 128,
  trim: true,
  anchor: 'bottom',
  scaleMode: 'none',
  padding: 0,
};

export const DEFAULT_SLICE: SliceConfig = {
  mode: 'grid',
  grid: { ...DEFAULT_GRID },
  guides: { verticals: [], horizontals: [] },
  boxes: { rects: [] },
  overrides: {},
  normalize: { ...DEFAULT_NORMALIZE },
};

export interface FrameSizePreset {
  name: string;
  width: number;
  height: number;
}

export const FRAME_SIZE_PRESETS: FrameSizePreset[] = [
  { name: 'Monk 92×128', width: 92, height: 128 },
  { name: 'Small 64×64', width: 64, height: 64 },
  { name: 'Medium 96×144', width: 96, height: 144 },
  { name: 'Boss 128×176', width: 128, height: 176 },
  { name: 'Large 148×200', width: 148, height: 200 },
];

export function computeCells(
  config: SliceConfig,
  imageWidth: number,
  imageHeight: number,
): Rect[] {
  switch (config.mode) {
    case 'grid':
      return computeGridCells(config.grid, imageWidth, imageHeight);
    case 'guides':
      return computeGuideCells(config.guides, imageWidth, imageHeight);
    case 'boxes':
      return config.boxes.rects.map(clampRect(imageWidth, imageHeight)).filter(isValidRect);
  }
}

function clampRect(w: number, h: number) {
  return (r: Rect): Rect => ({
    x: Math.max(0, Math.min(w, Math.round(r.x))),
    y: Math.max(0, Math.min(h, Math.round(r.y))),
    width: Math.max(0, Math.min(w - Math.round(r.x), Math.round(r.width))),
    height: Math.max(0, Math.min(h - Math.round(r.y), Math.round(r.height))),
  });
}

function isValidRect(r: Rect): boolean {
  return r.width > 0 && r.height > 0;
}

function computeGridCells(g: GridConfig, imageWidth: number, imageHeight: number): Rect[] {
  const cols = Math.max(1, Math.floor(g.cols));
  const rows = Math.max(1, Math.floor(g.rows));
  const usableW = imageWidth - 2 * g.marginX - (cols - 1) * g.spacingX;
  const usableH = imageHeight - 2 * g.marginY - (rows - 1) * g.spacingY;
  if (usableW <= 0 || usableH <= 0) return [];
  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const cells: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: Math.round(g.marginX + c * (cellW + g.spacingX)),
        y: Math.round(g.marginY + r * (cellH + g.spacingY)),
        width: Math.round(cellW),
        height: Math.round(cellH),
      });
    }
  }
  return cells;
}

function computeGuideCells(g: GuidesConfig, imageWidth: number, imageHeight: number): Rect[] {
  const vs = [0, ...[...g.verticals].sort((a, b) => a - b), imageWidth];
  const hs = [0, ...[...g.horizontals].sort((a, b) => a - b), imageHeight];
  const cells: Rect[] = [];
  for (let i = 0; i < hs.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      const x = Math.round(vs[j]);
      const y = Math.round(hs[i]);
      const width = Math.round(vs[j + 1] - vs[j]);
      const height = Math.round(hs[i + 1] - hs[i]);
      if (width > 0 && height > 0) cells.push({ x, y, width, height });
    }
  }
  return cells;
}

export function gridFromCellSize(
  imageWidth: number,
  imageHeight: number,
  cellWidth: number,
  cellHeight: number,
): GridConfig {
  return {
    cols: Math.max(1, Math.floor(imageWidth / cellWidth)),
    rows: Math.max(1, Math.floor(imageHeight / cellHeight)),
    marginX: 0,
    marginY: 0,
    spacingX: 0,
    spacingY: 0,
  };
}

/**
 * Find the tight bounding box of non-transparent content in `data`.
 * Returns null if the entire region is transparent.
 */
export function contentBounds(data: ImageData, alphaThreshold = 0): Rect | null {
  const { width, height } = data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const px = data.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = px[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Extract a cell from a source image and apply the configured transforms:
 *   1. Crop to the cell rect
 *   2. Flip if override says so
 *   3. Optionally trim transparent borders
 *   4. Optionally paste into a normalized target canvas with anchor + scaling
 */
export function extractAndNormalizeCell(
  source: ImageData,
  rect: Rect,
  override: CellOverride | undefined,
  normalize: NormalizationOptions,
): ImageData {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = source.width;
  srcCanvas.height = source.height;
  srcCanvas.getContext('2d')!.putImageData(source, 0, 0);

  const cropped = document.createElement('canvas');
  cropped.width = rect.width;
  cropped.height = rect.height;
  const cropCtx = cropped.getContext('2d')!;
  cropCtx.imageSmoothingEnabled = false;
  const flipH = !!override?.flipH;
  const flipV = !!override?.flipV;
  cropCtx.save();
  cropCtx.translate(flipH ? rect.width : 0, flipV ? rect.height : 0);
  cropCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  cropCtx.drawImage(srcCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  cropCtx.restore();
  let working = cropCtx.getImageData(0, 0, cropped.width, cropped.height);

  if (!normalize.enabled) {
    if (normalize.trim) {
      const bounds = contentBounds(working);
      if (bounds) {
        const trimmed = document.createElement('canvas');
        trimmed.width = bounds.width;
        trimmed.height = bounds.height;
        const tctx = trimmed.getContext('2d')!;
        tctx.drawImage(cropped, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        working = tctx.getImageData(0, 0, bounds.width, bounds.height);
      }
    }
    return working;
  }

  // --- Normalization enabled ---
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.floor(normalize.targetWidth));
  target.height = Math.max(1, Math.floor(normalize.targetHeight));
  const tctx = target.getContext('2d')!;
  tctx.imageSmoothingEnabled = false;
  tctx.clearRect(0, 0, target.width, target.height);

  // Source for placement: if trim, use content bounds; else whole cropped cell.
  const bounds = normalize.trim ? contentBounds(working) : { x: 0, y: 0, width: cropped.width, height: cropped.height };
  if (!bounds) return working;

  const innerW = target.width - normalize.padding * 2;
  const innerH = target.height - normalize.padding * 2;
  let scale = 1;
  if (normalize.scaleMode === 'fit') {
    scale = Math.min(innerW / bounds.width, innerH / bounds.height, 1);
  } else if (normalize.scaleMode === 'content-height') {
    scale = innerH / bounds.height;
  }
  // Integer scale is friendlier for pixel art; snap only if it's close to an integer.
  const integerSnapped = Math.round(scale);
  if (Math.abs(scale - integerSnapped) < 0.05 && integerSnapped >= 1) scale = integerSnapped;

  const drawW = Math.max(1, Math.round(bounds.width * scale));
  const drawH = Math.max(1, Math.round(bounds.height * scale));
  const { anchor } = normalize;
  let dx = normalize.padding;
  let dy = normalize.padding;
  const availW = innerW - drawW;
  const availH = innerH - drawH;
  if (anchor.includes('right')) dx += availW;
  else if (!anchor.includes('left')) dx += availW / 2;
  if (anchor.includes('bottom')) dy += availH;
  else if (!anchor.includes('top')) dy += availH / 2;
  if (anchor === 'top') dy = normalize.padding;
  if (anchor === 'bottom') dy = normalize.padding + availH;
  if (anchor === 'left') dx = normalize.padding;
  if (anchor === 'right') dx = normalize.padding + availW;

  tctx.drawImage(
    cropped,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    Math.round(dx),
    Math.round(dy),
    drawW,
    drawH,
  );
  return tctx.getImageData(0, 0, target.width, target.height);
}

/** Detect connected opaque blobs and return their bounding boxes. */
export function detectBlobs(
  data: ImageData,
  minSize = 16,
  padding = 0,
  alphaThreshold = 0,
): Rect[] {
  const { width, height } = data;
  const visited = new Uint8Array(width * height);
  const px = data.data;
  const blobs: Rect[] = [];
  // Typed-array stack sized to the worst case (every pixel). Using a plain
  // `number[]` here boxes each index into a JS Number object, which makes the
  // inner loop allocation-bound on large sheets.
  const stack = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start]) continue;
      const alpha = px[start * 4 + 3];
      if (alpha <= alphaThreshold) {
        visited[start] = 1;
        continue;
      }
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let top = 0;
      stack[top++] = start;
      while (top > 0) {
        const p = stack[--top];
        if (visited[p]) continue;
        visited[p] = 1;
        const a = px[p * 4 + 3];
        if (a <= alphaThreshold) continue;
        const px_ = p % width;
        const py_ = (p - px_) / width;
        if (px_ < minX) minX = px_;
        if (px_ > maxX) maxX = px_;
        if (py_ < minY) minY = py_;
        if (py_ > maxY) maxY = py_;
        if (px_ > 0) stack[top++] = p - 1;
        if (px_ < width - 1) stack[top++] = p + 1;
        if (py_ > 0) stack[top++] = p - width;
        if (py_ < height - 1) stack[top++] = p + width;
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (w * h >= minSize) {
        blobs.push({
          x: Math.max(0, minX - padding),
          y: Math.max(0, minY - padding),
          width: Math.min(width, maxX + padding + 1) - Math.max(0, minX - padding),
          height: Math.min(height, maxY + padding + 1) - Math.max(0, minY - padding),
        });
      }
    }
  }
  // Sort blobs roughly left-to-right, top-to-bottom using rows (grouping y-proximity).
  blobs.sort((a, b) => {
    if (Math.abs(a.y - b.y) > Math.min(a.height, b.height) / 2) return a.y - b.y;
    return a.x - b.x;
  });
  return blobs;
}

/**
 * Pack cells into a single packed sheet + Phaser 3 atlas JSON.
 * Each cell is first extracted/normalized, then placed in a grid layout.
 */
export interface PackedSheet {
  png: ImageData;
  atlas: PhaserAtlas;
}

export interface PhaserFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  pivot?: { x: number; y: number };
}

export interface PhaserAtlas {
  frames: Record<string, PhaserFrame>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: string;
  };
}

export interface PackOptions {
  columns: number;
  /** Optional pivot (0..1 normalized) applied to every frame in the atlas. */
  pivot?: { x: number; y: number };
  /** PNG filename referenced in the atlas meta.image field. */
  pngFilename: string;
  /** Base name for each frame — suffixed with zero-padded index. */
  frameName: string;
}

export function packCells(
  cellImages: ImageData[],
  options: PackOptions,
): PackedSheet {
  const n = cellImages.length;
  if (n === 0) throw new Error('Nothing to pack');
  const cols = Math.max(1, Math.floor(options.columns));
  const rows = Math.ceil(n / cols);
  const cellW = Math.max(...cellImages.map((c) => c.width));
  const cellH = Math.max(...cellImages.map((c) => c.height));
  const sheetW = cellW * cols;
  const sheetH = cellH * rows;

  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = sheetH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, sheetW, sheetH);

  const frames: Record<string, PhaserFrame> = {};
  const pad = String(Math.max(0, n - 1)).length;

  for (let i = 0; i < n; i++) {
    const c = cellImages[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW + Math.floor((cellW - c.width) / 2);
    const y = row * cellH + Math.floor((cellH - c.height) / 2);
    const tmp = document.createElement('canvas');
    tmp.width = c.width;
    tmp.height = c.height;
    tmp.getContext('2d')!.putImageData(c, 0, 0);
    ctx.drawImage(tmp, x, y);
    frames[`${options.frameName}_${String(i).padStart(pad, '0')}`] = {
      frame: { x, y, w: c.width, h: c.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: c.width, h: c.height },
      sourceSize: { w: c.width, h: c.height },
      pivot: options.pivot,
    };
  }

  return {
    png: ctx.getImageData(0, 0, sheetW, sheetH),
    atlas: {
      frames,
      meta: {
        app: 'background-remover',
        version: '0.1.0',
        image: options.pngFilename,
        format: 'RGBA8888',
        size: { w: sheetW, h: sheetH },
        scale: '1',
      },
    },
  };
}
