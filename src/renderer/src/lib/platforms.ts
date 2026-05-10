/**
 * Platform asset library types — used by the Platforms mode in bg-remover and
 * exported verbatim into the manifest that AscensionGame's
 * `PlatformAssetLibrary` consumes. Keep this file dependency-free so the
 * shape stays portable.
 */

export type Biome = 'DEPTHS' | 'CAVERNS' | 'SPIRE' | 'SUMMIT';

export const BIOMES: readonly Biome[] = ['DEPTHS', 'CAVERNS', 'SPIRE', 'SUMMIT'];

/**
 * Asset categories the user can author. This is intentionally narrower than
 * AscensionGame's gameplay `PlatformType` enum: the gameplay variants
 * (`MOVING` / `BREAKABLE` / `ICE` / `STICKY` / `BOUNCE`) all consume the
 * `STANDARD` sprite at runtime and get differentiated via HSL hue rotation
 * in `PlatformTextureManager`. Authoring one base sprite per biome keeps
 * the workflow lean — type variation is a tuning step, not an art step.
 *
 * Walls are split into `WALL` (regular wall-jump pillar) and `WALL_CRACKED`
 * (breakable, hides a secret room) so the player can read the difference
 * visually. Slopes keep `SLOPE_LEFT` / `SLOPE_RIGHT` for asymmetric art.
 */
export type PlatformType =
  | 'STANDARD'
  | 'SLOPE_LEFT'
  | 'SLOPE_RIGHT'
  | 'WALL'
  | 'WALL_CRACKED'
  | 'SHOP'
  | 'PORTAL'
  | 'GAMBLING'
  | 'NPC';

export const PLATFORM_TYPES: readonly PlatformType[] = [
  'STANDARD',
  'SLOPE_LEFT',
  'SLOPE_RIGHT',
  'WALL',
  'WALL_CRACKED',
  'SHOP',
  'PORTAL',
  'GAMBLING',
  'NPC',
];

/** Older project files may have used these gameplay variants as asset tags
 *  before the simplification. Migration coerces them to `STANDARD` since
 *  that's what they all collapse to in the new model. */
const REMOVED_TYPES_TO_STANDARD = new Set([
  'MOVING',
  'BREAKABLE',
  'ICE',
  'STICKY',
  'BOUNCE',
]);

/**
 * 9-slice insets in source-pixel coordinates. The middle column (between
 * `left` and `width - right`) is the part that stretches/repeats horizontally
 * when the runtime renders a wider platform than the source PNG.
 *
 * `top` and `bottom` exist for completeness but default to 0 — platforms in
 * AscensionGame only stretch horizontally (they're always 32px tall).
 */
export interface SliceBorders {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Visual size buckets PLUS a special-role "FLOOR" tag. XS-XL are sorting
 * labels — runtime selects regular platforms by closest effective width,
 * not by category.
 *
 * `FLOOR` is functional: AscensionGame uses it to find the biome's floor
 * sprite (depths' starting platform, each later biome's boss-arena floor).
 * Floor sprites render at full natural height (no display-height clamp)
 * and sit at a lower depth so taller platforms above them overlap cleanly.
 *
 * Auto-detect maps effective width to XS/S/M/L/XL only; it never assigns
 * or overwrites FLOOR — that's a manual tag.
 */
export type SizeCategory = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'FLOOR';

export const SIZE_CATEGORIES: readonly SizeCategory[] = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'FLOOR',
];

/**
 * Authored walkable surface in SOURCE pixel coords. The TOP edge of the
 * rectangle is the walking surface the player stands on; the height is
 * the collision-band depth (typically 32 — matches AscensionGame's
 * default `collisionHeight`).
 *
 * `rightTopOffset` lets the top edge TILT — the top-left corner stays at
 * `(x, y)` while the top-right corner moves to `(x + width, y + rightTopOffset)`.
 * Positive = right side lower (slope down to the right); negative = right
 * side higher. Used for platforms drawn in perspective whose visible top
 * face is a tilted parallelogram. The bottom edge stays parallel to the
 * top so the region remains a parallelogram rather than a general quad.
 *
 * Multiple regions per asset support uneven ground (multiple plateaus
 * at different heights) and bridges (gap in the middle of one platform).
 * The runtime creates one collision body per region (multiple stair-stepped
 * bodies when `rightTopOffset` is non-zero so the slope reads in physics).
 */
export interface WalkableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rightTopOffset?: number;
}

