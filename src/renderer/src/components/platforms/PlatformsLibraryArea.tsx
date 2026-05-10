import React, { useCallback, useMemo, useState } from 'react';
import {
  extractRect,
  flipImageDataHorizontal,
  flipImageDataVertical,
  loadImageFromBytes,
} from '../../lib/image-utils';
import {
  BIOMES,
  categorizeWidth,
  derivePlatformFilename,
  isRecentlyModified,
  platformAssetEffectiveWidth,
  PLATFORM_TYPES,
  SIZE_CATEGORIES,
  type PlatformAsset,
  type PlatformProject,
  type SizeCategory,
  type SliceBorders,
} from '../../lib/platforms';
import { computeCells } from '../../lib/slicing';
import type { SourceMeta } from '../../lib/sources';
import { detectWalkableRegions } from '../../lib/walkableDetect';
import type { DecorationProject } from '../../lib/decorations';
import { GalleryThumb } from '../GalleryThumb';
import { NineSliceEditor } from './NineSliceEditor';
import { PlatformThumbnail } from './PlatformThumbnail';
import { WalkableEditor } from './WalkableEditor';

export interface PlatformsLibraryAreaProps {
  project: PlatformProject;
  assetImages: Map<string, ImageData>;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onAddAsset: (image: ImageData) => void;
  onUpdateAsset: (id: string, patch: Partial<PlatformAsset>) => void;
  onRemoveAsset: (id: string) => void;
  /** Decoration project (loaded in Decorations mode). The Walkable
   *  editor's "Decorations" tab uses these entries to populate its
   *  picker so the user can drop specific decorations onto specific
   *  platforms. Null = no decoration project loaded; the tab still
   *  renders but with an empty picker. */
  decorationProject: DecorationProject | null;
  /** Source PNG blob URLs for decoration thumbnails, keyed by id —
   *  same map produced by `loadDecorationProject`. Used for the picker
   *  thumbnails AND for rendering the placed decoration sprites on
   *  the platform canvas. */
  decorationThumbnails: Map<string, string>;
  onUpscaleAll: (
    onProgress: (current: number, total: number, filename: string) => void,
    shouldCancel: () => boolean,
    assetIds?: ReadonlySet<string>,
  ) => Promise<void>;
}

/**
 * Three-pane work area for tagging platforms.
 *
 *   ┌─ Sources (340) ──┬─ Library (flex) ─┬─ Metadata (320) ─┐
 *   │ cells from any   │ tagged assets    │ form for the     │
 *   │ loaded source    │ in the project   │ selected asset   │
 *   │ sheet            │                  │                  │
 *   │ click to add     │ click to select  │                  │
 *   └──────────────────┴──────────────────┴──────────────────┘
 *
 * Cell extraction applies any per-cell flip overrides so the asset matches
 * what the user sees in Slice mode's overlay.
 */
