import { useCallback, useEffect, useState } from 'react';
import type { ProcShape, TextureRef } from '../../../lib/builder';
import {
  addBytesToBank,
  deleteFromBank,
  listBank,
  type BankEntry,
} from '../../../lib/particles/bank';
import { computeCells } from '../../../lib/slicing';
import type { SourceMeta } from '../../../lib/sources';
import { TextureThumbnail } from './TextureThumbnail';

type SubTab = 'procedural' | 'bank' | 'projectSprite';

export interface TexturePickerProps {
  /** Title (typically the emitter's name being edited). */
  title?: string;
  initial: TextureRef;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  onCommit: (texture: TextureRef) => void;
  onClose: () => void;
}

/**
 * Full-tab texture picker with three sub-tabs. Each sub-tab maintains an
 * independent draft (procedural shape config / selected bank entry / selected
 * project sprite cell). Switching sub-tabs doesn't lose the others' drafts —
 * this lets the user compare three options before committing.
 *
 * Default sub-tab matches the kind of `initial`, so opening to edit an
 * already-set texture lands the user where they last were.
 */
export function TexturePicker({
  title,
  initial,
  sources,
  getSource,
  onCommit,
  onClose,
}: TexturePickerProps) {
  const [subTab, setSubTab] = useState<SubTab>(initialTab(initial));

  // Each sub-tab tracks its own draft so switching tabs doesn't reset state.
  const [procDraft, setProcDraft] = useState<{
    shape: ProcShape;
    size: number;
    softness: number;
  }>(() =>
    initial.kind === 'procedural'
      ? { shape: initial.shape, size: initial.size, softness: initial.softness }
      : { shape: 'circle', size: 8, softness: 0.6 },
  );
  const [bankDraft, setBankDraft] = useState<string | null>(
    initial.kind === 'bank' ? initial.name : null,
  );
  const [spriteDraft, setSpriteDraft] = useState<{
    sourceId: string;
    cellIndex: number;
  } | null>(
    initial.kind === 'projectSprite'
      ? { sourceId: initial.sourceId, cellIndex: initial.cellIndex }
      : null,
  );

  const draftTexture = buildDraftTexture(subTab, procDraft, bankDraft, spriteDraft);

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
        <button onClick={onClose} style={{ fontSize: 11 }} title="Discard and return">
          ← Back
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>
          Choose texture {title ? `for ${title}` : ''}
        </div>
        <button
          className="primary"
          onClick={() => draftTexture && onCommit(draftTexture)}
          disabled={!draftTexture}
          style={{ fontSize: 11 }}
          title={!draftTexture ? 'Pick a texture in this sub-tab first' : undefined}
        >
          Use this texture
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 16px',
          background: 'var(--panel-hi)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {(['procedural', 'bank', 'projectSprite'] as const).map((t) => (
          <button
            key={t}
            className={subTab === t ? 'primary' : ''}
            onClick={() => setSubTab(t)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            {t === 'projectSprite' ? 'Project sprite' : t === 'bank' ? 'Bank' : 'Procedural'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {subTab === 'procedural' ? (
          <ProceduralPanel draft={procDraft} onChange={setProcDraft} />
        ) : subTab === 'bank' ? (
          <BankPanel selected={bankDraft} onSelect={setBankDraft} />
        ) : (
          <ProjectSpritePanel
            sources={sources}
            getSource={getSource}
            selected={spriteDraft}
            onSelect={setSpriteDraft}
          />
        )}
      </div>
    </div>
  );
}

function initialTab(t: TextureRef): SubTab {
  if (t.kind === 'procedural') return 'procedural';
  if (t.kind === 'bank') return 'bank';
  return 'projectSprite';
}

function buildDraftTexture(
  subTab: SubTab,
  proc: { shape: ProcShape; size: number; softness: number },
  bank: string | null,
  sprite: { sourceId: string; cellIndex: number } | null,
): TextureRef | null {
  if (subTab === 'procedural') return { kind: 'procedural', ...proc };
  if (subTab === 'bank') return bank ? { kind: 'bank', name: bank } : null;
  return sprite ? { kind: 'projectSprite', ...sprite } : null;
}

// ---- Procedural sub-tab -------------------------------------------------

function ProceduralPanel({
  draft,
  onChange,
}: {
  draft: { shape: ProcShape; size: number; softness: number };
  onChange: (d: { shape: ProcShape; size: number; softness: number }) => void;
}) {
  const shapes: ProcShape[] = ['circle', 'square', 'diamond', 'triangle', 'star'];
  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 360px' }}>
        <label>Shape</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {shapes.map((s) => (
            <button
              key={s}
              className={draft.shape === s ? 'primary' : ''}
              onClick={() => onChange({ ...draft, shape: s })}
              style={{ flex: 1, fontSize: 11, textTransform: 'capitalize' }}
            >
              {s}
            </button>
          ))}
        </div>
        <label style={{ marginTop: 8 }}>Size: {draft.size}px</label>
        <input
          type="range"
          min={2}
          max={32}
          step={1}
          value={draft.size}
          onChange={(e) => onChange({ ...draft, size: Number(e.target.value) })}
        />
        <label style={{ marginTop: 4 }}>Softness: {draft.softness.toFixed(2)}</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={draft.softness}
          onChange={(e) => onChange({ ...draft, softness: Number(e.target.value) })}
        />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
          Procedural textures are built at runtime from primitives — no PNG
          shipped with the export. Hard edges (softness 0) read crisp at
          small sizes; soft variants (≥0.5) look like glows or smoke puffs.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <label>Preview</label>
        <TextureThumbnail
          texture={{ kind: 'procedural', ...draft }}
          size={96}
        />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {draft.shape} · {draft.size}px · soft {draft.softness.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

// ---- Bank sub-tab -------------------------------------------------------

function BankPanel({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listBank());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importPng = useCallback(async () => {
    const paths = await window.api.openImagePaths();
    if (paths.length === 0) return;
    for (const p of paths) {
      // Filename minus extension, sanitized inside addBytesToBank.
      const base =
        p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'imported';
      const bytes = await window.api.readFile(p);
      // Convert Uint8Array view to a clean ArrayBuffer the writer can handle
      // without leaking the renderer's larger underlying buffer.
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await addBytesToBank(base, buf);
    }
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!confirm(`Delete bank texture "${name}"?\n\nThis only removes it from the bank — projects already using it keep their reference but will fall back to a default until re-set.`)) {
        return;
      }
      await deleteFromBank(name);
      if (selected === name) onSelect(null);
      await refresh();
    },
    [refresh, selected, onSelect],
  );

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ marginBottom: 0, flex: 1 }}>
          Bank ({entries.length}) {loading ? '…' : ''}
        </label>
        <button onClick={importPng} style={{ fontSize: 11 }}>
          Import PNG…
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Cross-project library at <code>&lt;userData&gt;/texture-bank/</code>. Click a
        thumbnail to select; "Use this texture" commits.
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Bank is empty. Import a PNG above, or restart the app to seed built-ins.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
          }}
        >
          {entries.map((e) => (
            <BankCell
              key={e.name}
              entry={e}
              selected={selected === e.name}
              onClick={() => onSelect(selected === e.name ? null : e.name)}
              onDelete={() => handleDelete(e.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BankCell({
  entry,
  selected,
  onClick,
  onDelete,
}: {
  entry: BankEntry;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 6,
        background: selected ? 'rgba(106,169,255,0.15)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${selected ? '#6aa9ff' : 'var(--border)'}`,
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <TextureThumbnail texture={{ kind: 'bank', name: entry.name }} size={64} />
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
        title={entry.name}
      >
        {entry.name}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete from bank"
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          padding: 0,
          fontSize: 10,
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

// ---- Project sprite sub-tab --------------------------------------------

function ProjectSpritePanel({
  sources,
  getSource,
  selected,
  onSelect,
}: {
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selected: { sourceId: string; cellIndex: number } | null;
  onSelect: (s: { sourceId: string; cellIndex: number } | null) => void;
}) {
  if (sources.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 11, color: 'var(--text-dim)' }}>
        No project sources loaded. Import sheets via the left-edge sources column to
        pick a sprite as a particle texture.
      </div>
    );
  }
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Pick any cell from a loaded sheet. The exported config will reference it by
        source filename + cell index, and the runtime can either copy the cell into
        a particle texture at load time or just reuse the loaded atlas frame.
      </div>
      {sources.map((src) => (
        <ProjectSpriteSourceRow
          key={src.id}
          source={src}
          getSource={getSource}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function ProjectSpriteSourceRow({
  source,
  getSource,
  selected,
  onSelect,
}: {
  source: SourceMeta;
  getSource: (id: string | null) => ImageData | null;
  selected: { sourceId: string; cellIndex: number } | null;
  onSelect: (s: { sourceId: string; cellIndex: number } | null) => void;
}) {
  const cells = computeCells(source.slice, source.width, source.height);
  if (cells.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-dim)' }}>
          {source.filename}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingLeft: 12 }}>
          No cells — slice this source first in Slice mode.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-dim)' }}>
        {source.filename} <span style={{ opacity: 0.6 }}>({cells.length})</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
          gap: 4,
        }}
      >
        {cells.map((_, i) => {
          const isSel = selected?.sourceId === source.id && selected?.cellIndex === i;
          return (
            <div
              key={i}
              onClick={() =>
                onSelect(isSel ? null : { sourceId: source.id, cellIndex: i })
              }
              style={{
                padding: 4,
                background: isSel ? 'rgba(106,169,255,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSel ? '#6aa9ff' : 'var(--border)'}`,
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <TextureThumbnail
                texture={{ kind: 'projectSprite', sourceId: source.id, cellIndex: i }}
                size={56}
                sources={[source]}
                getSource={getSource}
              />
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'monospace',
                  color: isSel ? '#6aa9ff' : 'var(--text-dim)',
                  marginTop: 2,
                }}
              >
                #{i}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