/** A single hand-placed decoration on a specific platform asset.
 *  References a decoration by id (must match an entry in the
 *  decoration project) and pins it to a fixed source-pixel position
 *  on the platform. Authoring this lets the artist pick "this exact
 *  mushroom in this exact spot" instead of relying on procedural
 *  scatter for every flora visual. */
export interface AuthoredDecoration {
  decorationId: string;
  /** Anchor point in SOURCE pixels of the platform's frame. The
   *  decoration's `anchor` field determines what part of the sprite
   *  gets pinned here (bottom-center for "bottom" anchored, top-center
   *  for "underside" placements, etc.). */
  x: number;
  y: number;
}

/** Optional rectangular footprint (SOURCE pixels) describing the
 *  platform's silhouette for shadow casting. Defaults to the union of
 *  walkableRegions. Author when the visible silhouette is wider than
 *  the standable area (overhangs) and the shadow should match the
 *  silhouette rather than just the walkable bands. */
export interface WalkableHull {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlatformAsset {
  id: string;
  /** PNG filename within the project folder. */
  filename: string;
  biome: Biome;
  type: PlatformType;
  slice: SliceBorders;
  /** Natural pixel size of the source PNG. */
  width: number;
  height: number;
  /** Optional per-asset display-size override consumed by AscensionGame.
   *  When set, the runtime renders the platform at exactly this size
   *  regardless of the procgen request. Undefined = "auto" (use procgen
   *  width and the source PNG's natural height). */
  targetWidth?: number;
  targetHeight?: number;
  /** Authoring-only label for size-bucket organization. Persisted to the
   *  manifest so other tools could read it, but AscensionGame ignores it. */
  sizeCategory?: SizeCategory;
  /** Authored walkable surface bands (SOURCE pixels). When present,
   *  AscensionGame replaces its body-position heuristic with bodies
   *  placed exactly at the top edge of each region. */
  walkableRegions?: WalkableRegion[];
  /** Optional silhouette bounds for shadow / fall-off (SOURCE pixels).
   *  Defaults to the union of walkableRegions. */
  walkableHull?: WalkableHull;
  /** Optional anchor (SOURCE pixels) for centered overlays — shrine /
   *  shop icons, particle FX. Defaults to the centroid of walkableRegions
   *  / walkableHull. */
  surfaceCenter?: { x: number; y: number };
  /** Optional decoration scatter zones (SOURCE pixels). When present,
   *  AscensionGame's decoration scatter restricts placement to the
   *  union of these rectangles instead of using the walkable regions'
   *  full horizontal extent. Use this when the visible top of the
   *  platform has chunks where decorations look bad (e.g. a shrine's
   *  altar pedestal, a stairs section, a gap between two slabs).
   *  Empty / missing = scatter uses the walkable regions as-is. */
  decorationZones?: WalkableRegion[];
  /** Hand-authored decoration placements (SOURCE pixels). When this
   *  array is non-empty, the runtime spawns EXACTLY these decorations
   *  at the configured positions and skips procedural scatter for
   *  this platform. Use this for one-off "this exact mushroom goes
   *  in this exact spot" art direction. Coordinates anchor by the
   *  decoration's own `anchor` rule:
   *    - bottom-anchored (most): (x, y) = sprite's bottom-center
   *    - underside / center-anchored: (x, y) = sprite's anchor point
   *  An empty array means "no authored decorations, fall through to
   *  scatter." Missing field means the same. */
  authoredDecorations?: AuthoredDecoration[];
  /** Epoch ms of the last edit. Used to highlight recently-changed assets
   *  in the library so the user can spot what they just touched. Stamped
   *  by the renderer; persisted to the manifest so the highlight survives
   *  a save+reload (within the freshness window). */
  lastModifiedMs?: number;
}

export interface PlatformProject {
  name: string;
  savedAt: string;
  assets: PlatformAsset[];
}

export const DEFAULT_PLATFORM_PROJECT: PlatformProject = {
  name: 'platforms',
  savedAt: new Date(0).toISOString(),
  assets: [],
};

export function newPlatformAssetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `plat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Default 9-slice for a freshly-tagged platform: all-zero (no slicing,
 *  whole sprite scales uniformly to whatever target size the runtime needs).
 *  The user opens the 9-slice editor when they want crisp corners. */
export function defaultSliceBorders(_width: number): SliceBorders {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/**
 * Compute a unique, deterministic filename for an asset given its biome +
 * type. Steps `01.png`, `02.png`, … until a free slot is found. Skipping
 * gaps from deletions is intentional — filenames stay short and predictable.
 */
export function derivePlatformFilename(
  asset: Pick<PlatformAsset, 'biome' | 'type'>,
  existing: PlatformAsset[],
): string {
  const base = `${asset.type.toLowerCase()}_${asset.biome.toLowerCase()}`;
  const taken = new Set(existing.map((a) => a.filename));
  let i = 1;
  while (taken.has(`${base}_${String(i).padStart(2, '0')}.png`)) i++;
  return `${base}_${String(i).padStart(2, '0')}.png`;
}

/**
 * Build a fresh `PlatformAsset` for the given image, with default biome,
 * type, and 9-slice borders. The caller is responsible for supplying a
 * unique `existing` list so the filename doesn't collide.
 */
export function makePlatformAsset(
  image: ImageData,
  existing: PlatformAsset[],
  overrides: Partial<Pick<PlatformAsset, 'biome' | 'type'>> = {},
): PlatformAsset {
  const biome: Biome = overrides.biome ?? 'DEPTHS';
  const type: PlatformType = overrides.type ?? 'STANDARD';
  return {
    id: newPlatformAssetId(),
    filename: derivePlatformFilename({ biome, type }, existing),
    biome,
    type,
    slice: defaultSliceBorders(image.width),
    width: image.width,
    height: image.height,
  };
}

function isBiome(v: unknown): v is Biome {
  return typeof v === 'string' && (BIOMES as readonly string[]).includes(v);
}

function isPlatformType(v: unknown): v is PlatformType {
  return typeof v === 'string' && (PLATFORM_TYPES as readonly string[]).includes(v);
}

/** Coerce legacy types to the closest current type. Unknown/missing → STANDARD. */
function migrateType(v: unknown): PlatformType {
  if (isPlatformType(v)) return v;
  if (typeof v === 'string' && REMOVED_TYPES_TO_STANDARD.has(v)) return 'STANDARD';
  return 'STANDARD';
}

/** Parse an unknown value as a positive finite number, or undefined.
 *  Used for optional override fields where 0 / negative / NaN should be
 *  treated as "not set" so the runtime falls back to defaults. */
function positiveNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function isSizeCategory(v: unknown): v is SizeCategory {
  return typeof v === 'string' && (SIZE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Bucket an asset's effective width into a size category. Used by the
 * "Auto-detect sizes" button to stamp every library entry in one click.
 * Thresholds match the documented ranges on `SizeCategory`.
 */
export function categorizeWidth(width: number): SizeCategory {
  if (width < 200) return 'XS';
  if (width < 400) return 'S';
  if (width < 700) return 'M';
  if (width < 1100) return 'L';
  return 'XL';
}

/** Effective width for sizing purposes — the override beats the natural PNG width. */
export function platformAssetEffectiveWidth(a: Pick<PlatformAsset, 'width' | 'targetWidth'>): number {
  return a.targetWidth ?? a.width;
}

/** How long after a change an asset is still considered "recently modified"
 *  for the library highlight. 5 minutes balances "I can see what I just
 *  touched" against "old highlights don't linger across sessions". */
export const RECENT_MODIFIED_MS = 5 * 60 * 1000;

export function isRecentlyModified(
  a: Pick<PlatformAsset, 'lastModifiedMs'>,
  now: number = Date.now(),
): boolean {
  return a.lastModifiedMs !== undefined && now - a.lastModifiedMs < RECENT_MODIFIED_MS;
}

/** Strict parse of a single walkable region. Returns null on any
 *  shape/type problem so callers can filter out bad entries without
 *  losing the whole array. */
function parseWalkableRegion(raw: unknown): WalkableRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as {
    x?: unknown; y?: unknown; width?: unknown; height?: unknown;
    rightTopOffset?: unknown;
  };
  if (
    typeof o.x !== 'number' || !Number.isFinite(o.x) ||
    typeof o.y !== 'number' || !Number.isFinite(o.y) ||
    typeof o.width !== 'number' || !Number.isFinite(o.width) || o.width <= 0 ||
    typeof o.height !== 'number' || !Number.isFinite(o.height) || o.height <= 0
  ) return null;
  const region: WalkableRegion = { x: o.x, y: o.y, width: o.width, height: o.height };
  if (typeof o.rightTopOffset === 'number' && Number.isFinite(o.rightTopOffset) && o.rightTopOffset !== 0) {
    region.rightTopOffset = o.rightTopOffset;
  }
  return region;
}

function parseWalkableRegions(raw: unknown): WalkableRegion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WalkableRegion[] = [];
  for (const r of raw) {
    const parsed = parseWalkableRegion(r);
    if (parsed) out.push(parsed);
  }
  return out.length > 0 ? out : undefined;
}

function parseWalkableHull(raw: unknown): WalkableHull | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { left?: unknown; right?: unknown; top?: unknown; bottom?: unknown };
  if (
    typeof o.left !== 'number' || typeof o.right !== 'number' ||
    typeof o.top !== 'number' || typeof o.bottom !== 'number' ||
    o.right <= o.left || o.bottom <= o.top
  ) return undefined;
  return { left: o.left, right: o.right, top: o.top, bottom: o.bottom };
}

function parseAuthoredDecorations(raw: unknown): AuthoredDecoration[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AuthoredDecoration[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as { decorationId?: unknown; x?: unknown; y?: unknown };
    if (
      typeof o.decorationId !== 'string' ||
      o.decorationId.length === 0 ||
      typeof o.x !== 'number' ||
      !Number.isFinite(o.x) ||
      typeof o.y !== 'number' ||
      !Number.isFinite(o.y)
    ) {
      continue;
    }
    out.push({ decorationId: o.decorationId, x: o.x, y: o.y });
  }
  return out.length > 0 ? out : undefined;
}

function parseSurfaceCenter(raw: unknown): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { x?: unknown; y?: unknown };
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return undefined;
  return { x: o.x, y: o.y };
}

/** Compute the union bounding box of an asset's walkable regions in
 *  SOURCE pixels. Returns null when the asset has no walkable regions
 *  AND no authored hull. */
export function walkableBoundsSource(
  a: Pick<PlatformAsset, 'walkableHull' | 'walkableRegions'>,
): WalkableHull | null {
  if (a.walkableHull) return a.walkableHull;
  const regions = a.walkableRegions;
  if (!regions || regions.length === 0) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const r of regions) {
    if (r.x < left) left = r.x;
    if (r.x + r.width > right) right = r.x + r.width;
    if (r.y < top) top = r.y;
    if (r.y + r.height > bottom) bottom = r.y + r.height;
  }
  return { left, right, top, bottom };
}

/**
 * Coerce an arbitrary parsed JSON value into a valid `PlatformProject`. Used
 * on load so manually-edited or out-of-date manifests still open without
 * crashing. Unknown fields are dropped; missing fields get sane defaults.
 */
export function migratePlatformProject(raw: unknown): PlatformProject {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PLATFORM_PROJECT };
  const obj = raw as Record<string, unknown>;
  const rawAssets = Array.isArray(obj.assets) ? obj.assets : [];
  const assets: PlatformAsset[] = [];
  for (const a of rawAssets) {
    if (!a || typeof a !== 'object') continue;
    const ao = a as Record<string, unknown>;
    const slice = ao.slice && typeof ao.slice === 'object'
      ? (ao.slice as Record<string, unknown>)
      : {};
    assets.push({
      id: typeof ao.id === 'string' ? ao.id : newPlatformAssetId(),
      filename: typeof ao.filename === 'string' ? ao.filename : 'unnamed.png',
      biome: isBiome(ao.biome) ? ao.biome : 'DEPTHS',
      type: migrateType(ao.type),
      slice: {
        left: Number(slice.left) || 0,
        right: Number(slice.right) || 0,
        top: Number(slice.top) || 0,
        bottom: Number(slice.bottom) || 0,
      },
      width: Number(ao.width) || 0,
      height: Number(ao.height) || 0,
      targetWidth: positiveNumberOrUndefined(ao.targetWidth),
      targetHeight: positiveNumberOrUndefined(ao.targetHeight),
      sizeCategory: isSizeCategory(ao.sizeCategory) ? ao.sizeCategory : undefined,
      walkableRegions: parseWalkableRegions(ao.walkableRegions),
      walkableHull: parseWalkableHull(ao.walkableHull),
      surfaceCenter: parseSurfaceCenter(ao.surfaceCenter),
      decorationZones: parseWalkableRegions(ao.decorationZones),
      authoredDecorations: parseAuthoredDecorations(ao.authoredDecorations),
      lastModifiedMs: positiveNumberOrUndefined(ao.lastModifiedMs),
    });
  }
  return {
    name: typeof obj.name === 'string' ? obj.name : 'platforms',
    savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date(0).toISOString(),
    assets,
  };
}
