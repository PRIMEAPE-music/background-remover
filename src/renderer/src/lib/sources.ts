import { DEFAULT_SLICE, type Rect, type SliceConfig } from './slicing';
import type { Point } from './lasso';

/**
 * Runtime payload for a source — the big pixel buffers and derived caches that
 * must NEVER be held in React state. Stored in a ref-keyed Map.
 */
export interface SourceRuntime {
  image: ImageData;
  history: ImageData[];
  /**
   * Redo stack — populated when an edit is undone, drained when redone, and
   * cleared whenever a fresh edit happens (the standard undo/redo invalidation
   * rule, enforced inside `pushHistory`).
   */
  future: ImageData[];
  liftSnapshot: ImageData | null;
  floater: ImageData | null;
}

/**
 * Cheap metadata for a source — fine to keep in React state and drive UI from.
 * `version` bumps whenever `image` bytes change.
 */
export interface SourceMeta {
  id: string;
  filepath: string;
  filename: string;
  width: number;
  height: number;
  version: number;
  historyLen: number;
  futureLen: number;
  slice: SliceConfig;
  selectedCellIndex: number | null;
  selectionRect: Rect | null;
  lassoPolygon: Point[] | null;
  selectionOffset: { x: number; y: number } | null;
  selectionConfirmed: boolean;
  hasFloater: boolean;
  hasLiftSnapshot: boolean;
}

export function makeSourceMeta(params: {
  id: string;
  filepath: string;
  filename: string;
  image: ImageData;
  version: number;
}): SourceMeta {
  return {
    id: params.id,
    filepath: params.filepath,
    filename: params.filename,
    width: params.image.width,
    height: params.image.height,
    version: params.version,
    historyLen: 0,
    futureLen: 0,
    slice: { ...DEFAULT_SLICE, overrides: {} },
    selectedCellIndex: null,
    selectionRect: null,
    lassoPolygon: null,
    selectionOffset: null,
    selectionConfirmed: false,
    hasFloater: false,
    hasLiftSnapshot: false,
  };
}

export function makeSourceRuntime(image: ImageData): SourceRuntime {
  return {
    image,
    history: [],
    future: [],
    liftSnapshot: null,
    floater: null,
  };
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function newSourceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
