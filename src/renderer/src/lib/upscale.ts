/**
 * AI upscaling for platform sprites — wraps UpscalerJS (TensorFlow.js backed
 * ESRGAN). Lazy-loads the model on first use; subsequent upscales reuse the
 * same instance.
 *
 * Why: authored sprites that the runtime renders at higher dimensions than
 * their source PNG come out soft (the canvas downsampling in 9-slice can't
 * add information that wasn't there). Pre-upscaling the source bakes
 * plausible detail into a higher-resolution PNG so the runtime can then
 * downsample with more to work from.
 *
 * Transparency: ESRGAN is RGB-only — it doesn't see or preserve the alpha
 * channel. If we just upscaled the RGBA canvas the model would compose the
 * source against an opaque background and emit black where the input was
 * transparent. We work around this by upscaling the alpha channel
 * SEPARATELY via a plain canvas resize, then stitching the AI-upscaled RGB
 * back together with that alpha mask.
 */
import * as tf from '@tensorflow/tfjs';
import Upscaler from 'upscaler';
// `esrgan-thick` ships separate model definitions per scale (x2/x3/x4/x8).
// The named `x4` export is what we want for a 4× upscale.
import { x4 as esrganThickX4 } from '@upscalerjs/esrgan-thick';

type UpscalerInstance = InstanceType<typeof Upscaler>;

let cached: UpscalerInstance | null = null;

/** Lazily instantiate the Upscaler. The model itself (~80MB) is bundled
 *  inside the @upscalerjs/esrgan-thick package — the first call pays the
 *  load + warmup cost, every subsequent call is cheap. We use the THICK
 *  variant (slowest but highest quality) since this is a one-time bake
 *  and the user's library is small relative to a video pipeline. */
function getUpscaler(): UpscalerInstance {
  if (cached && upscalesSinceRecreate >= RECREATE_AFTER) {
    cached.dispose?.();
    cached = null;
    upscalesSinceRecreate = 0;
  }
  if (!cached) {
    cached = new Upscaler({ model: esrganThickX4 });
  }
  return cached;
}

/** Upscale factor baked into the ESRGAN model. UpscalerJS doesn't expose
 *  this at runtime so we hardcode it; if you swap the model package, also
 *  update this. */
const SCALE = 4;

/**
 * Tile size for patch-based processing. Smaller = less GPU memory per
 * step but more steps overall. 32 is what UpscalerJS recommends for
 * memory-tight scenarios; combined with the upscaler-recreate cycle below
 * it lets a library of 100+ assets finish without WebGL crashing.
 */
const PATCH_SIZE = 32;
const PATCH_PADDING = 4;

/** After this many upscales, we dispose the cached Upscaler and rebuild
 *  it. tfjs's tensor pool slowly accumulates state across inferences and
 *  the only sure way to release it is to drop the model and re-load. The
 *  reload costs ~1-2s but caps GPU/heap pressure regardless of library size.
 *  Lowered to 10 because upscaling already-upscaled sources (16× original
 *  data) blows through the V8 heap faster than fresh sources do. */
const RECREATE_AFTER = 10;
let upscalesSinceRecreate = 0;

/**
 * Upscale a single ImageData using the bundled ESRGAN model. Output is 4×
 * larger in each dimension and PRESERVES the input's alpha channel.
 */
