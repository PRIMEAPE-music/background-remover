export type ViewMode = 'remove' | 'select' | 'slice' | 'builder';

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
        {(['remove', 'select', 'slice', 'builder'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'primary' : ''}
            onClick={() => onModeChange(m)}
            style={{ textTransform: 'capitalize' }}
            // Builder is always reachable so the user can open a saved
            // project without having to load a sheet first. The three
            // editing modes still gate on an active source.
            disabled={m !== 'builder' && !hasImage}
            title={
              m !== 'builder' && !hasImage
                ? 'Load a sheet first (drop one or click "Open image…")'
                : undefined
            }
          >
            {m === 'remove'
              ? 'Remove BG'
              : m === 'select'
                ? 'Select + Move'
                : m === 'slice'
                  ? 'Slice'
                  : 'Builder'}
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
