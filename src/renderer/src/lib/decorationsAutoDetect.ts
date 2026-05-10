import {
  type Decoration,
  type DecorationCategory,
  type DecorationProject,
  type DecorationSheet,
  type DecorationSingle,
  type DecorationSizeClass,
  type DecorationBehaviorWeight,
  migrateDecorationProject,
} from './decorations';
import {
  DECORATION_PROJECT_FILE,
} from './decorationsProject';
import { joinPath, dirnameOf } from './platformProject';
import { loadImageFromBytes } from './image-utils';

/**
 * Auto-detect decorations from a folder and merge into an existing
 * decorations.json (or create a new one). Designed to run after Builder
 * exports its animation strips: scan the folder for decoration-shaped
 * PNGs, infer metadata, classify, and preserve any user edits already
 * persisted in decorations.json.
 *
 * Discovery rules:
 *   - Animated sheets: filenames matching `*_Nfps.png` (the export
 *     pattern Builder uses). Frame width inferred from height (frames
 *     are square 512×512 in our pipeline); frame count = imageWidth /
 *     frameWidth; fps from the filename suffix.
 *   - Static singles: any PNG inside a `decorations_singles/` sibling
 *     folder, OR matching `*_raw_NN.png` in the scan folder.
 *
 * Persistence rules:
 *   - decorations.json lives wherever it already is — folder OR parent
 *     of folder (e.g. when sheets are in `decorations_sheets/` and the
 *     manifest sits one level up alongside `decorations_singles/`).
 *   - When writing fresh, the manifest goes in `folder` itself.
 *   - File paths in the manifest are relative to wherever it sits.
 *
 * Merge rules: for entries already in decorations.json, only the
 * file-derived fields (frameWidth/Height/Count, fps, width, height)
 * are refreshed from disk. User-authored fields (category, sizeClass,
 * anchor, allowedBehaviors, notes, pauseFrame, spawnHazardOnFrame)
 * are preserved verbatim. Entries whose file no longer exists on disk
 * are dropped.
 */

export interface SyncResult {
  /** Where the manifest was written. */
  manifestPath: string;
  /** Total decorations after sync. */
  totalCount: number;
  /** Newly added entries (didn't exist before this run). */
  addedCount: number;
  /** Entries dropped because their file no longer exists. */
  removedCount: number;
}

/** Match Builder's exported animation-strip filename pattern: name + fps suffix. */
const SHEET_RE = /^(.+)_(\d+)fps\.png$/i;
/** Match the raw-singles pattern Builder/manual exports tend to produce. */
const SINGLE_RE = /^(.+)_raw_\d+\.png$/i;

