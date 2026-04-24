import { useEffect, useRef, useState } from 'react';
import type { Rect } from '../lib/slicing';
import { polygonBounds, polygonToPath, type Point } from '../lib/lasso';

export type SelectTool = 'rect' | 'lasso';

export interface SelectOverlayProps {
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  tool: SelectTool;
  /** Source rect in image coords (if any selection). */
  selectionRect: Rect | null;
  /** Lasso polygon in image coords (null if rectangle selection). */
  lassoPolygon: Point[] | null;
  /** Where the floater is currently drawn (image coords). */
  offset: { x: number; y: number } | null;
  /** Whether the user has confirmed the drawn selection and is ready to move. */
  confirmed: boolean;
  /** Pixels lifted from source; null until first move. */
  floater: ImageData | null;
  /** Emitted when user draws a new rect (rectangle tool) or the bbox of a lasso. */
  onDefine: (rect: Rect, polygon: Point[] | null) => void;
  /** Emitted to promote a pending (drawn) selection into a confirmed one. */
  onConfirm: () => void;
  /** Emitted on each move step. `ensureLifted` must be true on the first move after define. */
  onMove: (nextOffset: { x: number; y: number }, ensureLifted: boolean, copy: boolean) => void;
  /** Called to finalize: paste floater into image and clear selection. */
  onCommit: () => void;
  /** Called to abort: restore pre-lift image and clear selection. */
  onCancel: () => void;
  /** Called to delete floater and keep source cleared (erase). */
  onEraseFloater: () => void;
}

type DragMode = 'none' | 'define' | 'lasso' | 'move';

