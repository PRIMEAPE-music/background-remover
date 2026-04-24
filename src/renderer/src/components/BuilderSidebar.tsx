import { useEffect, useMemo, useState } from 'react';
import {
  contentBoundsInRect,
  emptySlots,
  getActiveAnimation,
  newAnimation,
  scaleRatio,
  updateActiveAnimation,
  type BuilderState,
} from '../lib/builder';
import { computeCells } from '../lib/slicing';
import type { SourceMeta } from '../lib/sources';
import type { SelectedCell } from './BuilderView';
import { BuilderPreview } from './BuilderPreview';

export interface BuilderSidebarProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedCell: SelectedCell | null;
  selectedSlotIndex: number | null;
  onDeselectSlot: () => void;
  onDeselectCell: () => void;
  onExport: () => void;
  projectName: string;
  projectFolder: string | null;
  recentFolders: Array<{ path: string; name: string; at: string }>;
  /** Save to the currently-open folder (or prompt if none yet). */
  onProjectSave: (name: string) => void;
  /** Always prompt for a folder (Save As). */
  onProjectSaveAs: (name: string) => void;
  /** Prompt for a folder to open. */
  onProjectLoad: () => void;
  /** Load a specific folder (from the recents list). */
  onProjectLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onProjectNew: () => void;
}

export function BuilderSidebar({
  state,
  onStateChange,
  sources,
  getSource,
  selectedCell,
  selectedSlotIndex,
  onDeselectSlot,
  onDeselectCell,
  onExport,
  projectName,
  projectFolder,
  recentFolders,
  onProjectSave,
  onProjectSaveAs,
  onProjectLoad,
  onProjectLoadRecent,
  onRecentRemove,
  onProjectNew,
}: BuilderSidebarProps) {
  const active = getActiveAnimation(state);
  const activeSlots = active?.slots ?? [];

  const setSlotCount = (n: number) => {
    if (!active) return;
    const count = Math.max(0, Math.min(64, Math.floor(n)));
    const next: typeof activeSlots = [];
    for (let i = 0; i < count; i++)
      next.push(activeSlots[i] ?? { cell: null, yOffset: 0, scaleOverride: 1 });
    onStateChange(updateActiveAnimation(state, { slots: next }));
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
    // Default target height = natural height (ratio 1). User drags slider to adjust.
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

  const focusedSlot =
    selectedSlotIndex !== null ? activeSlots[selectedSlotIndex] ?? null : null;
  const nudge = (delta: number) => {
    if (!active || selectedSlotIndex === null) return;
    const next = activeSlots.map((s, i) =>
      i === selectedSlotIndex ? { ...s, yOffset: s.yOffset + delta } : s,
    );
    onStateChange(updateActiveAnimation(state, { slots: next }));
  };

  const allFilled = !!active && activeSlots.length > 0 && activeSlots.every((s) => s.cell);

  // Animation bank helpers
  const addAnimation = () => {
    const n = prompt('Name for the new animation:', 'animation');
    if (!n) return;
    const a = newAnimation(n.trim(), 8);
    onStateChange({
      ...state,
      animations: [...state.animations, a],
      activeAnimationId: a.id,
    });
  };
  const renameActiveAnimation = () => {
    if (!active) return;
    const n = prompt('Rename animation:', active.name);
    if (!n) return;
    onStateChange(updateActiveAnimation(state, { name: n.trim() }));
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

  return (
    <aside
      style={{
        width: 300,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <ProjectSection
        projectName={projectName}
        projectFolder={projectFolder}
        recentFolders={recentFolders}
        onSave={onProjectSave}
        onSaveAs={onProjectSaveAs}
        onLoad={onProjectLoad}
        onLoadRecent={onProjectLoadRecent}
        onRecentRemove={onRecentRemove}
        onNew={onProjectNew}
      />

      <section>
        <label>Animations ({state.animations.length})</label>
        {state.animations.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
            No animations yet. Click <b>+ New</b> below to create your first.
          </div>
        ) : (
          <select
            value={state.activeAnimationId ?? ''}
            onChange={(e) => setActiveAnimation(e.target.value)}
            style={{ width: '100%', marginTop: 4 }}
          >
            {state.animations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.slots.length})
              </option>
            ))}
          </select>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <button onClick={addAnimation} style={{ flex: 1, fontSize: 11 }}>
            + New
          </button>
          <button
            onClick={renameActiveAnimation}
            disabled={!active}
            style={{ flex: 1, fontSize: 11 }}
          >
            Rename
          </button>
          <button
            onClick={deleteActiveAnimation}
            disabled={!active}
            style={{ flex: 1, fontSize: 11 }}
          >
            Delete
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Animations share the character's frame box + scale lock. Each has its own slot list.
        </div>
      </section>

      <section>
        <label>Frame box</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
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
            style={{ flex: 1 }}
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
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
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
      </section>

      <section>
        <label>Slots ({activeSlots.length})</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
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
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
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
      </section>

      <section>
        <label>Scale reference</label>
        {state.scaleRef ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 4 }}>
              Ref: source <code>{state.scaleRef.sourceId.slice(0, 6)}…</code> cell{' '}
              {state.scaleRef.cellIndex}
              <br />
              Natural height: {state.scaleRef.refNaturalHeight}px · Ratio: ×
              {ratio.toFixed(3)}
            </div>
            <label style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
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
              style={{ width: '100%' }}
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
              style={{ width: '100%', marginTop: 4 }}
            />
            <button
              onClick={() => onStateChange({ ...state, scaleRef: null })}
              style={{ marginTop: 8, width: '100%' }}
            >
              Clear scale lock
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 4 }}>
              Pick a sprite (typically an idle pose) to lock the character's
              scale. Every slot uses the same ratio, so relative silhouette
              sizes are preserved across frames.
            </div>
            <button
              className="primary"
              onClick={setAsScaleReference}
              disabled={!selectedCell || !selectedRefHeight}
              style={{ marginTop: 8, width: '100%' }}
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

      <section>
        <label>
          Slot controls{' '}
          {selectedSlotIndex !== null && focusedSlot
            ? `(slot ${selectedSlotIndex + 1})`
            : '(no slot selected)'}
        </label>

        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
          Y-offset (lift for jumps / aerials)
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
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
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Arrow Up/Down nudge by 1 · Shift+arrow by 10.
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
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
          style={{ width: '100%', marginTop: 2 }}
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
          style={{ width: '100%', marginTop: 4, fontSize: 11 }}
        >
          Reset scale to character default
        </button>
        <button
          onClick={onDeselectCell}
          disabled={!selectedCell}
          style={{ width: '100%', marginTop: 4, fontSize: 11 }}
          title="Clear the gallery selection so clicking a placed slot focuses it instead of overwriting"
        >
          Deselect sprite
        </button>
        <button
          onClick={onDeselectSlot}
          disabled={selectedSlotIndex === null}
          style={{ width: '100%', marginTop: 4, fontSize: 11 }}
          title="Unfocus the current slot (arrow-nudge becomes inactive)"
        >
          Deselect slot
        </button>
      </section>

      <BuilderPreview state={state} sources={sources} getSource={getSource} />

      <section>
        <label>Export</label>
        <button
          className="primary"
          onClick={onExport}
          disabled={!allFilled || !state.scaleRef}
          style={{ width: '100%' }}
          title={
            !allFilled
              ? 'Fill every slot first'
              : !state.scaleRef
                ? 'Set a scale reference first'
                : undefined
          }
        >
          Export animation strip…
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Writes <code>{(active?.name ?? 'animation')}.png</code> at{' '}
          {state.boxSize.w * Math.max(1, activeSlots.length)}×{state.boxSize.h}.
        </div>
      </section>

      <section>
        <label>Reset</label>
        <button
          onClick={() => {
            if (!active) return;
            onStateChange(updateActiveAnimation(state, { slots: emptySlots(activeSlots.length) }));
          }}
          disabled={!active || activeSlots.every((s) => !s.cell)}
          style={{ width: '100%' }}
        >
          Clear all slots in this animation
        </button>
      </section>
    </aside>
  );
}

