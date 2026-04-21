import type { DistanceMode } from '../lib/bg-removal';
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
  onAutoDetect: () => void;
  onUndo: () => void;
  canUndo: boolean;
  hasImage: boolean;
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
    onAutoDetect,
    onUndo,
    canUndo,
    hasImage,
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

      <Section title="Tolerance">
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
            Remove picked color
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
