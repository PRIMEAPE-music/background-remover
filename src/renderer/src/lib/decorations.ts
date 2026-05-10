/**
 * Decoration manifest types — used by the Decorations mode in bg-remover
 * and exported verbatim into the manifest that AscensionGame consumes.
 *
 * A decoration is a sprite (animated sheet OR static single image) that
 * gets scattered onto platform tops at runtime. Each decoration has:
 *   - Asset metadata (filename, frame layout if a sheet)
 *   - Runtime classification (category, size-class)
 *   - A list of behaviors the runtime is allowed to assign to spawned
 *     instances, with weights for weighted-random selection — so the
 *     same sprite can show up with different behaviors across spawns
 *     (one altar quietly looping, another waking up when the player
 *     stands on its platform).
 *
 * Keep this file dependency-free so the shape stays portable into both
 * apps without bundler trouble.
 */

export type DecorationBiome = 'DEPTHS' | 'CAVERNS' | 'SPIRE' | 'SUMMIT';

export const DECORATION_BIOMES: readonly DecorationBiome[] = [
  'DEPTHS',
  'CAVERNS',
  'SPIRE',
  'SUMMIT',
];

/**
 * Categories steer where each decoration is allowed to spawn:
 *  - flora: small ground cover, scatters densely on most platforms.
 *  - decor: medium-sized props (mushrooms, vines, stumps), sparser.
 *  - feature: prominent set pieces (altars), at most one per platform.
 *  - effect: transient animations (dust, spores) — usually triggered
 *    by player events rather than placed on platforms.
 *  - hazard_visual: tied to the hazard system (poison flower / pool).
 *    The runtime treats these as the visual half of a damage hazard.
 */
export type DecorationCategory = 'flora' | 'decor' | 'feature' | 'effect' | 'hazard_visual';

export const DECORATION_CATEGORIES: readonly DecorationCategory[] = [
  'flora',
  'decor',
  'feature',
  'effect',
  'hazard_visual',
];

/**
 * Visual size classes — drive how often a decoration appears, what
 * platform widths it's allowed on, and its render scale relative to
 * the platform. Source frames are typically 512×512, but the visible
 * content within varies wildly (a grass tuft fills 200×80, an altar
 * fills the full frame), so this is a hand-tuned authoring label
 * rather than something inferred from pixel dimensions.
 */
export type DecorationSizeClass = 'tiny' | 'small' | 'medium' | 'large';

export const DECORATION_SIZE_CLASSES: readonly DecorationSizeClass[] = [
  'tiny',
  'small',
  'medium',
  'large',
];

/**
 * Behavior kinds — the state-machine playback rule a runtime instance
 * follows. The runtime picks one per instance from the asset's
 * `allowedBehaviors` list, weighted-random. Keep this list synced with
 * the runtime's behavior implementation in AscensionGame.
 *
 *   - static: single image, no animation. Default for `singles`.
 *   - loop: plays at fps forever. Default for sheets.
 *   - randomBurst: idle → play once → idle (random interval).
 *   - proximity: plays while player is within radius.
 *   - pass: one-shot when player crosses the decoration's x.
 *   - onPlatformOccupied: plays while player stands on parent platform.
 *   - stuckMidFrame: plays to mid-frame, holds, finishes when player
 *     leaves the proximity/platform trigger zone.
 *   - onLanding / onJump: triggered by player events (used for dust,
 *     spores). Usually spawned by PlayerEvents, not platform scatter.
 */
export type DecorationBehaviorKind =
  | 'static'
  | 'loop'
  | 'randomBurst'
  | 'proximity'
  | 'pass'
  | 'onPlatformOccupied'
  | 'stuckMidFrame'
  | 'onLanding'
  | 'onJump'
  | 'flyAway';

export const DECORATION_BEHAVIORS: readonly DecorationBehaviorKind[] = [
  'static',
  'loop',
  'randomBurst',
  'proximity',
  'pass',
  'onPlatformOccupied',
  'stuckMidFrame',
  'onLanding',
  'onJump',
  'flyAway',
];