export function PlatformsLibraryArea({
  project,
  assetImages,
  sources,
  getSource,
  onAddAsset,
  onUpdateAsset,
  onRemoveAsset,
  decorationProject,
  decorationThumbnails,
  onUpscaleAll,
}: PlatformsLibraryAreaProps) {
  // Multi-select: shift-click extends a range from the last clicked card,
  // ctrl/cmd-click toggles individual cards, plain click selects only that
  // card (or deselects when it was the sole selection).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  // Upscaler progress; null when idle. The cancel ref is read by the
  // App-side handler between assets so we can abort cleanly mid-batch.
  const [upscaleProgress, setUpscaleProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  } | null>(null);
  const upscaleCancelRef = React.useRef(false);
  // When set, the library middle-pane swaps from grid to the 9-slice editor
  // for that asset. Sources + Metadata panes stay visible alongside.
  const [editingSliceForId, setEditingSliceForId] = useState<string | null>(null);
  // Same idea, separate state — the walkable editor swaps the middle pane
  // for the rectangle-drawing UI. Mutually exclusive with the slice editor;
  // opening one closes the other.
  const [editingWalkableForId, setEditingWalkableForId] = useState<string | null>(null);
  const selectedAssets = useMemo(
    () => project.assets.filter((a) => selectedIds.has(a.id)),
    [project.assets, selectedIds],
  );
  const singleSelected = selectedAssets.length === 1 ? selectedAssets[0] : null;
  const editingAsset =
    editingSliceForId !== null
      ? project.assets.find((a) => a.id === editingSliceForId) ?? null
      : null;
  const editingImage =
    editingAsset !== null ? assetImages.get(editingAsset.id) ?? null : null;
  // If the asset being edited got deleted, drop the editor.
  if (editingSliceForId !== null && (!editingAsset || !editingImage)) {
    setEditingSliceForId(null);
  }
  const editingWalkableAsset =
    editingWalkableForId !== null
      ? project.assets.find((a) => a.id === editingWalkableForId) ?? null
      : null;
  const editingWalkableImage =
    editingWalkableAsset !== null ? assetImages.get(editingWalkableAsset.id) ?? null : null;
  if (editingWalkableForId !== null && (!editingWalkableAsset || !editingWalkableImage)) {
    setEditingWalkableForId(null);
  }

  const handleAddCell = useCallback(
    (sourceId: string, cellIndex: number) => {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;
      const img = getSource(source.id);
      if (!img) return;
      const cells = computeCells(source.slice, source.width, source.height);
      const rect = cells[cellIndex];
      if (!rect) return;
      // Extract just the cell's pixels at native size, applying flip overrides
      // so the library asset matches Slice mode's overlay rendering.
      let extracted = extractRect(img, rect.x, rect.y, rect.width, rect.height);
      const override = source.slice.overrides[cellIndex] ?? {};
      if (override.flipH) extracted = flipImageDataHorizontal(extracted);
      if (override.flipV) extracted = flipImageDataVertical(extracted);
      onAddAsset(extracted);
    },
    [sources, getSource, onAddAsset],
  );

  const handleAssetClick = useCallback(
    (id: string, mods: { shift: boolean; toggle: boolean }) => {
      if (mods.shift && lastClickedId) {
        // Extend selection from `lastClickedId` to `id` along the asset
        // order. Adds the range on top of the existing selection so users
        // can build composite multi-selects.
        const ids = project.assets.map((a) => a.id);
        const startIdx = ids.indexOf(lastClickedId);
        const endIdx = ids.indexOf(id);
        if (startIdx >= 0 && endIdx >= 0) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const range = ids.slice(lo, hi + 1);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const r of range) next.add(r);
            return next;
          });
        }
        setLastClickedId(id);
        return;
      }
      if (mods.toggle) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLastClickedId(id);
        return;
      }
      // Plain click: select only this one, OR clear if it was already the sole pick.
      setSelectedIds((prev) =>
        prev.size === 1 && prev.has(id) ? new Set() : new Set([id]),
      );
      setLastClickedId(id);
    },
    [lastClickedId, project.assets],
  );

  const handleUpscaleAll = useCallback(async () => {
    if (project.assets.length === 0) return;
    // If anything is selected, treat that as the user's intent — they're
    // either testing one asset before running the whole library, or
    // upscaling a specific subset.
    const targetIds = selectedIds.size > 0 ? selectedIds : null;
    const targetCount = targetIds ? targetIds.size : project.assets.length;
    const scopeLabel = targetIds ? `${targetCount} selected asset${targetCount > 1 ? 's' : ''}` : `all ${targetCount} assets`;
    if (
      !confirm(
        `Upscale ${scopeLabel} with the AI model?\n\n` +
          `Replaces the originals on disk with 4× higher-resolution PNGs.\n` +
          `First call loads the model (~80MB, slow); subsequent calls are\n` +
          `faster. You can cancel mid-batch — partial progress is preserved.`,
      )
    ) {
      return;
    }
    upscaleCancelRef.current = false;
    setUpscaleProgress({ current: 0, total: targetCount, filename: '' });
    try {
      await onUpscaleAll(
        (current, total, filename) => {
          setUpscaleProgress({ current, total, filename });
        },
        () => upscaleCancelRef.current,
        targetIds ?? undefined,
      );
    } finally {
      setUpscaleProgress(null);
    }
  }, [onUpscaleAll, project.assets.length, selectedIds]);

  const handleOpenPngs = useCallback(async () => {
    const paths = await window.api.openImagePaths();
    for (const p of paths) {
      try {
        const bytes = await window.api.readFile(p);
        const ext = p.split('.').pop()?.toLowerCase();
        const mime =
          ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'bmp'
                ? 'image/bmp'
                : ext === 'gif'
                  ? 'image/gif'
                  : 'image/png';
        const img = await loadImageFromBytes(bytes, mime);
        onAddAsset(img);
      } catch (err) {
        console.warn('[platforms] failed to import PNG:', p, err);
      }
    }
  }, [onAddAsset]);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      <SourcesPane
        sources={sources}
        getSource={getSource}
        onAddCell={handleAddCell}
      />
      {/* LibraryPane stays MOUNTED behind any open editor so its scroll
          position is preserved when the editor closes. CSS display:none
          collapses it to zero size while keeping the scroll state in
          the DOM, so re-opening lands you exactly where you were. */}
      <LibraryPane
        hidden={!!editingAsset || !!editingWalkableAsset}
        assets={project.assets}
        assetImages={assetImages}
        selectedIds={selectedIds}
        onAssetClick={handleAssetClick}
        onOpenPngs={handleOpenPngs}
        onUpscaleAll={handleUpscaleAll}
        upscaleScopeLabel={
          selectedIds.size > 0 ? `Upscale ${selectedIds.size} selected…` : 'Upscale all…'
        }
        upscaleProgress={upscaleProgress}
        onUpscaleCancel={() => {
          upscaleCancelRef.current = true;
        }}
        onAutoDetectSizes={() => {
          for (const a of project.assets) {
            // FLOOR is a manual role tag, not a width bucket — never
            // overwrite it with the auto-detected width category.
            if (a.sizeCategory === 'FLOOR') continue;
            const next = categorizeWidth(platformAssetEffectiveWidth(a));
            if (a.sizeCategory !== next) {
              onUpdateAsset(a.id, { sizeCategory: next });
            }
          }
        }}
        onAutoDetectWalkable={() => {
          // Mass auto-detect — only stamp STANDARD platforms and the
          // FLOOR role. Walls / slopes / shop / portal / gambling / npc
          // either don't have a "walkable surface" the player traverses
          // (walls), have geometry the runtime handles separately
          // (slopes via slopeManager), or are typically authored
          // one-off enough that batch detection isn't worth running on
          // them. The user can still hit "Edit walkable…" on any single
          // asset to author by hand.
          for (const a of project.assets) {
            const eligible = a.type === 'STANDARD' || a.sizeCategory === 'FLOOR';
            if (!eligible) continue;
            // Skip assets that already have user-authored regions so a
            // batch detect doesn't blow away hand-tuned work.
            if (a.walkableRegions && a.walkableRegions.length > 0) continue;
            const img = assetImages.get(a.id);
            if (!img) continue;
            const detected = detectWalkableRegions(img);
            if (detected.length > 0) {
              onUpdateAsset(a.id, { walkableRegions: detected });
            }
          }
        }}
      />
      {editingAsset && editingImage && (
        <NineSliceEditor
          asset={editingAsset}
          image={editingImage}
          onChange={(slice: SliceBorders) =>
            onUpdateAsset(editingAsset.id, { slice })
          }
          onClose={() => setEditingSliceForId(null)}
        />
      )}
      {editingWalkableAsset && editingWalkableImage && (
        <WalkableEditor
          asset={editingWalkableAsset}
          image={editingWalkableImage}
          decorationProject={decorationProject}
          decorationThumbnails={decorationThumbnails}
          onChange={(patch) => onUpdateAsset(editingWalkableAsset.id, patch)}
          onClose={() => setEditingWalkableForId(null)}
        />
      )}
      <MetadataPane
        asset={singleSelected}
        selectedAssets={selectedAssets}
        existing={project.assets}
        onUpdate={onUpdateAsset}
        onEditSlice={(id) => {
          setEditingWalkableForId(null);
          setEditingSliceForId(id);
        }}
        onEditWalkable={(id) => {
          setEditingSliceForId(null);
          setEditingWalkableForId(id);
        }}
        onRemove={(id) => {
          setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          if (editingSliceForId === id) setEditingSliceForId(null);
          if (editingWalkableForId === id) setEditingWalkableForId(null);
          onRemoveAsset(id);
        }}
        onRemoveMany={(ids) => {
          setSelectedIds(new Set());
          if (editingSliceForId !== null && ids.includes(editingSliceForId)) {
            setEditingSliceForId(null);
          }
          if (editingWalkableForId !== null && ids.includes(editingWalkableForId)) {
            setEditingWalkableForId(null);
          }
          for (const id of ids) onRemoveAsset(id);
        }}
      />
    </div>
  );
}

