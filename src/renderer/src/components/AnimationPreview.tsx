import { memo, useEffect, useRef, useState } from 'react';
import {
  extractCellFromCanvas,
  sourceImageToCanvas,
  type CellOverride,
  type NormalizationOptions,
  type Rect,
} from '../lib/slicing';

export interface AnimationPreviewProps {
  source: ImageData | null;
  cells: Rect[];
  overrides: Record<number, CellOverride>;
  normalize: NormalizationOptions;
}

/**
 * Lazy-extracts only the current frame. The source canvas is built on first
 * need and cached by ImageData identity so rapid source switching doesn't
 * repeatedly allocate 17MB canvas backing stores — a heavy debounce on that
 * build step means mid-burst switches do no preview work at all.
 */
export const AnimationPreview = memo(function AnimationPreview({
  source,
  cells,
  overrides,
  normalize,
}: AnimationPreviewProps) {
  const [fps, setFps] = useState(8);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Cache: one source canvas per ImageData identity.
  const srcCanvasRef = useRef<{ image: ImageData; canvas: HTMLCanvasElement } | null>(null);
  // `settledSource` is what the extractor actually uses; it trails `source`
  // by 500ms so rapid source-switch clicks do no allocation work at all.
  const [settledSource, setSettledSource] = useState<ImageData | null>(source);

  useEffect(() => {
    if (settledSource === source) return;
    const handle = setTimeout(() => setSettledSource(source), 500);
    return () => clearTimeout(handle);
  }, [source, settledSource]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, cells.length - 1)));
  }, [cells.length]);

  useEffect(() => {
    if (!playing || cells.length === 0) return;
    const interval = window.setInterval(() => {
      setIndex((i) => (i + 1) % cells.length);
    }, Math.max(20, 1000 / fps));
    return () => window.clearInterval(interval);
  }, [playing, fps, cells.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !settledSource || cells.length === 0) return;
    const rect = cells[index];
    if (!rect) return;
    if (!srcCanvasRef.current || srcCanvasRef.current.image !== settledSource) {
      srcCanvasRef.current = { image: settledSource, canvas: sourceImageToCanvas(settledSource) };
    }
    const extracted = extractCellFromCanvas(
      srcCanvasRef.current.canvas,
      rect,
      overrides[index],
      normalize,
    );
    canvas.width = extracted.width;
    canvas.height = extracted.height;
    canvas.getContext('2d')!.putImageData(extracted, 0, 0);
  }, [settledSource, cells, overrides, normalize, index]);

  // Cap the preview container at MAX so a full-sized cell from a 2K sheet
  // doesn't push the Play/Pause controls off the sidebar.
  const MAX_PREVIEW_DIM = 180;
  const bounds = previewBounds(cells, normalize);
  const fitScale = Math.min(MAX_PREVIEW_DIM / bounds.w, MAX_PREVIEW_DIM / bounds.h, 1);
  // For pixel-art crispness use integer scale when the content fits; fall back
  // to fractional downscale when cells are larger than the preview area.
  const scale = fitScale >= 1 ? Math.max(1, Math.floor(fitScale)) : fitScale;
  const currentRect = cells[index];
  const currentW = currentRect ? (normalize.enabled ? normalize.targetWidth : currentRect.width) : 0;
  const currentH = currentRect ? (normalize.enabled ? normalize.targetHeight : currentRect.height) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          width: Math.round(bounds.w * scale),
          height: Math.round(bounds.h * scale),
          maxWidth: '100%',
          margin: '0 auto',
          backgroundImage:
            'linear-gradient(45deg, #3a3a44 25%, transparent 25%), linear-gradient(-45deg, #3a3a44 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a44 75%), linear-gradient(-45deg, transparent 75%, #3a3a44 75%)',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {cells.length > 0 && currentRect ? (
          <canvas
            ref={canvasRef}
            style={{
              imageRendering: 'pixelated',
              width: Math.round(currentW * scale),
              height: Math.round(currentH * scale),
            }}
          />
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>No cells yet</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => setPlaying((p) => !p)} disabled={cells.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          style={{ flex: 1 }}
          disabled={cells.length === 0}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 40, textAlign: 'right' }}>
          {fps} fps
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => setIndex((i) => (i - 1 + cells.length) % Math.max(1, cells.length))}
          disabled={cells.length === 0}
        >
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, cells.length - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          style={{ flex: 1 }}
          disabled={cells.length === 0}
        />
        <button
          onClick={() => setIndex((i) => (i + 1) % Math.max(1, cells.length))}
          disabled={cells.length === 0}
        >
          ▶
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 60, textAlign: 'right' }}>
          {cells.length ? `${index + 1}/${cells.length}` : '—'}
        </span>
      </div>
    </div>
  );
});

function previewBounds(cells: Rect[], normalize: NormalizationOptions): { w: number; h: number } {
  if (normalize.enabled) {
    return { w: Math.max(1, normalize.targetWidth), h: Math.max(1, normalize.targetHeight) };
  }
  let maxW = 1;
  let maxH = 1;
  for (const r of cells) {
    if (r.width > maxW) maxW = r.width;
    if (r.height > maxH) maxH = r.height;
  }
  return { w: maxW, h: maxH };
}