function classifySheet(name: string): { category: DecorationCategory; sizeClass: DecorationSizeClass; behaviors: DecorationBehaviorWeight[] } {
  const n = name.toLowerCase();
  // Order matters: more specific patterns first.
  if (n.includes('poison_pool')) return { category: 'hazard_visual', sizeClass: 'large', behaviors: [{ kind: 'loop', weight: 1 }] };
  if (n.includes('poison_flower') || (n.includes('poison') && n.includes('flower'))) return { category: 'hazard_visual', sizeClass: 'medium', behaviors: [{ kind: 'loop', weight: 1 }] };
  if (n.includes('altar')) return { category: 'feature', sizeClass: 'large', behaviors: [{ kind: 'onPlatformOccupied', weight: 0.6 }, { kind: 'randomBurst', weight: 0.3 }, { kind: 'loop', weight: 0.1 }] };
  if (n.includes('bones')) return { category: 'decor', sizeClass: 'large', behaviors: [{ kind: 'stuckMidFrame', weight: 0.4 }, { kind: 'randomBurst', weight: 0.3 }, { kind: 'static', weight: 0.3 }] };
  if (n.includes('stump')) return { category: 'decor', sizeClass: 'large', behaviors: [{ kind: 'loop', weight: 0.3 }, { kind: 'randomBurst', weight: 0.4 }, { kind: 'pass', weight: 0.3 }] };
  if (n.includes('bush')) return { category: 'flora', sizeClass: 'medium', behaviors: [{ kind: 'loop', weight: 0.5 }, { kind: 'randomBurst', weight: 0.3 }, { kind: 'pass', weight: 0.2 }] };
  if (n.includes('flower')) return { category: 'flora', sizeClass: 'medium', behaviors: [{ kind: 'randomBurst', weight: 0.5 }, { kind: 'loop', weight: 0.3 }, { kind: 'proximity', weight: 0.2 }] };
  if (n.includes('fern')) return { category: 'flora', sizeClass: 'small', behaviors: [{ kind: 'loop', weight: 0.5 }, { kind: 'pass', weight: 0.3 }, { kind: 'randomBurst', weight: 0.2 }] };
  if (n.includes('moss')) return { category: 'flora', sizeClass: 'small', behaviors: [{ kind: 'loop', weight: 1 }] };
  if (n.includes('grass')) return { category: 'flora', sizeClass: 'tiny', behaviors: [{ kind: 'loop', weight: 0.5 }, { kind: 'pass', weight: 0.3 }, { kind: 'randomBurst', weight: 0.2 }] };
  if (n.includes('shroom')) return { category: 'decor', sizeClass: 'small', behaviors: [{ kind: 'loop', weight: 0.4 }, { kind: 'randomBurst', weight: 0.3 }, { kind: 'proximity', weight: 0.3 }] };
  if (n.includes('vine')) return { category: 'decor', sizeClass: 'medium', behaviors: [{ kind: 'loop', weight: 0.5 }, { kind: 'pass', weight: 0.3 }, { kind: 'proximity', weight: 0.2 }] };
  if (n.includes('moth')) return { category: 'effect', sizeClass: 'small', behaviors: [{ kind: 'loop', weight: 0.7 }, { kind: 'proximity', weight: 0.3 }] };
  if (n.includes('spores')) return { category: 'effect', sizeClass: 'small', behaviors: [{ kind: 'proximity', weight: 0.4 }, { kind: 'onLanding', weight: 0.4 }, { kind: 'randomBurst', weight: 0.2 }] };
  if (n.includes('dust')) return { category: 'effect', sizeClass: 'small', behaviors: [{ kind: 'onLanding', weight: 0.7 }, { kind: 'onJump', weight: 0.3 }] };
  if (n.includes('rock_break')) return { category: 'effect', sizeClass: 'medium', behaviors: [{ kind: 'onPlatformOccupied', weight: 0.5 }, { kind: 'proximity', weight: 0.5 }] };
  return { category: 'decor', sizeClass: 'medium', behaviors: [{ kind: 'loop', weight: 1 }] };
}

function classifySingle(name: string): { category: DecorationCategory; sizeClass: DecorationSizeClass } {
  const n = name.toLowerCase();
  if (n.includes('flora_2')) return { category: 'flora', sizeClass: 'tiny' };
  if (n.includes('flora_5')) return { category: 'flora', sizeClass: 'small' };
  if (n.includes('multi_flora')) return { category: 'flora', sizeClass: 'medium' };
  if (n.includes('vines')) return { category: 'decor', sizeClass: 'large' };
  return { category: 'flora', sizeClass: 'small' };
}

/** Read PNG dimensions via the same image-utils path used elsewhere. */
async function readPngDims(path: string): Promise<{ w: number; h: number } | null> {
  try {
    const bytes = await window.api.readFile(path);
    const img = await loadImageFromBytes(bytes, 'image/png');
    return { w: img.width, h: img.height };
  } catch {
    return null;
  }
}

/**
 * Scan the alpha channel of a sheet's FIRST FRAME and return the
 * number of fully-transparent rows at the bottom of that frame. The
 * runtime uses this as `visibleBottomPadding` to nudge bottom-anchored
 * sprites down so their visible content rests on the walking surface
 * instead of floating above due to bottom-edge transparency.
 *
 * Threshold: a row counts as "transparent" if every pixel's alpha is
 * below `ALPHA_OPAQUE_THRESHOLD` (96). Strict zero would miss assets
 * with faint anti-aliasing dust at the bottom; 96 catches those while
 * still finding the real first-opaque-row.
 */
const ALPHA_OPAQUE_THRESHOLD = 96;