export interface DecorationBehaviorWeight {
  kind: DecorationBehaviorKind;
  /** Relative weight in the random pick. The runtime normalizes
   *  weights at scatter time, so absolute scale doesn't matter. */
  weight: number;
}

/** Common fields across both kinds. */
interface DecorationBase {
  id: string;
  filename: string;
  biome: DecorationBiome;
  category: DecorationCategory;
  sizeClass: DecorationSizeClass;
  /** Where on the sprite the runtime anchors its world position.
   *  "bottom" means y = walking-surface y; the sprite stretches up
   *  from there. Most flora and props are bottom-anchored.
   *  "center" anchors mid-sprite — useful for floating things (moths). */
  anchor: 'bottom' | 'center';
  /** Where on the platform the decoration sits.
   *   - 'topside' (default): rests on top of the walkable surface
   *     (grass, mushrooms, altars).
   *   - 'underside': hangs from the BOTTOM of the platform (vines,
   *     moss tendrils). The runtime anchors at the platform's visible
   *     bottom and lets the sprite extend downward, so the PNG should
   *     be authored with its attachment point at the TOP of the frame. */
  placement?: 'topside' | 'underside';
  /** Optional: pixels of empty (transparent) space at the bottom of the
   *  source PNG. The runtime shifts the sprite down by this many source
   *  pixels (scaled by renderScale) so the visible content's bottom
   *  lines up with the walking surface, instead of floating above it
   *  due to padding inside the bounding box. Default 0 = no shift. */
  visibleBottomPadding?: number;
  /** When true, the decoration renders FLAT on the ground (like a
   *  puddle, mat, or rune circle) instead of standing upright. The
   *  runtime anchors the sprite at bottom-center on the walking
   *  surface, lowers its depth so it sits BELOW standalone decorations,
   *  and (if `flatWidth` / `flatHeight` are set) stretches the sprite
   *  to those exact world-pixel dimensions — letting you author flat
   *  things at any aspect, not just the poison-pool ratio. */
  flatGround?: boolean;
  /** Display width in WORLD pixels when `flatGround` is true. Omit to
   *  use the natural sprite width × render scale (just the standard
   *  size, but rendered flat at lower depth). */
  flatWidth?: number;
  /** Display height in WORLD pixels when `flatGround` is true. Omit to
   *  use the natural sprite height × render scale. */
  flatHeight?: number;
  /** Max display height (world px) for spawned instances. The runtime
   *  clamps each spawn to this value AFTER applying scale jitter, so
   *  the decoration never overshoots — even when the random jitter
   *  rolled high. Omit to fall back to the global default cap. Only
   *  applies when `flatGround` is false; flat sprites use the explicit
   *  `flatHeight` instead. */
  maxHeight?: number;
  /** Multiplier on the final render scale across every spawn path
   *  (scatter, authored placement, player-event one-shots). Default 1.
   *  Lets you nudge an individual decoration up or down without
   *  touching the global render scale or per-instance jitter. e.g. 0.2
   *  shrinks the dust burst at the player's feet to a fifth of its
   *  default size. Multiplies `flatWidth`/`flatHeight` for flat sprites
   *  and `setScale` for standing ones. */
  sizeScale?: number;
  /** When true, the runtime LOCKS the decoration to its `sizeScale`
   *  multiplier — bypasses the per-spawn tier roll, scale jitter,
   *  AND max-height clamp. Use for assets where you want every
   *  spawn to render at exactly the same size (e.g. a hand-tuned
   *  signature feature). Default behavior (off): tier × jitter ×
   *  sizeScale, with the height cap applied. */
  overrideSize?: boolean;
  allowedBehaviors: DecorationBehaviorWeight[];
  /** Author-time notes shown only in bg-remover. */
  notes?: string;
}

