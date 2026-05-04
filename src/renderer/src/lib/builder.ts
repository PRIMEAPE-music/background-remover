import type { AnchorKind, Rect } from './slicing';

/**
 * A single slot in the animation strip. `cell` points back to a source +
 * cell index so we don't duplicate pixel data. `yOffset` nudges the placed
 * sprite upward (positive) or downward (negative) inside its box — useful
 * for jump/aerial frames where the character should hover above the
 * baseline rather than land on it.
 */
export interface Slot {
  cell: { sourceId: string; cellIndex: number } | null;
  yOffset: number;
  /**
   * Per-slot multiplier applied on top of the character's global scale.
   * 1.0 = use global ratio. <1 shrinks, >1 grows. Lets the artist fix
   * outlier frames that don't match the auto-derived ratio.
   */
  scaleOverride: number;
}

/**
 * The character's locked scale. Set once per character by picking a
 * reference sprite (typically the idle pose) and declaring its target height
 * in pixels. Every other cell is scaled by the same ratio.
 */
export interface ScaleRef {
  sourceId: string;
  cellIndex: number;
  targetHeightPx: number;
  refNaturalHeight: number;
}

/**
 * One named animation on a character — e.g. "idle", "walk", "attack".
 * Has its own ordered slot list and playback speed. All animations share
 * the character's frame box, anchor, and scale lock.
 */
export interface Animation {
  id: string;
  name: string;
  slots: Slot[];
  /**
   * Playback speed — used by the in-app preview AND appended to the
   * exported PNG filename so the engine integrator knows what tick rate
   * to play it at.
   */
  fps: number;
  /**
   * Keys (KeyboardEvent.code values, e.g. "KeyW", "ArrowUp", "Space") that
   * trigger this animation in the Test mode. Multi-key supported. Stored
   * here so they survive project save/load alongside slots and fps.
   */
  testKeys?: string[];
  /**
   * When true, holding a bound key keeps the animation looping. When false,
   * pressing a bound key plays the animation once and the player returns to
   * the default (idle) animation. Default = true.
   */
  testLoop?: boolean;
  /**
   * Particle emitters attached to this animation. Each emitter has its own
   * timing window (startFrame / endFrame), offset from the anchor, and
   * full Phaser-shaped config. See the Emitter / EmitterConfig types below.
   */
  emitters?: Emitter[];
}

// ---- Particle emitter types ---------------------------------------------
//
// These types describe particle emitters attached to an animation. The shape
// mirrors Phaser 3's emitter config closely so the exported JSON can be fed
// directly to `scene.add.particles().createEmitter(config)` with minimal
// translation. Stored on Animation so each animation has its own particle
// behavior, and they round-trip cleanly through project save/load.

export type ProcShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'star';

/**
 * Where the emitter's particle texture comes from. Three kinds:
 *  - `procedural`: built at runtime from primitives (no image file). Cheapest
 *    and tiny in the JSON. Limited to a fixed shape vocabulary.
 *  - `bank`: a PNG from the cross-project user texture bank stored in the
 *    user-data directory. Resolved at export time by copying the file next
 *    to the project's particles JSON.
 *  - `projectSprite`: a cell from one of this project's source sheets. Lets
 *    you reuse an existing in-game asset (e.g. a slash trail) as a particle.
 */
export type TextureRef =
  | { kind: 'procedural'; shape: ProcShape; size: number; softness: number }
  | { kind: 'bank'; name: string }
  | { kind: 'projectSprite'; sourceId: string; cellIndex: number };

export type EmitterLayer = 'front' | 'back';

export type EmitterBlendMode = 'NORMAL' | 'ADD' | 'MULTIPLY' | 'SCREEN';

/**
 * Phaser-shaped emitter config. Numeric fields can be a single value or a
 * `{ min, max }` range — Phaser interprets ranges as random-per-particle.
 * `tint` accepts an array for random-per-particle color picking.
 */
