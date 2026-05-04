import { useMemo } from 'react';
import type { BuilderState, SelectedCell } from '../../lib/builder';
import { computeCells, type Rect } from '../../lib/slicing';
import type { SourceMeta } from '../../lib/sources';
import { GalleryThumb } from '../GalleryThumb';

export interface GalleryPaneProps {
  state: BuilderState;
  onStateChange: (s: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
  selected: SelectedCell | null;
  onSelect: (c: SelectedCell | null) => void;
}

/**
 * Sprite pool — the gallery of every loaded source's cells, grouped by source.
 * Lives as the leftmost column inside builder mode. Width is fixed so the
 * builder layout can put the dock under just the strip pane (not under the
 * gallery), keeping the gallery readable as a full-height column.
 */
export function GalleryPane({
  state,
  onStateChange,
  sources,
  getSource,
  selected,
  onSelect,
}: GalleryPaneProps) {
  // Don't mutate the input array; the upstream sources order is meaningful
  // (load order shown in the left edge sidebar).
  const displaySources = state.gallerySortByName
    ? [...sources].sort((a, b) =>
        a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()),
      )
    : sources;

  const collapsedSet = new Set(state.collapsedSources);
  const isCollapsed = (id: string) => collapsedSet.has(id);
  const toggleCollapsed = (id: string) => {
    const next = new Set(collapsedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onStateChange({ ...state, collapsedSources: [...next] });
  };
  // "Minimize all" if any are open; "Expand all" if all are already collapsed.
  const allCollapsed =
    sources.length > 0 && sources.every((s) => collapsedSet.has(s.id));
  const toggleAll = () => {
    onStateChange({
      ...state,
      collapsedSources: allCollapsed ? [] : sources.map((s) => s.id),
    });
  };
  const toggleSort = () => {
    onStateChange({ ...state, gallerySortByName: !state.gallerySortByName });
  };

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flex: 1 }}>
          Sprite pool
        </div>
        <button
          onClick={toggleSort}
          className={state.gallerySortByName ? 'primary' : ''}
          disabled={sources.length === 0}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={state.gallerySortByName ? 'Sorted A→Z (click to revert)' : 'Sort sources alphabetically'}
        >
          A→Z
        </button>
        <button
          onClick={toggleAll}
          disabled={sources.length === 0}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={allCollapsed ? 'Expand all sources' : 'Minimize all sources'}
        >
          {allCollapsed ? 'Expand all' : 'Minimize all'}
        </button>
      </div>
      {sources.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Load sheets from the left-edge sources column first.
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Click a sprite to select it, then click an empty slot in the strip to
        place it there. Click a placed slot to focus it (arrows nudge
        Y-offset). Right-click a placed slot to clear it.
      </div>
      {displaySources.map((s) => (
        <SourceRow
          key={s.id}
          source={s}
          getSource={getSource}
          selected={selected}
          onSelect={onSelect}
          collapsed={isCollapsed(s.id)}
          onToggleCollapsed={() => toggleCollapsed(s.id)}
        />
      ))}
    </aside>
  );
}

function SourceRow({
  source,
  getSource,
  selected,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: {
  source: SourceMeta;
  getSource: (id: string | null) => ImageData | null;
  selected: SelectedCell | null;
  onSelect: (c: SelectedCell | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const open = !collapsed;
  const cells: Rect[] = useMemo(
    () => computeCells(source.slice, source.width, source.height),
    [source.slice, source.width, source.height],
  );
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={onToggleCollapsed}
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
        <span style={{ fontFamily: 'monospace', fontSize: 11, width: 10 }}>{open ? '▾' : '▸'}</span>
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
      {open && cells.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
            gap: 4,
          }}
        >
          {cells.map((r, i) => {
            const isSel = selected?.sourceId === source.id && selected?.cellIndex === i;
            return (
              <GalleryThumb
                key={i}
                sourceId={source.id}
                sourceVersion={source.version}
                rect={r}
                getSource={getSource}
                selected={isSel}
                onClick={() =>
                  onSelect(isSel ? null : { sourceId: source.id, cellIndex: i })
                }
              />
            );
          })}
        </div>
      )}
      {open && cells.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingLeft: 18 }}>
          No cells — slice this source first.
        </div>
      )}
    </section>
  );
}