/** Animated decoration with multiple frames laid out horizontally. */
export interface DecorationSheet extends DecorationBase {
  kind: 'sheet';
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  /** Index of the "midpoint" frame for stuckMidFrame behavior — the
   *  animation pauses here until the player leaves. Default = floor(frameCount/2). */
  pauseFrame?: number;
  /** First frame of the TAIL loop for `flyAway` behavior. The runtime
   *  plays frames [0, flyAwayLoopStartFrame) once as an intro, then
   *  loops [flyAwayLoopStartFrame, frameCount) forever while the
   *  sprite drifts away from its parent platform until off-screen.
   *  Use for moths / sprites that "wake up" on spawn and then leave. */
  flyAwayLoopStartFrame?: number;
  /** When true, the runtime destroys the sprite as soon as its
   *  triggered animation completes its first play-through. Use for
   *  one-shot effects: rocks breaking, bones crumbling, spores
   *  dispersing. For trigger-loop behaviors (proximity /
   *  onPlatformOccupied) the runtime ALSO switches to a one-shot
   *  play so the completion event actually fires. Ignored for
   *  `loop`, `static`, and `flyAway` — those have their own
   *  lifecycle. */
  vanishAfterAnim?: boolean;
  /** Frame on which the runtime spawns a chained hazard (poison flower
   *  → poison_pool). Only used when category === 'hazard_visual'. */
  spawnHazardOnFrame?: {
    hazardKind: string;
    frame: number;
    offsetY?: number;
  };
}

/** Static, single-image decoration. No animation. */
export interface DecorationSingle extends DecorationBase {
  kind: 'single';
  width: number;
  height: number;
}

export type Decoration = DecorationSheet | DecorationSingle;

export interface DecorationProject {
  name: string;
  savedAt: string;
  decorations: Decoration[];
}

export const DEFAULT_DECORATION_PROJECT: DecorationProject = {
  name: 'decorations',
  savedAt: new Date(0).toISOString(),
  decorations: [],
};

// ---- Migration / parsing -----------------------------------------------

function isBiome(v: unknown): v is DecorationBiome {
  return typeof v === 'string' && (DECORATION_BIOMES as readonly string[]).includes(v);
}

function isCategory(v: unknown): v is DecorationCategory {
  return typeof v === 'string' && (DECORATION_CATEGORIES as readonly string[]).includes(v);
}

function isSizeClass(v: unknown): v is DecorationSizeClass {
  return typeof v === 'string' && (DECORATION_SIZE_CLASSES as readonly string[]).includes(v);
}

function isBehavior(v: unknown): v is DecorationBehaviorKind {
  return typeof v === 'string' && (DECORATION_BEHAVIORS as readonly string[]).includes(v);
}

function parseBehaviorWeights(raw: unknown): DecorationBehaviorWeight[] {
  if (!Array.isArray(raw)) return [];
  const out: DecorationBehaviorWeight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { kind?: unknown; weight?: unknown };
    if (!isBehavior(o.kind)) continue;
    const weight = typeof o.weight === 'number' && o.weight > 0 ? o.weight : 1;
    out.push({ kind: o.kind, weight });
  }
  return out;
}

/** Merge author-edited fields into a parsed decoration, preferring
 *  authored values but never producing nonsense (e.g. a sheet without
 *  frameCount or fps). */