export function SelectOverlay({
  imageWidth,
  imageHeight,
  zoom,
  tool,
  selectionRect,
  lassoPolygon,
  offset,
  confirmed,
  floater,
  onDefine,
  onConfirm,
  onMove,
  onCommit,
  onCancel,
  onEraseFloater,
}: SelectOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragMode = useRef<DragMode>('none');
  const dragStart = useRef({ x: 0, y: 0, origOx: 0, origOy: 0, copy: false });
  // Local drag offset — updated on every mousemove so the marquee/floater
  // follows the cursor smoothly without triggering the heavy lift each frame.
  // The actual lift + image state change only happens on mouseup.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [lassoDraft, setLassoDraft] = useState<Point[] | null>(null);
  const displayOffset = dragOffset ?? offset;

  const toLocal = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * imageWidth,
      y: ((e.clientY - rect.top) / rect.height) * imageHeight,
    };
  };

  const insideSelection = (x: number, y: number): boolean => {
    if (!selectionRect || !displayOffset) return false;
    return (
      x >= displayOffset.x &&
      y >= displayOffset.y &&
      x < displayOffset.x + selectionRect.width &&
      y < displayOffset.y + selectionRect.height
    );
  };

  // Dragging inside the box only MOVES pixels once the selection is confirmed
  // (or a floater already exists). Otherwise dragging always starts a new selection.
  const canMoveInside = confirmed || !!floater;

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toLocal(e);
    if (selectionRect && displayOffset && canMoveInside && insideSelection(p.x, p.y)) {
      dragMode.current = 'move';
      dragStart.current = {
        x: p.x,
        y: p.y,
        origOx: displayOffset.x,
        origOy: displayOffset.y,
        copy: e.altKey,
      };
      setDragOffset(displayOffset);
    } else {
      if (floater) onCommit();
      if (tool === 'lasso') {
        dragMode.current = 'lasso';
        setLassoDraft([{ x: p.x, y: p.y }]);
      } else {
        dragMode.current = 'define';
        dragStart.current = { x: p.x, y: p.y, origOx: 0, origOy: 0, copy: false };
        onDefine({ x: Math.round(p.x), y: Math.round(p.y), width: 0, height: 0 }, null);
      }
    }
    e.stopPropagation();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragMode.current === 'none') return;
    const p = toLocal(e);
    if (dragMode.current === 'define') {
      onDefine(
        {
          x: Math.round(Math.min(dragStart.current.x, p.x)),
          y: Math.round(Math.min(dragStart.current.y, p.y)),
          width: Math.round(Math.abs(p.x - dragStart.current.x)),
          height: Math.round(Math.abs(p.y - dragStart.current.y)),
        },
        null,
      );
    } else if (dragMode.current === 'lasso') {
      setLassoDraft((draft) => {
        if (!draft) return [{ x: p.x, y: p.y }];
        const last = draft[draft.length - 1];
        // Throttle points by pixel distance so dense drags don't explode state.
        if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return draft;
        return [...draft, { x: p.x, y: p.y }];
      });
    } else if (dragMode.current === 'move') {
      setDragOffset({
        x: Math.round(dragStart.current.origOx + (p.x - dragStart.current.x)),
        y: Math.round(dragStart.current.origOy + (p.y - dragStart.current.y)),
      });
    }
  };

  const onMouseUp = () => {
    if (dragMode.current === 'move' && dragOffset) {
      const moved =
        dragOffset.x !== dragStart.current.origOx || dragOffset.y !== dragStart.current.origOy;
      if (moved) {
        onMove(dragOffset, !floater, dragStart.current.copy);
      }
    } else if (dragMode.current === 'lasso' && lassoDraft && lassoDraft.length >= 3) {
      const bbox = polygonBounds(lassoDraft);
      if (bbox && bbox.width > 2 && bbox.height > 2) {
        onDefine(bbox, lassoDraft);
      }
    }
    setDragOffset(null);
    setLassoDraft(null);
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
        // Enter is a progressive action: unconfirmed → confirm, otherwise commit.
        if (floater || confirmed) onCommit();
        else onConfirm();
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
      // Only nudge once the selection has been confirmed (or is already lifted).
      if (!canMoveInside) return;
      e.preventDefault();
      onMove({ x: offset.x + dx, y: offset.y + dy }, !floater, e.altKey);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    selectionRect,
    offset,
    floater,
    confirmed,
    canMoveInside,
    onMove,
    onCommit,
    onCancel,
    onConfirm,
    onEraseFloater,
  ]);

  const strokeW = 1 / zoom;
  const hasFloat = !!floater;
  // Three visual states: pending (yellow), confirmed (red), lifted (green).
  const color = hasFloat ? '#6aff9e' : confirmed ? '#ff6a6a' : '#f0c84a';
  const bg = hasFloat
    ? 'rgba(106,255,158,0.06)'
    : confirmed
      ? 'rgba(255,106,106,0.06)'
      : 'rgba(240,200,74,0.08)';
  const hintText = hasFloat
    ? 'drag: move · arrows: nudge · enter: commit · esc: revert · del: erase'
    : confirmed
      ? 'drag-in-box: move · arrows: nudge · enter: commit · esc: cancel · drag-outside: redraw'
      : tool === 'lasso'
        ? 'drag: trace a lasso · enter or "Confirm selection" when ready'
        : 'drag: draw selection · enter or "Confirm selection" when ready';
  // Show the polygon outline while drawing (draft) or post-define until lifted.
  const polyToShow: Point[] | null =
    dragMode.current === 'lasso' ? lassoDraft : !hasFloat ? lassoPolygon : null;
  const polyOffsetDx = displayOffset && selectionRect ? displayOffset.x - selectionRect.x : 0;
  const polyOffsetDy = displayOffset && selectionRect ? displayOffset.y - selectionRect.y : 0;

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
        cursor: canMoveInside ? 'move' : 'crosshair',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {floater && displayOffset && (
        <FloaterImage data={floater} x={displayOffset.x} y={displayOffset.y} />
      )}
      {selectionRect && displayOffset && (
        <div
          style={{
            position: 'absolute',
            left: displayOffset.x,
            top: displayOffset.y,
            width: selectionRect.width,
            height: selectionRect.height,
            border: `${strokeW}px dashed ${color}`,
            boxSizing: 'border-box',
            background: lassoPolygon ? 'transparent' : bg,
            pointerEvents: 'none',
          }}
        />
      )}
      {polyToShow && polyToShow.length >= 2 && (
        <svg
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: imageWidth,
            height: imageHeight,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <path
            d={polygonToPath(
              polyToShow.map((p) => ({ x: p.x + polyOffsetDx, y: p.y + polyOffsetDy })),
            )}
            fill={bg}
            stroke={color}
            strokeWidth={strokeW}
            strokeDasharray={`${3 / zoom} ${2 / zoom}`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
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
        {hintText}
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
