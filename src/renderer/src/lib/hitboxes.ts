/**
 * Hitbox manifest types for character / enemy / boss sprite sheets.
 * Authoring lives in bg-remover's Hitboxes mode; the same JSON gets
 * dropped into AscensionGame's `assets/hitboxes/` folder where the
 * runtime reads it (mirrored types in `HitboxLibrary.ts`).
 *
 * Two things are authored together because they're the same data:
 *
 *   (A) Static body — one rectangle that defines where the entity
 *       collides with platforms / takes damage by default. Replaces
 *       the hand-tuned `BODY_WIDTH/HEIGHT/OFFSET_*` constants in
 *       AnimationConfig.ts with a visual workflow.
 *
 *   (B) Per-frame hit + hurt boxes — for each animation sheet, you
 *       can override the body per frame AND draw additional boxes:
 *         - `hurt`: where the entity can BE hit by attacks (multiple
 *           allowed for limbs, head, etc.).
 *         - `attack`: where the entity damages others when this
 *           frame is active. Carries its own damage / knockback so
 *           the runtime can dispatch hits per frame without
 *           hardcoded combat sweeps.
 *
 * Frames without entries fall back to `defaultBody` for collision
 * + a single hurt box matching the body. That keeps existing
 * characters working with just a defaultBody authored.
 */

/** A single rectangle hitbox. Coordinates are in SOURCE PIXELS
 *  relative to the sprite frame's TOP-LEFT corner — same coordinate
 *  system Phaser's `Body.setOffset(x, y)` and `setSize(w, h)` use,
 *  so the runtime can pass them through with a scale multiplier. */
export interface HitboxRect {
  /** Frame-local x of top-left corner. */
  x: number;
  /** Frame-local y of top-left corner. */
  y: number;
  /** Width in source pixels. */
  w: number;
  /** Height in source pixels. */
  h: number;
  /** Author-time tag — purely cosmetic, useful for "head", "leg",
   *  "weapon-tip" etc. when reading the manifest. */
  tag?: string;
  /** Damage dealt when this attack box overlaps a hurt box. Only
   *  meaningful for `attack` boxes. */
  damage?: number;
  /** Knockback velocity applied to the hit entity. Sign of x is
   *  resolved from the attacker's facing at hit time, so positive
   *  means "outward from attacker". Only for `attack` boxes. */
  knockbackX?: number;
  knockbackY?: number;
  /** Whether this attack hits the same target multiple times during
   *  one play of the animation. Default false (one hit per swing). */
  multiHit?: boolean;
}

/** Boxes for a single animation frame. All fields optional; the
 *  runtime inherits defaultBody when `body` is missing and defaults
 *  to no hurt / attack boxes when those arrays are empty. */
export interface HitboxFrame {
  /** Optional per-frame override of the body (collision + default
   *  hurt). When omitted, the entity's `defaultBody` is used. */
  body?: HitboxRect;
  /** Where this frame can BE hit. Empty array = use the body as
   *  the implicit hurt zone. Multiple boxes allowed (head + body). */
  hurt: HitboxRect[];
  /** Where this frame DEALS damage. Empty = inactive frame (no hits
   *  during this frame even if part of an attack animation). */
  attack: HitboxRect[];
}

/** Per-sheet dimensions + per-frame overrides. The sheet is keyed by
 *  its filename (relative to the project folder) so multiple sheets
 *  per entity (idle / walk / lunge / etc.) coexist cleanly. */
export interface HitboxSheet {
  filename: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Sparse map of frame index -> overrides. Frames not present in
   *  the map use the entity's defaults. */
  framesByIndex: { [frameIndex: number]: HitboxFrame };
}

/** A single entity's complete hitbox manifest. */
export interface HitboxEntity {
  /** Stable identifier — runtime looks up by this. e.g. "newborn". */
  id: string;
  /** The default body rectangle used when no per-frame override
   *  exists. Replaces hardcoded BODY_* constants. Source-pixel
   *  rectangle relative to the sprite frame's top-left, same
   *  coordinate space as Phaser's body offset + size. Null only
   *  when the entity has been authored without any body yet. */
  defaultBody: HitboxRect | null;
  /** Optional notes, author-time only. */
  notes?: string;
}

/** Top-level project file written to `hitboxes.json` inside the
 *  user's hitbox project folder. */
export interface HitboxProject {
  name: string;
  savedAt: string;
  /** Entities authored in this project. Most projects have 1 entity
   *  but you can group related characters (e.g. all mongrels). */
  entities: HitboxEntity[];
  /** Sheets indexed by entity id then filename. Kept separate from
   *  entities so the same sheet metadata can be referenced cleanly
   *  while the schema evolves. */
  sheets: { [entityId: string]: HitboxSheet[] };
}

