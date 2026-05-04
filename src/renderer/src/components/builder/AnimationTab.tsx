import { useEffect, useMemo, useState } from 'react';
import {
  contentBoundsInRect,
  emptySlots,
  getActiveAnimation,
  newAnimation,
  scaleRatio,
  updateActiveAnimation,
  type BuilderState,
  type SelectedCell,
  type Slot,
} from '../../lib/builder';
import { computeCells } from '../../lib/slicing';
import type { SourceMeta } from '../../lib/sources';

export interface AnimationTabProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedCell: SelectedCell | null;
  selectedSlotIndex: number | null;
  onDeselectSlot: () => void;
  onDeselectCell: () => void;
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
  onUndoPlacement: () => void;
  onRedoPlacement: () => void;
  canUndoPlacement: boolean;
  canRedoPlacement: boolean;
}

/**
 * The animation editing tab — five horizontal columns reach the same handlers
 * as the old vertical BuilderSidebar. Each column wraps to the next row when
 * the dock is narrower than ~1100px.
 */
export function AnimationTab({
  state,
  onStateChange,
  sources,
  getSource,
  selectedCell,
  selectedSlotIndex,
  onDeselectSlot,
  onDeselectCell,
  onRecordPlacement,
  onUndoPlacement,
  onRedoPlacement,
  canUndoPlacement,
  canRedoPlacement,
}: AnimationTabProps) {
  const active = getActiveAnimation(state);
  const activeSlots = active?.slots ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        padding: 16,
        alignItems: 'flex-start',
      }}
    >
      <AnimationsColumn
        state={state}
        onStateChange={onStateChange}
        active={active}
        activeSlots={activeSlots}
        onRecordPlacement={onRecordPlacement}
        onUndoPlacement={onUndoPlacement}
        onRedoPlacement={onRedoPlacement}
        canUndoPlacement={canUndoPlacement}
        canRedoPlacement={canRedoPlacement}
      />
      <FrameBoxAndSlotsColumn
        state={state}
        onStateChange={onStateChange}
        active={active}
        activeSlots={activeSlots}
        onRecordPlacement={onRecordPlacement}
      />
      <SlotControlsColumn
        state={state}
        onStateChange={onStateChange}
        active={active}
        activeSlots={activeSlots}
        selectedCell={selectedCell}
        selectedSlotIndex={selectedSlotIndex}
        onDeselectSlot={onDeselectSlot}
        onDeselectCell={onDeselectCell}
      />
      <ScaleReferenceColumn
        state={state}
        onStateChange={onStateChange}
        sources={sources}
        getSource={getSource}
        selectedCell={selectedCell}
      />
    </div>
  );
}

