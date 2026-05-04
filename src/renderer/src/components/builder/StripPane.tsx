import { useState } from 'react';
import type { BuilderState, Slot } from '../../lib/builder';
import type { SourceMeta } from '../../lib/sources';
import { SlotRenderer } from '../SlotRenderer';

export interface StripPaneProps {
  state: BuilderState;
  slots: Slot[];
  activeName: string | null;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedSlotIndex: number | null;
  onSlotClick: (i: number) => void;
  onSlotClear: (i: number) => void;
}

/**
 * The animation strip viewport — the right side of builder mode. Renders the
 * active animation's slots in a row, optionally preceded by the scale
 * reference box. Has its own ctrl-wheel zoom that's independent of the rest
 * of the editor's zoom state.
 */
export function StripPane({
  state,
  slots,
  activeName,
  sources,
  getSource,
  selectedSlotIndex,
  onSlotClick,
  onSlotClear,
}: StripPaneProps) {
  const [zoom, setZoom] = useState(1);
  // Gap between the reference box and the first slot — close but visually
  // distinct as "not part of the animation".
  const REF_GAP = 8;
  const hasRef = !!state.scaleRef;
  const slotsTotalW =
    state.boxSize.w * Math.max(1, slots.length) + Math.max(0, slots.length - 1) * 2;
  const rawStripW = (hasRef ? state.boxSize.w + REF_GAP : 0) + slotsTotalW;
  const rawStripH = state.boxSize.h;
  const scaledW = rawStripW * zoom;
  const scaledH = rawStripH * zoom;
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((z) => Math.max(0.05, Math.min(4, z * factor)));
  };
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e22',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 12,
          color: 'var(--text-dim)',
          flexShrink: 0,
        }}
      >
        <span>
          Animation:{' '}
          <span style={{ fontFamily: 'monospace', color: '#e6e6ea' }}>
            {activeName ?? '—'}
          </span>
        </span>
        <span>·</span>
        <span>
          {slots.length} slot{slots.length === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span>
          {state.boxSize.w}×{state.boxSize.h}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => setZoom((z) => Math.max(0.05, z / 1.15))} title="Zoom out (ctrl+wheel)">
            −
          </button>
          <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'monospace', fontSize: 11 }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(4, z * 1.15))} title="Zoom in (ctrl+wheel)">
            +
          </button>
          <button onClick={() => setZoom(1)} title="Reset to 100%">
            1:1
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }} onWheel={onWheel}>
        {!activeName ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: 40 }}>
            Create or select an animation in the sidebar to start building a strip.
          </div>
        ) : slots.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: 40 }}>
            Set a slot count in the sidebar to start the strip.
          </div>
        ) : (
          <div
            style={{
              width: scaledW,
              height: scaledH,
              margin: '0 auto',
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {hasRef && state.scaleRef && (
                <div
                  style={{
                    width: state.boxSize.w,
                    height: state.boxSize.h,
                    border: '1px dashed #ffbf6a',
                    background:
                      'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 16px 16px',
                    position: 'relative',
                    flexShrink: 0,
                    marginRight: REF_GAP,
                  }}
                  title={`Scale reference · target height ${state.scaleRef.targetHeightPx}px`}
                >
                  <SlotRenderer
                    slot={{
                      cell: {
                        sourceId: state.scaleRef.sourceId,
                        cellIndex: state.scaleRef.cellIndex,
                      },
                      yOffset: 0,
                      scaleOverride: 1,
                    }}
                    boxSize={state.boxSize}
                    anchor={state.anchor}
                    scaleRef={state.scaleRef}
                    sources={sources}
                    getSource={getSource}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 4,
                      color: '#ffbf6a',
                      fontSize: 10,
                      fontFamily: 'monospace',
                      pointerEvents: 'none',
                      textShadow: '0 1px 0 rgba(0,0,0,0.8)',
                    }}
                  >
                    ref · {state.scaleRef.targetHeightPx}px
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 2 }}>
                {slots.map((slot, i) => {
                  const focused = selectedSlotIndex === i;
                  return (
                    <div
                      key={i}
                      onClick={() => onSlotClick(i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (slot.cell) onSlotClear(i);
                      }}
                      style={{
                        width: state.boxSize.w,
                        height: state.boxSize.h,
                        border: `1px solid ${focused ? '#6aa9ff' : 'var(--border)'}`,
                        background:
                          'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 16px 16px',
                        position: 'relative',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      title={
                        slot.cell
                          ? `slot ${i + 1} · yOffset ${slot.yOffset} · scale ×${(slot.scaleOverride ?? 1).toFixed(2)}`
                          : `slot ${i + 1} · click to place selected sprite`
                      }
                    >
                      {slot.cell ? (
                        <SlotRenderer
                          slot={slot}
                          boxSize={state.boxSize}
                          anchor={state.anchor}
                          scaleRef={state.scaleRef}
                          sources={sources}
                          getSource={getSource}
                        />
                      ) : null}
                      <div
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: 4,
                          color: focused ? '#6aa9ff' : 'var(--text-dim)',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          pointerEvents: 'none',
                          textShadow: '0 1px 0 rgba(0,0,0,0.8)',
                        }}
                      >
                        {i + 1}
                        {slot.yOffset !== 0 && `  y${slot.yOffset > 0 ? '+' : ''}${slot.yOffset}`}
                        {(slot.scaleOverride ?? 1) !== 1 &&
                          `  ×${(slot.scaleOverride ?? 1).toFixed(2)}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
