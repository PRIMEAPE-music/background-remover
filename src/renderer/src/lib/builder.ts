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
  return { id: newAnimationId(), name, slots: emptySlots(slotCount), fps: DEFAULT_FPS };
}

export function emptySlots(count: number): Slot[] {
  return Array.from({ length: count }, () => ({ cell: null, yOffset: 0, scaleOverride: 1 }));
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
  patch: Partial<Pick<Animation, 'name' | 'slots' | 'fps'>>,
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
    // Already new-ish shape — backfill fps for animations saved before that field existed.
    const animations = (obj.animations as Animation[]).map((a) => ({
      ...a,
      fps: typeof a.fps === 'number' && a.fps > 0 ? a.fps : DEFAULT_FPS,
    }));
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
