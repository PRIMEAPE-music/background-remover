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
  image: ImageData | null;
  /** Called with image-space pixel coordinates on a left-click that isn't a pan. */
  onPick?: (x: number, y: number, color: RGB) => void;
  onHover?: (x: number, y: number, color: RGB | null) => void;
  /** Extra content rendered in image-space (inside a transformed overlay). */
  children?: ReactNode;
  /** Set to false to disable click-to-pick (e.g. when a slice tool owns clicks). */
  pickEnabled?: boolean;
  /** Called whenever zoom changes so overlays can size strokes/handles. */
  onViewportChange?: (zoom: number, pan: { x: number; y: number }) => void;
}

export const CanvasView = forwardRef<CanvasViewHandle, CanvasViewProps>(function CanvasView(
  { image, onPick, onHover, children, pickEnabled = true, onViewportChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const fit = useCallback(() => {
    const container = containerRef.current;
    const img = imageCanvasRef.current;
    if (!container || !img) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const scale = Math.min(cw / img.width, ch / img.height, 1) * 0.9;
    setZoom(scale);
    setPan({ x: (cw - img.width * scale) / 2, y: (ch - img.height * scale) / 2 });
  }, []);

  useEffect(() => {
    if (!image) {
      imageCanvasRef.current = null;
      render();
      return;
    }
    const off = document.createElement('canvas');
    off.width = image.width;
    off.height = image.height;
    off.getContext('2d')!.putImageData(image, 0, 0);
    imageCanvasRef.current = off;
    fit();
  }, [image]);

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
    const img = imageCanvasRef.current;
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
      const img = imageCanvasRef.current;
      if (!img) return null;
      const x = Math.floor((sx - pan.x) / zoom);
      const y = Math.floor((sy - pan.y) / zoom);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
      return { x, y };
    },
    [pan, zoom],
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

  const pickAt = useCallback((x: number, y: number): RGB | null => {
    const img = imageCanvasRef.current;
    if (!img) return null;
    const { data } = img.getContext('2d')!.getImageData(x, y, 1, 1);
    if (data[3] === 0) return null;
    return { r: data[0], g: data[1], b: data[2] };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
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
    if (p) {
      onHover?.(p.x, p.y, pickAt(p.x, p.y));
    } else {
      onHover?.(-1, -1, null);
    }
  };

  const onMouseUp = () => setIsPanning(false);

  const onClick = (e: React.MouseEvent) => {
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
        cursor: isPanning ? 'grabbing' : pickEnabled ? 'crosshair' : 'default',
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setIsPanning(false);
        onHover?.(-1, -1, null);
      }}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
      {image && children && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: image.width,
            height: image.height,
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      )}
      {image && (
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
          {image.width}×{image.height} · {Math.round(zoom * 100)}% · alt+drag to pan · wheel to zoom
        </div>
      )}
      {image && (
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
