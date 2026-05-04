import { useState } from 'react';
import type {
  Emitter,
  EmitterBlendMode,
  EmitterConfig,
  EmitterLayer,
} from '../../../lib/builder';
import type { SourceMeta } from '../../../lib/sources';
import { TexturePicker } from './TexturePicker';
import { TextureThumbnail } from './TextureThumbnail';

export interface EmitterEditorProps {
  emitter: Emitter;
  /** Active animation's slot count — used to clamp/range timing inputs. */
  slotCount: number;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onChange: (next: Emitter) => void;
  onClose: () => void;
  onSavePreset: () => void;
}

/**
 * Full emitter editor form. Edits propagate live (no Apply button) — every
 * change goes through `onChange` immediately. The texture picker takes over
 * the editor view in-place via local state, returning to the editor on
 * commit/cancel rather than back to the list (the picker's parent doesn't
 * need to know about edit-mode navigation).
 */
export function EmitterEditor({
  emitter,
  slotCount,
  sources,
  getSource,
  onChange,
  onClose,
  onSavePreset,
}: EmitterEditorProps) {
  const [showTexturePicker, setShowTexturePicker] = useState(false);

  if (showTexturePicker) {
    return (
      <TexturePicker
        title={emitter.name}
        initial={emitter.config.texture}
        sources={sources}
        getSource={getSource}
        onCommit={(t) => {
          onChange({ ...emitter, config: { ...emitter.config, texture: t } });
          setShowTexturePicker(false);
        }}
        onClose={() => setShowTexturePicker(false)}
      />
    );
  }

  const patch = (p: Partial<Emitter>) => onChange({ ...emitter, ...p });
  const patchConfig = (p: Partial<EmitterConfig>) =>
    onChange({ ...emitter, config: { ...emitter.config, ...p } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button onClick={onClose} style={{ fontSize: 11 }}>
          ← Back
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>
          Editing emitter <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{emitter.name}</span>
        </div>
        <button onClick={onSavePreset} style={{ fontSize: 11 }} title="Save current config as a cross-project preset">
          Save as preset…
        </button>
      </div>

      {/* Body — sections lay out as a responsive grid filling the dock width. */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <TimingSection
            startFrame={emitter.startFrame}
            endFrame={emitter.endFrame}
            slotCount={slotCount}
            onChange={(p) => patch(p)}
          />
          <PositionSection
            layer={emitter.layer}
            offset={emitter.offset}
            onChange={(p) => patch(p)}
          />
          <EmissionSection
            quantity={emitter.config.quantity}
            frequency={emitter.config.frequency}
            onChange={(p) => patchConfig(p)}
          />
          <TextureSection
            texture={emitter.config.texture}
            sources={sources}
            getSource={getSource}
            onClickChange={() => setShowTexturePicker(true)}
          />
          <BlendSection
            blendMode={emitter.config.blendMode}
            onChange={(blendMode) => patchConfig({ blendMode })}
          />
          <ColorSection
            tint={emitter.config.tint}
            onChange={(tint) => patchConfig({ tint })}
          />
          <MotionSection
            speed={emitter.config.speed}
            angle={emitter.config.angle}
            gravityY={emitter.config.gravityY}
            accelerationX={emitter.config.accelerationX ?? 0}
            accelerationY={emitter.config.accelerationY ?? 0}
            rotateStart={emitter.config.rotateStart ?? 0}
            rotateRate={emitter.config.rotateRate ?? 0}
            onChange={(p) => patchConfig(p)}
          />
          <LifecycleSection
            lifespan={emitter.config.lifespan}
            scale={emitter.config.scale}
            alpha={emitter.config.alpha}
            onChange={(p) => patchConfig(p)}
          />
          <ModifiersSection
            swirl={emitter.config.swirl}
            drag={emitter.config.drag}
            wave={emitter.config.wave}
            onChange={(p) => patchConfig(p)}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Sections ------------------------------------------------------------

function TimingSection({
  startFrame,
  endFrame,
  slotCount,
  onChange,
}: {
  startFrame: number;
  endFrame: number | undefined;
  slotCount: number;
  onChange: (p: Partial<Pick<Emitter, 'startFrame' | 'endFrame'>>) => void;
}) {
  const max = Math.max(0, slotCount - 1);
  const burst = endFrame === undefined;
  return (
    <Section title="Timing">
      <NumberWithSlider
        label={`Start frame (0–${max})`}
        value={startFrame}
        min={0}
        max={max}
        step={1}
        onChange={(v) => onChange({ startFrame: clamp(v, 0, max) })}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          className={burst ? 'primary' : ''}
          onClick={() => onChange({ endFrame: undefined })}
          style={{ flex: 1, fontSize: 11 }}
          title="Single-frame burst — emit once on the start frame"
        >
          Burst
        </button>
        <button
          className={!burst ? 'primary' : ''}
          onClick={() => onChange({ endFrame: clamp(endFrame ?? startFrame, startFrame, max) })}
          style={{ flex: 1, fontSize: 11 }}
          title="Continuous — emit while playhead is inside [start, end]"
        >
          Continuous
        </button>
      </div>
      {!burst && (
        <NumberWithSlider
          label={`End frame (≥ ${startFrame})`}
          value={endFrame ?? startFrame}
          min={startFrame}
          max={max}
          step={1}
          onChange={(v) => onChange({ endFrame: clamp(v, startFrame, max) })}
        />
      )}
    </Section>
  );
}

function PositionSection({
  layer,
  offset,
  onChange,
}: {
  layer: EmitterLayer;
  offset: { x: number; y: number };
  onChange: (p: Partial<Pick<Emitter, 'layer' | 'offset'>>) => void;
}) {
  return (
    <Section title="Position">
      <label style={{ marginBottom: 0, fontSize: 11 }}>Layer</label>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['back', 'front'] as const).map((l) => (
          <button
            key={l}
            className={layer === l ? 'primary' : ''}
            onClick={() => onChange({ layer: l })}
            style={{ flex: 1, fontSize: 11, textTransform: 'capitalize' }}
          >
            {l}
          </button>
        ))}
      </div>
      <NumberWithSlider
        label="Offset X (px from anchor)"
        value={offset.x}
        min={-128}
        max={128}
        step={1}
        onChange={(v) => onChange({ offset: { ...offset, x: Math.round(v) } })}
      />
      <NumberWithSlider
        label="Offset Y (negative = up)"
        value={offset.y}
        min={-128}
        max={128}
        step={1}
        onChange={(v) => onChange({ offset: { ...offset, y: Math.round(v) } })}
      />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Pixels relative to the box anchor (typically bottom-center for feet).
      </div>
    </Section>
  );
}

function EmissionSection({
  quantity,
  frequency,
  onChange,
}: {
  quantity: number;
  frequency: number;
  onChange: (p: Partial<EmitterConfig>) => void;
}) {
  const burstMode = frequency === -1;
  return (
    <Section title="Emission">
      <NumberWithSlider
        label="Quantity (per emit)"
        value={quantity}
        min={1}
        max={50}
        step={1}
        onChange={(v) => onChange({ quantity: Math.max(1, Math.round(v)) })}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          className={burstMode ? 'primary' : ''}
          onClick={() => onChange({ frequency: -1 })}
          style={{ flex: 1, fontSize: 11 }}
          title="Emit `quantity` particles once per entry into the timing window"
        >
          Burst
        </button>
        <button
          className={!burstMode ? 'primary' : ''}
          onClick={() => onChange({ frequency: frequency === -1 ? 50 : frequency })}
          style={{ flex: 1, fontSize: 11 }}
          title="Emit every `frequency` ms while inside the window"
        >
          Continuous
        </button>
      </div>
      {!burstMode && (
        <NumberWithSlider
          label="Frequency (ms between emits)"
          value={frequency}
          min={10}
          max={1000}
          step={5}
          onChange={(v) => onChange({ frequency: Math.max(1, Math.round(v)) })}
        />
      )}
    </Section>
  );
}

function TextureSection({
  texture,
  sources,
  getSource,
  onClickChange,
}: {
  texture: EmitterConfig['texture'];
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onClickChange: () => void;
}) {
  return (
    <Section title="Texture">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <TextureThumbnail
          texture={texture}
          size={64}
          sources={sources}
          getSource={getSource}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)' }}>
            {textureLabel(texture)}
          </div>
          <button onClick={onClickChange} style={{ fontSize: 11 }}>
            Change texture…
          </button>
        </div>
      </div>
    </Section>
  );
}

function textureLabel(t: EmitterConfig['texture']): string {
  if (t.kind === 'procedural') {
    return `${t.shape} · ${t.size}px · soft ${t.softness.toFixed(2)}`;
  }
  if (t.kind === 'bank') return `bank: ${t.name}`;
  return `sprite cell #${t.cellIndex}`;
}

function BlendSection({
  blendMode,
  onChange,
}: {
  blendMode: EmitterBlendMode;
  onChange: (b: EmitterBlendMode) => void;
}) {
  const modes: EmitterBlendMode[] = ['NORMAL', 'ADD', 'MULTIPLY', 'SCREEN'];
  return (
    <Section title="Blend mode">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {modes.map((m) => (
          <button
            key={m}
            className={blendMode === m ? 'primary' : ''}
            onClick={() => onChange(m)}
            style={{ flex: 1, fontSize: 11, minWidth: 64 }}
          >
            {m}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        ADD makes bright/glowy effects (sparks, fire). MULTIPLY darkens
        underlying pixels (smoke). SCREEN brightens. NORMAL = standard alpha.
      </div>
    </Section>
  );
}

function ColorSection({
  tint,
  onChange,
}: {
  tint: number | number[];
  onChange: (t: number | number[]) => void;
}) {
  const colors = Array.isArray(tint) ? tint : [tint];

  const setColorAt = (i: number, c: number) => {
    const next = colors.map((x, idx) => (idx === i ? c : x));
    onChange(next.length === 1 ? next[0] : next);
  };
  const removeAt = (i: number) => {
    if (colors.length <= 1) return;
    const next = colors.filter((_, idx) => idx !== i);
    onChange(next.length === 1 ? next[0] : next);
  };
  const addColor = () => {
    onChange([...colors, 0xffffff]);
  };

  return (
    <Section title={`Tint (${colors.length} ${colors.length === 1 ? 'color' : 'colors'})`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {colors.map((c, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <input
              type="color"
              value={hexStr(c)}
              onChange={(e) => setColorAt(i, parseHex(e.target.value))}
              style={{
                width: 36,
                height: 36,
                padding: 0,
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              title={hexStr(c)}
            />
            {colors.length > 1 && (
              <button
                onClick={() => removeAt(i)}
                title="Remove color"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 16,
                  height: 16,
                  padding: 0,
                  fontSize: 10,
                  lineHeight: 1,
                  background: 'rgba(0,0,0,0.7)',
                  border: '1px solid var(--border)',
                  color: '#e6e6ea',
                  borderRadius: 8,
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button onClick={addColor} style={{ fontSize: 14, padding: '6px 10px' }} title="Add another color (chosen randomly per particle)">
          +
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Multiple colors = each emitted particle picks one at random. Single
        color = uniform tint. White (#ffffff) = no tint.
      </div>
    </Section>
  );
}

function MotionSection({
  speed,
  angle,
  gravityY,
  accelerationX,
  accelerationY,
  rotateStart,
  rotateRate,
  onChange,
}: {
  speed: number | { min: number; max: number };
  angle: number | { min: number; max: number };
  gravityY: number;
  accelerationX: number | { min: number; max: number };
  accelerationY: number | { min: number; max: number };
  rotateStart: number | { min: number; max: number };
  rotateRate: number;
  onChange: (p: Partial<EmitterConfig>) => void;
}) {
  return (
    <Section title="Motion">
      <RangeOrValue
        label="Speed (px/sec)"
        value={speed}
        sliderMin={0}
        sliderMax={300}
        step={1}
        onChange={(v) => onChange({ speed: v })}
      />
      <RangeOrValue
        label="Angle (degrees · 0=right, 90=down)"
        value={angle}
        sliderMin={-180}
        sliderMax={360}
        step={1}
        onChange={(v) => onChange({ angle: v })}
      />
      <NumberWithSlider
        label="Gravity Y (positive = falls)"
        value={gravityY}
        min={-200}
        max={400}
        step={5}
        onChange={(v) => onChange({ gravityY: Math.round(v) })}
      />
      <RangeOrValue
        label="Acceleration X (px/s²)"
        value={accelerationX}
        sliderMin={-300}
        sliderMax={300}
        step={5}
        onChange={(v) => onChange({ accelerationX: v })}
      />
      <RangeOrValue
        label="Acceleration Y (px/s²)"
        value={accelerationY}
        sliderMin={-300}
        sliderMax={300}
        step={5}
        onChange={(v) => onChange({ accelerationY: v })}
      />
      <RangeOrValue
        label="Rotate start (degrees)"
        value={rotateStart}
        sliderMin={-180}
        sliderMax={180}
        step={5}
        onChange={(v) => onChange({ rotateStart: v })}
      />
      <NumberWithSlider
        label="Rotate rate (deg/sec) — particle spin"
        value={rotateRate}
        min={-720}
        max={720}
        step={10}
        onChange={(v) => onChange({ rotateRate: Math.round(v) })}
      />
    </Section>
  );
}

// ---- Modifiers section --------------------------------------------------

function ModifiersSection({
  swirl,
  drag,
  wave,
  onChange,
}: {
  swirl: EmitterConfig['swirl'];
  drag: EmitterConfig['drag'];
  wave: EmitterConfig['wave'];
  onChange: (p: Partial<EmitterConfig>) => void;
}) {
  return (
    <Section title="Modifiers">
      <SwirlBlock value={swirl} onChange={(v) => onChange({ swirl: v })} />
      <DragBlock value={drag} onChange={(v) => onChange({ drag: v })} />
      <WaveBlock value={wave} onChange={(v) => onChange({ wave: v })} />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 4 }}>
        Modifiers run via a custom particle processor. The exported JSON
        carries them verbatim — your AscensionGame loader interprets them
        with the same logic to keep the preview 1:1.
      </div>
    </Section>
  );
}

function SwirlBlock({
  value,
  onChange,
}: {
  value: EmitterConfig['swirl'];
  onChange: (v: EmitterConfig['swirl']) => void;
}) {
  const enabled = !!value;
  const strength = value?.strength ?? 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className={enabled ? 'primary' : ''}
          onClick={() => onChange(enabled ? undefined : { strength: 200 })}
          style={{ fontSize: 11 }}
        >
          {enabled ? 'Swirl on' : 'Swirl off'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          orbit around emit point
        </span>
      </div>
      {enabled && (
        <NumberWithSlider
          label={`Strength (px/s² tangential · ${strength >= 0 ? 'CCW' : 'CW'})`}
          value={strength}
          min={-800}
          max={800}
          step={10}
          onChange={(v) => onChange({ strength: Math.round(v) })}
        />
      )}
    </div>
  );
}

function DragBlock({
  value,
  onChange,
}: {
  value: EmitterConfig['drag'];
  onChange: (v: EmitterConfig['drag']) => void;
}) {
  const enabled = value !== undefined && value > 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className={enabled ? 'primary' : ''}
          onClick={() => onChange(enabled ? undefined : 1)}
          style={{ fontSize: 11 }}
        >
          {enabled ? 'Drag on' : 'Drag off'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          velocity-proportional decay
        </span>
      </div>
      {enabled && (
        <NumberWithSlider
          label={`Coefficient (e^(-c·dt) per second)`}
          value={value ?? 0}
          min={0}
          max={5}
          step={0.05}
          onChange={(v) => onChange(Math.max(0, Number(v.toFixed(2))))}
        />
      )}
    </div>
  );
}

function WaveBlock({
  value,
  onChange,
}: {
  value: EmitterConfig['wave'];
  onChange: (v: EmitterConfig['wave']) => void;
}) {
  const enabled = !!value && value.amplitude > 0;
  const wave = value ?? { amplitude: 10, frequency: 2, axis: 'x' as const };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className={enabled ? 'primary' : ''}
          onClick={() =>
            onChange(enabled ? undefined : { amplitude: 12, frequency: 2, axis: 'x' })
          }
          style={{ fontSize: 11 }}
        >
          {enabled ? 'Wave on' : 'Wave off'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          sinusoidal position offset
        </span>
      </div>
      {enabled && (
        <>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {(['x', 'y'] as const).map((a) => (
              <button
                key={a}
                className={wave.axis === a ? 'primary' : ''}
                onClick={() => onChange({ ...wave, axis: a })}
                style={{ flex: 1, fontSize: 11, textTransform: 'uppercase' }}
              >
                Axis {a}
              </button>
            ))}
          </div>
          <NumberWithSlider
            label="Amplitude (px peak)"
            value={wave.amplitude}
            min={0}
            max={50}
            step={1}
            onChange={(v) => onChange({ ...wave, amplitude: Math.max(0, Math.round(v)) })}
          />
          <NumberWithSlider
            label="Frequency (cycles/sec)"
            value={wave.frequency}
            min={0.1}
            max={10}
            step={0.1}
            onChange={(v) => onChange({ ...wave, frequency: Math.max(0.1, Number(v.toFixed(2))) })}
          />
        </>
      )}
    </div>
  );
}

function LifecycleSection({
  lifespan,
  scale,
  alpha,
  onChange,
}: {
  lifespan: number | { min: number; max: number };
  scale: number | { start: number; end: number };
  alpha: number | { start: number; end: number };
  onChange: (p: Partial<EmitterConfig>) => void;
}) {
  return (
    <Section title="Lifecycle">
      <RangeOrValue
        label="Lifespan (ms)"
        value={lifespan}
        sliderMin={50}
        sliderMax={2000}
        step={10}
        onChange={(v) => onChange({ lifespan: v })}
      />
      <StartEndRamp
        label="Scale"
        value={scale}
        sliderMin={0}
        sliderMax={3}
        step={0.05}
        onChange={(v) => onChange({ scale: v })}
      />
      <StartEndRamp
        label="Alpha"
        value={alpha}
        sliderMin={0}
        sliderMax={1}
        step={0.01}
        onChange={(v) => onChange({ alpha: v })}
      />
    </Section>
  );
}

// ---- Generic field components -------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <label style={{ marginBottom: 4 }}>{title}</label>
      {children}
    </section>
  );
}

function NumberWithSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ marginBottom: 0, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: 64, textAlign: 'right' }}
        />
      </div>
    </div>
  );
}

/**
 * Edits a `number | { min, max }` field. Toggle row on top picks the mode;
 * switching modes preserves the current value (single → range collapses to
 * `{ min: v, max: v }`; range → single uses `min`).
 */
function RangeOrValue({
  label,
  value,
  sliderMin,
  sliderMax,
  step = 1,
  onChange,
}: {
  label: string;
  value: number | { min: number; max: number };
  sliderMin: number;
  sliderMax: number;
  step?: number;
  onChange: (v: number | { min: number; max: number }) => void;
}) {
  const isRange = typeof value !== 'number';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <label
          style={{
            marginBottom: 0,
            fontSize: 11,
            textTransform: 'none',
            letterSpacing: 0,
            flex: 1,
          }}
        >
          {label}
        </label>
        <button
          onClick={() => {
            if (isRange) onChange(value.min);
            else onChange({ min: value, max: value });
          }}
          style={{ fontSize: 10, padding: '1px 6px' }}
          title={isRange ? 'Switch to single value' : 'Switch to a min/max range'}
        >
          {isRange ? 'Range' : 'Single'}
        </button>
      </div>
      {isRange ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28 }}>min</span>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={step}
              value={value.min}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ min: v, max: Math.max(value.max, v) });
              }}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              step={step}
              value={value.min}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ min: v, max: Math.max(value.max, v) });
              }}
              style={{ width: 60, textAlign: 'right' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28 }}>max</span>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={step}
              value={value.max}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ min: Math.min(value.min, v), max: v });
              }}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              step={step}
              value={value.max}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ min: Math.min(value.min, v), max: v });
              }}
              style={{ width: 60, textAlign: 'right' }}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ width: 60, textAlign: 'right' }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Edits a `number | { start, end }` field as a paired start/end ramp.
 * Single-number input is normalized to `{ start: v, end: v }` on first edit
 * (the JSON round-trip stays clean for new presets, and existing presets
 * with a single number still load fine and just get expanded once touched).
 */
