import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { drawCheckerboard } from '../lib/image-utils';
import type { RGB } from '../lib/color';

export interface CanvasViewHandle {
  fit: () => void;
  screenToImage: (sx: number, sy: number) => { x: number; y: number } | null;
  imageToScreen: (x: number, y: number) => { x: number; y: number };
  zoom: number;
}

export interface CanvasViewProps {
  /** Tiny descriptor of the current image — drives re-renders without flowing ImageData through props. */
  imageMeta: { width: number; height: number; version: number } | null;
  /** Lazy accessor for the actual ImageData pixels. */
  getImage: () => ImageData | null;
  /** Called with image-space pixel coordinates on a left-click that isn't a pan. */
  onPick?: (x: number, y: number, color: RGB) => void;
  onHover?: (x: number, y: number, color: RGB | null) => void;
  /** Extra content rendered in image-space (inside a transformed overlay). */
  children?: ReactNode;
  /** Set to false to disable click-to-pick (e.g. when a slice tool owns clicks). */
  pickEnabled?: boolean;
  /** When true, left-drag paints transparency via `onErase` instead of picking. */
  eraserEnabled?: boolean;
  /** Brush radius in image pixels; also used to draw the cursor preview. */
  eraserBrushSize?: number;
  /** Fired on every mousedown/move sample while erasing. `isStart` is true on the first sample of a stroke. */
  onErase?: (x: number, y: number, isStart: boolean) => void;
  /** Fired when the erase stroke ends (mouseup / mouseleave). */
  onEraseEnd?: () => void;
  /** Called whenever zoom changes so overlays can size strokes/handles. */
  onViewportChange?: (zoom: number, pan: { x: number; y: number }) => void;
}

