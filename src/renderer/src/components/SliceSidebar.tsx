import { useState } from 'react';
import { FRAME_SIZE_PRESETS, gridFromCellSize, type AnchorKind, type Rect, type SliceConfig } from '../lib/slicing';
import type { BoxesTool } from './slice/BoxesOverlay';
import type { SavedPreset } from '../lib/presets';
import { AnimationPreview } from './AnimationPreview';

export interface SliceSidebarProps {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
  imageWidth: number;
  imageHeight: number;
  cellCount: number;
  /**
   * Stable callback returning the active source's ImageData. Kept as a
   * callback (plus `previewSourceId` primitive) instead of passing the raw
   * ImageData — React 19 dev mode walks props during reconciliation, and
   * large ImageData buffers in the prop tree caused multi-second freezes
   * on source switches even when AnimationPreview wasn't mounted.
   */
  getPreviewSource: (id: string | null) => ImageData | null;
  previewSourceId: string | null;
  previewCells: Rect[];
  selectedCellIndex: number | null;
  onSelectedCellIndexChange: (i: number | null) => void;
  onExportCells: () => void;
  onExportAtlas: () => void;
  onAutoDetectBlobs: (mergeGap: number) => void;
  onAutoDetectBlobsAllSources: (mergeGap: number) => void;
  sourceCount: number;
  onAutoRepack: () => void;
  boxesTool: BoxesTool;
  onBoxesToolChange: (t: BoxesTool) => void;
  canExport: boolean;
  presets: SavedPreset[];
  onSavePreset: (name: string) => void;
  onLoadPreset: (p: SavedPreset) => void;
  onDeletePreset: (name: string) => void;
}

const ANCHORS: AnchorKind[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

export function SliceSidebar(props: SliceSidebarProps) {
  const {
    config,
    onConfigChange,
    imageWidth,
    imageHeight,
    cellCount,
    getPreviewSource,
    previewSourceId,
    previewCells,
    selectedCellIndex,
    onSelectedCellIndexChange,
    onExportCells,
    onExportAtlas,
    onAutoDetectBlobs,
    onAutoDetectBlobsAllSources,
    sourceCount,
    onAutoRepack,
    boxesTool,
    onBoxesToolChange,
    canExport,
    presets,
    onSavePreset,
    onLoadPreset,
    onDeletePreset,
  } = props;

  const setMode = (mode: SliceConfig['mode']) => onConfigChange({ ...config, mode });
  const selectedOverride = selectedCellIndex !== null ? config.overrides[selectedCellIndex] ?? {} : null;

  const toggleFlip = (axis: 'flipH' | 'flipV') => {
    if (selectedCellIndex === null) return;
    const current = config.overrides[selectedCellIndex] ?? {};
    onConfigChange({
      ...config,
      overrides: {
        ...config.overrides,
        [selectedCellIndex]: { ...current, [axis]: !current[axis] },
      },
    });
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
      <section>
        <label>Slice mode</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'guides', 'boxes'] as const).map((m) => (
            <button
              key={m}
              className={config.mode === m ? 'primary' : ''}
              onClick={() => setMode(m)}
              style={{ flex: 1, textTransform: 'capitalize' }}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      {config.mode === 'grid' && (
        <GridControls
          config={config}
          onConfigChange={onConfigChange}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
        />
      )}

      {config.mode === 'guides' && (
        <GuidesControls config={config} onConfigChange={onConfigChange} />
      )}

      {config.mode === 'boxes' && (
        <BoxesControls
          config={config}
          onConfigChange={onConfigChange}
          selectedIndex={selectedCellIndex}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          onAutoDetectBlobs={onAutoDetectBlobs}
          onAutoDetectBlobsAllSources={onAutoDetectBlobsAllSources}
          sourceCount={sourceCount}
          tool={boxesTool}
          onToolChange={onBoxesToolChange}
        />
      )}

      <section>
        <label>Cells ({cellCount})</label>
        {selectedCellIndex !== null && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              marginBottom: 6,
              fontFamily: 'monospace',
            }}
          >
            Selected: #{selectedCellIndex}
            <button
              style={{ marginLeft: 8, padding: '1px 6px', fontSize: 10 }}
              onClick={() => onSelectedCellIndexChange(null)}
            >
              clear
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => toggleFlip('flipH')}
            disabled={selectedCellIndex === null}
            className={selectedOverride?.flipH ? 'primary' : ''}
            style={{ flex: 1 }}
            title="Flip horizontal (H)"
          >
            ↔ Flip H
          </button>
          <button
            onClick={() => toggleFlip('flipV')}
            disabled={selectedCellIndex === null}
            className={selectedOverride?.flipV ? 'primary' : ''}
            style={{ flex: 1 }}
            title="Flip vertical (V)"
          >
            ↕ Flip V
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Tip: click any cell in the canvas to select · H/V key to flip
        </div>
      </section>

      <NormalizeSection config={config} onConfigChange={onConfigChange} />

      <PreviewSection
        getSource={getPreviewSource}
        sourceId={previewSourceId}
        cells={previewCells}
        overrides={config.overrides}
        normalize={config.normalize}
      />

      <section>
        <label>Export</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="primary" onClick={onExportCells} disabled={!canExport}>
            Export cells (individual PNGs)…
          </button>
          <button className="primary" onClick={onExportAtlas} disabled={!canExport}>
            Export Phaser 3 atlas (PNG + JSON)…
          </button>
          <button onClick={onAutoRepack} disabled={!canExport}>
            Auto-repack → clean sheet…
          </button>
        </div>
      </section>

      <PresetsSection
        presets={presets}
        onSave={onSavePreset}
        onLoad={onLoadPreset}
        onDelete={onDeletePreset}
      />
    </aside>
  );
}

