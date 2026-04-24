import { useMemo } from 'react';
import { tolerancePreviewColors, type DistanceMode } from '../lib/bg-removal';
import { rgbToHex, type RGB } from '../lib/color';

export interface SidebarProps {
  tolerance: number;
  onToleranceChange: (v: number) => void;
  mode: DistanceMode;
  onModeChange: (m: DistanceMode) => void;
  floodFill: boolean;
  onFloodFillChange: (v: boolean) => void;
  pickedColor: RGB | null;
  hoverColor: RGB | null;
  hoverPos: { x: number; y: number } | null;
  onPickedColorChange: (c: RGB | null) => void;
  onRemoveGlobal: () => void;
  onRemoveGlobalAllSources: () => void;
  onAutoDetect: () => void;
  onUndo: () => void;
  canUndo: boolean;
  hasImage: boolean;
  sourceCount: number;
  /** Saved color swatches (persistent in localStorage). */
  swatches: (RGB | null)[];
  onSwatchesChange: (s: (RGB | null)[]) => void;
  tool: 'pick' | 'erase';
  onToolChange: (t: 'pick' | 'erase') => void;
  eraseBrushSize: number;
  onEraseBrushSizeChange: (n: number) => void;
}

const BG_PRESETS: { name: string; color: RGB }[] = [
  { name: 'Magenta', color: { r: 255, g: 0, b: 255 } },
  { name: 'Green', color: { r: 0, g: 255, b: 0 } },
  { name: 'Blue', color: { r: 0, g: 0, b: 255 } },
  { name: 'White', color: { r: 255, g: 255, b: 255 } },
  { name: 'Black', color: { r: 0, g: 0, b: 0 } },
  { name: 'Cyan', color: { r: 0, g: 255, b: 255 } },
];

function Swatch({ color, size = 24 }: { color: RGB | null; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: color ? rgbToHex(color) : 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 4,
        backgroundImage: color
          ? undefined
          : 'linear-gradient(45deg, #3a3a44 25%, transparent 25%), linear-gradient(-45deg, #3a3a44 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a44 75%), linear-gradient(-45deg, transparent 75%, #3a3a44 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
      }}
    />
  );
}

