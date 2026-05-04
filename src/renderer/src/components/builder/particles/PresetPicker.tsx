import { useCallback, useEffect, useState } from 'react';
import type { Emitter } from '../../../lib/builder';
import {
  deletePreset,
  instantiatePreset,
  listPresets,
  type PresetEntry,
} from '../../../lib/particles/presets';
import type { SourceMeta } from '../../../lib/sources';
import { TextureThumbnail } from './TextureThumbnail';

export interface PresetPickerProps {
  /** Animation frame count, used to clamp the preset's start/end frames into range. */
  animationSlotCount: number;
  /** For thumbnailing project-sprite-textured presets. */
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  /** Called with a fully-instantiated emitter (fresh id) when the user commits. */
  onCommit: (emitter: Emitter) => void;
  onClose: () => void;
}

/**
 * Browse the cross-project preset library and instantiate one as a new
 * emitter on the active animation. Each preset shows a texture thumbnail
 * (when its texture is resolvable in this project) and quick stats so the
 * user can pick by sight rather than memorizing names.
 */
export function PresetPicker({
  animationSlotCount,
  sources,
  getSource,
  onCommit,
  onClose,
}: PresetPickerProps) {
  const [entries, setEntries] = useState<PresetEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listPresets());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback(() => {
    if (!selected) return;
    const entry = entries.find((e) => e.name === selected);
    if (!entry) return;
    const emitter = instantiatePreset(entry.emitter);
    // Clamp frames to the active animation's length so a preset built for an
    // 8-frame animation doesn't reference frame 5 in a 3-frame one.
    const maxFrame = Math.max(0, animationSlotCount - 1);
    emitter.startFrame = Math.min(emitter.startFrame, maxFrame);
    if (emitter.endFrame !== undefined) {
      emitter.endFrame = Math.min(emitter.endFrame, maxFrame);
    }
    onCommit(emitter);
  }, [selected, entries, animationSlotCount, onCommit]);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!confirm(`Delete preset "${name}"?`)) return;
      await deletePreset(name);
      if (selected === name) setSelected(null);
      await refresh();
    },
    [refresh, selected],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
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
          Pick a preset to add as a new emitter
        </div>
        <button
          className="primary"
          onClick={apply}
          disabled={!selected}
          style={{ fontSize: 11 }}
        >
          Use this preset
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 12 }}>
          Cross-project library at <code>&lt;userData&gt;/emitter-presets/</code>. Apply
          one and tweak from there. Frame range gets clamped to this animation's slot
          count so out-of-range presets don't break.
        </div>

        {loading ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            No presets yet. Built-ins should seed on first launch — restart if the
            list is empty unexpectedly.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {entries.map((entry) => (
              <PresetCell
                key={entry.name}
                entry={entry}
                selected={selected === entry.name}
                onClick={() => setSelected(selected === entry.name ? null : entry.name)}
                onDelete={() => handleDelete(entry.name)}
                sources={sources}
                getSource={getSource}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PresetCell({
  entry,
  selected,
  onClick,
  onDelete,
  sources,
  getSource,
}: {
  entry: PresetEntry;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}) {
  const e = entry.emitter;
  const frameLabel =
    e.endFrame !== undefined && e.endFrame !== e.startFrame
      ? `frames ${e.startFrame}–${e.endFrame}`
      : `frame ${e.startFrame}${e.endFrame === undefined ? ' (burst)' : ''}`;
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 8,
        background: selected ? 'rgba(106,169,255,0.15)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${selected ? '#6aa9ff' : 'var(--border)'}`,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <TextureThumbnail
        texture={e.config.texture}
        size={48}
        sources={sources}
        getSource={getSource}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={entry.name}
        >
          {entry.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {e.layer} · {frameLabel}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {e.config.blendMode} · qty {e.config.quantity} · freq {e.config.frequency}
        </div>
      </div>
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete();
        }}
        title="Delete preset"
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          padding: 0,
          fontSize: 11,
          lineHeight: 1,
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid var(--border)',
          color: '#e6e6ea',
          borderRadius: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}
