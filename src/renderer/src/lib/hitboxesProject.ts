import {
  migrateHitboxProject,
  type HitboxEntity,
  type HitboxProject,
  type HitboxSheet,
} from "./hitboxes";
import { joinPath, dirnameOf } from "./platformProject";

/** Last segment of a path (cross-platform handling for both / and \). */
function basenameOf(p: string): string {
  const sep = p.lastIndexOf("/");
  const winSep = p.lastIndexOf("\\");
  const idx = Math.max(sep, winSep);
  return idx >= 0 ? p.slice(idx + 1) : p;
}
import { loadImageFromBytes } from "./image-utils";

/**
 * Hitbox project file IO + sprite-sheet discovery.
 *
 * One project = one folder on disk:
 *   - `hitboxes.json` at the root holds the manifest.
 *   - Sprite sheets matching `*_<fps>fps.png` (same convention as
 *     decorations) live in the folder OR in subfolders. Each sheet's
 *     filename is stored relative to the project root so paths stay
 *     stable when the folder is dragged into AscensionGame.
 *
 * The Hitboxes mode targets a single entity per folder (typically a
 * character / enemy / boss). The schema supports multiple entities for
 * future use; the current UI exposes the first entity, falling back
 * to a folder-name-derived default when the manifest is empty.
 */

export const HITBOX_PROJECT_FILE = "hitboxes.json";

const SHEET_RE = /^(.+?)_(\d+)fps\.png$/i;

export interface HitboxLoadResult {
  project: HitboxProject;
  /** Sheet filename (relative to project folder) → blob URL of the
   *  PNG. The view renders the sheet in a canvas; blob URLs survive
   *  reloads of just the renderer process. Caller revokes via
   *  `disposeSheetUrls`. */
  sheetUrls: Map<string, string>;
  /** Filenames the manifest references but couldn't be read. */
  missing: string[];
}

/** Load `<folder>/hitboxes.json` if present. Returns null when the
 *  file is missing OR doesn't parse — caller can fall back to
 *  building a fresh project from the folder via `discoverSheets`. */