export function Sidebar(props: SidebarProps) {
  const {
    tolerance,
    onToleranceChange,
    mode,
    onModeChange,
    floodFill,
    onFloodFillChange,
    pickedColor,
    hoverColor,
    hoverPos,
    onPickedColorChange,
    onRemoveGlobal,
    onRemoveGlobalAllSources,
    onAutoDetect,
    onUndo,
    canUndo,
    hasImage,
    sourceCount,
    swatches,
    onSwatchesChange,
    tool,
    onToolChange,
    eraseBrushSize,
    onEraseBrushSizeChange,
  } = props;

  return (
    <aside
      style={{
        width: 280,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <Section title="Tool">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['pick', 'erase'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onToolChange(t)}
              className={tool === t ? 'primary' : ''}
              style={{ flex: 1, textTransform: 'capitalize', fontSize: 11 }}
            >
              {t === 'pick' ? 'Pick color' : 'Eraser'}
            </button>
          ))}
        </div>
        {tool === 'erase' && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
              Brush size: {eraseBrushSize}px
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input
                type="range"
                min={1}
                max={200}
                step={1}
                value={eraseBrushSize}
                onChange={(e) => onEraseBrushSizeChange(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={1}
                max={2000}
                value={eraseBrushSize}
                onChange={(e) =>
                  onEraseBrushSizeChange(Math.max(1, Math.round(Number(e.target.value) || 1)))
                }
                style={{ width: 60 }}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
              Click + drag on the canvas to paint transparency. Undo rolls back the whole stroke.
              Alt+drag to pan as usual.
            </div>
          </>
        )}
      </Section>

      <Section title="Picked color">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Swatch color={pickedColor} size={32} />
          <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>
            {pickedColor ? (
              <>
                <div>{rgbToHex(pickedColor).toUpperCase()}</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  {pickedColor.r}, {pickedColor.g}, {pickedColor.b}
                </div>
              </>
            ) : (
              <span style={{ color: 'var(--text-dim)' }}>Click image to pick</span>
            )}
          </div>
        </div>
        <button
          onClick={onAutoDetect}
          disabled={!hasImage}
          style={{ marginTop: 8, width: '100%' }}
        >
          Auto-detect from corners
        </button>
      </Section>

      <Section title="Background presets">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {BG_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => onPickedColorChange(p.color)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                justifyContent: 'flex-start',
              }}
            >
              <Swatch color={p.color} size={14} />
              <span style={{ fontSize: 11 }}>{p.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Saved swatches">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {swatches.map((sw, i) => (
            <SwatchSlot
              key={i}
              color={sw}
              hasPicked={!!pickedColor}
              onClick={() => {
                if (sw) {
                  // Saved swatch → pick it
                  onPickedColorChange(sw);
                } else if (pickedColor) {
                  // Empty slot → save current picked color into it
                  const next = [...swatches];
                  next[i] = pickedColor;
                  onSwatchesChange(next);
                }
              }}
              onRightClick={() => {
                const next = [...swatches];
                next[i] = null;
                onSwatchesChange(next);
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Click an empty slot with a color picked to save it. Click a filled
          slot to re-pick that color. Right-click to clear.
        </div>
      </Section>

      <Section title="Tolerance">
        <TolerancePreview picked={pickedColor} tolerance={tolerance} mode={mode} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={tolerance}
            onChange={(e) => onToleranceChange(Number(e.target.value))}
          />
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={tolerance}
            onChange={(e) => onToleranceChange(Number(e.target.value))}
            style={{ width: 60 }}
          />
        </div>
      </Section>

      <Section title="Distance metric">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onModeChange('lab')}
            className={mode === 'lab' ? 'primary' : ''}
            style={{ flex: 1 }}
          >
            LAB (perceptual)
          </button>
          <button
            onClick={() => onModeChange('rgb')}
            className={mode === 'rgb' ? 'primary' : ''}
            style={{ flex: 1 }}
          >
            RGB
          </button>
        </div>
      </Section>

      <Section title="Removal mode">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 12, color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={floodFill}
            onChange={(e) => onFloodFillChange(e.target.checked)}
          />
          Contiguous flood-fill (click-only)
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          {floodFill
            ? 'Click removes connected region only.'
            : 'Click removes all matching pixels globally.'}
        </div>
      </Section>

      <Section title="Actions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className="primary"
            onClick={onRemoveGlobal}
            disabled={!hasImage || !pickedColor}
          >
            Remove picked color (active)
          </button>
          <button
            onClick={onRemoveGlobalAllSources}
            disabled={!pickedColor || sourceCount < 2}
            title={
              sourceCount < 2
                ? 'Load more than one source to batch-apply'
                : 'Runs the picked color + tolerance across every loaded source'
            }
          >
            Remove picked color (all {sourceCount} sources)
          </button>
          <button onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
        </div>
      </Section>

      {hoverPos && hoverPos.x >= 0 && (
        <Section title="Cursor">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Swatch color={hoverColor} size={20} />
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)' }}>
              <div>
                ({hoverPos.x}, {hoverPos.y})
              </div>
              <div>{hoverColor ? rgbToHex(hoverColor).toUpperCase() : 'transparent'}</div>
            </div>
          </div>
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <label>{title}</label>
      {children}
    </section>
  );
}

function SwatchSlot({
  color,
  hasPicked,
  onClick,
  onRightClick,
}: {
  color: RGB | null;
  hasPicked: boolean;
  onClick: () => void;
  onRightClick: () => void;
}) {
  const empty = !color;
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick();
      }}
      disabled={empty && !hasPicked}
      title={
        empty
          ? hasPicked
            ? 'Save picked color here'
            : 'Pick a color first, then click to save'
          : `${rgbToHex(color).toUpperCase()} · click to re-pick, right-click to clear`
      }
      style={{
        width: 32,
        height: 32,
        padding: 0,
        background: color ? rgbToHex(color) : 'transparent',
        backgroundImage: empty
          ? 'linear-gradient(45deg, #3a3a44 25%, transparent 25%), linear-gradient(-45deg, #3a3a44 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a44 75%), linear-gradient(-45deg, transparent 75%, #3a3a44 75%)'
          : undefined,
        backgroundSize: '6px 6px',
        backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
        border: '1px solid var(--border)',
        borderRadius: 3,
        cursor: empty && !hasPicked ? 'not-allowed' : 'pointer',
      }}
    />
  );
}

/**
 * Preview strip: shows colors that fall inside the current tolerance ball
 * around the picked color. Count scales with tolerance so a higher setting
 * visibly "fans out" into more swatches. The picked color is always the first
 * swatch; the rest sample fixed LAB/RGB directions at distance = threshold,
 * so swatches stay stable as the slider moves.
 */
function TolerancePreview({
  picked,
  tolerance,
  mode,
}: {
  picked: RGB | null;
  tolerance: number;
  mode: DistanceMode;
}) {
  const count = Math.max(3, Math.min(12, Math.round(tolerance / 10) + 3));
  const colors = useMemo(
    () => (picked ? tolerancePreviewColors(picked, tolerance, mode, count) : []),
    [picked, tolerance, mode, count],
  );
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          display: 'flex',
          gap: 2,
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 2,
          background: 'var(--bg)',
          minHeight: 20,
        }}
      >
        {!picked ? (
          <div style={{ flex: 1, fontSize: 10, color: 'var(--text-dim)', padding: '2px 4px' }}>
            Pick a color to preview the tolerance range
          </div>
        ) : (
          colors.map((c, i) => {
            const hex = rgbToHex(c).toUpperCase();
            return (
              <div
                key={i}
                title={`${hex} · rgb(${c.r}, ${c.g}, ${c.b})`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 18,
                  background: hex,
                  borderRadius: 2,
                  outline: i === 0 ? '1px solid var(--accent)' : 'none',
                  outlineOffset: i === 0 ? -1 : 0,
                }}
              />
            );
          })
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
        {picked && colors.length > 0
          ? `${colors.length} sample${colors.length === 1 ? '' : 's'} · first = picked · rest at distance ${tolerance.toFixed(0)}`
          : ' '}
      </div>
    </div>
  );
}
