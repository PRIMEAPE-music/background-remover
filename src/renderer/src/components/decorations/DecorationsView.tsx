import { useMemo, useState } from 'react';
import {
  DECORATION_BEHAVIORS,
  DECORATION_CATEGORIES,
  DECORATION_SIZE_CLASSES,
  type Decoration,
  type DecorationBehaviorKind,
  type DecorationBehaviorWeight,
  type DecorationCategory,
  type DecorationProject,
  type DecorationSizeClass,
} from '../../lib/decorations';

export interface DecorationsViewProps {
  project: DecorationProject | null;
  /** Absolute path of the folder containing the loaded decorations.json.
   *  Decoration sprites are resolved relative to this folder. Independent
   *  from the Platforms project folder so decorations can live wherever
   *  the user keeps them (commonly inside a Builder project). */
  projectFolder: string | null;
  thumbnails: Map<string, string>;
  onUpdate: (id: string, patch: Partial<Decoration>) => void;
  /** Permanently remove a decoration from the manifest. The PNG on
   *  disk is left alone — only the manifest entry goes away. The
   *  caller is expected to confirm with the user before calling. */
  onRemove: (id: string) => void;
  onSave: () => void;
  onReload: () => void;
  /** Pick a folder; auto-find decorations.json inside it. */
  onOpenFolder: () => void;
  /** Pick a decorations.json file directly. Use when the parent folder
   *  has a non-obvious name. */
  onOpenFile: () => void;
  /** Re-scan the current folder for sprite additions/removals and
   *  merge into the manifest, preserving authored fields. Mirrors the
   *  auto-sync that runs after a Builder export. */
  onRescan: () => void;
  /** Scan every sheet's first frame alpha channel for transparent
   *  bottom rows and stamp the count as visibleBottomPadding. Lets
   *  the user batch-fix the "decoration floats above the platform"
   *  problem with one click. */
  onAutoDetectPadding: () => void;
  /** Scan every entry's first frame for top-heavy alpha distribution
   *  and flip those to placement: underside. Catches vines that don't
   *  have "vine" in the filename (e.g. `flora_5_raw_05.png`) so they
   *  hang from platforms instead of standing on top. Only flips
   *  topside → underside; user-authored underside values stay put. */
  onAutoDetectUnderside: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}

/**
 * Top-level Decorations mode. Three-pane layout mirrors PlatformsView:
 *   ┌─ Filters (left) ──┬─ Library list (center) ──┬─ Inspector (right) ─┐
 *   │ category, size,   │ thumbnail grid grouped   │ per-asset metadata  │
 *   │ behavior filters  │ by category              │ + behavior weights  │
 *   └───────────────────┴──────────────────────────┴─────────────────────┘
 *
 * Keeping it lean for v1: no PNG import (the manifest is auto-built by
 * a Python script, then hand-tuned here), no animation preview (just
 * the source sheet thumbnail). Both can be added later.
 */
export function DecorationsView({
  project,
  projectFolder,
  thumbnails,
  onUpdate,
  onRemove,
  onSave,
  onReload,
  onOpenFolder,
  onOpenFile,
  onRescan,
  onAutoDetectPadding,
  onAutoDetectUnderside,
  saveStatus,
}: DecorationsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<DecorationCategory | 'all'>('all');
  const [sizeFilter, setSizeFilter] = useState<DecorationSizeClass | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!project) return [];
    const search = searchText.trim().toLowerCase();
    return project.decorations.filter((d) => {
      if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;
      if (sizeFilter !== 'all' && d.sizeClass !== sizeFilter) return false;
      if (search && !d.id.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [project, categoryFilter, sizeFilter, searchText]);

  const selected = useMemo(() => {
    if (!selectedId || !project) return null;
    return project.decorations.find((d) => d.id === selectedId) ?? null;
  }, [selectedId, project]);

  if (!project || !projectFolder) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          fontSize: 13,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 540, lineHeight: 1.5 }}>
          <strong style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
            No decoration project loaded.
          </strong>
          <div style={{ marginBottom: 16 }}>
            Decorations live independently from Platforms — pick the folder
            containing <code style={{ fontSize: 12 }}>decorations.json</code>{' '}
            (e.g. inside your Builder project, or directly in
            <code style={{ fontSize: 12 }}> assets/platforms/&lt;biome&gt;/</code>).
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={onOpenFolder} className="primary">
              Open folder…
            </button>
            <button onClick={onOpenFile}>Open decorations.json…</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 16 }}>
            Tip: opening a Platforms project that contains a sibling{' '}
            <code style={{ fontSize: 11 }}>decorations.json</code> auto-loads
            it here too.
          </div>
        </div>
      </div>
    );
  }

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
      <Toolbar
        total={project.decorations.length}
        filtered={filtered.length}
        categoryFilter={categoryFilter}
        onCategoryFilter={setCategoryFilter}
        sizeFilter={sizeFilter}
        onSizeFilter={setSizeFilter}
        searchText={searchText}
        onSearchText={setSearchText}
        onSave={onSave}
        onReload={onReload}
        onOpenFolder={onOpenFolder}
        onOpenFile={onOpenFile}
        onRescan={onRescan}
        onAutoDetectPadding={onAutoDetectPadding}
        onAutoDetectUnderside={onAutoDetectUnderside}
        projectFolder={projectFolder}
        saveStatus={saveStatus}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <DecorationList
          decorations={filtered}
          thumbnails={thumbnails}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Inspector
          decoration={selected}
          onUpdate={onUpdate}
          onRemove={(id) => {
            onRemove(id);
            setSelectedId(null);
          }}
        />
      </div>
    </div>
  );
}

