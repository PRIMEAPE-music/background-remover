import { DEFAULT_NORMALIZE, DEFAULT_SLICE, type SliceConfig } from './slicing';

export interface SavedPreset {
  name: string;
  config: SliceConfig;
}

const KEY = 'bg-remover:slice-presets';

/** Backfill any missing fields so presets saved by older versions still load. */
function migrateConfig(c: Partial<SliceConfig>): SliceConfig {
  return {
    mode: c.mode ?? DEFAULT_SLICE.mode,
    grid: { ...DEFAULT_SLICE.grid, ...(c.grid ?? {}) },
    guides: { ...DEFAULT_SLICE.guides, ...(c.guides ?? {}) },
    boxes: { rects: c.boxes?.rects ?? [] },
    overrides: c.overrides ?? {},
    normalize: { ...DEFAULT_NORMALIZE, ...(c.normalize ?? {}) },
  };
}

export function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p: { name: string; config: Partial<SliceConfig> }) => ({
      name: p.name,
      config: migrateConfig(p.config ?? {}),
    }));
  } catch {
    return [];
  }
}

export function savePresets(presets: SavedPreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(presets));
}
