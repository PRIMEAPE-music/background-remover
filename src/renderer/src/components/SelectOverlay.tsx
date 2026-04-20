import { useEffect, useRef } from 'react';
import type { Rect } from '../lib/slicing';

export interface SelectOverlayProps {
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  /** Source rect in image coords (if any selection). */
  selectionRect: Rect | null;
  /** Where the floater is currently drawn (image coords). */
  offset: { x: number; y: number } | null;
  /** Pixels lifted from source; null until first move. */
  floater: ImageData | null;
  /** Emitted when user draws a new rect. */
  onDefine: (rect: Rect) => void;
  /** Emitted on each move step. `ensureLifted` must be true on the first move after define. */
  onMove: (nextOffset: { x: number; y: number }, ensureLifted: boolean, copy: boolean) => void;
  /** Called to finalize: paste floater into image and clear selection. */
  onCommit: () => void;
  /** Called to abort: restore pre-lift image and clear selection. */
  onCancel: () => void;
  /** Called to delete floater and keep source cleared (erase). */
  onEraseFloater: () => void;
}

type DragMode = 'none' | 'define' | 'move';

export function SelectOverlay({
  imageWidth,
  imageHeight,
  zoom,
  selectionRect,
  offset,
  floater,
  onDefine,
  onMove,
  onCommit,
  onCancel,
  onEraseFloater,
}: SelectOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragMode = useRef<DragMode>('none');
  const dragStart = useRef({ x: 0, y: 0, origOx: 0, origOy: 0, copy: false });

  const toLocal = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * imageWidth,
      y: ((e.clientY - rect.top) / rect.height) * imageHeight,
    };
  };

  const insideSelection = (x: number, y: number): boolean => {
    if (!selectionRect || !offset) return false;
    return (
      x >= offset.x &&
      y >= offset.y &&
      x < offset.x + selectionRect.width &&
      y < offset.y + selectionRect.height
    );
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toLocal(e);
    if (selectionRect && offset && insideSelection(p.x, p.y)) {
      dragMode.current = 'move';
      dragStart.current = {
        x: p.x,
        y: p.y,
        origOx: offset.x,
        origOy: offset.y,
        copy: e.altKey,
      };
    } else {
      if (floater) onCommit();
      dragMode.current = 'define';
      dragStart.current = { x: p.x, y: p.y, origOx: 0, origOy: 0, copy: false };
      onDefine({ x: Math.round(p.x), y: Math.round(p.y), width: 0, height: 0 });
    }
    e.stopPropagation();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragMode.current === 'none') return;
    const p = toLocal(e);
    if (dragMode.current === 'define') {
      onDefine({
        x: Math.round(Math.min(dragStart.current.x, p.x)),
        y: Math.round(Math.min(dragStart.current.y, p.y)),
        width: Math.round(Math.abs(p.x - dragStart.current.x)),
        height: Math.round(Math.abs(p.y - dragStart.current.y)),
      });
    } else if (dragMode.current === 'move') {
      onMove(
        {
          x: Math.round(dragStart.current.origOx + (p.x - dragStart.current.x)),
          y: Math.round(dragStart.current.origOy + (p.y - dragStart.current.y)),
        },
        !floater,
        dragStart.current.copy,
      );
    }
  };

  const onMouseUp = () => {
    dragMode.current = 'none';
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectionRect || !offset) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && floater) {
        e.preventDefault();
        onEraseFloater();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      onMove({ x: offset.x + dx, y: offset.y + dy }, !floater, e.altKey);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectionRect, offset, floater, onMove, onCommit, onCancel, onEraseFloater]);

  const strokeW = 1 / zoom;
  const hasFloat = !!floater;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: imageWidth,
        height: imageHeight,
        pointerEvents: 'auto',
        cursor: selectionRect ? 'move' : 'crosshair',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {floater && offset && (
        <FloaterImage data={floater} x={offset.x} y={offset.y} />
      )}
      {selectionRect && offset && (
        <div
          style={{
            position: 'absolute',
            left: offset.x,
            top: offset.y,
            width: selectionRect.width,
            height: selectionRect.height,
            border: `${strokeW}px dashed ${hasFloat ? '#6aff9e' : '#ff6a6a'}`,
            boxSizing: 'border-box',
            background: hasFloat ? 'rgba(106,255,158,0.06)' : 'rgba(255,106,106,0.06)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          top: 4 / zoom,
          left: 4 / zoom,
          padding: `${2 / zoom}px ${6 / zoom}px`,
          background: 'rgba(0,0,0,0.6)',
          color: '#e6e6ea',
          fontSize: 10 / zoom,
          fontFamily: 'monospace',
          pointerEvents: 'none',
          borderRadius: 2 / zoom,
        }}
      >
        drag: select · drag-in-box: move · alt+drag/arrow: copy · arrows: 1px · shift+arrows: 10px · enter: commit · esc: cancel · del: erase
      </div>
    </div>
  );
}

function FloaterImage({ data, x, y }: { data: ImageData; x: number; y: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.width = data.width;
    ref.current.height = data.height;
    ref.current.getContext('2d')!.putImageData(data, 0, 0);
  }, [data]);
  return (
    <canvas
      ref={ref}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: data.width,
        height: data.height,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
      }}
    />
  );
}
