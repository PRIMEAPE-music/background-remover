import { imageDataToPngBytes, loadImageFromBytes } from '../image-utils';

/**
 * Cross-project texture bank: PNGs stored under `<userData>/texture-bank/`.
 * Survives across projects; users can add their own here too. The bank stores
 * just file bytes — the renderer decodes to ImageData on demand and a small
 * per-name LRU keeps decoded copies cached so the picker doesn't redecode on
 * every render.
 */

const BANK_SUBDIR = 'texture-bank';

export interface BankEntry {
  /** Filename without extension — the canonical name used by `TextureRef.bank`. */
  name: string;
  /** Absolute path on disk. */
  path: string;
}

let cachedBankDir: string | null = null;

async function getBankDir(): Promise<string> {
  if (cachedBankDir) return cachedBankDir;
  const userData = await window.api.getUserDataPath();
  cachedBankDir = joinPath(userData, BANK_SUBDIR);
  return cachedBankDir;
}

function joinPath(folder: string, child: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + child : `${folder}${sep}${child}`;
}

/** Create the bank dir if missing. Idempotent. */
export async function ensureBankDir(): Promise<string> {
  const dir = await getBankDir();
  await window.api.mkdir(dir);
  return dir;
}

/**
 * List every PNG in the bank, sorted alphabetically. Names are returned
 * without the `.png` extension so they're directly comparable to
 * `TextureRef.bank.name`.
 */
export async function listBank(): Promise<BankEntry[]> {
  const dir = await getBankDir();
  const entries = await window.api.listDir(dir);
  const out: BankEntry[] = [];
  for (const e of entries) {
    if (!/\.png$/i.test(e)) continue;
    out.push({ name: e.replace(/\.png$/i, ''), path: joinPath(dir, e) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** True if a bank entry with the given name exists. */
export async function bankHas(name: string): Promise<boolean> {
  const dir = await getBankDir();
  return window.api.pathExists(joinPath(dir, `${name}.png`));
}

/**
 * Write an ImageData (typically procedurally generated or imported via the
 * UI) into the bank as `<name>.png`. Overwrites if the name already exists.
 */
export async function addToBank(name: string, image: ImageData): Promise<void> {
  await ensureBankDir();
  const dir = await getBankDir();
  const safe = sanitizeName(name);
  const bytes = await imageDataToPngBytes(image);
  await window.api.writeFile(joinPath(dir, `${safe}.png`), bytes);
  evictBankCache(safe);
}

/** Write raw PNG bytes (e.g. from a user file import). */
export async function addBytesToBank(name: string, bytes: ArrayBuffer): Promise<void> {
  await ensureBankDir();
  const dir = await getBankDir();
  const safe = sanitizeName(name);
  await window.api.writeFile(joinPath(dir, `${safe}.png`), bytes);
  evictBankCache(safe);
}

export async function deleteFromBank(name: string): Promise<void> {
  const dir = await getBankDir();
  const path = joinPath(dir, `${name}.png`);
  if (await window.api.pathExists(path)) {
    await window.api.unlinkFile(path);
  }
  evictBankCache(name);
}

/** Load and decode a single bank entry to ImageData. Returns null if missing. */
export async function getBankImage(name: string): Promise<ImageData | null> {
  const dir = await getBankDir();
  const path = joinPath(dir, `${name}.png`);
  if (!(await window.api.pathExists(path))) return null;
  const bytes = await window.api.readFile(path);
  return loadImageFromBytes(bytes, 'image/png');
}

/** Read a bank entry's raw PNG bytes — used for export, where re-encoding
 *  ImageData would just waste cycles since the file already exists on disk. */
export async function getBankBytes(name: string): Promise<Uint8Array | null> {
  const dir = await getBankDir();
  const path = joinPath(dir, `${name}.png`);
  if (!(await window.api.pathExists(path))) return null;
  return window.api.readFile(path);
}

// In-memory decoded-image cache. The picker shows ~21 builtin thumbnails
// simultaneously, and re-decoding on every prop change is wasted work since
// PNG bytes don't change unless we explicitly add/delete via this module.
const bankCache = new Map<string, ImageData | null>();
const inflight = new Map<string, Promise<ImageData | null>>();

export async function getBankImageCached(name: string): Promise<ImageData | null> {
  if (bankCache.has(name)) return bankCache.get(name) ?? null;
  const existing = inflight.get(name);
  if (existing) return existing;
  const p = getBankImage(name).then((img) => {
    bankCache.set(name, img);
    inflight.delete(name);
    return img;
  });
  inflight.set(name, p);
  return p;
}

/** Drop one entry (or the whole cache when no name passed) — call after
 *  any disk write so subsequent reads pick up the fresh PNG. */
export function evictBankCache(name?: string): void {
  if (name === undefined) {
    bankCache.clear();
    return;
  }
  bankCache.delete(name);
}

/** Strip path separators and other awkward characters for a safe filename. */
function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '').slice(0, 64) || 'texture';
}