function StartEndRamp({
  label,
  value,
  sliderMin,
  sliderMax,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number | { start: number; end: number };
  sliderMin: number;
  sliderMax: number;
  step?: number;
  onChange: (v: { start: number; end: number }) => void;
}) {
  const v = typeof value === 'number' ? { start: value, end: value } : value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label
        style={{
          marginBottom: 0,
          fontSize: 11,
          textTransform: 'none',
          letterSpacing: 0,
        }}
      >
        {label}: {v.start.toFixed(2)} → {v.end.toFixed(2)}
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28 }}>start</span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={step}
          value={v.start}
          onChange={(e) => onChange({ ...v, start: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          step={step}
          value={v.start}
          onChange={(e) => onChange({ ...v, start: Number(e.target.value) })}
          style={{ width: 60, textAlign: 'right' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28 }}>end</span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={step}
          value={v.end}
          onChange={(e) => onChange({ ...v, end: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          step={step}
          value={v.end}
          onChange={(e) => onChange({ ...v, end: Number(e.target.value) })}
          style={{ width: 60, textAlign: 'right' }}
        />
      </div>
    </div>
  );
}

// ---- Helpers ------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hexStr(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function parseHex(s: string): number {
  return parseInt(s.replace('#', ''), 16) & 0xffffff;
}