/**
 * Preview renders only when the user explicitly enables it. Source-switch
 * interactions don't mount AnimationPreview unless the user has opted in, so
 * rapid clicking between sheets stays free of any extraction work.
 */
function PreviewSection({
  getSource,
  sourceId,
  cells,
  overrides,
  normalize,
}: {
  getSource: (id: string | null) => ImageData | null;
  sourceId: string | null;
  cells: Rect[];
  overrides: Record<number, import('../lib/slicing').CellOverride>;
  normalize: import('../lib/slicing').NormalizationOptions;
}) {
  const [enabled, setEnabled] = useState(false);
  // Only resolve the ImageData reference when the preview is actively enabled;
  // otherwise keep the 17MB buffer entirely out of this subtree's prop tree.
  const source = enabled ? getSource(sourceId) : null;
  return (
    <section>
      <label>Animation preview</label>
      {enabled ? (
        <>
          <AnimationPreview
            source={source}
            cells={cells}
            overrides={overrides}
            normalize={normalize}
          />
          <button
            onClick={() => setEnabled(false)}
            style={{ marginTop: 6, width: '100%', fontSize: 11 }}
          >
            Hide preview
          </button>
        </>
      ) : (
        <button
          onClick={() => setEnabled(true)}
          disabled={!sourceId || cells.length === 0}
          style={{ width: '100%' }}
          title="Preview animates through all cells. Hidden by default so source-switch reconciliation stays cheap."
        >
          Show preview
        </button>
      )}
    </section>
  );
}

