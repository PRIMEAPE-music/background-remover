import { useEffect, useState } from 'react';
import type { PlatformAsset, PlatformProject } from '../../lib/platforms';
import type { RecentPlatformFolder } from '../../lib/platformProject';
import type { SourceMeta } from '../../lib/sources';
import type { DecorationProject } from '../../lib/decorations';
import { PlatformsLibraryArea } from './PlatformsLibraryArea';

export interface PlatformsViewProps {
  project: PlatformProject;
  assetImages: Map<string, ImageData>;
  /** Loaded source sheets — Sources pane lists their cells for one-click add. */
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onAddAsset: (image: ImageData) => void;
  onUpdateAsset: (id: string, patch: Partial<PlatformAsset>) => void;
  onRemoveAsset: (id: string) => void;
  /** Decoration project from Decorations mode — passed through to the
   *  Walkable editor's "Decorations" tab so the user can place
   *  specific decorations on specific platforms. Null when Decorations
   *  mode hasn't loaded a project. */
  decorationProject: DecorationProject | null;
  decorationThumbnails: Map<string, string>;
  // Project file
  projectName: string;
  projectFolder: string | null;
  recentFolders: RecentPlatformFolder[];
  onProjectSave: (name: string) => void;
  onProjectSaveAs: (name: string) => void;
  onProjectLoad: () => void;
  onProjectLoadFile: () => void;
  onProjectLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onProjectNew: () => void;
  /** Run AI upscaling on library assets. When `assetIds` is provided, only
   *  those are upscaled; when undefined, the whole library runs.
   *  `onProgress` reports per-asset; `shouldCancel` is polled between
   *  assets so the user can abort mid-batch. */
  onUpscaleAll: (
    onProgress: (current: number, total: number, filename: string) => void,
    shouldCancel: () => boolean,
    assetIds?: ReadonlySet<string>,
  ) => Promise<void>;
}

/**
 * Top-level view for Platforms mode. Slice 1 wires up project save/load,
 * recents, and the empty-state placeholder. Slice 2 will fill the body with
 * the source-cells panel + library list + asset metadata form.
 */
export function PlatformsView({
  project,
  assetImages,
  sources,
  getSource,
  onAddAsset,
  onUpdateAsset,
  onRemoveAsset,
  decorationProject,
  decorationThumbnails,
  projectName,
  projectFolder,
  recentFolders,
  onProjectSave,
  onProjectSaveAs,
  onProjectLoad,
  onProjectLoadFile,
  onProjectLoadRecent,
  onRecentRemove,
  onProjectNew,
  onUpscaleAll,
}: PlatformsViewProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <ProjectBar
        projectName={projectName}
        projectFolder={projectFolder}
        recentFolders={recentFolders}
        onSave={onProjectSave}
        onSaveAs={onProjectSaveAs}
        onLoad={onProjectLoad}
        onLoadFile={onProjectLoadFile}
        onLoadRecent={onProjectLoadRecent}
        onRecentRemove={onRecentRemove}
        onNew={onProjectNew}
      />
      <PlatformsLibraryArea
        project={project}
        assetImages={assetImages}
        sources={sources}
        getSource={getSource}
        onAddAsset={onAddAsset}
        onUpdateAsset={onUpdateAsset}
        onRemoveAsset={onRemoveAsset}
        decorationProject={decorationProject}
        decorationThumbnails={decorationThumbnails}
        onUpscaleAll={onUpscaleAll}
      />
    </div>
  );
}

function ProjectBar({
  projectName,
  projectFolder,
  recentFolders,
  onSave,
  onSaveAs,
  onLoad,
  onLoadFile,
  onLoadRecent,
  onRecentRemove,
  onNew,
}: {
  projectName: string;
  projectFolder: string | null;
  recentFolders: RecentPlatformFolder[];
  onSave: (name: string) => void;
  onSaveAs: (name: string) => void;
  onLoad: () => void;
  onLoadFile: () => void;
  onLoadRecent: (folder: string) => void;
  onRecentRemove: (folder: string) => void;
  onNew: () => void;
}) {
  const [draft, setDraft] = useState(projectName || 'platforms');
  useEffect(() => {
    setDraft(projectName || 'platforms');
  }, [projectName]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 16px',
        background: 'var(--panel)',
        borderBottom: '1px solid var(--border)',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ marginBottom: 0, fontSize: 11 }}>Project</label>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="project name"
          style={{ flex: '0 1 240px' }}
        />
        <button
          className="primary"
          onClick={() => {
            const trimmed = draft.trim();
            if (!trimmed) return;
            if (projectFolder) onSave(trimmed);
            else onSaveAs(trimmed);
          }}
          disabled={!draft.trim()}
          style={{ fontSize: 11 }}
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
              const t = draft.trim();
              if (t) onSaveAs(t);
            }}
            disabled={!draft.trim()}
            style={{ fontSize: 11 }}
            title="Save a copy into a different parent folder"
          >
            Save as…
          </button>
        )}
        <button
          onClick={onLoad}
          style={{ fontSize: 11 }}
          title="Open by selecting the project folder (also searches one level deep so it works after a rename)"
        >
          Open folder…
        </button>
        <button
          onClick={onLoadFile}
          style={{ fontSize: 11 }}
          title="Open by selecting a platforms.json file directly — works regardless of folder name"
        >
          Open file…
        </button>
        <button
          onClick={onNew}
          style={{ fontSize: 11 }}
          title="Clear the library and start fresh"
        >
          New
        </button>
        <div style={{ flex: 1 }} />
        {projectFolder && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-dim)',
              fontFamily: 'monospace',
              maxWidth: 360,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={projectFolder}
          >
            {projectFolder}
          </div>
        )}
      </div>

      {recentFolders.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Recent ({recentFolders.length}):
          </span>
          {recentFolders.map((r) => (
            <span
              key={r.path}
              style={{ display: 'flex', gap: 2, alignItems: 'center' }}
            >
              <button
                onClick={() => onLoadRecent(r.path)}
                title={r.path}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  fontWeight: r.path === projectFolder ? 600 : 400,
                }}
              >
                {r.path === projectFolder ? '● ' : '○ '}
                {r.name}
              </button>
              <button
                onClick={() => onRecentRemove(r.path)}
                title="Forget this path"
                style={{ fontSize: 11, padding: '2px 4px' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

