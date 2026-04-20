import { useRef, useState } from 'react';
import type { GuidesConfig } from '../../lib/slicing';

export function GuidesOverlay({
  config,
  onChange,
  zoom,
  imageWidth,
  imageHeight,
}: {
  config: GuidesConfig;
  onChange: (c: GuidesConfig) => void;
  zoom: number;
  imageWidth: number;
  imageHeight: number;
}) {
  const strokeW = 1 / zoom;
  const hitW = Math.max(6 / zoom, 2);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<
    | { kind: 'v'; index: number }
    | { kind: 'h'; index: number }
    | null
  >(null);

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const localX = ((e.clientX - rect.left) / rect.width) * imageWidth;
    const localY = ((e.clientY - rect.top) / rect.height) * imageHeight;
    if (dragging.kind === 'v') {
      const next = [...config.verticals];
      next[dragging.index] = Math.max(1, Math.min(imageWidth - 1, Math.round(localX)));
      onChange({ ...config, verticals: next });
    } else {
      const next = [...config.horizontals];
      next[dragging.index] = Math.max(1, Math.min(imageHeight - 1, Math.round(localY)));
      onChange({ ...config, horizontals: next });
    }
  };

  const onMouseUp = () => setDragging(null);

  const onBackgroundDoubleClick = (e: React.MouseEvent) => {
    // Add a guide at the click point — decide axis by which edge is closer.
    const rect = containerRef.current!.getBoundingClientRect();
    const localX = ((e.clientX - rect.left) / rect.width) * imageWidth;
    const localY = ((e.clientY - rect.top) / rect.height) * imageHeight;
    // Heuristic: if shift held, horizontal line; else vertical.
    if (e.shiftKey) {
      onChange({ ...config, horizontals: [...config.horizontals, Math.round(localY)] });
    } else {
      onChange({ ...config, verticals: [...config.verticals, Math.round(localX)] });
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onBackgroundDoubleClick}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: imageWidth,
        height: imageHeight,
        pointerEvents: 'auto',
        cursor: 'crosshair',
      }}
    >
      {/* Outer border */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `${strokeW}px solid #6aa9ff`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          opacity: 0.6,
        }}
      />
      {config.verticals.map((x, i) => (
        <VerticalLine
          key={`v${i}`}
          x={x}
          imageHeight={imageHeight}
          hitW={hitW}
          strokeW={strokeW}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging({ kind: 'v', index: i });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const next = config.verticals.filter((_, j) => j !== i);
            onChange({ ...config, verticals: next });
          }}
        />
      ))}
      {config.horizontals.map((y, i) => (
        <HorizontalLine
          key={`h${i}`}
          y={y}
          imageWidth={imageWidth}
          hitW={hitW}
          strokeW={strokeW}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging({ kind: 'h', index: i });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const next = config.horizontals.filter((_, j) => j !== i);
            onChange({ ...config, horizontals: next });
          }}
        />
      ))}
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
        double-click: add vertical · shift+double-click: add horizontal · right-click guide: remove
      </div>
    </div>
  );
}

function VerticalLine({
  x,
  imageHeight,
  hitW,
  strokeW,
  onMouseDown,
  onContextMenu,
}: {
  x: number;
  imageHeight: number;
  hitW: number;
  strokeW: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      style={{
        position: 'absolute',
        left: x - hitW / 2,
        top: 0,
        width: hitW,
        height: imageHeight,
        cursor: 'col-resize',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: hitW / 2 - strokeW / 2,
          top: 0,
          width: strokeW,
          height: '100%',
          background: '#ff6a6a',
        }}
      />
    </div>
  );
}

function HorizontalLine({
  y,
  imageWidth,
  hitW,
  strokeW,
  onMouseDown,
  onContextMenu,
}: {
  y: number;
  imageWidth: number;
  hitW: number;
  strokeW: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      style={{
        position: 'absolute',
        left: 0,
        top: y - hitW / 2,
        width: imageWidth,
        height: hitW,
        cursor: 'row-resize',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: hitW / 2 - strokeW / 2,
          left: 0,
          height: strokeW,
          width: '100%',
          background: '#ff6a6a',
        }}
      />
    </div>
  );
}
