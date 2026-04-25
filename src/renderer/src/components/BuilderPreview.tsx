import { memo, useEffect, useState } from 'react';
import {
  DEFAULT_FPS,
  getActiveAnimation,
  updateActiveAnimation,
  type BuilderState,
} from '../lib/builder';
import type { SourceMeta } from '../lib/sources';
import { SlotRenderer } from './SlotRenderer';

export interface BuilderPreviewProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

/**
 * Opt-in animated preview of the current builder strip. Mounted only when
 * the user clicks "Show preview" — same pattern as Slice mode's preview, for
 * the same reason: keeping a live ImageData reference in the sidebar's prop
 * tree causes React 19 dev-mode reconciliation stalls during rapid source
 * switches.
 */
export const BuilderPreview = memo(function BuilderPreview({
  state,
  onStateChange,
  sources,
  getSource,
}: BuilderPreviewProps) {
  const [enabled, setEnabled] = useState(false);
  const active = getActiveAnimation(state);
  const canPreview = !!active && active.slots.some((s) => s.cell);
  return (
    <section>
      <label>Animation preview</label>
      {enabled ? (
        <>
          <PreviewInner
            state={state}
            onStateChange={onStateChange}
            sources={sources}
            getSource={getSource}
          />
          <button
            onClick={() => setEnabled(false)}
            style={{ marginTop: 6, width: '100%', fontSize: 11 }}
          >
            Hide preview
          </button>
        </>
      ) : (
        <button
          onClick={() => setEnabled(true)}
          disabled={!canPreview}
          style={{ width: '100%' }}
          title="Preview plays through the active animation's placed slots."
        >
          Show preview
        </button>
      )}
    </section>
  );
});

function PreviewInner({
  state,
  onStateChange,
  sources,
  getSource,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}) {
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const active = getActiveAnimation(state);
  const slots = active?.slots ?? [];
  // FPS is per-animation now — slider edits push to BuilderState so the
  // chosen rate persists across saves and is appended to the export filename.
  const fps = active?.fps ?? DEFAULT_FPS;
  const setFps = (next: number) => {
    onStateChange(updateActiveAnimation(state, { fps: Math.max(1, Math.min(60, next)) }));
  };

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, slots.length - 1)));
  }, [slots.length]);

  useEffect(() => {
    if (!playing || slots.length === 0) return;
    const interval = window.setInterval(() => {
      setIndex((i) => (i + 1) % slots.length);
    }, Math.max(20, 1000 / fps));
    return () => window.clearInterval(interval);
  }, [playing, fps, slots.length]);

  const MAX = 220;
  const scale = Math.min(MAX / state.boxSize.w, MAX / state.boxSize.h, 1);
  const slot = slots[index];
  const displayW = Math.round(state.boxSize.w * scale);
  const displayH = Math.round(state.boxSize.h * scale);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          width: displayW,
          height: displayH,
          margin: '0 auto',
          border: '1px solid var(--border)',
          background:
            'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 10px 10px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {slot ? (
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              width: state.boxSize.w,
              height: state.boxSize.h,
            }}
          >
            <SlotRenderer
              slot={slot}
              boxSize={state.boxSize}
              anchor={state.anchor}
              scaleRef={state.scaleRef}
              sources={sources}
              getSource={getSource}
            />
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => setPlaying((p) => !p)} disabled={slots.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          style={{ flex: 1 }}
          disabled={slots.length === 0}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 40, textAlign: 'right' }}>
          {fps} fps
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => setIndex((i) => (i - 1 + slots.length) % Math.max(1, slots.length))}
          disabled={slots.length === 0}
        >
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, slots.length - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          style={{ flex: 1 }}
          disabled={slots.length === 0}
        />
        <button
          onClick={() => setIndex((i) => (i + 1) % Math.max(1, slots.length))}
          disabled={slots.length === 0}
        >
          ▶
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 60, textAlign: 'right' }}>
          {slots.length ? `${index + 1}/${slots.length}` : '—'}
        </span>
      </div>
    </div>
  );
}