export const DEFAULT_HITBOX_PROJECT: HitboxProject = {
  name: "hitboxes",
  savedAt: new Date(0).toISOString(),
  entities: [],
  sheets: {},
};

// ─── Parsing ────────────────────────────────────────────────────────

function parseRect(raw: unknown): HitboxRect | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  const out: HitboxRect = { x, y, w, h };
  if (typeof o.tag === "string") out.tag = o.tag;
  if (typeof o.damage === "number" && Number.isFinite(o.damage)) {
    out.damage = o.damage;
  }
  if (typeof o.knockbackX === "number" && Number.isFinite(o.knockbackX)) {
    out.knockbackX = o.knockbackX;
  }
  if (typeof o.knockbackY === "number" && Number.isFinite(o.knockbackY)) {
    out.knockbackY = o.knockbackY;
  }
  if (o.multiHit === true) out.multiHit = true;
  return out;
}

function parseRects(raw: unknown): HitboxRect[] {
  if (!Array.isArray(raw)) return [];
  const out: HitboxRect[] = [];
  for (const r of raw) {
    const parsed = parseRect(r);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseFrame(raw: unknown): HitboxFrame {
  if (!raw || typeof raw !== "object") return { hurt: [], attack: [] };
  const o = raw as Record<string, unknown>;
  return {
    body: parseRect(o.body) ?? undefined,
    hurt: parseRects(o.hurt),
    attack: parseRects(o.attack),
  };
}

function parseSheet(raw: unknown): HitboxSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.filename !== "string") return null;
  const frameWidth = Number(o.frameWidth) || 0;
  const frameHeight = Number(o.frameHeight) || 0;
  const frameCount = Math.max(1, Number(o.frameCount) || 1);
  const framesByIndex: HitboxSheet["framesByIndex"] = {};
  if (o.framesByIndex && typeof o.framesByIndex === "object") {
    const fbi = o.framesByIndex as Record<string, unknown>;
    for (const [k, v] of Object.entries(fbi)) {
      const idx = Number(k);
      if (!Number.isFinite(idx) || idx < 0 || idx >= frameCount) continue;
      framesByIndex[idx] = parseFrame(v);
    }
  }
  return {
    filename: o.filename,
    frameWidth,
    frameHeight,
    frameCount,
    framesByIndex,
  };
}

export function migrateHitboxProject(raw: unknown): HitboxProject {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_HITBOX_PROJECT };
  const obj = raw as Record<string, unknown>;
  const entities: HitboxEntity[] = [];
  if (Array.isArray(obj.entities)) {
    for (const e of obj.entities) {
      if (!e || typeof e !== "object") continue;
      const eo = e as Record<string, unknown>;
      if (typeof eo.id !== "string") continue;
      entities.push({
        id: eo.id,
        defaultBody: parseRect(eo.defaultBody),
        notes: typeof eo.notes === "string" ? eo.notes : undefined,
      });
    }
  }
  const sheets: HitboxProject["sheets"] = {};
  if (obj.sheets && typeof obj.sheets === "object") {
    for (const [entityId, list] of Object.entries(
      obj.sheets as Record<string, unknown>,
    )) {
      if (!Array.isArray(list)) continue;
      const parsedSheets: HitboxSheet[] = [];
      for (const s of list) {
        const parsed = parseSheet(s);
        if (parsed) parsedSheets.push(parsed);
      }
      sheets[entityId] = parsedSheets;
    }
  }
  return {
    name: typeof obj.name === "string" ? obj.name : "hitboxes",
    savedAt:
      typeof obj.savedAt === "string"
        ? obj.savedAt
        : new Date(0).toISOString(),
    entities,
    sheets,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Resolve the effective body for a given frame: per-frame override
 *  if present, otherwise the entity's defaultBody, otherwise null. */
export function resolveBody(
  entity: HitboxEntity,
  frame: HitboxFrame | undefined,
): HitboxRect | null {
  return frame?.body ?? entity.defaultBody ?? null;
}

/** Build a fresh empty frame entry. */
export function emptyFrame(): HitboxFrame {
  return { hurt: [], attack: [] };
}

/** Generate a sensible default rect centered on a sheet's frame —
 *  used when creating a new body box without any prior data. */
export function defaultRectForFrame(
  frameWidth: number,
  frameHeight: number,
): HitboxRect {
  const w = Math.max(8, Math.round(frameWidth * 0.4));
  const h = Math.max(8, Math.round(frameHeight * 0.5));
  const x = Math.round((frameWidth - w) / 2);
  const y = Math.round((frameHeight - h) / 2);
  return { x, y, w, h };
}