// ---- Sources pane -------------------------------------------------------

function SourcesPane({
  sources,
  getSource,
  onAddCell,
}: {
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onAddCell: (sourceId: string, cellIndex: number) => void;
}) {
  return (
    <aside
      style={{
        width: 340,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 12,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
        Source cells {sources.length > 0 ? `(${sources.length})` : ''}
      </div>
      {sources.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          No source sheets loaded. Use the left-edge sources column to load
          images, then Slice mode to define cells (auto-detect blobs works
          well for irregular platform sheets). Cells appear here once defined.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Click a cell to add it to the library as a fresh asset. Per-cell
            flip overrides are applied at extract time.
          </div>
          {sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              getSource={getSource}
              onAddCell={onAddCell}
            />
          ))}
        </>
      )}
    </aside>
  );
}

function SourceRow({
  source,
  getSource,
  onAddCell,
}: {
  source: SourceMeta;
  getSource: (id: string | null) => ImageData | null;
  onAddCell: (sourceId: string, cellIndex: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const cells = useMemo(
    () => computeCells(source.slice, source.width, source.height),
    [source.slice, source.width, source.height],
  );
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
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
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 10 }}>
          {collapsed ? '▸' : '▾'}
        </span>
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
      {!collapsed && cells.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 4,
          }}
        >
          {cells.map((rect, i) => (
            <GalleryThumb
              key={i}
              sourceId={source.id}
              sourceVersion={source.version}
              rect={rect}
              getSource={getSource}
              onClick={() => onAddCell(source.id, i)}
            />
          ))}
        </div>
      )}
      {!collapsed && cells.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingLeft: 18 }}>
          No cells — slice this source first in Slice mode.
        </div>
      )}
    </section>
  );
}