export interface EmitterConfig {
  texture: TextureRef;
  tint: number | number[];
  lifespan: number | { min: number; max: number };
  speed: number | { min: number; max: number };
  /** Degrees. 0 = right, 90 = down, 180 = left, 270 = up. */
  angle: number | { min: number; max: number };
  /** Pixels/second^2 downward. Negative values rise. */
  gravityY: number;
  scale: number | { start: number; end: number };
  alpha: number | { start: number; end: number };
  /** Particles emitted per `frequency` tick. */
  quantity: number;
  /**
   * Milliseconds between emissions. -1 = burst-only: emit `quantity`
   * particles once per entry into the [startFrame..endFrame] window.
   */
  frequency: number;
  blendMode: EmitterBlendMode;

  // ---- Phaser-native motion extensions ----
  // All optional so existing presets/projects load unchanged. Defaults match
  // "no effect" — runtime can omit them entirely from the JSON if 0/unset.

  /** Constant horizontal acceleration applied per particle (px/s²). */
  accelerationX?: number | { min: number; max: number };
  /** Constant vertical acceleration applied per particle (px/s²). */
  accelerationY?: number | { min: number; max: number };
  /** Initial sprite rotation at emit time, degrees. Range = random per particle. */
  rotateStart?: number | { min: number; max: number };
  /** Continuous angular velocity in degrees/second. 0 = no spin. */
  rotateRate?: number;

  // ---- Synthetic motion modifiers ----
  // These don't have a single Phaser config field — both the editor preview
  // and the AscensionGame runtime apply them via a custom ParticleProcessor.
  // See lib/particles/phaserPreview.ts (editor) and AscensionGame's
  // particles/loadParticles.ts (runtime) for the equivalent implementations.

  /**
   * Tangential acceleration around the emitter center. Positive `strength`
   * spirals counter-clockwise, negative clockwise. Magnitude is in px/s² of
   * tangential acceleration applied to each particle's velocity.
   */
  swirl?: { strength: number };
  /**
   * Velocity-proportional decay. `coefficient` 0..5 typically — exponential
   * decay factor `e^(-coefficient * dt)` applied to vx/vy each frame.
   */
  drag?: number;
  /**
   * Sinusoidal position oscillation along one axis. `amplitude` is in pixels
   * of peak displacement, `frequency` in oscillations per second.
   */
  wave?: { amplitude: number; frequency: number; axis: 'x' | 'y' };
}

export interface Emitter {
  id: string;
  /** User-editable label, e.g. "foot-dust", "dash-trail". */
  name: string;
  /** Whether the emitter draws above (front) or below (back) the sprite. */
  layer: EmitterLayer;
  /** Animation frame index this emitter starts firing on. */
  startFrame: number;
  /**
   * Last frame the emitter fires on (inclusive). When omitted, the emitter
   * is a single-frame burst — fires once on entry into `startFrame` and
   * stops the next frame.
   */
  endFrame?: number;
  /** Pixels relative to the box anchor (e.g. bottom-center for feet). */
  offset: { x: number; y: number };
  config: EmitterConfig;
}

// ---- /Particle emitter types --------------------------------------------

/**
 * A cell selected in the gallery — the candidate that will get placed into the
 * next clicked slot. Same shape as `Slot.cell` (non-null), exported here so
 * builder UI components can share it without circular component imports.
 */
export interface SelectedCell {
  sourceId: string;
  cellIndex: number;
}

export const DEFAULT_FPS = 8;

export interface BuilderState {
  /** Fixed frame size for this character — typically 2× the largest sprite height. */
  boxSize: { w: number; h: number };
  /** Where the sprite anchors inside each box. Default bottom-center. */
  anchor: AnchorKind;
  /** Character-level scale lock. Set once, inherited by every animation. */
  scaleRef: ScaleRef | null;
  /** All animations the user has created for this character. */
  animations: Animation[];
  /** The animation currently being edited in the strip. */
  activeAnimationId: string | null;
  /**
   * IDs of source rows currently minimized in the gallery. Persists per
   * project so the user can keep unrelated sheets collapsed when working on
   * one specific animation.
   */
  collapsedSources: string[];
  /** When true, the gallery sorts source rows alphabetically by filename. */
  gallerySortByName: boolean;
  /**
   * Animation that plays in Test mode when no bound key is held. Defaults
   * to the first animation if unset. Persisted with the project.
   */
  testDefaultAnimationId?: string | null;
}

