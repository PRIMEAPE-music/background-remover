import {
  type Animation,
  type BuilderState,
  type Emitter,
  type EmitterConfig,
  type ProcShape,
  type TextureRef,
} from './builder';
import { getBankBytes } from './particles/bank';
import type { SourceMeta } from './sources';

/**
 * Particles export — produces a JSON shape that an in-game runtime (Phaser
 * 3 in AscensionGame's case) can consume directly. The exported texture
 * union differs from the in-app one in two ways:
 *
 *   1. `projectSprite` references the source's filename rather than its
 *      internal id, so the runtime can resolve it against whatever sheet
 *      it has loaded under that filename.
 *   2. `bank` references stay as `{ kind: 'bank', name }` and rely on the
 *      runtime finding `<name>.png` next to the JSON (or in a configured
 *      texture directory). Bank PNGs are bundled into the export folder
 *      via `bundleBankTextures`.
 *
 * Procedural references export verbatim — the runtime regenerates them.
 */

export type ExportedTextureRef =
  | { kind: 'procedural'; shape: ProcShape; size: number; softness: number }
  | { kind: 'bank'; name: string }
  | { kind: 'projectSprite'; sourceFilename: string; cellIndex: number };

export interface ExportedEmitterConfig
  extends Omit<EmitterConfig, 'texture'> {
  texture: ExportedTextureRef;
}

export interface ExportedEmitter
  extends Omit<Emitter, 'config' | 'id'> {
  config: ExportedEmitterConfig;
}

export interface ExportedAnimationJson {
  name: string;
  fps: number;
  boxSize: { w: number; h: number };
  anchor: BuilderState['anchor'];
  emitters: ExportedEmitter[];
}

export interface ExportedProjectJson {
  project: string;
  boxSize: { w: number; h: number };
  anchor: BuilderState['anchor'];
  animations: Record<string, { fps: number; emitters: ExportedEmitter[] }>;
}

// ---- Builders -----------------------------------------------------------

export function buildAnimationParticleJson(
  anim: Animation,
  builder: BuilderState,
  sources: SourceMeta[],
): ExportedAnimationJson {
  return {
    name: anim.name,
    fps: anim.fps,
    boxSize: builder.boxSize,
    anchor: builder.anchor,
    emitters: (anim.emitters ?? []).map((e) => transformEmitter(e, sources)),
  };
}

export function buildProjectParticleJson(
  builder: BuilderState,
  sources: SourceMeta[],
  projectName: string,
): ExportedProjectJson {
  const animations: ExportedProjectJson['animations'] = {};
  for (const a of builder.animations) {
    animations[a.name] = {
      fps: a.fps,
      emitters: (a.emitters ?? []).map((e) => transformEmitter(e, sources)),
    };
  }
  return {
    project: projectName,
    boxSize: builder.boxSize,
    anchor: builder.anchor,
    animations,
  };
}

function transformEmitter(e: Emitter, sources: SourceMeta[]): ExportedEmitter {
  const { id: _id, config, ...rest } = e;
  void _id;
  return {
    ...rest,
    config: {
      ...config,
      texture: transformTextureRef(config.texture, sources),
    },
  };
}

function transformTextureRef(t: TextureRef, sources: SourceMeta[]): ExportedTextureRef {
  if (t.kind === 'projectSprite') {
    const src = sources.find((s) => s.id === t.sourceId);
    return {
      kind: 'projectSprite',
      sourceFilename: src?.filename ?? `unknown_${t.sourceId.slice(0, 8)}.png`,
      cellIndex: t.cellIndex,
    };
  }
  // procedural and bank pass through unchanged.
  return t as ExportedTextureRef;
}

// ---- Texture bundling ---------------------------------------------------

/**
 * Walk every emitter and collect the unique bank-texture names it
 * references. Procedural and project-sprite textures need no bundling.
 */
export function collectBankTextures(emitters: Emitter[]): string[] {
  const names = new Set<string>();
  for (const e of emitters) {
    if (e.config.texture.kind === 'bank') names.add(e.config.texture.name);
  }
  return [...names].sort();
}

/**
 * Copy referenced bank PNGs into `targetDir` (flat, no subfolder). The
 * runtime is expected to find `<name>.png` next to the particles JSON.
 *
 * Reads raw PNG bytes via the bank module so we don't decode + re-encode
 * unnecessarily.
 */
export async function bundleBankTextures(
  targetDir: string,
  emitters: Emitter[],
): Promise<{ written: string[]; missing: string[] }> {
  const names = collectBankTextures(emitters);
  const written: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const bytes = await getBankBytes(name);
    if (!bytes) {
      missing.push(name);
      continue;
    }
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await window.api.writeFile(joinPath(targetDir, `${name}.png`), buf);
    written.push(name);
  }
  return { written, missing };
}

// ---- Path / encoding helpers --------------------------------------------

export function joinPath(folder: string, child: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + child : `${folder}${sep}${child}`;
}

export function dirname(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/';
  const i = path.lastIndexOf(sep);
  return i >= 0 ? path.substring(0, i) : path;
}

/** Encode an arbitrary value as a UTF-8 ArrayBuffer ready for `writeFile`. */
export function encodeJsonBytes(value: unknown): ArrayBuffer {
  const text = JSON.stringify(value, null, 2);
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** File-safe project name — strips path separators / control chars. */
export function safeProjectFilename(name: string): string {
  return (
    (name || 'project').replace(/[^\w\-]+/g, '_').replace(/^\.+/, '').slice(0, 64) ||
    'project'
  );
}