function AnimationsColumn({
  state,
  onStateChange,
  active,
  activeSlots,
  onRecordPlacement,
  onUndoPlacement,
  onRedoPlacement,
  canUndoPlacement,
  canRedoPlacement,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  active: ReturnType<typeof getActiveAnimation>;
  activeSlots: Slot[];
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
  onUndoPlacement: () => void;
  onRedoPlacement: () => void;
  canUndoPlacement: boolean;
  canRedoPlacement: boolean;
}) {
  // Inline rename — local draft synced with active.name when the active
  // animation switches, committed on Enter or blur. Electron blocks
  // window.prompt() so renaming has to live in the panel.
  const [nameDraft, setNameDraft] = useState(active?.name ?? '');
  useEffect(() => {
    setNameDraft(active?.name ?? '');
  }, [active?.id, active?.name]);
  const commitRename = () => {
    if (!active) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === active.name) {
      setNameDraft(active.name);
      return;
    }
    onStateChange(updateActiveAnimation(state, { name: trimmed }));
  };

  const addAnimation = () => {
    let i = state.animations.length + 1;
    let candidate = `animation_${i}`;
    const taken = new Set(state.animations.map((a) => a.name));
    while (taken.has(candidate)) {
      i++;
      candidate = `animation_${i}`;
    }
    const a = newAnimation(candidate, 8);
    onStateChange({
      ...state,
      animations: [...state.animations, a],
      activeAnimationId: a.id,
    });
  };
  const deleteActiveAnimation = () => {
    if (!active) return;
    if (!confirm(`Delete animation "${active.name}"?`)) return;
    const nextAnims = state.animations.filter((a) => a.id !== active.id);
    onStateChange({
      ...state,
      animations: nextAnims,
      activeAnimationId: nextAnims[0]?.id ?? null,
    });
  };
  const setActiveAnimation = (id: string) => {
    onStateChange({ ...state, activeAnimationId: id });
  };

  const resetAllSlots = () => {
    if (!active) return;
    onRecordPlacement(active.id, activeSlots);
    onStateChange(updateActiveAnimation(state, { slots: emptySlots(activeSlots.length) }));
  };

  return (
    <section
      style={{
        flex: '0 1 260px',
        minWidth: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label>Animations ({state.animations.length})</label>
      {state.animations.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          No animations yet. Click <b>+ New</b> below to create your first.
        </div>
      ) : (
        <select
          value={state.activeAnimationId ?? ''}
          onChange={(e) => setActiveAnimation(e.target.value)}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          {state.animations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.slots.length})
            </option>
          ))}
        </select>
      )}
      {active && (
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setNameDraft(active.name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="animation name"
          title="Rename — press Enter or click away to commit"
        />
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={addAnimation} style={{ flex: 1, fontSize: 11 }}>
          + New
        </button>
        <button
          onClick={deleteActiveAnimation}
          disabled={!active}
          style={{ flex: 1, fontSize: 11 }}
        >
          Delete
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onUndoPlacement}
          disabled={!canUndoPlacement}
          style={{ flex: 1, fontSize: 11 }}
          title="Undo placement / clear / slot-count change (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          onClick={onRedoPlacement}
          disabled={!canRedoPlacement}
          style={{ flex: 1, fontSize: 11 }}
          title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Animations share the character's frame box + scale lock. Each has its own slot list.
      </div>
      <button
        onClick={resetAllSlots}
        disabled={!active || activeSlots.every((s) => !s.cell)}
        style={{ width: '100%', fontSize: 11, marginTop: 4 }}
      >
        Clear all slots in this animation
      </button>
    </section>
  );
}

