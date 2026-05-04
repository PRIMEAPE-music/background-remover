import { useCallback, useEffect, useState } from 'react';
import {
  cloneEmitter,
  getActiveAnimation,
  newEmitter,
  updateActiveAnimation,
  type BuilderState,
  type Emitter,
  type TextureRef,
} from '../../lib/builder';
import { presetHas, savePreset } from '../../lib/particles/presets';
import type { SourceMeta } from '../../lib/sources';
import { EmitterEditor } from './particles/EmitterEditor';
import { PresetPicker } from './particles/PresetPicker';
import { TexturePicker } from './particles/TexturePicker';
import { TextureThumbnail } from './particles/TextureThumbnail';

export interface ParticlesTabProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

type PickerState =
  | { kind: 'texture'; emitterId: string }
  | { kind: 'preset' }
  | { kind: 'edit'; emitterId: string }
  | null;

/**
 * Particles tab — Slice 3. The list view (default) shows emitter rows with
 * texture thumbnails and standard actions. Clicking a thumbnail opens the
 * full-tab `TexturePicker`. "+ From preset…" opens the `PresetPicker`. Both
 * pickers replace the list while open and route back via their Back button.
 *
 * Future: the editor form (timing/motion/color/blend) lands in slice 4 and
 * will plug into this same page (probably as an expandable section under
 * each row, or as a third picker mode).
 */
