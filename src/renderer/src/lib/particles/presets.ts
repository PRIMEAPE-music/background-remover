import {
  newEmitter as makeNewEmitter,
  newEmitterId,
  type Emitter,
} from '../builder';

/**
 * Cross-project emitter preset library: JSON files under
 * `<userData>/emitter-presets/`. Each file is a serialized `Emitter` minus
 * its id (id is generated fresh whenever a preset is loaded into a project,
 * so you can apply the same preset to multiple emitters without collisions).
 */

const PRESETS_SUBDIR = 'emitter-presets';

export interface PresetEntry {
  /** Filename without extension — what users see in the picker. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Stored payload — an emitter with no id. */
  emitter: Omit<Emitter, 'id'>;
}

let cachedPresetsDir: string | null = null;

async function getPresetsDir(): Promise<string> {
  if (cachedPresetsDir) return cachedPresetsDir;
  const userData = await window.api.getUserDataPath();
  cachedPresetsDir = joinPath(userData, PRESETS_SUBDIR);
  return cachedPresetsDir;
}

function joinPath(folder: string, child: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + child : `${folder}${sep}${child}`;
}

export async function ensurePresetsDir(): Promise<string> {
  const dir = await getPresetsDir();
  await window.api.mkdir(dir);
  return dir;
}

/** List every preset, parsed and sorted alphabetically. Skips malformed JSON. */
export async function listPresets(): Promise<PresetEntry[]> {
  const dir = await getPresetsDir();
  const entries = await window.api.listDir(dir);
  const out: PresetEntry[] = [];
  for (const e of entries) {
    if (!/\.json$/i.test(e)) continue;
    const path = joinPath(dir, e);
    try {
      const bytes = await window.api.readFile(path);
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text) as Omit<Emitter, 'id'>;
      out.push({ name: e.replace(/\.json$/i, ''), path, emitter: parsed });
    } catch {
      // Skip malformed presets rather than blowing up the whole list.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function presetHas(name: string): Promise<boolean> {
  const dir = await getPresetsDir();
  return window.api.pathExists(joinPath(dir, `${name}.json`));
}

/** Save an emitter as a preset under the given name. Overwrites if it exists. */
export async function savePreset(name: string, emitter: Emitter): Promise<void> {
  await ensurePresetsDir();
  const dir = await getPresetsDir();
  // Drop the id — preset is reusable across projects so id should be regenerated on load.
  const { id: _id, ...rest } = emitter;
  void _id;
  const text = JSON.stringify(rest, null, 2);
  const bytes = new TextEncoder().encode(text);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await window.api.writeFile(joinPath(dir, `${sanitizeName(name)}.json`), buf);
}

/** Save a raw `Omit<Emitter,'id'>` payload (used by the seeder to write builtins). */
export async function savePresetRaw(
  name: string,
  emitter: Omit<Emitter, 'id'>,
): Promise<void> {
  await ensurePresetsDir();
  const dir = await getPresetsDir();
  const text = JSON.stringify(emitter, null, 2);
  const bytes = new TextEncoder().encode(text);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await window.api.writeFile(joinPath(dir, `${sanitizeName(name)}.json`), buf);
}

export async function deletePreset(name: string): Promise<void> {
  const dir = await getPresetsDir();
  const path = joinPath(dir, `${name}.json`);
  if (await window.api.pathExists(path)) {
    await window.api.unlinkFile(path);
  }
}

/**
 * Materialize a preset into an Emitter ready to drop into an animation —
 * fresh id, optional name override.
 */
export function instantiatePreset(
  preset: Omit<Emitter, 'id'>,
  nameOverride?: string,
): Emitter {
  // Use the existing factory only for its id helper to keep id generation in
  // one place; we override every other field with the preset payload.
  void makeNewEmitter;
  return {
    ...preset,
    id: newEmitterId(),
    name: nameOverride ?? preset.name,
    offset: { ...preset.offset },
    config: structuredClone(preset.config),
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '').slice(0, 64) || 'preset';
}
