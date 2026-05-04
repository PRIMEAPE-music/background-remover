import { useCallback, useEffect, useState } from 'react';
import {
  getActiveAnimation,
  updateActiveAnimation,
  type BuilderState,
  type SelectedCell,
  type Slot,
} from '../../lib/builder';
import type { SourceMeta } from '../../lib/sources';
import { BuilderDock, clampDockHeight } from './BuilderDock';
import { GalleryPane } from './GalleryPane';
import { StripPane } from './StripPane';

const HEIGHT_STORAGE_KEY = 'builder.dockHeight';

function defaultDockHeight(): number {
  if (typeof window === 'undefined') return 400;
  return clampDockHeight(Math.round(window.innerHeight * 0.45));
}

function loadStoredDockHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (!raw) return defaultDockHeight();
    const n = Number(raw);
    if (!Number.isFinite(n)) return defaultDockHeight();
    return clampDockHeight(n);
  } catch {
    return defaultDockHeight();
  }
}

export interface BuilderLayoutProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selectedCell: SelectedCell | null;
  onSelectCell: (c: SelectedCell | null) => void;
  selectedSlotIndex: number | null;
  onSelectSlot: (i: number | null) => void;
  // Placement undo (shared between strip clicks and the dock's undo buttons).
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
  onUndoPlacement: () => void;
  onRedoPlacement: () => void;
  canUndoPlacement: boolean;
  canRedoPlacement: boolean;
  // Dock-only handlers.
  onDeselectCell: () => void;
  onDeselectSlot: () => void;
  // Project tab.
  projectName: string;
  projectFolder: string | null;
  recentFolders: Array<{ path: string; name: string; at: string }>;
  onProjectSave: (name: string) => void;
  onProjectSaveAs: (name: string) => void;
  onProjectLoad: () => void;
  onProjectLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onProjectNew: () => void;
  onExport: () => void;
  onExportAllToProject: () => void;
  hasProjectFolder: boolean;
}

/**
 * Builder mode top-level layout. Three regions:
 *
 *   ┌─ Gallery (340px, full height) ─┬─ Strip (top) ──────────┐
 *   │                                │                        │
 *   │                                ├─ resize handle ────────┤
 *   │                                │ Dock (tabs + preview)  │
 *   └────────────────────────────────┴────────────────────────┘
 *
 * The dock sits under the strip only — not under the gallery — so the gallery
 * stays a clean full-height column for browsing source cells.
 */
export function BuilderLayout(props: BuilderLayoutProps) {
  const [dockHeight, setDockHeightRaw] = useState<number>(() => loadStoredDockHeight());
  const setDockHeight = useCallback((h: number) => {
    const clamped = clampDockHeight(h);
    setDockHeightRaw(clamped);
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(clamped));
    } catch {
      // ignored
    }
  }, []);

  // Re-clamp on viewport resize so the dock can never exceed 80% of the new
  // window height (prevents the strip from being squeezed below 200px).
  useEffect(() => {
    const onResize = () => setDockHeightRaw((h) => clampDockHeight(h));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Strip-pane click handlers. Lifted here so the strip is self-contained
  // (no need to know about the gallery) and the gallery doesn't have to
  // route placement events through a parent.
  const active = getActiveAnimation(props.state);
  const slots = active?.slots ?? [];

  const placeIntoSlot = useCallback(
    (slotIndex: number) => {
      if (!active) return;
      if (!props.selectedCell) {
        props.onSelectSlot(slotIndex);
        return;
      }
      props.onRecordPlacement(active.id, slots);
      const next = slots.map((s, i) =>
        i === slotIndex ? { ...s, cell: { ...props.selectedCell! } } : s,
      );
      props.onStateChange(updateActiveAnimation(props.state, { slots: next }));
      props.onSelectSlot(slotIndex);
    },
    [active, slots, props],
  );

  const clearSlot = useCallback(
    (slotIndex: number) => {
      if (!active) return;
      props.onRecordPlacement(active.id, slots);
      const next = slots.map((s, i) =>
        i === slotIndex ? { cell: null, yOffset: 0, scaleOverride: 1 } : s,
      );
      props.onStateChange(updateActiveAnimation(props.state, { slots: next }));
    },
    [active, slots, props],
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <GalleryPane
        state={props.state}
        onStateChange={props.onStateChange}
        sources={props.sources}
        getSource={props.getSource}
        selected={props.selectedCell}
        onSelect={props.onSelectCell}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 200,
            overflow: 'hidden',
          }}
        >
          <StripPane
            state={props.state}
            slots={slots}
            activeName={active?.name ?? null}
            sources={props.sources}
            getSource={props.getSource}
            selectedSlotIndex={props.selectedSlotIndex}
            onSlotClick={placeIntoSlot}
            onSlotClear={clearSlot}
          />
        </div>
        <BuilderDock
          height={dockHeight}
          onHeightChange={setDockHeight}
          state={props.state}
          onStateChange={props.onStateChange}
          sources={props.sources}
          getSource={props.getSource}
          selectedCell={props.selectedCell}
          selectedSlotIndex={props.selectedSlotIndex}
          onDeselectSlot={props.onDeselectSlot}
          onDeselectCell={props.onDeselectCell}
          onRecordPlacement={props.onRecordPlacement}
          onUndoPlacement={props.onUndoPlacement}
          onRedoPlacement={props.onRedoPlacement}
          canUndoPlacement={props.canUndoPlacement}
          canRedoPlacement={props.canRedoPlacement}
          projectName={props.projectName}
          projectFolder={props.projectFolder}
          recentFolders={props.recentFolders}
          onProjectSave={props.onProjectSave}
          onProjectSaveAs={props.onProjectSaveAs}
          onProjectLoad={props.onProjectLoad}
          onProjectLoadRecent={props.onProjectLoadRecent}
          onRecentRemove={props.onRecentRemove}
          onProjectNew={props.onProjectNew}
          onExport={props.onExport}
          onExportAllToProject={props.onExportAllToProject}
          hasProjectFolder={props.hasProjectFolder}
        />
      </div>
    </div>
  );
}