export function ParticlesTab({ state, onStateChange, sources, getSource }: ParticlesTabProps) {
  const [picker, setPicker] = useState<PickerState>(null);
  const active = getActiveAnimation(state);
  const emitters = active?.emitters ?? [];

  const setEmitters = useCallback(
    (next: Emitter[]) => {
      onStateChange(updateActiveAnimation(state, { emitters: next }));
    },
    [state, onStateChange],
  );

  const addEmitter = useCallback(() => {
    if (!active) return;
    const e = newEmitter(uniqueName('emitter', emitters.map((x) => x.name)), 0);
    setEmitters([...emitters, e]);
  }, [active, emitters, setEmitters]);

  const duplicateEmitter = useCallback(
    (id: string) => {
      const src = emitters.find((e) => e.id === id);
      if (!src) return;
      const dup = cloneEmitter(src);
      dup.name = uniqueName(dup.name, emitters.map((e) => e.name));
      setEmitters([...emitters, dup]);
    },
    [emitters, setEmitters],
  );

  const deleteEmitter = useCallback(
    (id: string) => {
      setEmitters(emitters.filter((e) => e.id !== id));
    },
    [emitters, setEmitters],
  );

  const renameEmitter = useCallback(
    (id: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) return;
      const others = emitters.filter((e) => e.id !== id).map((e) => e.name);
      const safe = others.includes(trimmed) ? uniqueName(trimmed, others) : trimmed;
      setEmitters(emitters.map((e) => (e.id === id ? { ...e, name: safe } : e)));
    },
    [emitters, setEmitters],
  );

  const setEmitterTexture = useCallback(
    (id: string, texture: TextureRef) => {
      setEmitters(
        emitters.map((e) =>
          e.id === id ? { ...e, config: { ...e.config, texture } } : e,
        ),
      );
    },
    [emitters, setEmitters],
  );

  const replaceEmitter = useCallback(
    (next: Emitter) => {
      setEmitters(emitters.map((e) => (e.id === next.id ? next : e)));
    },
    [emitters, setEmitters],
  );

  const saveAsPreset = useCallback(
    async (id: string) => {
      const e = emitters.find((x) => x.id === id);
      if (!e) return;
      const name = e.name;
      if (await presetHas(name)) {
        if (!confirm(`Preset "${name}" already exists. Overwrite?`)) return;
      }
      try {
        await savePreset(name, e);
        alert(`Saved preset "${name}". Find it under "+ From preset…".`);
      } catch (err) {
        alert(`Failed to save preset: ${(err as Error).message}`);
      }
    },
    [emitters],
  );

  // ---- Picker modes ----

  if (picker?.kind === 'texture') {
    const target = emitters.find((e) => e.id === picker.emitterId);
    if (!target) {
      // Emitter was deleted while picker was open — fall back to list.
      setPicker(null);
      return null;
    }
    return (
      <TexturePicker
        title={target.name}
        initial={target.config.texture}
        sources={sources}
        getSource={getSource}
        onCommit={(t) => {
          setEmitterTexture(target.id, t);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    );
  }

  if (picker?.kind === 'preset') {
    return (
      <PresetPicker
        animationSlotCount={active?.slots.length ?? 0}
        sources={sources}
        getSource={getSource}
        onCommit={(emitter) => {
          if (!active) return;
          // Preset's own name might collide — rename to keep it unique within
          // this animation while preserving the preset library entry as-is.
          const safeName = uniqueName(emitter.name, emitters.map((x) => x.name));
          setEmitters([...emitters, { ...emitter, name: safeName }]);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    );
  }

  if (picker?.kind === 'edit') {
    const target = emitters.find((e) => e.id === picker.emitterId);
    if (!target) {
      setPicker(null);
      return null;
    }
    return (
      <EmitterEditor
        emitter={target}
        slotCount={active?.slots.length ?? 0}
        sources={sources}
        getSource={getSource}
        onChange={replaceEmitter}
        onClose={() => setPicker(null)}
        onSavePreset={() => saveAsPreset(target.id)}
      />
    );
  }

  // ---- List view (default) ----

  if (!active) {
    return (
      <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>
        Create or select an animation in the Animation tab to add particles.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ marginBottom: 0, flex: 1 }}>
          Emitters for {active.name} ({emitters.length})
        </label>
        <button
          onClick={() => setPicker({ kind: 'preset' })}
          style={{ fontSize: 11 }}
          title="Browse the cross-project preset library"
        >
          + From preset…
        </button>
        <button onClick={addEmitter} className="primary" style={{ fontSize: 11 }}>
          + Add emitter
        </button>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Click a row's thumbnail to change its texture. Save useful configs as
        presets — they live in the cross-project library and show up under "+
        From preset…" on every project. Editor form (timing, motion, color,
        blend) lands in the next slice.
      </div>

      {emitters.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          No emitters yet. Click <b>+ Add emitter</b> for a default emitter, or{' '}
          <b>+ From preset…</b> to start from one of the built-in effects.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {emitters.map((e) => (
            <EmitterRow
              key={e.id}
              emitter={e}
              sources={sources}
              getSource={getSource}
              onClickTexture={() => setPicker({ kind: 'texture', emitterId: e.id })}
              onEdit={() => setPicker({ kind: 'edit', emitterId: e.id })}
              onRename={(name) => renameEmitter(e.id, name)}
              onSavePreset={() => saveAsPreset(e.id)}
              onDuplicate={() => duplicateEmitter(e.id)}
              onDelete={() => deleteEmitter(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmitterRow({
  emitter,
  sources,
  getSource,
  onClickTexture,
  onEdit,
  onRename,
  onSavePreset,
  onDuplicate,
  onDelete,
}: {
  emitter: Emitter;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onClickTexture: () => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onSavePreset: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(emitter.name);
  // Resync when the parent renames us (e.g. uniqueness collision after commit
  // rewrites our name). Won't clobber an in-progress edit because the input
  // is blurred by the time onRename fires.
  useEffect(() => {
    setNameDraft(emitter.name);
  }, [emitter.id, emitter.name]);

  const frameLabel =
    emitter.endFrame !== undefined && emitter.endFrame !== emitter.startFrame
      ? `frames ${emitter.startFrame}–${emitter.endFrame}`
      : `frame ${emitter.startFrame}${emitter.endFrame === undefined ? ' (burst)' : ''}`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 4,
      }}
    >
      <div
        onClick={onClickTexture}
        title="Click to change texture"
        style={{ cursor: 'pointer', flexShrink: 0 }}
      >
        <TextureThumbnail
          texture={emitter.config.texture}
          size={36}
          sources={sources}
          getSource={getSource}
        />
      </div>
      <input
        type="text"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => {
          if (nameDraft !== emitter.name) onRename(nameDraft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setNameDraft(emitter.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
        title="Rename — Enter or blur to commit"
      />
      <span
        style={{
          color: 'var(--text-dim)',
          fontFamily: 'monospace',
          fontSize: 10,
          whiteSpace: 'nowrap',
        }}
      >
        {emitter.layer} · {frameLabel}
      </span>
      <button
        onClick={onEdit}
        className="primary"
        title="Open the full editor (timing, motion, color, blend…)"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        Edit
      </button>
      <button
        onClick={onSavePreset}
        title="Save this emitter as a cross-project preset"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        Save
      </button>
      <button
        onClick={onDuplicate}
        title="Duplicate emitter"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        Dup
      </button>
      <button
        onClick={onDelete}
        title="Delete emitter"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        ×
      </button>
    </div>
  );
}

/** Append `_2`, `_3`, … until the name is unique within the given list. */
function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
