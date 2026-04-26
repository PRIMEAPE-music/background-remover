export type ViewMode = 'remove' | 'select' | 'slice' | 'builder' | 'generate';

export interface ToolbarProps {
  filename: string | null;
  hasImage: boolean;
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  onOpen: () => void;
  onSave: () => void;
}

export function Toolbar({ filename, hasImage, mode, onModeChange, onOpen, onSave }: ToolbarProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
      }}
    >
      <strong style={{ fontSize: 13, marginRight: 8 }}>Background Remover</strong>
      <button onClick={onOpen}>Open image…</button>
      <button onClick={onSave} disabled={!hasImage} className="primary">
        Save PNG…
      </button>

      <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 6px' }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {(['remove', 'select', 'slice', 'builder', 'generate'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'primary' : ''}
            onClick={() => onModeChange(m)}
            style={{ textTransform: 'capitalize' }}
            // Builder + Generate are always reachable: Builder loads saved
            // projects without a sheet, and Generate produces images from
            // scratch. The three editing modes still gate on an active source.
            disabled={m !== 'builder' && m !== 'generate' && !hasImage}
            title={
              m !== 'builder' && m !== 'generate' && !hasImage
                ? 'Load a sheet first (drop one or click "Open image…")'
                : undefined
            }
          >
            {m === 'remove'
              ? 'Color'
              : m === 'select'
                ? 'Transform'
                : m === 'slice'
                  ? 'Slice'
                  : m === 'builder'
                    ? 'Builder'
                    : 'Generate'}
          </button>
        ))}
      </div>

      <div
        style={{
          marginLeft: 'auto',
          fontSize: 12,
          color: 'var(--text-dim)',
          maxWidth: 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {filename ?? 'No image loaded'}
      </div>
    </header>
  );
}