export const DEFAULT_BUILDER: BuilderState = {
  boxSize: { w: 128, h: 128 },
  anchor: 'bottom',
  scaleRef: null,
  animations: [],
  activeAnimationId: null,
  collapsedSources: [],
  gallerySortByName: false,
};

export function newAnimationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `anim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAnimation(name: string, slotCount = 8): Animation {
  return {
    id: newAnimationId(),
    name,
    slots: emptySlots(slotCount),
    fps: DEFAULT_FPS,
    testKeys: [],
    testLoop: true,
    emitters: [],
  };
}

export function emptySlots(count: number): Slot[] {
  return Array.from({ length: count }, () => ({ cell: null, yOffset: 0, scaleOverride: 1 }));
}

export function newEmitterId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `emitter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Default emitter config — a soft-falloff radial puff. Picked for "looks like
 * something" with one click, while leaving every parameter user-editable.
 */
export function defaultEmitterConfig(): EmitterConfig {
  return {
    texture: { kind: 'procedural', shape: 'circle', size: 6, softness: 0.5 },
    tint: 0xffffff,
    lifespan: { min: 300, max: 600 },
    speed: { min: 20, max: 60 },
    angle: { min: 0, max: 360 },
    gravityY: 0,
    scale: { start: 1, end: 0 },
    alpha: { start: 1, end: 0 },
    quantity: 1,
    frequency: 50,
    blendMode: 'NORMAL',
    // New optional fields default to 0/undefined ("no effect") so the editor
    // preview and exported JSON are byte-identical to before for any preset
    // not explicitly using these features.
    accelerationX: 0,
    accelerationY: 0,
    rotateStart: 0,
    rotateRate: 0,
  };
}

export function newEmitter(name: string, startFrame = 0): Emitter {
  return {
    id: newEmitterId(),
    name,
    layer: 'back',
    startFrame,
    offset: { x: 0, y: 0 },
    config: defaultEmitterConfig(),
  };
}

/** Deep-clone an emitter with a fresh id and a `(copy)` name suffix. */
export function cloneEmitter(e: Emitter, nameSuffix = ' (copy)'): Emitter {
  return {
    ...e,
    id: newEmitterId(),
    name: e.name + nameSuffix,
    offset: { ...e.offset },
    config: structuredClone(e.config),
  };
}

export function scaleRatio(ref: ScaleRef | null): number {
  if (!ref) return 1;
  if (ref.refNaturalHeight <= 0) return 1;
  return ref.targetHeightPx / ref.refNaturalHeight;
}

/** Final scale for a slot: global ratio × per-slot override. */
export function slotScale(ref: ScaleRef | null, slot: Slot): number {
  return scaleRatio(ref) * (slot.scaleOverride ?? 1);
}

export function getActiveAnimation(state: BuilderState): Animation | null {
  if (!state.activeAnimationId) return null;
  return state.animations.find((a) => a.id === state.activeAnimationId) ?? null;
}

/** Replace fields on the active animation and return a new state. Noop if none active. */
export function updateActiveAnimation(
  state: BuilderState,
  patch: Partial<Pick<Animation, 'name' | 'slots' | 'fps' | 'testKeys' | 'testLoop' | 'emitters'>>,
): BuilderState {
  if (!state.activeAnimationId) return state;
  return {
    ...state,
    animations: state.animations.map((a) =>
      a.id === state.activeAnimationId ? { ...a, ...patch } : a,
    ),
  };
}

/**
 * Migrate any previously-saved BuilderState shape into the current one.
 * Earlier versions stored a single animation as top-level `slots` +
 * `animationName`. We re-wrap that into the `animations` array so old
 * localStorage / project files still open.
 */
