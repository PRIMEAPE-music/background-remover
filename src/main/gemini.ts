import { safeStorage, app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MODEL = 'gemini-3-pro-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type GeminiAspect = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | 'auto';

export type GeminiSize = '1K' | '2K' | '4K';
const SIZE_VALUES: GeminiSize[] = ['1K', '2K', '4K'];

export interface GenerateRequest {
  apiKey: string;
  prompt: string;
  aspectRatio: GeminiAspect;
  size: GeminiSize;
  /** Optional reference image as raw bytes + mime. */
  referenceImage?: { mime: string; data: Uint8Array };
  /** AbortSignal so callers can cancel a long-running batch mid-flight. */
  signal?: AbortSignal;
}

export interface GenerateResult {
  /** PNG bytes of the first image candidate. */
  imageBytes: Uint8Array;
  /** Mime type the API returned (usually image/png). */
  mime: string;
}

export class GeminiError extends Error {
  constructor(
    public kind: 'safety' | 'rate-limit' | 'auth' | 'network' | 'no-image' | 'other',
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Node Buffer is fastest in main; renderer uses btoa.
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Call Gemini 3 Pro Image. Returns the first inline-image part it finds.
 * Throws GeminiError with a typed `kind` so the renderer can show useful UI
 * (safety blocks vs auth vs transient network).
 */
export async function generateImage(req: GenerateRequest): Promise<GenerateResult> {
  const parts: unknown[] = [{ text: req.prompt }];
  if (req.referenceImage) {
    parts.push({
      inlineData: {
        mimeType: req.referenceImage.mime,
        data: bytesToBase64(req.referenceImage.data),
      },
    });
  }
  // 'auto' = let the model decide; we omit aspectRatio so the prompt drives it.
  const imageConfig: { aspectRatio?: string; imageSize: string } = {
    imageSize: SIZE_VALUES.includes(req.size) ? req.size : '1K',
  };
  if (req.aspectRatio !== 'auto') imageConfig.aspectRatio = req.aspectRatio;

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['Image'],
      imageConfig,
    },
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GeminiError('network', `Network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new GeminiError('auth', `Auth failed (${res.status}): ${text}`, res.status);
    }
    if (res.status === 429) {
      throw new GeminiError('rate-limit', `Rate limited (429): ${text}`, res.status);
    }
    throw new GeminiError('other', `HTTP ${res.status}: ${text}`, res.status);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (json.promptFeedback?.blockReason) {
    throw new GeminiError('safety', `Blocked by safety: ${json.promptFeedback.blockReason}`);
  }

  for (const cand of json.candidates ?? []) {
    if (cand.finishReason && /SAFETY|BLOCK/i.test(cand.finishReason)) {
      throw new GeminiError('safety', `Blocked: ${cand.finishReason}`);
    }
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          imageBytes: base64ToBytes(part.inlineData.data),
          mime: part.inlineData.mimeType ?? 'image/png',
        };
      }
    }
  }

  throw new GeminiError('no-image', 'Response contained no image data');
}

// ---------- API key storage (encrypted via OS keychain) ----------

function keyFilePath(): string {
  return join(app.getPath('userData'), 'gemini-key.bin');
}

export async function saveApiKey(plaintext: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(plaintext);
    await writeFile(keyFilePath(), enc);
  } else {
    // Fallback: write plaintext but tag it so we don't try to decrypt as Buffer.
    // safeStorage is normally available on win/mac/linux-with-keyring, so this
    // path is rare.
    await writeFile(keyFilePath(), Buffer.concat([Buffer.from('PLAIN:'), Buffer.from(plaintext)]));
  }
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const buf = await readFile(keyFilePath());
    if (buf.subarray(0, 6).toString() === 'PLAIN:') {
      return buf.subarray(6).toString('utf8');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    await writeFile(keyFilePath(), Buffer.alloc(0));
  } catch {
    // ignore
  }
}