export function migrateDecorationProject(raw: unknown): DecorationProject {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DECORATION_PROJECT };
  const obj = raw as Record<string, unknown>;
  const rawDecos = Array.isArray(obj.decorations) ? obj.decorations : [];
  const decorations: Decoration[] = [];
  for (const d of rawDecos) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : null;
    const filename = typeof o.filename === 'string' ? o.filename : null;
    const kind = o.kind === 'sheet' ? 'sheet' : o.kind === 'single' ? 'single' : null;
    if (!id || !filename || !kind) continue;
    const biome = isBiome(o.biome) ? o.biome : 'DEPTHS';
    const category = isCategory(o.category) ? o.category : 'decor';
    const sizeClass = isSizeClass(o.sizeClass) ? o.sizeClass : 'small';
    const anchor = o.anchor === 'center' ? 'center' : 'bottom';
    const placement: 'topside' | 'underside' =
      o.placement === 'underside' ? 'underside' : 'topside';
    const visibleBottomPadding =
      typeof o.visibleBottomPadding === 'number' &&
      Number.isFinite(o.visibleBottomPadding) &&
      o.visibleBottomPadding > 0
        ? o.visibleBottomPadding
        : undefined;
    const flatGround = o.flatGround === true ? true : undefined;
    const flatWidth =
      typeof o.flatWidth === 'number' &&
      Number.isFinite(o.flatWidth) &&
      o.flatWidth > 0
        ? o.flatWidth
        : undefined;
    const flatHeight =
      typeof o.flatHeight === 'number' &&
      Number.isFinite(o.flatHeight) &&
      o.flatHeight > 0
        ? o.flatHeight
        : undefined;
    const maxHeight =
      typeof o.maxHeight === 'number' &&
      Number.isFinite(o.maxHeight) &&
      o.maxHeight > 0
        ? o.maxHeight
        : undefined;
    const sizeScale =
      typeof o.sizeScale === 'number' &&
      Number.isFinite(o.sizeScale) &&
      o.sizeScale > 0
        ? o.sizeScale
        : undefined;
    const overrideSize = o.overrideSize === true ? true : undefined;
    const allowedBehaviors = parseBehaviorWeights(o.allowedBehaviors);
    const notes = typeof o.notes === 'string' ? o.notes : undefined;
    if (kind === 'sheet') {
      const frameWidth = Number(o.frameWidth) || 512;
      const frameHeight = Number(o.frameHeight) || 512;
      const frameCount = Math.max(1, Number(o.frameCount) || 1);
      const fps = Math.max(1, Number(o.fps) || 6);
      const pauseFrame =
        typeof o.pauseFrame === 'number' && o.pauseFrame >= 0
          ? Math.min(o.pauseFrame, frameCount - 1)
          : undefined;
      const flyAwayLoopStartFrame =
        typeof o.flyAwayLoopStartFrame === 'number' &&
        o.flyAwayLoopStartFrame >= 1 &&
        o.flyAwayLoopStartFrame < frameCount
          ? Math.floor(o.flyAwayLoopStartFrame)
          : undefined;
      const vanishAfterAnim = o.vanishAfterAnim === true ? true : undefined;
      const spawnHazardOnFrame =
        o.spawnHazardOnFrame && typeof o.spawnHazardOnFrame === 'object'
          ? (() => {
              const s = o.spawnHazardOnFrame as Record<string, unknown>;
              if (typeof s.hazardKind !== 'string' || typeof s.frame !== 'number') {
                return undefined;
              }
              return {
                hazardKind: s.hazardKind,
                frame: s.frame,
                offsetY: typeof s.offsetY === 'number' ? s.offsetY : undefined,
              };
            })()
          : undefined;
      decorations.push({
        id, filename, kind: 'sheet', biome, category, sizeClass, anchor,
        placement, visibleBottomPadding,
        flatGround, flatWidth, flatHeight, maxHeight, sizeScale, overrideSize,
        allowedBehaviors, notes,
        frameWidth, frameHeight, frameCount, fps,
        pauseFrame, spawnHazardOnFrame, flyAwayLoopStartFrame,
        vanishAfterAnim,
      });
    } else {
      decorations.push({
        id, filename, kind: 'single', biome, category, sizeClass, anchor,
        placement, visibleBottomPadding,
        flatGround, flatWidth, flatHeight, maxHeight, sizeScale, overrideSize,
        allowedBehaviors: allowedBehaviors.length > 0
          ? allowedBehaviors
          : [{ kind: 'static', weight: 1 }],
        notes,
        width: Number(o.width) || 0,
        height: Number(o.height) || 0,
      });
    }
  }
  return {
    name: typeof obj.name === 'string' ? obj.name : 'decorations',
    savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date(0).toISOString(),
    decorations,
  };
}