export async function detectBottomPadding(
  fullPath: string,
  frameWidth: number,
  frameHeight: number,
): Promise<number | null> {
  try {
    const bytes = await window.api.readFile(fullPath);
    const img = await loadImageFromBytes(bytes, 'image/png');
    // First frame occupies x ∈ [0, frameWidth) of the sheet. Scan the
    // bottom rows of this slice for the first row that has any opaque
    // pixel. Sheets are horizontal strips so the height is the frame
    // height (= image.height for sheets we author).
    const w = Math.min(frameWidth, img.width);
    const h = Math.min(frameHeight, img.height);
    if (w <= 0 || h <= 0) return null;
    const data = img.data;
    const stride = img.width * 4;
    for (let y = h - 1; y >= 0; y--) {
      let anyOpaque = false;
      const rowStart = y * stride;
      for (let x = 0; x < w; x++) {
        const a = data[rowStart + x * 4 + 3];
        if (a > ALPHA_OPAQUE_THRESHOLD) {
          anyOpaque = true;
          break;
        }
      }
      if (anyOpaque) {
        // y is the first opaque row scanning bottom-up; the number of
        // transparent rows BELOW it is `(h - 1) - y`.
        return h - 1 - y;
      }
    }
    return null; // entirely transparent — author error, skip
  } catch {
    return null;
  }
}

/**
 * Decide whether a sheet/single's visible content is concentrated in
 * the TOP portion of the frame — the signature of a hanging
 * decoration like a vine, tendril, or moss strand. Returns true when
 * the opaque content's center of mass sits above `topShareThreshold`
 * × frameHeight from the top, which is the "PNG drawn from top of
 * frame, blank below" pattern. Used to auto-flag entries as
 * `placement: 'underside'` even when the filename gives no hint
 * (e.g. `flora_5_raw_05.png` that's actually a vine).
 *
 * The threshold defaults to 0.4 — most authored vines have their
 * attachment at frame Y=0 and trail down ~60% of the frame, so the
 * centroid lands around 30-35% from the top. A non-vine asset
 * usually has its centroid below 50% (bottom-anchored content).
 */
export async function detectTopHeavyAlpha(
  fullPath: string,
  frameWidth: number,
  frameHeight: number,
  topShareThreshold = 0.4,
): Promise<boolean> {
  try {
    const bytes = await window.api.readFile(fullPath);
    const img = await loadImageFromBytes(bytes, 'image/png');
    const w = Math.min(frameWidth, img.width);
    const h = Math.min(frameHeight, img.height);
    if (w <= 0 || h <= 0) return false;
    const data = img.data;
    const stride = img.width * 4;
    let totalOpaque = 0;
    let weightedY = 0; // sum of opaque-pixel y values
    for (let y = 0; y < h; y++) {
      const rowStart = y * stride;
      for (let x = 0; x < w; x++) {
        const a = data[rowStart + x * 4 + 3];
        if (a > ALPHA_OPAQUE_THRESHOLD) {
          totalOpaque += 1;
          weightedY += y;
        }
      }
    }
    if (totalOpaque < 32) return false; // empty / near-empty frame
    const centroidY = weightedY / totalOpaque;
    return centroidY < topShareThreshold * h;
  } catch {
    return false;
  }
}

/** Bulk-scan every entry's PNG and return the ids that look like
 *  underside decorations (top-heavy alpha distribution). The caller
 *  decides whether to apply the change — typically only flipping
 *  entries currently set to 'topside' so author-set 'underside'
 *  values stay untouched. */
export async function bulkDetectUnderside(
  manifestFolder: string,
  decorations: Decoration[],
): Promise<Set<string>> {
  const flipIds = new Set<string>();
  for (const d of decorations) {
    const fullPath = joinPath(manifestFolder, d.filename);
    const w = d.kind === 'sheet' ? d.frameWidth : d.width;
    const h = d.kind === 'sheet' ? d.frameHeight : d.height;
    if (!w || !h) continue;
    const isTopHeavy = await detectTopHeavyAlpha(fullPath, w, h);
    if (isTopHeavy) flipIds.add(d.id);
  }
  return flipIds;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return await window.api.pathExists(path);
  } catch {
    return false;
  }
}

async function listPngs(folder: string): Promise<string[]> {
  try {
    const entries = await window.api.listDir(folder);
    return entries.filter((e) => e.toLowerCase().endsWith('.png'));
  } catch {
    return [];
  }
}