export async function upscaleImageData(input: ImageData): Promise<ImageData> {
  const memBefore = tf.memory();
  console.log(
    `[upscale] starting ${input.width}×${input.height} | tfjs: ${memBefore.numTensors} tensors, ${(memBefore.numBytes / 1024 / 1024).toFixed(0)}MB`,
  );
  const upscaler = getUpscaler();
  upscalesSinceRecreate++;

  // Stage the ImageData onto a canvas. Upscaler accepts canvas / image /
  // tensor; canvas is the cheapest interop path from ImageData.
  const inCanvas = document.createElement('canvas');
  inCanvas.width = input.width;
  inCanvas.height = input.height;
  const inCtx = inCanvas.getContext('2d');
  if (!inCtx) throw new Error('upscaleImageData: 2d context unavailable');
  inCtx.putImageData(input, 0, 0);

  const outW = input.width * SCALE;
  const outH = input.height * SCALE;

  // Step 1: upscale alpha. Plain bilinear canvas resize is fine for sprite
  // alpha — the AI doesn't add useful detail to a mask, and bilinear
  // produces clean edges that match what the user authored.
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = outW;
  alphaCanvas.height = outH;
  const alphaCtx = alphaCanvas.getContext('2d');
  if (!alphaCtx) throw new Error('upscaleImageData: 2d context unavailable');
  alphaCtx.imageSmoothingEnabled = true;
  alphaCtx.imageSmoothingQuality = 'high';
  alphaCtx.drawImage(inCanvas, 0, 0, outW, outH);
  const alphaResized = alphaCtx.getImageData(0, 0, outW, outH);

  // Step 2: AI upscale the RGB. The model returns a [H, W, 3] tensor.
  console.log('[upscale] running model…');
  const tensor = (await upscaler.upscale(inCanvas, {
    output: 'tensor',
    patchSize: PATCH_SIZE,
    padding: PATCH_PADDING,
  })) as tf.Tensor3D;

  try {
    const [tensorH, tensorW] = tensor.shape;
    console.log(
      `[upscale] model output ${tensorW}×${tensorH} (expected ${outW}×${outH})`,
    );
    // If dims don't line up, fall back to using the model's actual output
    // dims and rebuild the alpha resize at the same size — better than
    // throwing and producing nothing.
    let alpha = alphaResized;
    if (tensorW !== outW || tensorH !== outH) {
      console.warn(
        `[upscale] model output dims ${tensorW}×${tensorH} != expected ${outW}×${outH}, rebuilding alpha to match`,
      );
      const fixCanvas = document.createElement('canvas');
      fixCanvas.width = tensorW;
      fixCanvas.height = tensorH;
      const fixCtx = fixCanvas.getContext('2d');
      if (!fixCtx) throw new Error('upscaleImageData: 2d context unavailable');
      fixCtx.imageSmoothingEnabled = true;
      fixCtx.imageSmoothingQuality = 'high';
      fixCtx.drawImage(inCanvas, 0, 0, tensorW, tensorH);
      alpha = fixCtx.getImageData(0, 0, tensorW, tensorH);
    }
    const outCanvas = document.createElement('canvas');
    outCanvas.width = tensorW;
    outCanvas.height = tensorH;
    // ESRGAN emits a float32 tensor in [0, 255] range, but `tf.browser.toPixels`
    // expects float32 in [0, 1] (or int32 in [0, 255]). Clip + cast to int32
    // so toPixels reads it correctly. tf.tidy disposes the clipped intermediate.
    const pixelTensor = tf.tidy(
      () => tensor.clipByValue(0, 255).toInt() as tf.Tensor3D,
    );
    try {
      await tf.browser.toPixels(pixelTensor, outCanvas);
    } finally {
      pixelTensor.dispose();
    }
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('upscaleImageData: 2d context unavailable');
    const aiRgba = outCtx.getImageData(0, 0, tensorW, tensorH);

    // Step 3: stitch — copy AI's RGB over the alpha-resized RGBA. This
    // preserves the AI detail in the colored regions while keeping the
    // authored transparency mask. Walking the buffer in-place is faster
    // than allocating a fresh ImageData.
    const ai = aiRgba.data;
    const alphaData = alpha.data;
    for (let i = 0; i < ai.length; i += 4) {
      alphaData[i] = ai[i];
      alphaData[i + 1] = ai[i + 1];
      alphaData[i + 2] = ai[i + 2];
      // alphaData[i + 3] stays as the resized authored alpha
    }
    console.log(`[upscale] composed final ImageData ${alpha.width}×${alpha.height}`);
    return alpha;
  } finally {
    tensor.dispose();
    // Yield to the event loop so any pending tfjs cleanup can run before
    // the caller queues the next upscale. Without this, GPU resources
    // accumulate across rapid successive calls.
    await tf.nextFrame();
  }
}

/** Free the cached upscaler + its underlying tfjs tensors. Call when the
 *  user is unlikely to upscale again soon (e.g. closing the app, or after
 *  a long idle). Optional — the cache is bounded by a single model. */
export function disposeUpscaler(): void {
  if (cached) {
    cached.dispose?.();
    cached = null;
  }
}
