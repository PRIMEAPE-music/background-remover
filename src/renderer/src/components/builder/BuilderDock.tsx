import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuilderState, SelectedCell, Slot } from '../../lib/builder';
import type { SourceMeta } from '../../lib/sources';
import { BuilderPreview } from '../BuilderPreview';
import { ProjectTab } from './ProjectTab';
import { AnimationTab } from './AnimationTab';
import { ParticlesTab } from './ParticlesTab';

type TabId = 'project' | 'animation' | 'particles';

const TAB_STORAGE_KEY = 'builder.activeTab';
const DEFAULT_TAB: TabId = 'animation';
const PINNED_PREVIEW_WIDTH = 320;

function isTabId(v: string | null): v is TabId {
  return v === 'project' || v === 'animation' || v === 'particles';
}

export interface BuilderDockProps {
  height: number;
  onHeightChange: (h: number) => void;
  // Animation tab + pinned preview share these.
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  // Animation tab only.
  selectedCell: SelectedCell | null;
  selectedSlotIndex: number | null;
  onDeselectSlot: () => void;
  onDeselectCell: () => void;
  onRecordPlacement: (animationId: string, prevSlots: Slot[]) => void;
  onUndoPlacement: () => void;
  onRedoPlacement: () => void;
  canUndoPlacement: boolean;
  canRedoPlacement: boolean;
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
 * Bottom dock for builder mode. Top edge is a drag-to-resize handle, then a
 * tab strip, then the active tab's content. The animation preview lives in a
 * pinned column on the right so it stays visible regardless of which tab the
 * user is on (currently the most-referenced control while editing slots).
 */
export function BuilderDock(props: BuilderDockProps) {
  const { height, onHeightChange } = props;
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_STORAGE_KEY) : null;
    return isTabId(stored) ? stored : DEFAULT_TAB;
  });
  const setTab = useCallback((id: TabId) => {
    setActiveTab(id);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {
      // ignored
    }
  }, []);

  return (
    <div
      style={{
        height,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--panel)',
        borderTop: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <ResizeHandle height={height} onHeightChange={onHeightChange} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <TabStrip activeTab={activeTab} onChange={setTab} />
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {activeTab === 'project' ? (
              <ProjectTab
                state={props.state}
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
            ) : activeTab === 'animation' ? (
              <AnimationTab
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
              />
            ) : (
              <ParticlesTab
                state={props.state}
                onStateChange={props.onStateChange}
                sources={props.sources}
                getSource={props.getSource}
              />
            )}
          </div>
        </div>
        <aside
          style={{
            width: PINNED_PREVIEW_WIDTH,
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 12,
            overflowY: 'auto',
          }}
        >
          <BuilderPreview
            state={props.state}
            onStateChange={props.onStateChange}
            sources={props.sources}
            getSource={props.getSource}
            alwaysOn
          />
        </aside>
      </div>
    </div>
  );
}

function TabStrip({
  activeTab,
  onChange,
}: {
  activeTab: TabId;
  onChange: (id: TabId) => void;
}) {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'project', label: 'Project' },
    { id: 'animation', label: 'Animation' },
    { id: 'particles', label: 'Particles' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 8px',
        background: 'var(--panel-hi)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          className={activeTab === t.id ? 'primary' : ''}
          onClick={() => onChange(t.id)}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (h: number) => void;
}) {
  const draggingRef = useRef<{ startY: number; startH: number } | null>(null);
  const [hover, setHover] = useState(false);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = { startY: e.clientY, startH: height };
    },
    [height],
  );
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;
      // Drag up = grow the dock; clamp to a sane window-relative range.
      const delta = drag.startY - e.clientY;
      const next = clampDockHeight(drag.startH + delta);
      onHeightChange(next);
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onHeightChange]);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 6,
        cursor: 'ns-resize',
        background: hover ? 'var(--accent)' : 'var(--border)',
        flexShrink: 0,
        transition: 'background 0.1s',
      }}
      title="Drag to resize the dock"
    />
  );
}

export function clampDockHeight(h: number): number {
  // Reserve at least 200px for the canvas above and don't grow past 80% of the
  // viewport — past that and the strip pane is unusable.
  if (typeof window === 'undefined') return Math.max(200, Math.min(900, h));
  const max = Math.max(200, Math.round(window.innerHeight * 0.8));
  const min = 200;
  return Math.max(min, Math.min(max, h));
}