export function migrateBuilderState(raw: unknown): BuilderState {
  if (!raw || typeof raw !== 'object') return DEFAULT_BUILDER;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.animations)) {
    // Already new-ish shape — backfill fps + test + emitters fields on
    // animations saved before those existed.
    const animations = (obj.animations as Animation[]).map((a) => ({
      ...a,
      fps: typeof a.fps === 'number' && a.fps > 0 ? a.fps : DEFAULT_FPS,
      testKeys: Array.isArray(a.testKeys)
        ? a.testKeys.filter((k) => typeof k === 'string')
        : [],
      testLoop: typeof a.testLoop === 'boolean' ? a.testLoop : true,
      emitters: Array.isArray(a.emitters) ? a.emitters : [],
    }));
    const testDefaultRaw =
      typeof obj.testDefaultAnimationId === 'string' ? obj.testDefaultAnimationId : null;
    const testDefault = testDefaultRaw && animations.some((a) => a.id === testDefaultRaw)
      ? testDefaultRaw
      : null;
    return {
      boxSize: (obj.boxSize as BuilderState['boxSize']) ?? DEFAULT_BUILDER.boxSize,
      anchor: (obj.anchor as BuilderState['anchor']) ?? DEFAULT_BUILDER.anchor,
      scaleRef: (obj.scaleRef as BuilderState['scaleRef']) ?? null,
      animations,
      activeAnimationId:
        (obj.activeAnimationId as string | null) ??
        (animations.length > 0 ? animations[0].id : null),
      collapsedSources: Array.isArray(obj.collapsedSources)
        ? (obj.collapsedSources as string[]).filter((x) => typeof x === 'string')
        : [],
      gallerySortByName:
        typeof obj.gallerySortByName === 'boolean' ? obj.gallerySortByName : false,
      testDefaultAnimationId: testDefault,
    };
  }
  // Old shape: top-level slots + animationName
  const oldSlots = Array.isArray(obj.slots) ? (obj.slots as Slot[]) : [];
  const oldName = typeof obj.animationName === 'string' ? obj.animationName : 'animation';
  const animations: Animation[] =
    oldSlots.length > 0
      ? [{ id: newAnimationId(), name: oldName, slots: oldSlots, fps: DEFAULT_FPS }]
      : [];
  return {
    boxSize: (obj.boxSize as BuilderState['boxSize']) ?? DEFAULT_BUILDER.boxSize,
    anchor: (obj.anchor as BuilderState['anchor']) ?? DEFAULT_BUILDER.anchor,
    scaleRef: (obj.scaleRef as BuilderState['scaleRef']) ?? null,
    animations,
    activeAnimationId: animations[0]?.id ?? null,
    collapsedSources: [],
    gallerySortByName: false,
  };
}

/**
 * Scan the opaque pixels inside `rect` (coords are absolute within `source`)
 * and return the tight bounding box of content, expressed in rect-local
 * coordinates. Used when rendering a slot so we can preserve the character's
 * natural silhouette proportions when scaling.
 */
export function contentBoundsInRect(
  source: ImageData,
  rect: Rect,
  alphaThreshold = 0,
): Rect | null {
  const w = source.width;
  const h = source.height;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(w, rect.x + rect.width);
  const y1 = Math.min(h, rect.y + rect.height);
  const data = source.data;
  let minX = x1;
  let minY = y1;
  let maxX = x0 - 1;
  let maxY = y0 - 1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < x0) return null;
  return {
    x: minX - rect.x,
    y: minY - rect.y,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Where to draw a sprite of `drawW × drawH` inside a `box`, per anchor, plus
 * a vertical nudge (`yOffset` lifts it upward).
 */
export function computeAnchorPos(
  anchor: AnchorKind,
  box: { w: number; h: number },
  drawW: number,
  drawH: number,
  yOffset: number,
): { dx: number; dy: number } {
  let dx = Math.round((box.w - drawW) / 2);
  if (anchor.includes('left')) dx = 0;
  else if (anchor.includes('right')) dx = box.w - drawW;
  let dy = Math.round((box.h - drawH) / 2);
  if (anchor.includes('top')) dy = 0;
  else if (anchor.includes('bottom')) dy = box.h - drawH;
  return { dx, dy: dy - yOffset };
}