export async function loadHitboxProject(
  folderPath: string,
): Promise<HitboxLoadResult | null> {
  let bytes: Uint8Array;
  try {
    bytes = await window.api.readFile(
      joinPath(folderPath, HITBOX_PROJECT_FILE),
    );
  } catch {
    return null;
  }
  let parsed: HitboxProject;
  try {
    parsed = migrateHitboxProject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
  const { sheetUrls, missing } = await loadSheetUrls(folderPath, parsed);
  return { project: parsed, sheetUrls, missing };
}

/** Save the project back to `<folder>/hitboxes.json`. Updates `savedAt`
 *  so the user can tell from the file when it was last touched. */
export async function saveHitboxProject(
  folderPath: string,
  project: HitboxProject,
): Promise<void> {
  const out: HitboxProject = {
    ...project,
    savedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(out, null, 2);
  await window.api.writeFile(
    joinPath(folderPath, HITBOX_PROJECT_FILE),
    new TextEncoder().encode(text),
  );
}

/** Free every blob URL in the map. Call on unload. */
export function disposeSheetUrls(map: Map<string, string>): void {
  for (const url of map.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // best effort
    }
  }
}

/** Build a fresh project from the contents of `folderPath`:
 *    - Entity id = folder basename (e.g. "newborn").
 *    - Sheets = every `*_<fps>fps.png` found in the folder root and
 *      one level of subfolders, with frame width inferred from the
 *      image height (square frames assumed; non-square sheets need
 *      manual fixup in the inspector).
 *
 *  Used when the user opens a folder that doesn't yet have a
 *  hitboxes.json, OR by `Re-scan` to pick up newly added sheets
 *  while preserving authored values.
 *
 *  When `existing` is provided, preserves any entity / sheet entries
 *  already present, only adding newly-discovered sheets. */
export async function discoverSheets(
  folderPath: string,
  existing?: HitboxProject,
): Promise<HitboxLoadResult> {
  const entityId =
    existing?.entities[0]?.id ?? basenameOf(folderPath) ?? "entity";
  const discovered: Array<{
    filename: string;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
  }> = [];

  const scanDir = async (absDir: string, prefix: string) => {
    let pngs: string[] = [];
    try {
      const entries = await window.api.listDir(absDir);
      pngs = entries.filter((e) => e.toLowerCase().endsWith(".png"));
    } catch {
      return;
    }
    for (const png of pngs) {
      const m = png.match(SHEET_RE);
      if (!m) continue;
      const dims = await readPngDims(joinPath(absDir, png));
      if (!dims) continue;
      // Square frames assumption — frameSize = imageHeight, count = width / size.
      const frameSize = dims.h;
      const frameCount = Math.max(1, Math.floor(dims.w / Math.max(1, frameSize)));
      discovered.push({
        filename: prefix ? `${prefix}/${png}` : png,
        frameWidth: frameSize,
        frameHeight: frameSize,
        frameCount,
      });
    }
  };

  await scanDir(folderPath, "");
  // Scan one level deep for subfolders (e.g. when the user points at a
  // sprites/ root that holds <character>/ subdirs).
  let subdirs: string[] = [];
  try {
    const entries = await window.api.listDir(folderPath);
    for (const name of entries) {
      const sub = joinPath(folderPath, name);
      if (await isDir(sub)) subdirs.push(name);
    }
  } catch {
    subdirs = [];
  }
  for (const sub of subdirs) {
    await scanDir(joinPath(folderPath, sub), sub);
  }

  // Merge with existing — preserve authored frame overrides for any
  // sheet whose filename matches.
  const existingByEntity = existing?.sheets ?? {};
  const oldSheets = existingByEntity[entityId] ?? [];
  const oldByFilename = new Map<string, HitboxSheet>(
    oldSheets.map((s) => [s.filename, s] as const),
  );

  const sheets: HitboxSheet[] = discovered.map((d) => {
    const old = oldByFilename.get(d.filename);
    if (old) {
      // Keep authored frames + dims (don't clobber a hand-fixed
      // non-square frame layout).
      return {
        ...old,
        frameWidth: old.frameWidth || d.frameWidth,
        frameHeight: old.frameHeight || d.frameHeight,
        frameCount: old.frameCount || d.frameCount,
      };
    }
    return {
      filename: d.filename,
      frameWidth: d.frameWidth,
      frameHeight: d.frameHeight,
      frameCount: d.frameCount,
      framesByIndex: {},
    };
  });

  // Build / preserve entity row.
  const oldEntity = existing?.entities.find((e) => e.id === entityId);
  const entity: HitboxEntity = oldEntity ?? {
    id: entityId,
    defaultBody: null,
  };

  const project: HitboxProject = {
    name: existing?.name ?? entityId,
    savedAt: new Date(0).toISOString(),
    entities: [entity, ...(existing?.entities.filter((e) => e.id !== entityId) ?? [])],
    sheets: { ...existingByEntity, [entityId]: sheets },
  };

  const { sheetUrls, missing } = await loadSheetUrls(folderPath, project);
  return { project, sheetUrls, missing };
}

// ─── Internals ──────────────────────────────────────────────────────

async function loadSheetUrls(
  folderPath: string,
  project: HitboxProject,
): Promise<{ sheetUrls: Map<string, string>; missing: string[] }> {
  const sheetUrls = new Map<string, string>();
  const missing: string[] = [];
  const filenames = new Set<string>();
  for (const list of Object.values(project.sheets)) {
    for (const s of list) filenames.add(s.filename);
  }
  for (const filename of filenames) {
    try {
      const bytes = await window.api.readFile(joinPath(folderPath, filename));
      // Slice copy — see decorationsProject for rationale.
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      sheetUrls.set(filename, URL.createObjectURL(blob));
    } catch {
      missing.push(filename);
    }
  }
  return { sheetUrls, missing };
}

async function readPngDims(
  path: string,
): Promise<{ w: number; h: number } | null> {
  try {
    const bytes = await window.api.readFile(path);
    const img = await loadImageFromBytes(bytes, "image/png");
    return { w: img.width, h: img.height };
  } catch {
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const entries = await window.api.listDir(path);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

// `dirnameOf` is currently unused but might be needed for future
// "open by file" parity with platforms / decorations modes. Re-exported
// here so callers don't have to chase imports.
export { dirnameOf };
