import { memo, useEffect, useRef } from 'react';
import {
  computeAnchorPos,
  contentBoundsInRect,
  slotScale,
  type BuilderState,
  type Slot,
} from '../lib/builder';
import { computeCells, type Rect } from '../lib/slicing';
import type { SourceMeta } from '../lib/sources';

export interface SlotRendererProps {
  slot: Slot;
  boxSize: BuilderState['boxSize'];
  anchor: BuilderState['anchor'];
  scaleRef: BuilderState['scaleRef'];
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

/**
 * Draws a single slot's sprite onto a canvas sized to the character's frame
 * box. Handles scale (from scaleRef), anchor, and per-slot yOffset. Lazy —
 * the scan + extract only run when the slot or dependencies actually change.
 */
export const SlotRenderer = memo(function SlotRenderer({
  slot,
  boxSize,
  anchor,
  scaleRef,
  sources,
  getSource,
}: SlotRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratio = slotScale(scaleRef, slot);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = boxSize.w;
    canvas.height = boxSize.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, boxSize.w, boxSize.h);
    if (!slot.cell) return;
    const source = sources.find((s) => s.id === slot.cell!.sourceId);
    if (!source) return;
    const img = getSource(source.id);
    if (!img) return;
    const cells: Rect[] = computeCells(source.slice, source.width, source.height);
    const rect = cells[slot.cell.cellIndex];
    if (!rect) return;
    const bounds = contentBoundsInRect(img, rect);
    if (!bounds) return;
    const drawW = Math.max(1, Math.round(bounds.width * ratio));
    const drawH = Math.max(1, Math.round(bounds.height * ratio));
    const { dx, dy } = computeAnchorPos(anchor, boxSize, drawW, drawH, slot.yOffset);
    let cancelled = false;
    const override = source.slice.overrides[slot.cell.cellIndex] ?? {};
    const flipH = !!override.flipH;
    const flipV = !!override.flipV;
    createImageBitmap(
      img,
      rect.x + bounds.x,
      rect.y + bounds.y,
      bounds.width,
      bounds.height,
      { resizeWidth: drawW, resizeHeight: drawH, resizeQuality: 'low' },
    )
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        ctx.imageSmoothingEnabled = false;
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slot, boxSize.w, boxSize.h, anchor, ratio, sources, getSource]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: boxSize.w,
        height: boxSize.h,
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
});
