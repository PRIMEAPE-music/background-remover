import type { GeminiAspect, GeminiSize } from '../../../preload';

export const ASPECT_OPTIONS: GeminiAspect[] = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
  'auto',
];

export const SIZE_OPTIONS: GeminiSize[] = ['1K', '2K', '4K'];

export interface PromptRow {
  id: string;
  /** User-entered base name; e.g. "character_walk". */
  name: string;
  prompt: string;
  /** How many images to generate from this row. ≥1. */
  count: number;
}

export type RowStatus =
  | { kind: 'idle' }
  | { kind: 'queued'; total: number }
  | { kind: 'running'; total: number; done: number; jobId: string }
  | { kind: 'done'; total: number; saved: string[] }
  | { kind: 'failed'; reason: string; partial?: string[] }
  | { kind: 'cancelled'; partial?: string[] };

export interface GeneratedImage {
  /** Full path to the PNG on disk. */
  path: string;
  /** Bare filename (no folder). */
  filename: string;
}

const SAFE_NAME_RE = /[\\/:*?"<>|]+/g;

/** Strip filesystem-illegal characters and collapse whitespace. */
export function sanitizeFilename(name: string): string {
  return name.replace(SAFE_NAME_RE, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 80);
}

/**
 * Pick the next non-colliding filename for a generated image.
 *
 * Naming rules:
 *  - First image of a multi-image batch (or single): `name.png`
 *  - Subsequent images in a same-prompt batch: `name2.png`, `name3.png`, ...
 *  - Across separate runs that collide: append `_2`, `_3`, ... before .png,
 *    matching projectFolder.ts conventions.
 */
export function pickFilename(
  baseName: string,
  indexInBatch: number,
  totalInBatch: number,
  existing: Set<string>,
): string {
  const safe = sanitizeFilename(baseName) || 'image';
  // Within a same-prompt batch: 1st image is bare name, 2nd onward gets a number.
  let candidate = totalInBatch === 1 || indexInBatch === 0 ? safe : `${safe}${indexInBatch + 1}`;
  let target = `${candidate}.png`;
  if (!existing.has(target.toLowerCase())) return target;
  // Collision with a pre-existing file → append _2, _3, ...
  let suffix = 2;
  while (existing.has(`${candidate}_${suffix}.png`.toLowerCase())) suffix++;
  return `${candidate}_${suffix}.png`;
}

export function joinPath(folder: string, filename: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + filename : `${folder}${sep}${filename}`;
}

/** Basename without extension. */
export function stem(filename: string): string {
  return filename.replace(/\.png$/i, '');
}

const KEY_LOCAL_FOLDER = 'generate:defaultFolder';

export function getDefaultFolder(): string | null {
  try {
    return localStorage.getItem(KEY_LOCAL_FOLDER);
  } catch {
    return null;
  }
}

export function setDefaultFolder(folder: string | null): void {
  try {
    if (folder) localStorage.setItem(KEY_LOCAL_FOLDER, folder);
    else localStorage.removeItem(KEY_LOCAL_FOLDER);
  } catch {
    // ignore
  }
}