// ---- Toolbar -----------------------------------------------------------

function Toolbar({
  total,
  filtered,
  categoryFilter,
  onCategoryFilter,
  sizeFilter,
  onSizeFilter,
  searchText,
  onSearchText,
  onSave,
  onReload,
  onOpenFolder,
  onOpenFile,
  onRescan,
  onAutoDetectPadding,
  onAutoDetectUnderside,
  projectFolder,
  saveStatus,
}: {
  total: number;
  filtered: number;
  categoryFilter: DecorationCategory | 'all';
  onCategoryFilter: (v: DecorationCategory | 'all') => void;
  sizeFilter: DecorationSizeClass | 'all';
  onSizeFilter: (v: DecorationSizeClass | 'all') => void;
  searchText: string;
  onSearchText: (v: string) => void;
  onSave: () => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onRescan: () => void;
  onAutoDetectPadding: () => void;
  onAutoDetectUnderside: () => void;
  projectFolder: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
        Decorations ({filtered === total ? total : `${filtered} / ${total}`})
      </div>

      <select
        value={categoryFilter}
        onChange={(e) => onCategoryFilter(e.target.value as DecorationCategory | 'all')}
        style={{ fontSize: 11 }}
      >
        <option value="all">all categories</option>
        {DECORATION_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={sizeFilter}
        onChange={(e) => onSizeFilter(e.target.value as DecorationSizeClass | 'all')}
        style={{ fontSize: 11 }}
      >
        <option value="all">all sizes</option>
        {DECORATION_SIZE_CLASSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={searchText}
        onChange={(e) => onSearchText(e.target.value)}
        placeholder="filter by id…"
        style={{ fontSize: 11, flex: '0 1 200px' }}
      />
      <div style={{ flex: 1 }} />
      <button onClick={onOpenFolder} style={{ fontSize: 11 }} title="Pick a folder; auto-find decorations.json inside it">
        Open folder…
      </button>
      <button onClick={onOpenFile} style={{ fontSize: 11 }} title="Pick decorations.json directly">
        Open file…
      </button>
      <button onClick={onReload} style={{ fontSize: 11 }} title="Re-read decorations.json from disk (current folder)">
        Reload
      </button>
      <button
        onClick={onRescan}
        style={{ fontSize: 11 }}
        title="Scan the project folder for new/removed sprite files and merge into decorations.json. New entries get auto-classified; existing entries' authored fields are preserved."
      >
        Re-scan
      </button>
      <button
        onClick={onAutoDetectPadding}
        style={{ fontSize: 11 }}
        title="Scan every sheet's first frame for transparent rows at the bottom and stamp the count as visibleBottomPadding. Fixes 'decoration floats above the platform' for assets with bottom-edge transparency. Authored values that are LARGER than the detected one are preserved."
      >
        Detect padding
      </button>
      <button
        onClick={onAutoDetectUnderside}
        style={{ fontSize: 11 }}
        title="Scan every PNG for top-heavy alpha distribution (visible content sits in the upper portion of the frame). Flips matching entries to placement: underside so they hang from platforms instead of standing on top. Catches vines whose filenames don't say 'vine' (e.g. flora_5_raw_05.png). User-authored 'underside' values are left alone."
      >
        Detect underside
      </button>
      <button
        onClick={onSave}
        className="primary"
        style={{ fontSize: 11 }}
        disabled={saveStatus === 'saving'}
        title="Write decorations.json back to the project folder"
      >
        {saveStatus === 'saving'
          ? 'Saving…'
          : saveStatus === 'saved'
            ? 'Saved ✓'
            : saveStatus === 'error'
              ? 'Save (errored)'
              : 'Save'}
      </button>
      {projectFolder && (
        <div
          title={projectFolder}
          style={{
            flexBasis: '100%',
            fontSize: 10,
            color: 'var(--text-dim)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {projectFolder}
        </div>
      )}
    </div>
  );
}

// ---- Library list ------------------------------------------------------

function DecorationList({
  decorations,
  thumbnails,
  selectedId,
  onSelect,
}: {
  decorations: Decoration[];
  thumbnails: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Group by category so the user can scan the library section by section.
  const groups = useMemo(() => {
    const m = new Map<DecorationCategory, Decoration[]>();
    for (const d of decorations) {
      const arr = m.get(d.category) ?? [];
      arr.push(d);
      m.set(d.category, arr);
    }
    return m;
  }, [decorations]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {decorations.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          No decorations match the current filters.
        </div>
      ) : (
        DECORATION_CATEGORIES.filter((c) => groups.has(c)).map((cat) => (
          <section key={cat}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-dim)',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {cat} · {groups.get(cat)!.length}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 6,
              }}
            >
              {groups.get(cat)!.map((d) => (
                <DecorationCard
                  key={d.id}
                  decoration={d}
                  thumbnailUrl={thumbnails.get(d.id) ?? null}
                  selected={d.id === selectedId}
                  onClick={() => onSelect(d.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function DecorationCard({
  decoration,
  thumbnailUrl,
  selected,
  onClick,
}: {
  decoration: Decoration;
  thumbnailUrl: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  // For sheets, we crop the thumbnail to the first frame using
  // background-image with sized-cover background. Singles fit the whole
  // PNG into the thumbnail box.
  const isSheet = decoration.kind === 'sheet';
  const frameW = isSheet ? decoration.frameWidth : 0;
  const frameH = isSheet ? decoration.frameHeight : 0;
  const totalW = isSheet ? frameW * decoration.frameCount : 0;
  // Scale chosen so the first frame fits within an 88px-tall thumbnail.
  const thumbScale = isSheet && frameH > 0 ? 88 / frameH : 1;
  const thumbStyle: React.CSSProperties =
    isSheet && thumbnailUrl
      ? {
          width: frameW * thumbScale,
          height: frameH * thumbScale,
          backgroundImage: `url(${thumbnailUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${totalW * thumbScale}px ${frameH * thumbScale}px`,
          backgroundPosition: '0 0',
          imageRendering: 'pixelated',
          margin: '0 auto',
        }
      : {
          maxWidth: '100%',
          maxHeight: 88,
          display: 'block',
          margin: '0 auto',
        };

  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? 'var(--accent-bg, #2a3a4a)' : '#1e1e22',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 4,
        padding: 6,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        textAlign: 'left',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 92,
          background:
            'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 12px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {thumbnailUrl ? (
          isSheet ? (
            <div style={thumbStyle} />
          ) : (
            <img src={thumbnailUrl} alt="" style={thumbStyle} />
          )
        ) : (
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>missing</span>
        )}
      </div>
      <div
        style={{
          fontSize: 9,
          color: selected ? 'var(--accent)' : 'var(--text)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={decoration.id}
      >
        {decoration.id}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
        {decoration.kind === 'sheet'
          ? `${decoration.frameCount}f @ ${decoration.fps}fps · ${decoration.sizeClass}`
          : `${decoration.width}×${decoration.height} · ${decoration.sizeClass}`}
      </div>
    </button>
  );
}

// ---- Inspector ---------------------------------------------------------

function Inspector({
  decoration,
  onUpdate,
  onRemove,
}: {
  decoration: Decoration | null;
  onUpdate: (id: string, patch: Partial<Decoration>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 12,
        overflowY: 'auto',
        fontSize: 12,
      }}
    >
      {!decoration ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          Select a decoration on the left to edit its tags + behaviors.
        </div>
      ) : (
        <DecorationEditor
          decoration={decoration}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      )}
    </aside>
  );
}

function DecorationEditor({
  decoration,
  onUpdate,
  onRemove,
}: {
  decoration: Decoration;
  onUpdate: (id: string, patch: Partial<Decoration>) => void;
  onRemove: (id: string) => void;
}) {
  const patch = (p: Partial<Decoration>) => onUpdate(decoration.id, p);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
          {decoration.kind === 'sheet' ? 'Sheet' : 'Single'}
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            wordBreak: 'break-all',
            color: 'var(--text)',
            marginBottom: 4,
          }}
        >
          {decoration.id}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {decoration.filename}
        </div>
        {decoration.kind === 'sheet' && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-dim)',
              fontFamily: 'monospace',
              marginTop: 2,
            }}
          >
            {decoration.frameWidth}×{decoration.frameHeight} · {decoration.frameCount} frames @ {decoration.fps}fps
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>Category</label>
        <select
          value={decoration.category}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => patch({ category: e.target.value as DecorationCategory } as any)}
          style={{ fontSize: 11 }}
        >
          {DECORATION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label>Size class</label>
        <select
          value={decoration.sizeClass}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => patch({ sizeClass: e.target.value as DecorationSizeClass } as any)}
          style={{ fontSize: 11 }}
        >
          {DECORATION_SIZE_CLASSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label>Anchor</label>
        <select
          value={decoration.anchor}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => patch({ anchor: e.target.value as 'bottom' | 'center' } as any)}
          style={{ fontSize: 11 }}
        >
          <option value="bottom">bottom</option>
          <option value="center">center</option>
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Bottom = sprite anchored at the walking surface (most flora /
          props). Center = anchored mid-sprite (floating / flying things
          like moths).
        </div>
        <label>Placement</label>
        <select
          value={decoration.placement ?? 'topside'}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => patch({ placement: e.target.value as 'topside' | 'underside' } as any)}
          style={{ fontSize: 11 }}
          disabled={decoration.flatGround === true}
        >
          <option value="topside">topside (sits on top)</option>
          <option value="underside">underside (hangs below)</option>
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Topside = decoration rests on the platform's walking surface.
          Underside = decoration hangs from the platform's bottom edge —
          for vines / hanging moss. The PNG should be authored with its
          attachment point at the TOP of the frame.
          {decoration.flatGround && (
            <>
              {' '}
              <em>(disabled while Flat-on-ground is on.)</em>
            </>
          )}
        </div>
        <FlatGroundEditor
          decoration={decoration}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPatch={(p) => patch(p as any)}
        />
        <label>Visible bottom padding (source px)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={decoration.visibleBottomPadding ?? 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            patch({
              visibleBottomPadding:
                Number.isFinite(n) && n > 0 ? n : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          If the visible content has empty rows below it in the source
          PNG, the runtime sees those rows as the sprite's bottom and
          the visible content floats above the walking surface. Set
          this to the number of transparent source pixels at the
          bottom of the PNG to nudge the sprite down by exactly that
          amount (scaled). 0 = no shift.
        </div>
        <label>Max display height (world px)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={decoration.maxHeight ?? ''}
          placeholder="auto (default cap, 150)"
          onChange={(e) => {
            if (e.target.value === '') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              patch({ maxHeight: undefined } as any);
              return;
            }
            const n = Number(e.target.value);
            patch({
              maxHeight:
                Number.isFinite(n) && n > 0 ? n : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Hard ceiling on this decoration's display height in world
          pixels. The runtime applies a ±15% scale jitter at spawn
          time for visual variety, then clamps the final height to
          this value (preserving aspect ratio). Leave blank to use
          the global default cap. Doesn't apply to flat-on-ground
          sprites — those use their explicit height instead.
        </div>
        <label>Size scale (multiplier)</label>
        <input
          type="number"
          min={0}
          step={0.05}
          value={decoration.sizeScale ?? ''}
          placeholder="1.0 (default)"
          onChange={(e) => {
            if (e.target.value === '') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              patch({ sizeScale: undefined } as any);
              return;
            }
            const n = Number(e.target.value);
            patch({
              sizeScale:
                Number.isFinite(n) && n > 0 ? n : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Per-asset render-scale multiplier applied across every spawn
          path (scatter, authored placement, player-event one-shot).
          1.0 = default. Use 0.2 to shrink to 20% of normal, 2.0 to
          double. Multiplies after the global render scale and before
          jitter / max-height clamping.
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            marginTop: 4,
          }}
        >
          <input
            type="checkbox"
            checked={decoration.overrideSize === true}
            onChange={(e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              patch({ overrideSize: e.target.checked || undefined } as any);
            }}
          />
          Override size (lock to size scale)
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          When ON, every spawn renders at exactly{' '}
          <code style={{ fontSize: 11 }}>renderScale × sizeScale</code>
          {' '}— bypasses the per-spawn tier roll, scale jitter, AND the
          max-height clamp. Use for hand-tuned features that should
          look the same on every platform. Default OFF (varies size
          for visual variety).
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>Allowed behaviors</label>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          The runtime picks one behavior per spawned instance, weighted-random.
          Same sprite gets different behaviors on different platforms = free
          variety. Set weight 0 to exclude a behavior.
        </div>
        <BehaviorWeightsEditor
          behaviors={decoration.allowedBehaviors}
          onChange={(b) => patch({ allowedBehaviors: b })}
        />
      </section>

      {decoration.kind === 'sheet' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label>Pause frame (for stuckMidFrame)</label>
          <input
            type="number"
            min={0}
            max={decoration.frameCount - 1}
            value={decoration.pauseFrame ?? Math.floor(decoration.frameCount / 2)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const clamped = Math.max(0, Math.min(decoration.frameCount - 1, Math.round(n)));
              patch({ pauseFrame: clamped });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Frame index where the animation holds while the player is in
            range. Defaults to the middle of the sheet. Only matters when
            stuckMidFrame is in this asset's allowed behaviors.
          </div>
          <label>Fly-away tail-loop start frame</label>
          <input
            type="number"
            min={1}
            max={decoration.frameCount - 1}
            value={decoration.flyAwayLoopStartFrame ?? ''}
            placeholder="(disabled)"
            onChange={(e) => {
              if (e.target.value === '') {
                patch({ flyAwayLoopStartFrame: undefined });
                return;
              }
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const clamped = Math.max(1, Math.min(decoration.frameCount - 1, Math.round(n)));
              patch({ flyAwayLoopStartFrame: clamped });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Only used when "flyAway" is in the allowed behaviors list.
            Frames [0, this) play once as an intro; frames
            [this, frameCount) loop forever while the sprite drifts
            away from its parent platform until off-screen, then it
            despawns. e.g. set to 8 on a 16-frame moth so frames 0-7
            are the wake-up sequence and 8-15 are the looping wing
            flap during flight.
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              marginTop: 4,
            }}
          >
            <input
              type="checkbox"
              checked={decoration.vanishAfterAnim === true}
              onChange={(e) => {
                patch({ vanishAfterAnim: e.target.checked || undefined });
              }}
            />
            Vanish after animation completes
          </label>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            One-shot effects: rock breaking, bones crumbling, spores
            dispersing. The runtime destroys the sprite the first
            time its triggered animation finishes — for proximity /
            onPlatformOccupied behaviors it ALSO switches to a
            one-shot play (instead of looping) so the completion
            event actually fires. Ignored for `loop`, `static`, and
            `flyAway`.
          </div>
        </section>
      )}

      {decoration.kind === 'sheet' && decoration.category === 'hazard_visual' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label>Spawn-hazard chain</label>
          <SpawnHazardEditor
            spawn={decoration.spawnHazardOnFrame}
            frameCount={decoration.frameCount}
            onChange={(s) => patch({ spawnHazardOnFrame: s })}
          />
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>Notes</label>
        <textarea
          value={decoration.notes ?? ''}
          onChange={(e) => patch({ notes: e.target.value || undefined })}
          rows={3}
          placeholder="Author-time notes — not used by the runtime."
          style={{ fontSize: 11, fontFamily: 'monospace' }}
        />
      </section>

      <section
        style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <button
          onClick={() => {
            const ok = window.confirm(
              `Remove "${decoration.id}" from the manifest?\n\nThis only removes the entry from decorations.json — the PNG file on disk is left alone. You'll need to click Save afterwards to persist.`,
            );
            if (ok) onRemove(decoration.id);
          }}
          style={{
            fontSize: 11,
            background: '#3a1f1f',
            color: '#ffb0b0',
            border: '1px solid #5a2a2a',
          }}
          title="Remove this decoration from the manifest. PNG on disk is preserved; click Save to persist the removal."
        >
          Remove from manifest
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Drops this entry from decorations.json. The PNG on disk is
          left alone — re-running Re-scan will re-add it (auto-classified)
          unless you delete the file. Save to persist.
        </div>
      </section>
    </div>
  );
}

function FlatGroundEditor({
  decoration,
  onPatch,
}: {
  decoration: Decoration;
  onPatch: (p: Partial<Decoration>) => void;
}) {
  const enabled = decoration.flatGround === true;
  return (
    <div
      style={{
        marginTop: 4,
        padding: 8,
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: '#181820',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 0,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              onPatch({ flatGround: true });
            } else {
              // Clear the flag and any sizes so re-disable is a clean
              // revert to whatever Placement says.
              onPatch({
                flatGround: undefined,
                flatWidth: undefined,
                flatHeight: undefined,
              });
            }
          }}
        />
        Flat on ground (puddle / mat / rune)
      </label>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Renders the sprite lying flat on the walking surface — anchored
        bottom-center, depth lowered so it sits beneath standing
        decorations. Use for poison pools, magic circles, blood smears,
        floor mats, etc. Sizes don't have to be circular — set width and
        height independently for any aspect (wide puddle, narrow streak).
      </div>
      {enabled && (
        <>
          <label style={{ fontSize: 11 }}>Display width (world px)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={decoration.flatWidth ?? ''}
            placeholder="auto (natural × render scale)"
            onChange={(e) => {
              if (e.target.value === '') {
                onPatch({ flatWidth: undefined });
                return;
              }
              const n = Number(e.target.value);
              onPatch({
                flatWidth: Number.isFinite(n) && n > 0 ? n : undefined,
              });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <label style={{ fontSize: 11 }}>Display height (world px)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={decoration.flatHeight ?? ''}
            placeholder="auto (natural × render scale)"
            onChange={(e) => {
              if (e.target.value === '') {
                onPatch({ flatHeight: undefined });
                return;
              }
              const n = Number(e.target.value);
              onPatch({
                flatHeight: Number.isFinite(n) && n > 0 ? n : undefined,
              });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Leave blank to use the natural sprite size. The poison-pool
            look is roughly width 384, height 192 — but you can author
            any aspect.
          </div>
        </>
      )}
    </div>
  );
}

function BehaviorWeightsEditor({
  behaviors,
  onChange,
}: {
  behaviors: DecorationBehaviorWeight[];
  onChange: (b: DecorationBehaviorWeight[]) => void;
}) {
  const map = new Map(behaviors.map((b) => [b.kind, b.weight]));
  const update = (kind: DecorationBehaviorKind, weight: number) => {
    const next = DECORATION_BEHAVIORS.flatMap((k) => {
      const w = k === kind ? weight : (map.get(k) ?? 0);
      return w > 0 ? [{ kind: k, weight: w }] : [];
    });
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {DECORATION_BEHAVIORS.map((kind) => {
        const weight = map.get(kind) ?? 0;
        return (
          <div
            key={kind}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              opacity: weight > 0 ? 1 : 0.55,
            }}
          >
            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}>
              {kind}
            </span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={weight}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                update(kind, Math.max(0, n));
              }}
              style={{
                width: 56,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function SpawnHazardEditor({
  spawn,
  frameCount,
  onChange,
}: {
  spawn: { hazardKind: string; frame: number; offsetY?: number } | undefined;
  frameCount: number;
  onChange: (s: { hazardKind: string; frame: number; offsetY?: number } | undefined) => void;
}) {
  const enabled = !!spawn;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({
                hazardKind: spawn?.hazardKind ?? 'poison_pool',
                frame: spawn?.frame ?? Math.floor(frameCount / 2),
                offsetY: spawn?.offsetY,
              });
            } else {
              onChange(undefined);
            }
          }}
        />
        Spawn a hazard on a specific animation frame
      </label>
      {enabled && spawn && (
        <>
          <input
            type="text"
            value={spawn.hazardKind}
            onChange={(e) => onChange({ ...spawn, hazardKind: e.target.value })}
            placeholder="hazard kind (e.g. poison_pool)"
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <label style={{ fontSize: 11 }}>Frame</label>
          <input
            type="number"
            min={0}
            max={frameCount - 1}
            value={spawn.frame}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              onChange({
                ...spawn,
                frame: Math.max(0, Math.min(frameCount - 1, Math.round(n))),
              });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <label style={{ fontSize: 11 }}>Offset Y (optional)</label>
          <input
            type="number"
            value={spawn.offsetY ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({
                ...spawn,
                offsetY: e.target.value === '' || !Number.isFinite(n) ? undefined : n,
              });
            }}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            When the animation reaches this frame, the runtime spawns a
            hazard at the decoration's base. e.g. poison flower → poison_pool.
          </div>
        </>
      )}
    </div>
  );
}
