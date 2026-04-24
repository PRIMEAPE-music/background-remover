import { memo, useEffect, useRef } from 'react';
import type { SourceMeta } from '../lib/sources';

export interface SourcesSidebarProps {
  sources: SourceMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  getImage: (id: string | null) => ImageData | null;
}

export function SourcesSidebar({
  sources,
  activeId,
  onSelect,
  onRemove,
  getImage,
}: SourcesSidebarProps) {
  if (sources.length === 0) {
    return (
      <aside
        style={{
          width: 96,
          borderRight: '1px solid var(--border)',
          background: 'var(--panel)',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: 'var(--text-dim)',
          fontSize: 10,
          textAlign: 'center',
        }}
      >
        <div style={{ marginTop: 12 }}>No sources</div>
        <div style={{ lineHeight: 1.4 }}>Open or drop an image to begin.</div>
      </aside>
    );
  }
  return (
    <aside
      style={{
        width: 96,
        borderRight: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
      }}
    >
      {sources.map((s) => (
        <SourceThumb
          key={s.id}
          source={s}
          active={activeId === s.id}
          onSelect={onSelect}
          onRemove={onRemove}
          getImage={getImage}
        />
      ))}
    </aside>
  );
}

const SourceThumb = memo(function SourceThumb({
  source,
  active,
  onSelect,
  onRemove,
  getImage,
}: {
  source: SourceMeta;
  active: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  getImage: (id: string | null) => ImageData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastVersion = useRef<number>(-1);

  // Regenerate thumbnail bitmap only when the source's version actually changes.
  // Uses createImageBitmap with resize so we don't allocate a full-size canvas
  // (17MB+ for a 2390×1792 sheet) per thumb refresh — that was a major source
  // of GC pressure with multiple sources loaded.
  useEffect(() => {
    if (lastVersion.current === source.version) return;
    const img = getImage(source.id);
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    lastVersion.current = source.version;
    const targetW = 80;
    const targetH = 80;
    const scale = Math.min(targetW / img.width, targetH / img.height);
    const drawW = Math.max(1, Math.round(img.width * scale));
    const drawH = Math.max(1, Math.round(img.height * scale));
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, targetW, targetH);
    let cancelled = false;
    createImageBitmap(img, {
      resizeWidth: drawW,
      resizeHeight: drawH,
      resizeQuality: 'low',
    })
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        const dx = Math.floor((targetW - drawW) / 2);
        const dy = Math.floor((targetH - drawH) / 2);
        ctx.drawImage(bitmap, dx, dy);
        bitmap.close();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source.id, source.version, getImage]);

  return (
    <div
      onClick={() => onSelect(source.id)}
      style={{
        position: 'relative',
        borderRadius: 4,
        padding: 4,
        cursor: 'pointer',
        background: active ? 'rgba(106,169,255,0.15)' : 'transparent',
        border: `1px solid ${active ? '#6aa9ff' : 'var(--border)'}`,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: 80,
          height: 80,
          display: 'block',
          imageRendering: 'pixelated',
          background:
            'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 12px 12px',
        }}
      />
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-dim)',
          marginTop: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
        }}
        title={source.filename}
      >
        {source.filename}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(source.id);
        }}
        title="Remove source"
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          padding: 0,
          fontSize: 10,
          lineHeight: 1,
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid var(--border)',
          color: '#e6e6ea',
          borderRadius: 2,
        }}
      >
        ×
      </button>
    </div>
  );
});