function ProjectSection({
  projectName,
  projectFolder,
  recentFolders,
  onSave,
  onSaveAs,
  onLoad,
  onLoadRecent,
  onRecentRemove,
  onNew,
}: {
  projectName: string;
  projectFolder: string | null;
  recentFolders: Array<{ path: string; name: string; at: string }>;
  onSave: (name: string) => void;
  onSaveAs: (name: string) => void;
  onLoad: () => void;
  onLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onNew: () => void;
}) {
  const [draft, setDraft] = useState(projectName || 'character');
  // Sync the editable name whenever the loaded project name changes.
  useEffect(() => {
    setDraft(projectName || 'character');
  }, [projectName]);
  return (
    <section>
      <label>Character project</label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="character name"
        style={{ width: '100%' }}
      />
      {projectFolder && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            marginTop: 4,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
          title={projectFolder}
        >
          {projectFolder}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button
          className="primary"
          onClick={() => {
            if (!draft.trim()) return;
            if (projectFolder) onSave(draft.trim());
            else onSaveAs(draft.trim());
          }}
          disabled={!draft.trim()}
          style={{ flex: 1, fontSize: 11 }}
          title={
            projectFolder
              ? `Overwrite project in ${projectFolder}`
              : 'Pick a parent folder; a <name> subfolder will be created inside'
          }
        >
          {projectFolder ? 'Save' : 'Save to folder…'}
        </button>
        {projectFolder && (
          <button
            onClick={() => {
              if (draft.trim()) onSaveAs(draft.trim());
            }}
            disabled={!draft.trim()}
            style={{ flex: 1, fontSize: 11 }}
            title="Save a copy into a different parent folder"
          >
            Save as…
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button onClick={() => onLoad()} style={{ flex: 1, fontSize: 11 }}>
          Open folder…
        </button>
        <button
          onClick={() => onNew()}
          style={{ flex: 1, fontSize: 11 }}
          title="Clear state and start fresh"
        >
          New
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
        Recent characters {recentFolders.length > 0 ? `(${recentFolders.length})` : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {recentFolders.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Save a character to a folder, and it'll appear here.
          </div>
        )}
        {recentFolders.map((r) => (
          <div key={r.path} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={() => onLoadRecent(r.path)}
              title={r.path}
              style={{
                flex: 1,
                fontSize: 11,
                textAlign: 'left',
                fontWeight: r.path === projectFolder ? 600 : 400,
              }}
            >
              {r.path === projectFolder ? '● ' : '○ '}
              {r.name}
            </button>
            <button
              onClick={() => onRecentRemove(r.path)}
              title="Forget this path (doesn't delete the folder)"
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>
        First save prompts for a parent folder and creates a <code>&lt;name&gt;/</code> subfolder
        inside it containing <code>project.spriteproj.json</code> + PNG copies of every loaded
        sheet. Subsequent Save calls overwrite that same folder. Move it freely; links won't break.
      </div>
    </section>
  );
}
