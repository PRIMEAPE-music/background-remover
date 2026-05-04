import { imageDataToPngBytes, loadImageFromBytes } from './image-utils';
import {
  migratePlatformProject,
  type PlatformAsset,
  type PlatformProject,
} from './platforms';

/**
 * Disk layout for a Platforms project folder:
 *
 *   <folder>/
 *     platforms.json                    <- this file IS the manifest
 *     standard_depths_01.png            <- one PNG per asset
 *     breakable_depths_01.png
 *     slope_left_depths_01.png
 *     ...
 *
 * The folder is self-contained — both bg-remover and AscensionGame read it
 * directly with no separate "export" step. Drop the folder into
 * `AscensionGame/public/assets/platforms/<theme>/` and the runtime picks it
 * up on next launch.
 */

export const PLATFORM_PROJECT_FILE = 'platforms.json';

export function joinPath(folder: string, filename: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + filename : `${folder}${sep}${filename}`;
}

/** Return the parent-directory portion of a path. Mirrors `path.dirname`
 *  using string ops only (renderer doesn't ship Node's `path` module). */
export function dirnameOf(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const trimmed = filePath.endsWith(sep) ? filePath.slice(0, -1) : filePath;
  const idx = trimmed.lastIndexOf(sep);
  if (idx < 0) return trimmed;
  return trimmed.slice(0, idx);
}

/**
 * Locate a project folder starting from `root`:
 *   1. If `root/platforms.json` exists → return `root`.
 *   2. Otherwise list immediate subdirs and return the first that contains
 *      `platforms.json`. Lets the user pick a parent folder OR a renamed
 *      project folder and have the loader find the project either way.
 *
 * Returns null when no project is found within one level.
 */
export async function findPlatformProjectFolder(root: string): Promise<string | null> {
  if (await window.api.pathExists(joinPath(root, PLATFORM_PROJECT_FILE))) {
    return root;
  }
  const entries = await window.api.listDir(root);
  for (const entry of entries) {
    const candidate = joinPath(root, entry);
    if (await window.api.pathExists(joinPath(candidate, PLATFORM_PROJECT_FILE))) {
      return candidate;
    }
  }
  return null;
}

export function sanitizeFolderName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 64) || 'platforms'
  );
}

export function folderBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] || 'platforms';
}

export interface SaveAssetInput {
  asset: PlatformAsset;
  /** ImageData for the asset's PNG; encoded to PNG bytes at save time. */
  image: ImageData;
}

export interface SaveInput {
  name: string;
  folderPath: string;
  assets: SaveAssetInput[];
}

export interface SaveResult {
  /** The folder the project was actually written into (may be a subfolder of `folderPath`). */
  projectFolder: string;
  /** Filenames of every asset written. */
  assetFilenames: string[];
}

/**
 * Write a Platforms project to disk. Each asset gets its own PNG file
 * (re-encoded from ImageData each time; cheap relative to the slicing work
 * the user already did). The manifest is written last so a partial save
 * doesn't produce a manifest pointing at missing files.
 */
export async function savePlatformProject(
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

  // Resolve filename collisions (multiple assets that ended up with the same
  // name after sanitization). The user can override filenames in Slice 2's
  // metadata UI; this is just a safety net.
  const assetFilenames: string[] = [];
  const usedNames = new Set<string>();
  const updatedAssets: PlatformAsset[] = [];
  for (const { asset, image } of input.assets) {
    let name = asset.filename || `${asset.type.toLowerCase()}_${asset.biome.toLowerCase()}.png`;
    if (!/\.png$/i.test(name)) name = `${name}.png`;
    if (usedNames.has(name)) {
      const base = name.replace(/\.png$/i, '');
      let suffix = 2;
      while (usedNames.has(`${base}_${suffix}.png`)) suffix++;
      name = `${base}_${suffix}.png`;
    }
    usedNames.add(name);
    const bytes = await imageDataToPngBytes(image);
    await window.api.writeFile(joinPath(projectFolder, name), bytes);
    assetFilenames.push(name);
    updatedAssets.push({ ...asset, filename: name, width: image.width, height: image.height });
  }

  const payload: PlatformProject = {
    name: input.name,
    savedAt: new Date().toISOString(),
    assets: updatedAssets,
  };
  const text = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(text);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await window.api.writeFile(joinPath(projectFolder, PLATFORM_PROJECT_FILE), buf);

  return { projectFolder, assetFilenames };
}

export interface LoadResult {
  project: PlatformProject;
  /** Asset id → decoded ImageData. Assets whose PNG file is missing are
   *  excluded from the map and listed in `missing`. */
  assetImages: Map<string, ImageData>;
  missing: string[];
}

export async function loadPlatformProject(folderPath: string): Promise<LoadResult | null> {
  let jsonBytes: Uint8Array;
  try {
    jsonBytes = await window.api.readFile(joinPath(folderPath, PLATFORM_PROJECT_FILE));
  } catch {
    return null;
  }
  const text = new TextDecoder().decode(jsonBytes);
  let parsed: PlatformProject;
  try {
    parsed = migratePlatformProject(JSON.parse(text));
  } catch {
    return null;
  }
  const assetImages = new Map<string, ImageData>();
  const missing: string[] = [];
  for (const asset of parsed.assets) {
    try {
      const bytes = await window.api.readFile(joinPath(folderPath, asset.filename));
      const img = await loadImageFromBytes(bytes, 'image/png');
      assetImages.set(asset.id, img);
    } catch {
      missing.push(asset.filename);
    }
  }
  return { project: parsed, assetImages, missing };
}

// ---- Recent folders -----------------------------------------------------

const RECENT_KEY = 'platformsProjects:recentFolders';
const MAX_RECENT = 8;

export interface RecentPlatformFolder {
  path: string;
  name: string;
  at: string;
}

export function listRecentPlatformFolders(): RecentPlatformFolder[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentPlatformFolder(path: string, name: string): void {
  const now = new Date().toISOString();
  const existing = listRecentPlatformFolders().filter((e) => e.path !== path);
  const next = [{ path, name, at: now }, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignored
  }
}

export function removeRecentPlatformFolder(path: string): void {
  const next = listRecentPlatformFolders().filter((e) => e.path !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignored
  }
}
