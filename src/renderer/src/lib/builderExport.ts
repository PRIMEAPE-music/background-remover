import {
  computeAnchorPos,
  contentBoundsInRect,
  slotScale,
  type Animation,
  type BuilderState,
} from './builder';
import { computeCells } from './slicing';
import type { SourceMeta } from './sources';

/**
 * Render a single animation strip into PNG bytes. Returns null when the
 * animation isn't ready to export (no scale lock, empty slots, or any slot
 * is unfilled). Used by the per-animation export and the bulk
 * "export all into project folder" handler.
 */
export async function composeAnimationStrip(
  animation: Animation,
  builder: BuilderState,
  sources: SourceMeta[],
  getSource: (id: string | null) => ImageData | null,
): Promise<ArrayBuffer | null> {
  const { boxSize, anchor, scaleRef } = builder;
  if (!scaleRef) return null;
  const slots = animation.slots;
  if (slots.length === 0 || !slots.every((s) => s.cell)) return null;

  const width = boxSize.w * slots.length;
  const height = boxSize.h;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.cell) continue;
    const source = sources.find((s) => s.id === slot.cell!.sourceId);
    if (!source) continue;
    const img = getSource(source.id);
    if (!img) continue;
    const srcCells = computeCells(source.slice, source.width, source.height);
    const rect = srcCells[slot.cell.cellIndex];
    if (!rect) continue;
    const bounds = contentBoundsInRect(img, rect);
    if (!bounds) continue;
    const ratio = slotScale(scaleRef, slot);
    const drawW = Math.max(1, Math.round(bounds.width * ratio));
    const drawH = Math.max(1, Math.round(bounds.height * ratio));
    const { dx, dy } = computeAnchorPos(anchor, boxSize, drawW, drawH, slot.yOffset);
    const bitmap = await createImageBitmap(
      img,
      rect.x + bounds.x,
      rect.y + bounds.y,
      bounds.width,
      bounds.height,
      { resizeWidth: drawW, resizeHeight: drawH, resizeQuality: 'low' },
    );
    const override = source.slice.overrides[slot.cell.cellIndex] ?? {};
    const flipH = !!override.flipH;
    const flipV = !!override.flipV;
    const slotX = i * boxSize.w + dx;
    if (flipH || flipV) {
      ctx.save();
      ctx.translate(slotX + drawW / 2, dy + drawH / 2);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(bitmap, -drawW / 2, -drawH / 2);
      ctx.restore();
    } else {
      ctx.drawImage(bitmap, slotX, dy);
    }
    bitmap.close();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) return null;
  return blob.arrayBuffer();
}

/**
 * Render an animation to per-frame ImageData (one entry per slot, each at
 * `boxSize.w × boxSize.h`). Returns null if the animation isn't ready.
 *
 * Used by Test mode for fast playback — frames are pre-rendered once on
 * tab entry and `putImageData` per tick avoids any per-frame composition.
 * Mirrors the layout decisions of `composeAnimationStrip` so what you test
 * matches what you export.
 */
export async function composeAnimationFrames(
  animation: Animation,
  builder: BuilderState,
  sources: SourceMeta[],
  getSource: (id: string | null) => ImageData | null,
): Promise<ImageData[] | null> {
  const { boxSize, anchor, scaleRef } = builder;
  if (!scaleRef) return null;
  const slots = animation.slots;
  if (slots.length === 0 || !slots.every((s) => s.cell)) return null;

  const canvas = document.createElement('canvas');
  canvas.width = boxSize.w;
  canvas.height = boxSize.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const frames: ImageData[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.cell) return null;
    ctx.clearRect(0, 0, boxSize.w, boxSize.h);
    const source = sources.find((s) => s.id === slot.cell!.sourceId);
    if (!source) return null;
    const img = getSource(source.id);
    if (!img) return null;
    const srcCells = computeCells(source.slice, source.width, source.height);
    const rect = srcCells[slot.cell.cellIndex];
    if (!rect) return null;
    const bounds = contentBoundsInRect(img, rect);
    if (!bounds) return null;
    const ratio = slotScale(scaleRef, slot);
    const drawW = Math.max(1, Math.round(bounds.width * ratio));
    const drawH = Math.max(1, Math.round(bounds.height * ratio));
    const { dx, dy } = computeAnchorPos(anchor, boxSize, drawW, drawH, slot.yOffset);
    const bitmap = await createImageBitmap(
      img,
      rect.x + bounds.x,
      rect.y + bounds.y,
      bounds.width,
      bounds.height,
      { resizeWidth: drawW, resizeHeight: drawH, resizeQuality: 'low' },
    );
    const override = source.slice.overrides[slot.cell.cellIndex] ?? {};
    const flipH = !!override.flipH;
    const flipV = !!override.flipV;
    if (flipH || flipV) {
      ctx.save();
      ctx.translate(dx + drawW / 2, dy + drawH / 2);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(bitmap, -drawW / 2, -drawH / 2);
      ctx.restore();
    } else {
      ctx.drawImage(bitmap, dx, dy);
    }
    bitmap.close();
    frames.push(ctx.getImageData(0, 0, boxSize.w, boxSize.h));
  }
  return frames;
}

/**
 * Filename for an exported strip — `<sanitized-name>_<fps>fps`. The fps
 * suffix lets the engine integrator know the playback rate the strip was
 * authored at without opening the project.
 */
export function safeAnimationFilename(name: string, fps?: number): string {
  const base = (name || 'animation').replace(/[^\w\-]+/g, '_').slice(0, 64) || 'animation';
  const f = typeof fps === 'number' && fps > 0 ? Math.round(fps) : null;
  return f ? `${base}_${f}fps` : base;
}
