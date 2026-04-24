import { migrateBuilderState, type BuilderState } from './builder';
import type { DistanceMode } from './bg-removal';
import type { RGB } from './color';
import { imageDataToPngBytes, loadImageFromBytes } from './image-utils';
import type { SliceConfig } from './slicing';

/**
 * Disk layout for a character project folder:
 *
 *   CharacterFolder/
 *     project.spriteproj.json
 *     <source0>.png    <- PNG copies of each loaded sheet (with edits baked in)
 *     <source1>.png
 *     ...
 *
 * The JSON references each sheet by its filename (relative to the folder),
 * so the whole folder can be moved without breaking the project.
 */
export const PROJECT_FILE = 'project.spriteproj.json';

export interface FolderProjectSource {
  /**
   * Stable source id (matches runtime sourceId). Preserved across save/load
   * so animation slots can still resolve their {sourceId, cellIndex} refs.
   */
  id: string;
  /** Filename within the project folder. */
  filename: string;
  slice: SliceConfig;
}

export interface FolderProject {
  name: string;
  savedAt: string;
  sources: FolderProjectSource[];
  builder: BuilderState;
  pickedColor: RGB | null;
  tolerance: number;
  distanceMode: DistanceMode;
  floodFill: boolean;
}

export interface SaveInput {
  name: string;
  folderPath: string;
  sources: Array<{ id: string; filename: string; image: ImageData; slice: SliceConfig }>;
  builder: BuilderState;
  pickedColor: RGB | null;
  tolerance: number;
  distanceMode: DistanceMode;
  floodFill: boolean;
}

/** Join two path segments, handling both separator styles. */
export function joinPath(folder: string, filename: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + filename : `${folder}${sep}${filename}`;
}

/** Derive a safe filename for a source within the project folder. */
export function safeSourceFilename(originalName: string, idx: number): string {
  const base = originalName.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || `source_${idx}`;
  return `${base}.png`;
}

/** Basename of a folder path — used as a default project name when saving. */
export function folderBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] || 'character';
}

export interface SaveResult {
  /** The actual folder the project was written into (a subfolder of the chosen one). */
  projectFolder: string;
  /** Filenames written inside the project folder. */
  sourceFilenames: string[];
}

/** Basic sanitizer so a user-entered name can safely become a folder name. */
export function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 64) ||
    'character';
}

/**
 * Write a project folder to disk. Creates a `<project-name>/` subfolder
 * inside the user-chosen parent folder and writes `project.spriteproj.json`
 * plus PNG copies of every loaded sheet into it. If `isProjectFolderItself`
 * is true (used on re-save when we already know the exact target), we skip
 * the subfolder nesting.
 */
export async function saveProjectFolder(
  input: SaveInput,
  options: { nestInSubfolder?: boolean } = {},
): Promise<SaveResult> {
  const nest = options.nestInSubfolder ?? true;
  const projectFolder = nest
    ? joinPath(input.folderPath, sanitizeFolderName(input.name))
    : input.folderPath;
  if (nest) {
    await window.api.mkdir(projectFolder);
  }

  const writtenNames: string[] = [];
  const projectSources: FolderProjectSource[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < input.sources.length; i++) {
    const src = input.sources[i];
    let name = safeSourceFilename(src.filename, i);
    if (usedNames.has(name)) {
      const base = name.replace(/\.png$/, '');
      let suffix = 2;
      while (usedNames.has(`${base}_${suffix}.png`)) suffix++;
      name = `${base}_${suffix}.png`;
    }
    usedNames.add(name);
    const bytes = await imageDataToPngBytes(src.image);
    await window.api.writeFile(joinPath(projectFolder, name), bytes);
    writtenNames.push(name);
    projectSources.push({ id: src.id, filename: name, slice: src.slice });
  }
  const payload: FolderProject = {
    name: input.name,
    savedAt: new Date().toISOString(),
    sources: projectSources,
    builder: input.builder,
    pickedColor: input.pickedColor,
    tolerance: input.tolerance,
    distanceMode: input.distanceMode,
    floodFill: input.floodFill,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const buf = jsonBytes.buffer.slice(
    jsonBytes.byteOffset,
    jsonBytes.byteOffset + jsonBytes.byteLength,
  ) as ArrayBuffer;
  await window.api.writeFile(joinPath(projectFolder, PROJECT_FILE), buf);
  return { projectFolder, sourceFilenames: writtenNames };
}

export interface LoadedSource {
  id: string;
  filepath: string;
  filename: string;
  image: ImageData;
  slice: SliceConfig;
}

export interface LoadResult {
  project: FolderProject;
  sources: LoadedSource[];
  missing: string[];
}

/** Read and parse a project folder. Returns sources with their re-loaded ImageData. */
export async function loadProjectFolder(folderPath: string): Promise<LoadResult | null> {
  let jsonBytes: Uint8Array;
  try {
    jsonBytes = await window.api.readFile(joinPath(folderPath, PROJECT_FILE));
  } catch {
    return null;
  }
  const text = new TextDecoder().decode(jsonBytes);
  let parsed: FolderProject;
  try {
    parsed = JSON.parse(text) as FolderProject;
  } catch {
    return null;
  }
  parsed.builder = migrateBuilderState(parsed.builder);
  const sources: LoadedSource[] = [];
  const missing: string[] = [];
  for (const src of parsed.sources ?? []) {
    const full = joinPath(folderPath, src.filename);
    try {
      const bytes = await window.api.readFile(full);
      const ext = src.filename.split('.').pop()?.toLowerCase();
      const mime =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'bmp'
              ? 'image/bmp'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/png';
      const image = await loadImageFromBytes(bytes, mime);
      // Fallback id for pre-id projects: derive from filename so re-saving
      // keeps it stable on subsequent loads.
      const id = src.id ?? `legacy:${src.filename}`;
      sources.push({ id, filepath: full, filename: src.filename, image, slice: src.slice });
    } catch {
      missing.push(src.filename);
    }
  }
  return { project: parsed, sources, missing };
}

// Recent folders — kept in localStorage so the user can re-open quickly.
const RECENT_KEY = 'projects:recentFolders';
const MAX_RECENT = 8;

export function listRecentFolders(): Array<{ path: string; name: string; at: string }> {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(path: string, name: string): void {
  const now = new Date().toISOString();
  const existing = listRecentFolders().filter((e) => e.path !== path);
  const next = [{ path, name, at: now }, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignored
  }
}

export function removeRecentFolder(path: string): void {
  const next = listRecentFolders().filter((e) => e.path !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignored
  }
}
