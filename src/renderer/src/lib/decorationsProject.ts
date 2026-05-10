import {
  migrateDecorationProject,
  type DecorationProject,
} from './decorations';
import { joinPath } from './platformProject';

/**
 * Decoration project file IO. Decorations live INSIDE the same folder as
 * a Platforms project — `decorations.json` sits alongside `platforms.json`,
 * sharing the same parent so a single drop into AscensionGame's
 * `assets/platforms/<theme>/` directory delivers both. Decorations
 * reference their PNGs via paths relative to that folder (e.g.
 * `decorations_sheets/level1_grass_5_6fps.png`).
 *
 * Decorations mode reuses the Platforms mode's project folder; opening
 * the Platforms project automatically loads decorations.json if it
 * exists. Saving the Platforms project writes both files.
 */

export const DECORATION_PROJECT_FILE = 'decorations.json';

export interface DecorationLoadResult {
  project: DecorationProject;
  /** Decoration id → blob URL of the source PNG. The Decorations UI
   *  uses these for thumbnails (sheet first frame via background-position
   *  cropping; singles direct). Cleared when the project unloads — the
   *  caller is responsible for revoking object URLs on cleanup. */
  thumbnails: Map<string, string>;
  /** Filenames that the manifest references but couldn't be read. */
  missing: string[];
}

/** Load decorations.json + the source PNGs. Returns null when the JSON
 *  is missing or invalid (the project folder probably doesn't have any
 *  decorations authored yet — caller can fall back to a default project). */
export async function loadDecorationProject(
  folderPath: string,
): Promise<DecorationLoadResult | null> {
  let jsonBytes: Uint8Array;
  try {
    jsonBytes = await window.api.readFile(joinPath(folderPath, DECORATION_PROJECT_FILE));
  } catch {
    return null;
  }
  const text = new TextDecoder().decode(jsonBytes);
  let parsed: DecorationProject;
  try {
    parsed = migrateDecorationProject(JSON.parse(text));
  } catch {
    return null;
  }
  const thumbnails = new Map<string, string>();
  const missing: string[] = [];
  for (const deco of parsed.decorations) {
    try {
      const bytes = await window.api.readFile(joinPath(folderPath, deco.filename));
      // Slice copy so the underlying ArrayBuffer isn't aliased between
      // the Uint8Array and the Blob — without this, the blob URL can
      // resolve to garbage when the source bytes get reused.
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      thumbnails.set(deco.id, URL.createObjectURL(blob));
    } catch {
      missing.push(deco.filename);
    }
  }
  return { project: parsed, thumbnails, missing };
}

/** Serialize the decoration project back to disk. Updates `savedAt` so
 *  the user can tell from the file when it was last touched. */
export async function saveDecorationProject(
  folderPath: string,
  project: DecorationProject,
): Promise<void> {
  const out: DecorationProject = {
    ...project,
    savedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(out, null, 2);
  const bytes = new TextEncoder().encode(text);
  await window.api.writeFile(joinPath(folderPath, DECORATION_PROJECT_FILE), bytes);
}

/** Revoke all blob URLs in a thumbnails map. Call on project unload to
 *  release memory — these blobs aren't garbage-collected automatically
 *  while the URL is alive. */
export function disposeThumbnails(thumbnails: Map<string, string>): void {
  for (const url of thumbnails.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best effort.
    }
  }
}