export const CanvasView = forwardRef<CanvasViewHandle, CanvasViewProps>(function CanvasView(
  {
    imageMeta,
    getImage,
    onPick,
    onHover,
    children,
    pickEnabled = true,
    eraserEnabled = false,
    eraserBrushSize = 10,
    onErase,
    onEraseEnd,
    onViewportChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Render source is an ImageBitmap — created off-thread from the ImageData
  // so we don't block the main thread with a full putImageData on every
  // image change. The ImageData prop remains the source of truth for pixels.
  const imageBitmapRef = useRef<ImageBitmap | null>(null);
  const imageDimsRef = useRef<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [isErasing, setIsErasing] = useState(false);
  // Track the last cursor in image coords while erasing so we can show a
  // cursor preview at the right spot. Also cached for brush-circle overlay.
  const [cursorImage, setCursorImage] = useState<{ x: number; y: number } | null>(null);

  const fit = useCallback(() => {
    const container = containerRef.current;
    const dims = imageDimsRef.current;
    if (!container || !dims) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const scale = Math.min(cw / dims.w, ch / dims.h, 1) * 0.9;
    setZoom(scale);
    setPan({ x: (cw - dims.w * scale) / 2, y: (ch - dims.h * scale) / 2 });
  }, []);

  useEffect(() => {
    const img = getImage();
    if (!img) {
      imageBitmapRef.current?.close();
      imageBitmapRef.current = null;
      imageDimsRef.current = null;
      render();
      return;
    }
    const prev = imageDimsRef.current;
    const dimsChanged = !prev || prev.w !== img.width || prev.h !== img.height;
    imageDimsRef.current = { w: img.width, h: img.height };
    let cancelled = false;
    createImageBitmap(img).then((bitmap) => {
      if (cancelled) {
        bitmap.close();
        return;
      }
      imageBitmapRef.current?.close();
      imageBitmapRef.current = bitmap;
      if (dimsChanged) fit();
      else render();
    });
    return () => {
      cancelled = true;
    };
  }, [imageMeta]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1e1e22';
    ctx.fillRect(0, 0, cw, ch);
    const img = imageBitmapRef.current;
    if (!img) return;
    const w = img.width * zoom;
    const h = img.height * zoom;
    ctx.save();
    ctx.translate(pan.x, pan.y);
    drawCheckerboard(ctx, w, h, Math.max(4, 8 * zoom));
    ctx.drawImage(img, 0, 0, w, h);
    ctx.strokeStyle = '#3a3a44';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.restore();
  }, [zoom, pan]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    onViewportChange?.(zoom, pan);
  }, [zoom, pan, onViewportChange]);

  useEffect(() => {
    const observer = new ResizeObserver(() => render());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [render]);

  const screenToImage = useCallback(
    (sx: number, sy: number) => {
      if (!imageMeta) return null;
      const x = Math.floor((sx - pan.x) / zoom);
      const y = Math.floor((sy - pan.y) / zoom);
      if (x < 0 || y < 0 || x >= imageMeta.width || y >= imageMeta.height) return null;
      return { x, y };
    },
    [pan, zoom, imageMeta],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      screenToImage,
      imageToScreen: (x, y) => ({ x: x * zoom + pan.x, y: y * zoom + pan.y }),
      zoom,
    }),
    [fit, screenToImage, zoom, pan],
  );

  const pickAt = useCallback(
    (x: number, y: number): RGB | null => {
      const img = getImage();
      if (!img) return null;
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) return null;
      return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
    },
    [getImage],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
      return;
    }
    if (eraserEnabled && e.button === 0) {
      const rect = containerRef.current!.getBoundingClientRect();
      const p = screenToImage(e.clientX - rect.left, e.clientY - rect.top);
      if (!p) return;
      setIsErasing(true);
      onErase?.(p.x, p.y, true);
      e.preventDefault();
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
      return;
    }
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const p = screenToImage(sx, sy);
    if (eraserEnabled) {
      setCursorImage(p ? { x: p.x, y: p.y } : null);
      if (isErasing && p) {
        onErase?.(p.x, p.y, false);
      }
    }
    if (p) {
      onHover?.(p.x, p.y, pickAt(p.x, p.y));
    } else {
      onHover?.(-1, -1, null);
    }
  };

  const onMouseUp = () => {
    setIsPanning(false);
    if (isErasing) {
      setIsErasing(false);
      onEraseEnd?.();
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (eraserEnabled) return; // stroke already handled in mousedown/move/up
    if (!pickEnabled) return;
    if (e.button !== 0 || e.altKey || isPanning) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const p = screenToImage(e.clientX - rect.left, e.clientY - rect.top);
    if (!p) return;
    const color = pickAt(p.x, p.y);
    if (color) onPick?.(p.x, p.y, color);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.05, Math.min(40, zoom * factor));
    const imgX = (mx - pan.x) / zoom;
    const imgY = (my - pan.y) / zoom;
    setZoom(newZoom);
    setPan({ x: mx - imgX * newZoom, y: my - imgY * newZoom });
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        cursor: isPanning
          ? 'grabbing'
          : eraserEnabled
            ? 'none'
            : pickEnabled
              ? 'crosshair'
              : 'default',
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setIsPanning(false);
        if (isErasing) {
          setIsErasing(false);
          onEraseEnd?.();
        }
        setCursorImage(null);
        onHover?.(-1, -1, null);
      }}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
      {imageMeta && children && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: imageMeta.width,
            height: imageMeta.height,
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      )}
      {eraserEnabled && cursorImage && (
        <div
          style={{
            position: 'absolute',
            left: cursorImage.x * zoom + pan.x,
            top: cursorImage.y * zoom + pan.y,
            width: eraserBrushSize * 2 * zoom,
            height: eraserBrushSize * 2 * zoom,
            marginLeft: -eraserBrushSize * zoom,
            marginTop: -eraserBrushSize * zoom,
            borderRadius: '50%',
            border: '1px solid #ff6a6a',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        />
      )}
      {imageMeta && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--text-dim)',
            pointerEvents: 'none',
          }}
        >
          {imageMeta.width}×{imageMeta.height} · {Math.round(zoom * 100)}% · alt+drag to pan · wheel to zoom
        </div>
      )}
      {imageMeta && (
        <button
          onClick={fit}
          style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, padding: '4px 8px' }}
        >
          Fit
        </button>
      )}
    </div>
  );
});
