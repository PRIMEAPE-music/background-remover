import { useEffect, useState } from 'react';
import { getActiveAnimation, type BuilderState } from '../../lib/builder';

export interface ProjectTabProps {
  state: BuilderState;
  // Project file
  projectName: string;
  projectFolder: string | null;
  recentFolders: Array<{ path: string; name: string; at: string }>;
  onProjectSave: (name: string) => void;
  onProjectSaveAs: (name: string) => void;
  onProjectLoad: () => void;
  onProjectLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onProjectNew: () => void;
  // Export
  onExport: () => void;
  onExportAllToProject: () => void;
  hasProjectFolder: boolean;
}

/**
 * Combined project + export tab. The dock gives us horizontal room, so the
 * three concerns (project file, recents, export) sit side by side instead of
 * stacked the way they were in the old vertical sidebar.
 */
export function ProjectTab({
  state,
  projectName,
  projectFolder,
  recentFolders,
  onProjectSave,
  onProjectSaveAs,
  onProjectLoad,
  onProjectLoadRecent,
  onRecentRemove,
  onProjectNew,
  onExport,
  onExportAllToProject,
  hasProjectFolder,
}: ProjectTabProps) {
  const active = getActiveAnimation(state);
  const activeSlots = active?.slots ?? [];
  const allFilled = !!active && activeSlots.length > 0 && activeSlots.every((s) => s.cell);

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
      <ProjectFileColumn
        projectName={projectName}
        projectFolder={projectFolder}
        onSave={onProjectSave}
        onSaveAs={onProjectSaveAs}
        onLoad={onProjectLoad}
        onNew={onProjectNew}
      />
      <RecentsColumn
        recentFolders={recentFolders}
        projectFolder={projectFolder}
        onLoadRecent={onProjectLoadRecent}
        onRecentRemove={onRecentRemove}
      />
      <ExportColumn
        animationName={active?.name ?? null}
        animationFps={active?.fps ?? 8}
        boxW={state.boxSize.w}
        boxH={state.boxSize.h}
        slotCount={activeSlots.length}
        animationCount={state.animations.length}
        allFilled={allFilled}
        hasScaleRef={!!state.scaleRef}
        hasProjectFolder={hasProjectFolder}
        onExport={onExport}
        onExportAllToProject={onExportAllToProject}
      />
    </div>
  );
}

function ProjectFileColumn({
  projectName,
  projectFolder,
  onSave,
  onSaveAs,
  onLoad,
  onNew,
}: {
  projectName: string;
  projectFolder: string | null;
  onSave: (name: string) => void;
  onSaveAs: (name: string) => void;
  onLoad: () => void;
  onNew: () => void;
}) {
  const [draft, setDraft] = useState(projectName || 'character');
  // Sync the editable name whenever the loaded project name changes.
  useEffect(() => {
    setDraft(projectName || 'character');
  }, [projectName]);
  return (
    <section
      style={{
        flex: '0 1 320px',
        minWidth: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label>Character project</label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="character name"
      />
      {projectFolder && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
          title={projectFolder}
        >
          {projectFolder}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
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
      <div style={{ display: 'flex', gap: 4 }}>
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
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        First save prompts for a parent folder and creates a <code>&lt;name&gt;/</code> subfolder
        inside it containing <code>project.spriteproj.json</code> + PNG copies of every loaded
        sheet. Subsequent Save calls overwrite that same folder. Move it freely; links won't break.
      </div>
    </section>
  );
}

function RecentsColumn({
  recentFolders,
  projectFolder,
  onLoadRecent,
  onRecentRemove,
}: {
  recentFolders: Array<{ path: string; name: string; at: string }>;
  projectFolder: string | null;
  onLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
}) {
  return (
    <section
      style={{
        flex: '0 1 320px',
        minWidth: 240,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <label>
        Recent characters {recentFolders.length > 0 ? `(${recentFolders.length})` : ''}
      </label>
      {recentFolders.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          Save a character to a folder, and it'll appear here.
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
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
    </section>
  );
}

function ExportColumn({
  animationName,
  animationFps,
  boxW,
  boxH,
  slotCount,
  animationCount,
  allFilled,
  hasScaleRef,
  hasProjectFolder,
  onExport,
  onExportAllToProject,
}: {
  animationName: string | null;
  animationFps: number;
  boxW: number;
  boxH: number;
  slotCount: number;
  animationCount: number;
  allFilled: boolean;
  hasScaleRef: boolean;
  hasProjectFolder: boolean;
  onExport: () => void;
  onExportAllToProject: () => void;
}) {
  return (
    <section
      style={{
        flex: '0 1 320px',
        minWidth: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label>Export</label>
      <button
        className="primary"
        onClick={onExport}
        disabled={!allFilled || !hasScaleRef}
        style={{ width: '100%' }}
        title={
          !allFilled
            ? 'Fill every slot first'
            : !hasScaleRef
              ? 'Set a scale reference first'
              : undefined
        }
      >
        Export this animation…
      </button>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        Writes{' '}
        <code>
          {animationName ?? 'animation'}_{animationFps}fps.png
        </code>{' '}
        via Save dialog at {boxW * Math.max(1, slotCount)}×{boxH}. Set FPS in the preview.
      </div>
      <button
        onClick={onExportAllToProject}
        disabled={!hasProjectFolder || !hasScaleRef || animationCount === 0}
        style={{ width: '100%' }}
        title={
          !hasProjectFolder
            ? 'Save the project to a folder first (Project tab)'
            : !hasScaleRef
              ? 'Set a scale reference first'
              : animationCount === 0
                ? 'No animations to export'
                : 'Save every animation strip into the project folder for re-editing later'
        }
      >
        Export all animations to project folder
      </button>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        {hasProjectFolder
          ? 'Writes one PNG per animation alongside project.spriteproj.json. Skips animations missing slots or a scale lock.'
          : 'Save the project to a folder first — this button writes into that folder.'}
      </div>
    </section>
  );
}
