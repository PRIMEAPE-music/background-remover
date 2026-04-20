import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoxesConfig, CellOverride, Rect } from '../../lib/slicing';

type DragState =
  | { kind: 'create'; startX: number; startY: number }
  | { kind: 'move'; index: number; offsetX: number; offsetY: number }
  | { kind: 'resize'; index: number; corner: Corner; originalRect: Rect };

type Corner = 'nw' | 'ne' | 'sw' | 'se';

export function BoxesOverlay({
  config,
  overrides,
  onChange,
  zoom,
  imageWidth,
  imageHeight,
  selectedIndex,
  onSelectedIndexChange,
}: {
  config: BoxesConfig;
  overrides: Record<number, CellOverride>;
  onChange: (c: BoxesConfig) => void;
  zoom: number;
  imageWidth: number;
  imageHeight: number;
  selectedIndex: number | null;
  onSelectedIndexChange: (i: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  const toLocal = useCallback((e: React.MouseEvent | MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(imageWidth, Math.round(((e.clientX - rect.left) / rect.width) * imageWidth))),
      y: Math.max(0, Math.min(imageHeight, Math.round(((e.clientY - rect.top) / rect.height) * imageHeight))),
    };
  }, [imageWidth, imageHeight]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toLocal(e);
    setDrag({ kind: 'create', startX: p.x, startY: p.y });
    setPreview({ x: p.x, y: p.y, width: 0, height: 0 });
    onSelectedIndexChange(null);
    e.stopPropagation();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toLocal(e);
    if (drag.kind === 'create') {
      const x = Math.min(drag.startX, p.x);
      const y = Math.min(drag.startY, p.y);
      const width = Math.abs(p.x - drag.startX);
      const height = Math.abs(p.y - drag.startY);
      setPreview({ x, y, width, height });
    } else if (drag.kind === 'move') {
      const next = [...config.rects];
      const orig = next[drag.index];
      const nx = Math.max(0, Math.min(imageWidth - orig.width, p.x - drag.offsetX));
      const ny = Math.max(0, Math.min(imageHeight - orig.height, p.y - drag.offsetY));
      next[drag.index] = { ...orig, x: nx, y: ny };
      onChange({ rects: next });
    } else if (drag.kind === 'resize') {
      const next = [...config.rects];
      const orig = drag.originalRect;
      let x = orig.x;
      let y = orig.y;
      let width = orig.width;
      let height = orig.height;
      if (drag.corner.includes('w')) {
        const nx = Math.min(orig.x + orig.width - 1, p.x);
        width = orig.x + orig.width - nx;
        x = nx;
      } else {
        width = Math.max(1, p.x - orig.x);
      }
      if (drag.corner.includes('n')) {
        const ny = Math.min(orig.y + orig.height - 1, p.y);
        height = orig.y + orig.height - ny;
        y = ny;
      } else {
        height = Math.max(1, p.y - orig.y);
      }
      next[drag.index] = { x, y, width, height };
      onChange({ rects: next });
    }
  };

  const onMouseUp = () => {
    if (drag?.kind === 'create' && preview && preview.width > 2 && preview.height > 2) {
      const next = [...config.rects, preview];
      onChange({ rects: next });
      onSelectedIndexChange(next.length - 1);
    }
    setDrag(null);
    setPreview(null);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedIndex === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onChange({ rects: config.rects.filter((_, i) => i !== selectedIndex) });
        onSelectedIndexChange(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIndex, config, onChange, onSelectedIndexChange]);

  const strokeW = 1 / zoom;
  const handleSize = 8 / zoom;

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
        cursor: 'crosshair',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {config.rects.map((r, i) => {
        const isSelected = selectedIndex === i;
        return (
          <div key={i}>
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                const p = toLocal(e);
                setDrag({ kind: 'move', index: i, offsetX: p.x - r.x, offsetY: p.y - r.y });
                onSelectedIndexChange(i);
              }}
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
                border: `${strokeW}px solid ${isSelected ? '#ff6a6a' : '#6aa9ff'}`,
                boxSizing: 'border-box',
                background: isSelected ? 'rgba(255,106,106,0.08)' : 'rgba(106,169,255,0.05)',
                cursor: 'move',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 2 / zoom,
                  left: 2 / zoom,
                  color: isSelected ? '#ff6a6a' : '#6aa9ff',
                  fontSize: 10 / zoom,
                  fontFamily: 'monospace',
                  pointerEvents: 'none',
                }}
              >
                {i} · {r.width}×{r.height}
                {overrides[i]?.flipH ? ' ↔' : ''}
                {overrides[i]?.flipV ? ' ↕' : ''}
              </div>
            </div>
            {isSelected &&
              (['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                const cx = corner.includes('w') ? r.x : r.x + r.width;
                const cy = corner.includes('n') ? r.y : r.y + r.height;
                return (
                  <div
                    key={corner}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      setDrag({ kind: 'resize', index: i, corner, originalRect: { ...r } });
                    }}
                    style={{
                      position: 'absolute',
                      left: cx - handleSize / 2,
                      top: cy - handleSize / 2,
                      width: handleSize,
                      height: handleSize,
                      background: '#ff6a6a',
                      border: `${strokeW}px solid #fff`,
                      cursor: `${corner}-resize`,
                    }}
                  />
                );
              })}
          </div>
        );
      })}
      {preview && drag?.kind === 'create' && (
        <div
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: `${strokeW}px dashed #6aff9e`,
            boxSizing: 'border-box',
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
        drag: create box · click box: select · drag corner: resize · del: remove
      </div>
    </div>
  );
}
