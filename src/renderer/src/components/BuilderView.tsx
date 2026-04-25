import { useMemo, useState } from 'react';
import {
  getActiveAnimation,
  updateActiveAnimation,
  type BuilderState,
  type Slot,
} from '../lib/builder';
import type { SourceMeta } from '../lib/sources';
import { computeCells, type Rect } from '../lib/slicing';
import { GalleryThumb } from './GalleryThumb';
import { SlotRenderer } from './SlotRenderer';

export interface SelectedCell {
  sourceId: string;
  cellIndex: number;
}

export interface BuilderViewProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedCell: SelectedCell | null;
  onSelectCell: (c: SelectedCell | null) => void;
  selectedSlotIndex: number | null;
  onSelectSlot: (i: number | null) => void;
  /** Snapshot the active animation's slots before a destructive change so the
   *  user can undo. Caller is responsible for guaranteeing animationId is the
   *  active one at call time. */
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
}

export function BuilderView({
  state,
  onStateChange,
  sources,
  getSource,
  selectedCell,
  onSelectCell,
  selectedSlotIndex,
  onSelectSlot,
  onRecordPlacement,
}: BuilderViewProps) {
  const active = getActiveAnimation(state);
  const slots: Slot[] = active?.slots ?? [];

  const placeIntoSlot = (slotIndex: number) => {
    if (!active) return;
    if (!selectedCell) {
      onSelectSlot(slotIndex);
      return;
    }
    onRecordPlacement(active.id, slots);
    const next = slots.map((s, i) =>
      i === slotIndex ? { ...s, cell: { ...selectedCell } } : s,
    );
    onStateChange(updateActiveAnimation(state, { slots: next }));
    onSelectSlot(slotIndex);
  };

  const clearSlot = (slotIndex: number) => {
    if (!active) return;
    onRecordPlacement(active.id, slots);
    const next = slots.map((s, i) =>
      i === slotIndex ? { cell: null, yOffset: 0, scaleOverride: 1 } : s,
    );
    onStateChange(updateActiveAnimation(state, { slots: next }));
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <GalleryPane
        state={state}
        onStateChange={onStateChange}
        sources={sources}
        getSource={getSource}
        selected={selectedCell}
        onSelect={onSelectCell}
      />
      <StripPane
        state={state}
        slots={slots}
        activeName={active?.name ?? null}
        sources={sources}
        getSource={getSource}
        selectedSlotIndex={selectedSlotIndex}
        onSlotClick={placeIntoSlot}
        onSlotClear={clearSlot}
      />
    </div>
  );
}

function GalleryPane({
  state,
  onStateChange,
  sources,
  getSource,
  selected,
  onSelect,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selected: SelectedCell | null;
  onSelect: (c: SelectedCell | null) => void;
}) {
  // Order to display sources in. Don't mutate the input array; the upstream
  // sources order is meaningful (load order shown in left edge sidebar).
  const displaySources = state.gallerySortByName
    ? [...sources].sort((a, b) =>
        a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()),
      )
    : sources;

  const collapsedSet = new Set(state.collapsedSources);
  const isCollapsed = (id: string) => collapsedSet.has(id);
  const toggleCollapsed = (id: string) => {
    const next = new Set(collapsedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onStateChange({ ...state, collapsedSources: [...next] });
  };
  // "Minimize all" if any are open; "Expand all" if all are already collapsed.
  const allCollapsed =
    sources.length > 0 && sources.every((s) => collapsedSet.has(s.id));
  const toggleAll = () => {
    onStateChange({
      ...state,
      collapsedSources: allCollapsed ? [] : sources.map((s) => s.id),
    });
  };
  const toggleSort = () => {
    onStateChange({ ...state, gallerySortByName: !state.gallerySortByName });
  };

  return (
    <div
      style={{
        width: 340,
        borderRight: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 12,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flex: 1 }}>
          Sprite pool
        </div>
        <button
          onClick={toggleSort}
          className={state.gallerySortByName ? 'primary' : ''}
          disabled={sources.length === 0}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={state.gallerySortByName ? 'Sorted A→Z (click to revert)' : 'Sort sources alphabetically'}
        >
          A→Z
        </button>
        <button
          onClick={toggleAll}
          disabled={sources.length === 0}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={allCollapsed ? 'Expand all sources' : 'Minimize all sources'}
        >
          {allCollapsed ? 'Expand all' : 'Minimize all'}
        </button>
      </div>
      {sources.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Load sheets from the left-edge sources column first.
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Click a sprite to select it, then click an empty slot in the strip to
        place it there. Click a placed slot to focus it (arrows nudge
        Y-offset). Right-click a placed slot to clear it.
      </div>
      {displaySources.map((s) => (
        <SourceRow
          key={s.id}
          source={s}
          getSource={getSource}
          selected={selected}
          onSelect={onSelect}
          collapsed={isCollapsed(s.id)}
          onToggleCollapsed={() => toggleCollapsed(s.id)}
        />
      ))}
    </div>
  );
}

function SourceRow({
  source,
  getSource,
  selected,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: {
  source: SourceMeta;
  getSource: (id: string | null) => ImageData | null;
  selected: SelectedCell | null;
  onSelect: (c: SelectedCell | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const open = !collapsed;
  const cells: Rect[] = useMemo(
    () => computeCells(source.slice, source.width, source.height),
    [source.slice, source.width, source.height],
  );
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={onToggleCollapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 3,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 10 }}>{open ? '▾' : '▸'}</span>
        <span
          style={{
            fontSize: 11,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}
          title={source.filename}
        >
          {source.filename}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{cells.length}</span>
      </div>
      {open && cells.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
            gap: 4,
          }}
        >
          {cells.map((r, i) => {
            const isSel = selected?.sourceId === source.id && selected?.cellIndex === i;
            return (
              <GalleryThumb
                key={i}
                sourceId={source.id}
                sourceVersion={source.version}
                rect={r}
                getSource={getSource}
                selected={isSel}
                onClick={() =>
                  onSelect(isSel ? null : { sourceId: source.id, cellIndex: i })
                }
              />
            );
          })}
        </div>
      )}
      {open && cells.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingLeft: 18 }}>
          No cells — slice this source first.
        </div>
      )}
    </section>
  );
}

function StripPane({
  state,
  slots,
  activeName,
  sources,
  getSource,
  selectedSlotIndex,
  onSlotClick,
  onSlotClear,
}: {
  state: BuilderState;
  slots: Slot[];
  activeName: string | null;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedSlotIndex: number | null;
  onSlotClick: (i: number) => void;
  onSlotClear: (i: number) => void;
}) {
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
