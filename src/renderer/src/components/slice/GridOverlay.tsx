import type { CellOverride, Rect } from '../../lib/slicing';

export function GridOverlay({
  cells,
  overrides,
  zoom,
  imageWidth,
  imageHeight,
  selectedIndex,
  onSelect,
}: {
  cells: Rect[];
  overrides: Record<number, CellOverride>;
  zoom: number;
  imageWidth: number;
  imageHeight: number;
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
}) {
  const strokeW = 1 / zoom;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: imageWidth,
        height: imageHeight,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect(null);
      }}
    >
      {cells.map((c, i) => {
        const ov = overrides[i];
        const isSelected = selectedIndex === i;
        return (
          <div
            key={i}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button === 0) onSelect(i);
            }}
            style={{
              position: 'absolute',
              left: c.x,
              top: c.y,
              width: c.width,
              height: c.height,
              border: `${strokeW}px solid ${isSelected ? '#ff6a6a' : '#6aa9ff'}`,
              boxSizing: 'border-box',
              background: isSelected ? 'rgba(255,106,106,0.08)' : 'transparent',
              cursor: 'pointer',
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
              {i}
              {ov?.flipH ? ' ↔' : ''}
              {ov?.flipV ? ' ↕' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