/**
 * Find the location where decorations.json should be read/written for
 * a given folder. Prefers an existing manifest (in folder OR its parent)
 * over creating a new one.
 *
 * Returns:
 *   - `manifestFolder`: folder the manifest sits in (paths in the
 *     manifest are relative to this).
 *   - `existedBefore`: true if a manifest was already on disk.
 */
async function resolveManifestLocation(scanFolder: string): Promise<{
  manifestFolder: string;
  existedBefore: boolean;
}> {
  // Check `scanFolder/decorations.json`.
  if (await fileExists(joinPath(scanFolder, DECORATION_PROJECT_FILE))) {
    return { manifestFolder: scanFolder, existedBefore: true };
  }
  // Check parent.
  const parent = dirnameOf(scanFolder);
  if (parent && parent !== scanFolder) {
    if (await fileExists(joinPath(parent, DECORATION_PROJECT_FILE))) {
      return { manifestFolder: parent, existedBefore: true };
    }
  }
  // Default: write fresh in the scan folder itself.
  return { manifestFolder: scanFolder, existedBefore: false };
}

async function loadExistingManifest(manifestFolder: string): Promise<DecorationProject | null> {
  try {
    const bytes = await window.api.readFile(joinPath(manifestFolder, DECORATION_PROJECT_FILE));
    const text = new TextDecoder().decode(bytes);
    return migrateDecorationProject(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Build a Decoration entry from a discovered file. The "old" entry, if
 *  present, contributes user-authored fields (category, behaviors, etc.). */
function buildEntry(args: {
  filename: string;
  kind: 'sheet' | 'single';
  sourcePath: string;
  width: number;
  height: number;
  fps?: number;
  old?: Decoration;
}): Decoration {
  const { filename, kind, width, height, fps, old } = args;
  const id = filename.replace(/\.png$/i, '');
  if (kind === 'sheet') {
    const frameHeight = height; // square frames
    const frameWidth = height;
    const frameCount = Math.max(1, Math.floor(width / frameWidth));
    const baseName = filename.replace(SHEET_RE, '$1');
    const auto = classifySheet(baseName);
    // Vines hang from the platform's underside; everything else
    // sits on top by default. Authored placement is preserved
    // through the merge — only NEW entries pick up the auto value.
    const placement: 'topside' | 'underside' = baseName.toLowerCase().includes('vine')
      ? 'underside'
      : 'topside';
    if (old && old.kind === 'sheet') {
      return {
        ...old,
        // Refresh file-derived fields from disk; preserve user edits.
        filename: old.filename || filename,
        frameWidth,
        frameHeight,
        frameCount,
        fps: fps ?? old.fps,
      };
    }
    const sheet: DecorationSheet = {
      id,
      filename,
      kind: 'sheet',
      frameWidth,
      frameHeight,
      frameCount,
      fps: fps ?? 6,
      anchor: 'bottom',
      placement,
      biome: 'DEPTHS',
      category: auto.category,
      sizeClass: auto.sizeClass,
      allowedBehaviors: auto.behaviors,
    };
    return sheet;
  }
  // single
  const baseName = filename.replace(SINGLE_RE, '$1');
  const auto = classifySingle(baseName);
  const placement: 'topside' | 'underside' = baseName.toLowerCase().includes('vine')
    ? 'underside'
    : 'topside';
  if (old && old.kind === 'single') {
    return {
      ...old,
      width,
      height,
    };
  }
  const single: DecorationSingle = {
    id,
    filename,
    kind: 'single',
    width,
    height,
    anchor: 'bottom',
    placement,
    biome: 'DEPTHS',
    category: auto.category,
    sizeClass: auto.sizeClass,
    allowedBehaviors: [{ kind: 'static', weight: 1 }],
  };
  return single;
}

/**
 * Sync (build / update) decorations.json against the on-disk content
 * of `scanFolder`. Returns null when the folder has no decoration-shaped
 * content AND there's no existing manifest — nothing to do.
 */
/**
 * Run alpha-channel detection across every sheet in the project and
 * return the proposed `visibleBottomPadding` per asset id. Caller
 * decides whether to apply (overwriting) or just preview the values.
 * Singles aren't included — they're typically authored tight already
 * and the singles path doesn't have a frame layout to scan around.
 */
export async function bulkDetectBottomPadding(
  manifestFolder: string,
  decorations: Decoration[],
): Promise<Map<string, number>> {
  const patches = new Map<string, number>();
  for (const d of decorations) {
    if (d.kind !== 'sheet') continue;
    const fullPath = joinPath(manifestFolder, d.filename);
    const padding = await detectBottomPadding(fullPath, d.frameWidth, d.frameHeight);
    if (padding !== null && padding > 0) {
      patches.set(d.id, padding);
    }
  }
  return patches;
}

export async function syncDecorationsForFolder(
  scanFolder: string,
): Promise<SyncResult | null> {
  const { manifestFolder, existedBefore } = await resolveManifestLocation(scanFolder);
  const existing = existedBefore ? await loadExistingManifest(manifestFolder) : null;
  const oldByFilename = new Map<string, Decoration>();
  if (existing) {
    for (const d of existing.decorations) {
      oldByFilename.set(d.filename, d);
    }
  }

  // Discover sheets + singles. Two layouts to consider:
  //   1. Manifest in PARENT folder; sheets in `decorations_sheets/`,
  //      singles in `decorations_singles/`. Filenames are subfolder-prefixed.
  //   2. Manifest in same folder as sheets; singles either in this folder
  //      (matching `_raw_` pattern) or in a `decorations_singles/`
  //      sibling. Filenames are bare.
  const discovered: Array<{
    filename: string;
    kind: 'sheet' | 'single';
    fullPath: string;
    fps?: number;
  }> = [];

  const scanDir = async (
    absDir: string,
    relPrefix: string,
  ): Promise<void> => {
    const pngs = await listPngs(absDir);
    for (const png of pngs) {
      const sheetMatch = png.match(SHEET_RE);
      const singleMatch = png.match(SINGLE_RE);
      if (sheetMatch) {
        discovered.push({
          filename: relPrefix ? `${relPrefix}/${png}` : png,
          kind: 'sheet',
          fullPath: joinPath(absDir, png),
          fps: Number(sheetMatch[2]),
        });
      } else if (singleMatch) {
        discovered.push({
          filename: relPrefix ? `${relPrefix}/${png}` : png,
          kind: 'single',
          fullPath: joinPath(absDir, png),
        });
      }
    }
  };

  // The manifest folder is the source of relative paths. Scan:
  //   - manifestFolder itself (any sheets/singles directly in it)
  //   - manifestFolder/decorations_sheets/ if it exists
  //   - manifestFolder/decorations_singles/ if it exists
  await scanDir(manifestFolder, '');
  const sheetsSubdir = joinPath(manifestFolder, 'decorations_sheets');
  if (await fileExists(sheetsSubdir)) {
    await scanDir(sheetsSubdir, 'decorations_sheets');
  }
  const singlesSubdir = joinPath(manifestFolder, 'decorations_singles');
  if (await fileExists(singlesSubdir)) {
    await scanDir(singlesSubdir, 'decorations_singles');
  }

  if (discovered.length === 0 && !existing) {
    // Nothing to do.
    return null;
  }

  // Build / merge entries.
  const seenFilenames = new Set<string>();
  const merged: Decoration[] = [];
  let addedCount = 0;
  for (const d of discovered) {
    seenFilenames.add(d.filename);
    const dims = await readPngDims(d.fullPath);
    if (!dims) continue;
    const old = oldByFilename.get(d.filename);
    const entry = buildEntry({
      filename: d.filename,
      kind: d.kind,
      sourcePath: d.fullPath,
      width: dims.w,
      height: dims.h,
      fps: d.fps,
      old,
    });
    if (!old) addedCount += 1;
    merged.push(entry);
  }

  // Drop entries whose file is gone.
  let removedCount = 0;
  if (existing) {
    for (const old of existing.decorations) {
      if (!seenFilenames.has(old.filename)) {
        removedCount += 1;
      }
    }
  }

  // Sort by category → kind → id for stable ordering across saves.
  merged.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  const next: DecorationProject = {
    name: existing?.name || 'decorations',
    savedAt: new Date().toISOString(),
    decorations: merged,
  };

  const text = JSON.stringify(next, null, 2);
  const bytes = new TextEncoder().encode(text);
  const manifestPath = joinPath(manifestFolder, DECORATION_PROJECT_FILE);
  await window.api.writeFile(manifestPath, bytes);

  return {
    manifestPath,
    totalCount: merged.length,
    addedCount,
    removedCount,
  };
}
