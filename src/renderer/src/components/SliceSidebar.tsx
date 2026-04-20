import { FRAME_SIZE_PRESETS, gridFromCellSize, type AnchorKind, type SliceConfig } from '../lib/slicing';
import type { SavedPreset } from '../lib/presets';
import { AnimationPreview } from './AnimationPreview';

export interface SliceSidebarProps {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
  imageWidth: number;
  imageHeight: number;
  cellCount: number;
  previewFrames: ImageData[];
  selectedCellIndex: number | null;
  onSelectedCellIndexChange: (i: number | null) => void;
  onExportCells: () => void;
  onExportAtlas: () => void;
  onAutoDetectBlobs: () => void;
  onAutoRepack: () => void;
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
    previewFrames,
    selectedCellIndex,
    onSelectedCellIndexChange,
    onExportCells,
    onExportAtlas,
    onAutoDetectBlobs,
    onAutoRepack,
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

      <section>
        <label>Animation preview</label>
        <AnimationPreview frames={previewFrames} />
      </section>

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
}: {
  config: SliceConfig;
  onConfigChange: (c: SliceConfig) => void;
  selectedIndex: number | null;
  imageWidth: number;
  imageHeight: number;
  onAutoDetectBlobs: () => void;
}) {
  const selected = selectedIndex !== null ? config.boxes.rects[selectedIndex] : null;
  return (
    <>
      <section>
        <button onClick={onAutoDetectBlobs} className="primary" style={{ width: '100%' }}>
          Auto-detect sprite blobs
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Finds every opaque region and creates boxes around them. Run after removing background.
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