// ---- Library pane -------------------------------------------------------

function LibraryPane({
  hidden,
  assets,
  assetImages,
  selectedIds,
  onAssetClick,
  onOpenPngs,
  onAutoDetectSizes,
  onAutoDetectWalkable,
  onUpscaleAll,
  upscaleScopeLabel,
  upscaleProgress,
  onUpscaleCancel,
}: {
  /** When true, the pane keeps its scroll state in the DOM but doesn't
   *  display — used to hide it behind the 9-slice / walkable editors
   *  without remounting (which would lose scroll position). */
  hidden: boolean;
  assets: PlatformAsset[];
  assetImages: Map<string, ImageData>;
  selectedIds: ReadonlySet<string>;
  onAssetClick: (id: string, mods: { shift: boolean; toggle: boolean }) => void;
  onOpenPngs: () => void;
  onAutoDetectSizes: () => void;
  onAutoDetectWalkable: () => void;
  onUpscaleAll: () => void;
  upscaleScopeLabel: string;
  upscaleProgress: { current: number; total: number; filename: string } | null;
  onUpscaleCancel: () => void;
}) {
  const upscaling = upscaleProgress !== null;
  // Count how many assets the mass walkable-detect would actually touch
  // — STANDARD type or FLOOR role, and not already authored. Surface
  // the number on the button so it's clear what'll happen.
  const walkableEligibleCount = assets.filter((a) => {
    const eligible = a.type === 'STANDARD' || a.sizeCategory === 'FLOOR';
    if (!eligible) return false;
    return !a.walkableRegions || a.walkableRegions.length === 0;
  }).length;
  return (
    <div
      style={{
        flex: hidden ? '0 0 0' : 1,
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        background: '#1e1e22',
        position: 'relative',
      }}
    >
      {upscaleProgress && (
        <UpscaleOverlay
          progress={upscaleProgress}
          onCancel={onUpscaleCancel}
        />
      )}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flex: 1 }}>
          Library ({assets.length}
          {selectedIds.size > 0 ? `, ${selectedIds.size} selected` : ''})
        </div>
        <button
          onClick={onAutoDetectSizes}
          style={{ fontSize: 11 }}
          title="Stamp every asset's size category (XS/S/M/L/XL) from its effective width. Authoring label only — runtime picks by closest width."
          disabled={assets.length === 0 || upscaling}
        >
          Auto-detect sizes
        </button>
        <button
          onClick={onAutoDetectWalkable}
          style={{ fontSize: 11 }}
          title="Propose a default walkable region for every STANDARD platform and every FLOOR-tagged asset that doesn't already have walkable regions. Skips walls, slopes, shop/portal/gambling/npc, and assets you've already hand-authored."
          disabled={walkableEligibleCount === 0 || upscaling}
        >
          Auto-detect walkable{walkableEligibleCount > 0 ? ` (${walkableEligibleCount})` : ''}
        </button>
        <button
          onClick={onUpscaleAll}
          style={{ fontSize: 11 }}
          title="AI 4× upscale. With assets selected, only those run; otherwise the whole library. Use a small selection first to spot-check quality before committing the batch."
          disabled={assets.length === 0 || upscaling}
        >
          {upscaleScopeLabel}
        </button>
        <button
          onClick={onOpenPngs}
          style={{ fontSize: 11 }}
          title="Import individual PNG files"
          disabled={upscaling}
        >
          Open PNGs…
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {assets.length === 0 ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
              maxWidth: 480,
              margin: '0 auto',
              textAlign: 'center',
              padding: '32px 0',
            }}
          >
            Library is empty. Click a cell on the left to add it, or use{' '}
            <b>Open PNGs…</b> above to import standalone PNG files. Each library
            asset is a fresh snapshot — independent of the source sheet from
            then on.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 8,
            }}
          >
            {assets.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                image={assetImages.get(a.id) ?? null}
                selected={selectedIds.has(a.id)}
                onClick={(e) =>
                  onAssetClick(a.id, {
                    shift: e.shiftKey,
                    toggle: e.ctrlKey || e.metaKey,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  image,
  selected,
  onClick,
}: {
  asset: PlatformAsset;
  image: ImageData | null;
  selected: boolean;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const recent = isRecentlyModified(asset);
  // Selection wins visually; recency adds a thin ring on top so the user
  // still sees what they just edited inside a multi-select.
  const borderColor = selected
    ? '#6aa9ff'
    : recent
      ? '#f0c060'
      : 'var(--border)';
  const background = selected
    ? 'rgba(106,169,255,0.15)'
    : recent
      ? 'rgba(240,192,96,0.08)'
      : 'rgba(255,255,255,0.03)';
  return (
    <div
      onClick={onClick}
      style={{
        padding: 6,
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        boxShadow: recent && !selected ? '0 0 0 1px rgba(240,192,96,0.35)' : 'none',
      }}
      title={
        recent
          ? `${asset.filename} · recently edited`
          : asset.filename
      }
    >
      <div style={{ position: 'relative', width: 96, height: 96 }}>
        <PlatformThumbnail image={image} size={96} />
        {asset.sizeCategory && (
          <div
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'monospace',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.6)',
              color: '#dcd0a0',
              border: '1px solid rgba(255,255,255,0.15)',
              pointerEvents: 'none',
            }}
            title={`Size category: ${asset.sizeCategory}`}
          >
            {asset.sizeCategory}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          color: 'var(--text-dim)',
          width: '100%',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {asset.filename}
      </div>
      <div
        style={{
          fontSize: 9,
          color: selected ? 'var(--accent)' : 'var(--text-dim)',
          fontFamily: 'monospace',
        }}
      >
        {asset.biome.toLowerCase()} · {asset.type.toLowerCase()}
      </div>
    </div>
  );
}

// ---- Metadata pane ------------------------------------------------------

function MetadataPane({
  asset,
  selectedAssets,
  existing,
  onUpdate,
  onEditSlice,
  onEditWalkable,
  onRemove,
  onRemoveMany,
}: {
  asset: PlatformAsset | null;
  /** All currently-selected assets. Drives the batch-edit pane when >1. */
  selectedAssets: PlatformAsset[];
  existing: PlatformAsset[];
  onUpdate: (id: string, patch: Partial<PlatformAsset>) => void;
  onEditSlice: (id: string) => void;
  onEditWalkable: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveMany: (ids: string[]) => void;
}) {
  // Multi-select branch — show batch editor instead of the single-asset form.
  if (selectedAssets.length > 1) {
    return (
      <BatchEditPane
        assets={selectedAssets}
        onUpdate={onUpdate}
        onRemoveMany={onRemoveMany}
      />
    );
  }
  if (!asset) {
    return (
      <aside
        style={{
          width: 320,
          flexShrink: 0,
          borderLeft: '1px solid var(--border)',
          background: 'var(--panel)',
          padding: 16,
          color: 'var(--text-dim)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Metadata</div>
        Select a library asset to edit its biome, type, and other tags. Hold
        Shift to extend a range, Ctrl/Cmd to toggle individual cards for
        batch edits.
      </aside>
    );
  }
  // The "existing" list excludes the current asset so the filename doesn't
  // collide with itself when biome/type changes.
  const others = existing.filter((a) => a.id !== asset.id);
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
        Edit asset
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Biome</label>
        <select
          value={asset.biome}
          onChange={(e) => {
            const biome = e.target.value as PlatformAsset['biome'];
            onUpdate(asset.id, {
              biome,
              filename: derivePlatformFilename({ ...asset, biome }, others),
            });
          }}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          {BIOMES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Type</label>
        <select
          value={asset.type}
          onChange={(e) => {
            const type = e.target.value as PlatformAsset['type'];
            onUpdate(asset.id, {
              type,
              filename: derivePlatformFilename({ ...asset, type }, others),
            });
          }}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          {PLATFORM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Filename (auto)</label>
        <code
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            background: 'var(--bg)',
            padding: '4px 6px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            wordBreak: 'break-all',
          }}
        >
          {asset.filename}
        </code>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          Generated from biome + type. Re-derives when those change.
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Source dimensions</label>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-dim)' }}>
          {asset.width} × {asset.height} px
        </div>
      </section>

      <DisplaySizeOverride asset={asset} onUpdate={onUpdate} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Size category</label>
        <select
          value={asset.sizeCategory ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate(asset.id, {
              sizeCategory: v === '' ? undefined : (v as SizeCategory),
            });
          }}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          <option value="">— (unset)</option>
          {SIZE_CATEGORIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Authoring label only — the runtime picks assets by closest effective
          width. Use "Auto-detect sizes" in the toolbar to bucket the whole
          library at once.
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>9-slice borders</label>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          left {asset.slice.left} · right {asset.slice.right} · top {asset.slice.top} ·
          bottom {asset.slice.bottom}
        </div>
        <button
          onClick={() => onEditSlice(asset.id)}
          className="primary"
          style={{ fontSize: 11 }}
          title="Open the visual 9-slice editor with live stretch preview"
        >
          Edit 9-slice…
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Drag border lines on the source preview, or use the numeric inputs.
          Stretch previews show how the platform reads at common runtime widths.
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Walkable surface</label>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {asset.walkableRegions && asset.walkableRegions.length > 0
            ? `${asset.walkableRegions.length} region${asset.walkableRegions.length === 1 ? '' : 's'}${asset.walkableHull ? ' · custom hull' : ''}${asset.surfaceCenter ? ' · custom center' : ''}`
            : 'none — using runtime fallback'}
        </div>
        <button
          onClick={() => onEditWalkable(asset.id)}
          className="primary"
          style={{ fontSize: 11 }}
          title="Open the walkable-surface editor (drag rectangles, auto-detect, set hull / icon anchor)"
        >
          Edit walkable…
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Define the surface(s) the player can stand on. Multiple regions
          support uneven ground / bridges. Optional silhouette hull
          controls shadow width; optional surface center anchors shrine /
          shop icons.
        </div>
      </section>

      <button
        onClick={() => onRemove(asset.id)}
        style={{ marginTop: 8, fontSize: 11 }}
        title="Delete the asset (file is removed on next save)"
      >
        Remove from library
      </button>
    </aside>
  );
}

/**
 * Per-asset width/height override consumed by AscensionGame's
 * `PlatformTextureManager`. Empty input = "auto" (procgen width / source
 * height). Any positive value pins the runtime to render at exactly that
 * size regardless of what the level generator requests.
 *
 * Edits flow through local string state so the user can type freely (e.g.
 * partially typing "12" before "120") without React re-flushing the value
 * mid-keystroke. The asset is patched on blur or Enter.
 */
function DisplaySizeOverride({
  asset,
  onUpdate,
}: {
  asset: PlatformAsset;
  onUpdate: (id: string, patch: Partial<PlatformAsset>) => void;
}) {
  const [w, setW] = useState<string>(
    asset.targetWidth !== undefined ? String(asset.targetWidth) : '',
  );
  const [h, setH] = useState<string>(
    asset.targetHeight !== undefined ? String(asset.targetHeight) : '',
  );
  // Resync when the user selects a different asset. React-supported pattern:
  // setState during render is fine as long as it's gated on a prop diff.
  const [trackedId, setTrackedId] = useState(asset.id);
  if (trackedId !== asset.id) {
    setTrackedId(asset.id);
    setW(asset.targetWidth !== undefined ? String(asset.targetWidth) : '');
    setH(asset.targetHeight !== undefined ? String(asset.targetHeight) : '');
  }

  const commit = (which: 'w' | 'h', raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onUpdate(asset.id, which === 'w' ? { targetWidth: undefined } : { targetHeight: undefined });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      // Snap input back to the persisted value on invalid entry.
      if (which === 'w') {
        setW(asset.targetWidth !== undefined ? String(asset.targetWidth) : '');
      } else {
        setH(asset.targetHeight !== undefined ? String(asset.targetHeight) : '');
      }
      return;
    }
    onUpdate(asset.id, which === 'w' ? { targetWidth: n } : { targetHeight: n });
  };

  const inputStyle = {
    width: '100%',
    padding: '4px 6px',
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'monospace',
  } as const;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label>Display size override</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>width (px)</span>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="auto"
            value={w}
            onChange={(e) => setW(e.target.value)}
            onBlur={(e) => commit('w', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>height (px)</span>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="auto"
            value={h}
            onChange={(e) => setH(e.target.value)}
            onBlur={(e) => commit('h', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Pins the in-game render size. Empty = auto (procgen width, source
        height). Useful when one PNG should always render at a fixed size
        regardless of the level generator's request.
      </div>
    </section>
  );
}

// ---- Batch edit pane (multi-select) -------------------------------------

/**
 * Replaces the single-asset metadata form when more than one asset is
 * selected. Each control writes the chosen value to ALL selected assets in
 * one click — biome, type, and size category. Filename is auto-derived
 * from biome+type per-asset to keep names unique.
 *
 * Display-size override and 9-slice are intentionally per-asset only: those
 * are tied to specific source dims and rarely make sense as a batch op.
 */
function BatchEditPane({
  assets,
  onUpdate,
  onRemoveMany,
}: {
  assets: PlatformAsset[];
  onUpdate: (id: string, patch: Partial<PlatformAsset>) => void;
  onRemoveMany: (ids: string[]) => void;
}) {
  // "Mixed" markers when the field's values aren't uniform across the
  // selection. Selecting a concrete value from the dropdown writes it to
  // all assets; leaving "—" makes no change.
  const uniformBiome = uniformValue(assets.map((a) => a.biome));
  const uniformType = uniformValue(assets.map((a) => a.type));
  const uniformSize = uniformValue(
    assets.map((a) => a.sizeCategory ?? '__unset'),
  );

  const setBatchBiome = (biome: PlatformAsset['biome']) => {
    for (const a of assets) {
      onUpdate(a.id, {
        biome,
        filename: derivePlatformFilename(
          { biome, type: a.type },
          assets.filter((x) => x.id !== a.id),
        ),
      });
    }
  };
  const setBatchType = (type: PlatformAsset['type']) => {
    for (const a of assets) {
      onUpdate(a.id, {
        type,
        filename: derivePlatformFilename(
          { biome: a.biome, type },
          assets.filter((x) => x.id !== a.id),
        ),
      });
    }
  };
  const setBatchSize = (sizeCategory: SizeCategory | undefined) => {
    for (const a of assets) onUpdate(a.id, { sizeCategory });
  };

  const selectStyle = {
    width: '100%',
    padding: '4px 6px',
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 4,
  } as const;

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
        Batch edit · {assets.length} assets
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Biome</label>
        <select
          value={uniformBiome ?? ''}
          onChange={(e) => {
            if (!e.target.value) return;
            setBatchBiome(e.target.value as PlatformAsset['biome']);
          }}
          style={selectStyle}
        >
          {uniformBiome === null && <option value="">— mixed —</option>}
          {BIOMES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Type</label>
        <select
          value={uniformType ?? ''}
          onChange={(e) => {
            if (!e.target.value) return;
            setBatchType(e.target.value as PlatformAsset['type']);
          }}
          style={selectStyle}
        >
          {uniformType === null && <option value="">— mixed —</option>}
          {PLATFORM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>Size category</label>
        <select
          value={uniformSize ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return; // user picked the "mixed" placeholder
            if (v === '__unset') setBatchSize(undefined);
            else setBatchSize(v as SizeCategory);
          }}
          style={selectStyle}
        >
          {uniformSize === null && <option value="">— mixed —</option>}
          <option value="__unset">— (unset)</option>
          {SIZE_CATEGORIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Authoring label only. The runtime selects assets by closest
          effective width.
        </div>
      </section>

      <button
        onClick={() => {
          if (
            confirm(
              `Remove ${assets.length} asset${assets.length > 1 ? 's' : ''} from the library? Files are cleared on next save.`,
            )
          ) {
            onRemoveMany(assets.map((a) => a.id));
          }
        }}
        style={{ marginTop: 8, fontSize: 11 }}
      >
        Remove {assets.length} from library
      </button>
    </aside>
  );
}

/** Returns the value when every entry equals it, or null when mixed/empty. */
function uniformValue<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return null;
  }
  return first;
}

// ---- Upscale progress overlay -------------------------------------------

/**
 * Full-pane modal overlay shown while the AI upscaler runs. Reports
 * `current/total` plus the file currently being processed, with a cancel
 * button. Sits at z-index 10 so it covers the asset grid but stays inside
 * the library pane (sources + metadata panes remain visible/usable, though
 * the grid input is blocked).
 */
function UpscaleOverlay({
  progress,
  onCancel,
}: {
  progress: { current: number; total: number; filename: string };
  onCancel: () => void;
}) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20,20,24,0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        padding: 24,
      }}
    >
      <div
        style={{
          minWidth: 380,
          maxWidth: 520,
          padding: 20,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          Upscaling library… ({progress.current} / {progress.total})
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={progress.filename}
        >
          {progress.filename || '…'}
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: '#6aa9ff',
              transition: 'width 200ms ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ fontSize: 11 }}>
            Cancel
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          The first asset includes the model load (~80 MB on first run);
          subsequent assets are faster. Cancel applies after the current
          asset finishes — partial progress is preserved.
        </div>
      </div>
    </div>
  );
}
