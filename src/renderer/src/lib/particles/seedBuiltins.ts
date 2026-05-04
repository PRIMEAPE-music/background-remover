import { addToBank, bankHas, ensureBankDir } from './bank';
import { BUILTIN_PRESETS } from './builtinPresets';
import { BUILTIN_TEXTURES } from './builtinTextures';
import { ensurePresetsDir, presetHas, savePresetRaw } from './presets';

const SEEDED_FLAG = 'particles:seeded';
/**
 * Bump when the BUILT-IN catalog gains new entries the existing fleet should
 * pick up on next launch. Per-item existence checks inside `seedAll` mean
 * already-seeded entries are skipped (preserves user edits), so the only
 * effect of bumping is "new built-ins get added."
 *
 * Versions:
 *   v1 = initial 12 presets + 21 textures
 *   v2 = +3 modifier-showcase presets (vortex, floating-leaves, settling-dust)
 */
const CURRENT_SEED_VERSION = 2;

/**
 * On first run (and after each catalog version bump): write every built-in
 * texture and preset to the cross-project user-data library so the picker
 * has a populated starting point. Idempotent inside a single run (each item
 * checks if it exists), and gated by a localStorage version across runs.
 *
 * Use {@link seedAll} to force a full re-seed (e.g. from a future "Reset
 * built-ins" admin button).
 */
export async function seedIfNeeded(): Promise<void> {
  let stored = 0;
  try {
    const raw = localStorage.getItem(SEEDED_FLAG);
    // Old releases stored "1" as a flag-style boolean; treat that as v1.
    stored = raw === '1' ? 1 : Number(raw) || 0;
  } catch {
    stored = 0;
  }
  if (stored >= CURRENT_SEED_VERSION) return;
  await seedAll();
  try {
    localStorage.setItem(SEEDED_FLAG, String(CURRENT_SEED_VERSION));
  } catch {
    // ignored
  }
}

/**
 * Run the seed regardless of the flag. Per-item existence check still
 * applies, so this only fills in what's missing — won't re-add textures or
 * presets the user has previously deleted unless they're already gone.
 */
export async function seedAll(): Promise<void> {
  await ensureBankDir();
  await ensurePresetsDir();

  for (const tex of BUILTIN_TEXTURES) {
    try {
      if (await bankHas(tex.name)) continue;
      const img = tex.generate();
      await addToBank(tex.name, img);
    } catch (err) {
      console.warn(`[particles] failed to seed texture "${tex.name}":`, err);
    }
  }

  for (const preset of BUILTIN_PRESETS) {
    try {
      if (await presetHas(preset.name)) continue;
      await savePresetRaw(preset.name, preset.emitter);
    } catch (err) {
      console.warn(`[particles] failed to seed preset "${preset.name}":`, err);
    }
  }
}