function FrameBoxAndSlotsColumn({
  state,
  onStateChange,
  active,
  activeSlots,
  onRecordPlacement,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  active: ReturnType<typeof getActiveAnimation>;
  activeSlots: Slot[];
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
}) {
  const setSlotCount = (n: number) => {
    if (!active) return;
    const count = Math.max(0, Math.min(64, Math.floor(n)));
    if (count === activeSlots.length) return;
    onRecordPlacement(active.id, activeSlots);
    const next: Slot[] = [];
    for (let i = 0; i < count; i++)
      next.push(activeSlots[i] ?? { cell: null, yOffset: 0, scaleOverride: 1 });
    onStateChange(updateActiveAnimation(state, { slots: next }));
  };

  return (
    <section
      style={{
        flex: '0 1 220px',
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>Frame box</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="number"
            value={state.boxSize.w}
            min={8}
            max={2048}
            onChange={(e) =>
              onStateChange({
                ...state,
                boxSize: { ...state.boxSize, w: Math.max(8, Number(e.target.value) || 0) },
              })
            }
          />
          <span style={{ color: 'var(--text-dim)' }}>×</span>
          <input
            type="number"
            value={state.boxSize.h}
            min={8}
            max={2048}
            onChange={(e) =>
              onStateChange({
                ...state,
                boxSize: { ...state.boxSize, h: Math.max(8, Number(e.target.value) || 0) },
              })
            }
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[128, 256, 512, 1024].map((n) => (
            <button
              key={n}
              onClick={() => onStateChange({ ...state, boxSize: { w: n, h: n } })}
              style={{ flex: 1, fontSize: 11 }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>Slots ({activeSlots.length})</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setSlotCount(activeSlots.length - 1)}
            disabled={!active || activeSlots.length === 0}
          >
            −
          </button>
          <input
            type="number"
            value={activeSlots.length}
            min={0}
            max={64}
            onChange={(e) => setSlotCount(Number(e.target.value))}
            disabled={!active}
            style={{ flex: 1, textAlign: 'center' }}
          />
          <button
            onClick={() => setSlotCount(activeSlots.length + 1)}
            disabled={!active || activeSlots.length >= 64}
          >
            +
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[4, 6, 8, 12].map((n) => (
            <button
              key={n}
              onClick={() => setSlotCount(n)}
              disabled={!active}
              style={{ flex: 1, fontSize: 11 }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const SCALE_REF_COLLAPSED_KEY = 'builder.scaleRef.collapsed';

function ScaleReferenceColumn({
  state,
  onStateChange,
  sources,
  getSource,
  selectedCell,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedCell: SelectedCell | null;
}) {
  // Collapsed by default — the slider is easy to bump, and most of the time
  // the user only wants to tweak per-slot scale override (the next column
  // over). Expand explicitly when locking in a new character scale.
  const [collapsed, setCollapsedRaw] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(SCALE_REF_COLLAPSED_KEY);
      return raw === null ? true : raw === '1';
    } catch {
      return true;
    }
  });
  const setCollapsed = (v: boolean) => {
    setCollapsedRaw(v);
    try {
      localStorage.setItem(SCALE_REF_COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      // ignored
    }
  };

  // Scan the selected cell's natural content height so the reference picker
  // can default to "1:1 scale" when the user opens it.
  const selectedRefHeight = useMemo(() => {
    if (!selectedCell) return null;
    const src = sources.find((s) => s.id === selectedCell.sourceId);
    if (!src) return null;
    const img = getSource(src.id);
    if (!img) return null;
    const cells = computeCells(src.slice, src.width, src.height);
    const rect = cells[selectedCell.cellIndex];
    if (!rect) return null;
    const bounds = contentBoundsInRect(img, rect);
    return bounds?.height ?? null;
  }, [selectedCell, sources, getSource]);

  const setAsScaleReference = () => {
    if (!selectedCell || !selectedRefHeight) return;
    onStateChange({
      ...state,
      scaleRef: {
        sourceId: selectedCell.sourceId,
        cellIndex: selectedCell.cellIndex,
        targetHeightPx: selectedRefHeight,
        refNaturalHeight: selectedRefHeight,
      },
    });
  };

  const ratio = scaleRatio(state.scaleRef);

  if (collapsed) {
    return (
      <section
        style={{
          flex: '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Expand scale reference controls"
          style={{
            fontSize: 11,
            padding: '4px 10px',
            textAlign: 'left',
            whiteSpace: 'nowrap',
          }}
        >
          ▸ Scale reference{state.scaleRef ? ` · ×${ratio.toFixed(2)}` : ''}
        </button>
      </section>
    );
  }

  return (
    <section
      style={{
        flex: '0 1 280px',
        minWidth: 240,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        onClick={() => setCollapsed(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        title="Collapse"
      >
        <label style={{ flex: 1, marginBottom: 0, cursor: 'pointer' }}>Scale reference</label>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>▾</span>
      </div>
      {state.scaleRef ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Ref: source <code>{state.scaleRef.sourceId.slice(0, 6)}…</code> cell{' '}
            {state.scaleRef.cellIndex}
            <br />
            Natural height: {state.scaleRef.refNaturalHeight}px · Ratio: ×{ratio.toFixed(3)}
          </div>
          <label style={{ marginTop: 4, marginBottom: 0 }}>
            Target height: {state.scaleRef.targetHeightPx}px
          </label>
          <input
            type="range"
            min={4}
            max={state.boxSize.h}
            value={state.scaleRef.targetHeightPx}
            onChange={(e) =>
              onStateChange({
                ...state,
                scaleRef: state.scaleRef && {
                  ...state.scaleRef,
                  targetHeightPx: Number(e.target.value),
                },
              })
            }
          />
          <input
            type="number"
            min={1}
            max={state.boxSize.h * 2}
            value={state.scaleRef.targetHeightPx}
            onChange={(e) =>
              onStateChange({
                ...state,
                scaleRef: state.scaleRef && {
                  ...state.scaleRef,
                  targetHeightPx: Math.max(1, Number(e.target.value) || 0),
                },
              })
            }
          />
          <button
            onClick={() => onStateChange({ ...state, scaleRef: null })}
            style={{ width: '100%' }}
          >
            Clear scale lock
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Pick a sprite (typically an idle pose) to lock the character's scale. Every slot
            uses the same ratio, so relative silhouette sizes are preserved across frames.
          </div>
          <button
            className="primary"
            onClick={setAsScaleReference}
            disabled={!selectedCell || !selectedRefHeight}
            style={{ width: '100%' }}
            title={
              !selectedCell
                ? 'Select a sprite in the gallery first'
                : !selectedRefHeight
                  ? 'Selected sprite has no opaque content'
                  : undefined
            }
          >
            Set selected sprite as reference
          </button>
        </>
      )}
    </section>
  );
}

function SlotControlsColumn({
  state,
  onStateChange,
  active,
  activeSlots,
  selectedCell,
  selectedSlotIndex,
  onDeselectSlot,
  onDeselectCell,
}: {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  active: ReturnType<typeof getActiveAnimation>;
  activeSlots: Slot[];
  selectedCell: SelectedCell | null;
  selectedSlotIndex: number | null;
  onDeselectSlot: () => void;
  onDeselectCell: () => void;
}) {
  const focusedSlot =
    selectedSlotIndex !== null ? activeSlots[selectedSlotIndex] ?? null : null;

  const nudge = (delta: number) => {
    if (!active || selectedSlotIndex === null) return;
    const next = activeSlots.map((s, i) =>
      i === selectedSlotIndex ? { ...s, yOffset: s.yOffset + delta } : s,
    );
    onStateChange(updateActiveAnimation(state, { slots: next }));
  };

  return (
    <section
      style={{
        flex: '0 1 300px',
        minWidth: 260,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label>
        Slot controls{' '}
        {selectedSlotIndex !== null && focusedSlot
          ? `(slot ${selectedSlotIndex + 1})`
          : '(no slot selected)'}
      </label>

      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Y-offset (lift for jumps / aerials)
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => nudge(-10)} disabled={selectedSlotIndex === null}>
          −10
        </button>
        <button onClick={() => nudge(-1)} disabled={selectedSlotIndex === null}>
          −1
        </button>
        <input
          type="number"
          value={focusedSlot?.yOffset ?? 0}
          onChange={(e) => {
            if (!active || selectedSlotIndex === null) return;
            const v = Math.round(Number(e.target.value) || 0);
            const next = activeSlots.map((s, i) =>
              i === selectedSlotIndex ? { ...s, yOffset: v } : s,
            );
            onStateChange(updateActiveAnimation(state, { slots: next }));
          }}
          disabled={!active || selectedSlotIndex === null}
          style={{ flex: 1, textAlign: 'center' }}
        />
        <button onClick={() => nudge(1)} disabled={selectedSlotIndex === null}>
          +1
        </button>
        <button onClick={() => nudge(10)} disabled={selectedSlotIndex === null}>
          +10
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        Arrow Up/Down nudge by 1 · Shift+arrow by 10.
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
        Scale override ×{(focusedSlot?.scaleOverride ?? 1).toFixed(2)}
      </div>
      <input
        type="range"
        min={0.2}
        max={3}
        step={0.01}
        value={focusedSlot?.scaleOverride ?? 1}
        onChange={(e) => {
          if (!active || selectedSlotIndex === null) return;
          const v = Number(e.target.value);
          const next = activeSlots.map((s, i) =>
            i === selectedSlotIndex ? { ...s, scaleOverride: v } : s,
          );
          onStateChange(updateActiveAnimation(state, { slots: next }));
        }}
        disabled={!active || selectedSlotIndex === null}
      />
      <button
        onClick={() => {
          if (!active || selectedSlotIndex === null) return;
          const next = activeSlots.map((s, i) =>
            i === selectedSlotIndex ? { ...s, scaleOverride: 1 } : s,
          );
          onStateChange(updateActiveAnimation(state, { slots: next }));
        }}
        disabled={
          !active || selectedSlotIndex === null || (focusedSlot?.scaleOverride ?? 1) === 1
        }
        style={{ width: '100%', fontSize: 11 }}
      >
        Reset scale to character default
      </button>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onDeselectCell}
          disabled={!selectedCell}
          style={{ flex: 1, fontSize: 11 }}
          title="Clear the gallery selection so clicking a placed slot focuses it instead of overwriting"
        >
          Deselect sprite
        </button>
        <button
          onClick={onDeselectSlot}
          disabled={selectedSlotIndex === null}
          style={{ flex: 1, fontSize: 11 }}
          title="Unfocus the current slot (arrow-nudge becomes inactive)"
        >
          Deselect slot
        </button>
      </div>
    </section>
  );
}
