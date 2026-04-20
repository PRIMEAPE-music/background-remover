import { useEffect, useRef, useState } from 'react';

export function AnimationPreview({ frames }: { frames: ImageData[] }) {
  const [fps, setFps] = useState(8);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, frames.length - 1)));
  }, [frames.length]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const interval = window.setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, Math.max(20, 1000 / fps));
    return () => window.clearInterval(interval);
  }, [playing, fps, frames.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const frame = frames[index];
    if (!frame) return;
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')!.putImageData(frame, 0, 0);
  }, [index, frames]);

  const maxW = Math.max(...frames.map((f) => f.width), 1);
  const maxH = Math.max(...frames.map((f) => f.height), 1);
  const scale = Math.max(1, Math.min(Math.floor(180 / maxW), Math.floor(180 / maxH)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          width: maxW * scale,
          height: maxH * scale,
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
        {frames.length > 0 ? (
          <canvas
            ref={canvasRef}
            style={{
              imageRendering: 'pixelated',
              width: (frames[index]?.width ?? 0) * scale,
              height: (frames[index]?.height ?? 0) * scale,
            }}
          />
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>No cells yet</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => setPlaying((p) => !p)} disabled={frames.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          style={{ flex: 1 }}
          disabled={frames.length === 0}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 40, textAlign: 'right' }}>
          {fps} fps
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => setIndex((i) => (i - 1 + frames.length) % Math.max(1, frames.length))}
          disabled={frames.length === 0}
        >
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          style={{ flex: 1 }}
          disabled={frames.length === 0}
        />
        <button
          onClick={() => setIndex((i) => (i + 1) % Math.max(1, frames.length))}
          disabled={frames.length === 0}
        >
          ▶
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 60, textAlign: 'right' }}>
          {frames.length ? `${index + 1}/${frames.length}` : '—'}
        </span>
      </div>
    </div>
  );
}
