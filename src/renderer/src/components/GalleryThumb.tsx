import { memo, useEffect, useRef } from 'react';
import type { Rect } from '../lib/slicing';

export interface GalleryThumbProps {
  /** Source identity + version used as a cache/memo key; changes invalidate the decode. */
  sourceId: string;
  sourceVersion: number;
  rect: Rect;
  /** Callback returning the source ImageData. Kept as a lazy accessor so the
   *  raw 17MB buffer never enters the gallery's prop tree (React 19 dev mode
   *  traverses props and chokes on large ImageData references). */
  getSource: (id: string | null) => ImageData | null;
  selected?: boolean;
  onClick?: () => void;
  /** Max px of the thumbnail on its longest edge. */
  maxDim?: number;
}

/**
 * One sprite thumbnail extracted lazily via createImageBitmap (decoded
 * off-thread, cropped + resized in a single call). Memoized so parent
 * re-renders don't retrigger the decode as long as the cell keys stay stable.
 */
export const GalleryThumb = memo(function GalleryThumb({
  sourceId,
  sourceVersion,
  rect,
  getSource,
  selected = false,
  onClick,
  maxDim = 96,
}: GalleryThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(maxDim / rect.width, maxDim / rect.height, 1);
  const drawW = Math.max(1, Math.round(rect.width * scale));
  const drawH = Math.max(1, Math.round(rect.height * scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = getSource(sourceId);
    if (!img) return;
    canvas.width = drawW;
    canvas.height = drawH;
    let cancelled = false;
    createImageBitmap(img, rect.x, rect.y, rect.width, rect.height, {
      resizeWidth: drawW,
      resizeHeight: drawH,
      resizeQuality: 'low',
    })
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, drawW, drawH);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // sourceVersion forces re-decode when the source's pixels change.
  }, [sourceId, sourceVersion, rect.x, rect.y, rect.width, rect.height, drawW, drawH, getSource]);

  return (
    <button
      onClick={onClick}
      title={`${rect.width}×${rect.height}`}
      style={{
        padding: 2,
        border: `1px solid ${selected ? '#6aa9ff' : 'var(--border)'}`,
        background: selected ? 'rgba(106,169,255,0.15)' : 'transparent',
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: maxDim + 6,
        height: maxDim + 6,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          imageRendering: 'pixelated',
          background:
            'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 8px 8px',
        }}
      />
    </button>
  );
});