function GridControls({
  config,
  onConfigChange,
  imageWidth,
  imageHeight,
}: {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
  imageWidth: number;
  imageHeight: number;
}) {
  const g = config.grid;
  const updateGrid = (patch: Partial<typeof g>) =>
    onConfigChange({ ...config, grid: { ...g, ...patch } });

  return (
    <>
      <section>
        <label>Frame size presets</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {FRAME_SIZE_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() =>
                onConfigChange({
                  ...config,
                  grid: gridFromCellSize(imageWidth, imageHeight, p.width, p.height),
                })
              }
              style={{ textAlign: 'left', fontSize: 11 }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label>Columns × Rows</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            min={1}
            value={g.cols}
            onChange={(e) => updateGrid({ cols: Math.max(1, Number(e.target.value)) })}
          />
          <input
            type="number"
            min={1}
            value={g.rows}
            onChange={(e) => updateGrid({ rows: Math.max(1, Number(e.target.value)) })}
          />
        </div>
      </section>

      <section>
        <label>Margin (x, y)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            min={0}
            value={g.marginX}
            onChange={(e) => updateGrid({ marginX: Math.max(0, Number(e.target.value)) })}
          />
          <input
            type="number"
            min={0}
            value={g.marginY}
            onChange={(e) => updateGrid({ marginY: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </section>

      <section>
        <label>Spacing (x, y)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            min={0}
            value={g.spacingX}
            onChange={(e) => updateGrid({ spacingX: Math.max(0, Number(e.target.value)) })}
          />
          <input
            type="number"
            min={0}
            value={g.spacingY}
            onChange={(e) => updateGrid({ spacingY: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </section>
    </>
  );
}

function GuidesControls({
  config,
  onConfigChange,
}: {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
}) {
  const gu = config.guides;
  return (
    <>
      <section>
        <label>Verticals ({gu.verticals.length})</label>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)' }}>
          {gu.verticals.length === 0
            ? 'none — double-click image to add'
            : [...gu.verticals].sort((a, b) => a - b).join(', ')}
        </div>
      </section>
      <section>
        <label>Horizontals ({gu.horizontals.length})</label>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)' }}>
          {gu.horizontals.length === 0
            ? 'none — shift+double-click to add'
            : [...gu.horizontals].sort((a, b) => a - b).join(', ')}
        </div>
      </section>
      <section>
        <button
          onClick={() => onConfigChange({ ...config, guides: { verticals: [], horizontals: [] } })}
          style={{ width: '100%' }}
        >
          Clear guides
        </button>
      </section>
    </>
  );
}

function BoxesControls({
  config,
  onConfigChange,
  selectedIndex,
  imageWidth,
  imageHeight,
  onAutoDetectBlobs,
  onAutoDetectBlobsAllSources,
  sourceCount,
  tool,
  onToolChange,
}: {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
  selectedIndex: number | null;
  imageWidth: number;
  imageHeight: number;
  onAutoDetectBlobs: (mergeGap: number) => void;
  onAutoDetectBlobsAllSources: (mergeGap: number) => void;
  sourceCount: number;
  tool: BoxesTool;
  onToolChange: (t: BoxesTool) => void;
}) {
  const selected = selectedIndex !== null ? config.boxes.rects[selectedIndex] : null;
  const [mergeGap, setMergeGap] = useState(8);
  return (
    <>
      <section>
        <label>Draw tool</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(['rect', 'lasso'] as const).map((t) => (
            <button
              key={t}
              className={tool === t ? 'primary' : ''}
              onClick={() => onToolChange(t)}
              style={{ flex: 1, textTransform: 'capitalize' }}
            >
              {t === 'rect' ? 'Rectangle' : 'Lasso'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Lasso: trace around a sprite (including loose particles) and a bounding box is created for you.
        </div>
      </section>
      <section>
        <button onClick={() => onAutoDetectBlobs(mergeGap)} className="primary" style={{ width: '100%' }}>
          Auto-detect sprite blobs
        </button>
        <button
          onClick={() => onAutoDetectBlobsAllSources(mergeGap)}
          disabled={sourceCount < 2}
          style={{ width: '100%', marginTop: 4 }}
          title={
            sourceCount < 2
              ? 'Load more than one source to batch-detect'
              : 'Run blob detection on every loaded sheet'
          }
        >
          Auto-detect across all {sourceCount} sources
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11 }}>
          <span style={{ flex: 1 }}>Merge gap</span>
          <input
            type="range"
            min={0}
            max={64}
            value={mergeGap}
            onChange={(e) => setMergeGap(Number(e.target.value))}
            style={{ flex: 2 }}
          />
          <input
            type="number"
            min={0}
            max={256}
            value={mergeGap}
            onChange={(e) => setMergeGap(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 48 }}
          />
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Finds every opaque region and creates boxes. Increase <em>merge gap</em> to group detached
          particles/FX into one sprite. Run after removing background.
        </div>
      </section>
      <section>
        <label>Boxes ({config.boxes.rects.length})</label>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          drag image to create · click box to select · corner handles resize · delete key removes
        </div>
      </section>
      {selected && selectedIndex !== null && (
        <section>
          <label>Selected #{selectedIndex}</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              type="number"
              value={selected.x}
              onChange={(e) => {
                const next = [...config.boxes.rects];
                next[selectedIndex] = {
                  ...selected,
                  x: Math.max(0, Math.min(imageWidth - selected.width, Number(e.target.value))),
                };
                onConfigChange({ ...config, boxes: { rects: next } });
              }}
            />
            <input
              type="number"
              value={selected.y}
              onChange={(e) => {
                const next = [...config.boxes.rects];
                next[selectedIndex] = {
                  ...selected,
                  y: Math.max(0, Math.min(imageHeight - selected.height, Number(e.target.value))),
                };
                onConfigChange({ ...config, boxes: { rects: next } });
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              value={selected.width}
              onChange={(e) => {
                const next = [...config.boxes.rects];
                next[selectedIndex] = {
                  ...selected,
                  width: Math.max(1, Math.min(imageWidth - selected.x, Number(e.target.value))),
                };
                onConfigChange({ ...config, boxes: { rects: next } });
              }}
            />
            <input
              type="number"
              value={selected.height}
              onChange={(e) => {
                const next = [...config.boxes.rects];
                next[selectedIndex] = {
                  ...selected,
                  height: Math.max(1, Math.min(imageHeight - selected.y, Number(e.target.value))),
                };
                onConfigChange({ ...config, boxes: { rects: next } });
              }}
            />
          </div>
        </section>
      )}
      <section>
        <button
          onClick={() => onConfigChange({ ...config, boxes: { rects: [] } })}
          style={{ width: '100%' }}
        >
          Clear boxes
        </button>
      </section>
    </>
  );
}

function NormalizeSection({
  config,
  onConfigChange,
}: {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
}) {
  const n = config.normalize;
  const update = (patch: Partial<typeof n>) =>
    onConfigChange({ ...config, normalize: { ...n, ...patch } });
  return (
    <section>
      <label>
        <input
          type="checkbox"
          checked={n.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          style={{ marginRight: 6 }}
        />
        Normalize on export
      </label>
      {!n.enabled && (
        <label style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={n.trim}
            onChange={(e) => update({ trim: e.target.checked })}
            style={{ marginRight: 6 }}
          />
          Trim transparent borders
        </label>
      )}
      {n.enabled && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <label style={{ textTransform: 'none', fontSize: 11, color: 'var(--text-dim)' }}>
              Frame size preset
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {FRAME_SIZE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => update({ targetWidth: p.width, targetHeight: p.height })}
                  style={{ textAlign: 'left', fontSize: 11, padding: '3px 6px' }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                min={1}
                value={n.targetWidth}
                onChange={(e) => update({ targetWidth: Math.max(1, Number(e.target.value)) })}
              />
              <input
                type="number"
                min={1}
                value={n.targetHeight}
                onChange={(e) => update({ targetHeight: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <label style={{ textTransform: 'none', fontSize: 11, color: 'var(--text-dim)' }}>
              Anchor
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 3,
              }}
            >
              {ANCHORS.map((a) => (
                <button
                  key={a}
                  className={n.anchor === a ? 'primary' : ''}
                  onClick={() => update({ anchor: a })}
                  style={{ fontSize: 10, padding: '3px 4px' }}
                  title={a}
                >
                  {anchorSymbol(a)}
                </button>
              ))}
            </div>
            <label style={{ textTransform: 'none', fontSize: 11, color: 'var(--text-dim)' }}>
              Scaling
            </label>
            <div style={{ display: 'flex', gap: 3 }}>
              {(['none', 'fit', 'content-height'] as const).map((m) => (
                <button
                  key={m}
                  className={n.scaleMode === m ? 'primary' : ''}
                  onClick={() => update({ scaleMode: m })}
                  style={{ flex: 1, fontSize: 10 }}
                >
                  {m}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ textTransform: 'none', fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                Padding
              </label>
              <input
                type="number"
                min={0}
                value={n.padding}
                onChange={(e) => update({ padding: Math.max(0, Number(e.target.value)) })}
                style={{ width: 60 }}
              />
            </div>
            <label style={{ textTransform: 'none', fontSize: 11, color: 'var(--text)', marginTop: 4 }}>
              <input
                type="checkbox"
                checked={n.trim}
                onChange={(e) => update({ trim: e.target.checked })}
                style={{ marginRight: 6 }}
              />
              Trim before placement
            </label>
          </div>
        </>
      )}
    </section>
  );
}

function anchorSymbol(a: AnchorKind): string {
  switch (a) {
    case 'top-left': return '↖';
    case 'top': return '↑';
    case 'top-right': return '↗';
    case 'left': return '←';
    case 'center': return '·';
    case 'right': return '→';
    case 'bottom-left': return '↙';
    case 'bottom': return '↓';
    case 'bottom-right': return '↘';
  }
}

function PresetsSection({
  presets,
  onSave,
  onLoad,
  onDelete,
}: {
  presets: SavedPreset[];
  onSave: (name: string) => void;
  onLoad: (p: SavedPreset) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <section>
      <label>Slice presets</label>
      <button
        onClick={() => {
          const name = prompt('Preset name:');
          if (name) onSave(name);
        }}
        style={{ width: '100%', marginBottom: 6 }}
      >
        Save current as preset…
      </button>
      {presets.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>No saved presets yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {presets.map((p) => (
            <div key={p.name} style={{ display: 'flex', gap: 4 }}>
              <button style={{ flex: 1, textAlign: 'left' }} onClick={() => onLoad(p)}>
                {p.name}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${p.name}"?`)) onDelete(p.name);
                }}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
