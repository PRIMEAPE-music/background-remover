export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

export async function loadImageFromBytes(bytes: Uint8Array, mime = 'image/png'): Promise<ImageData> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageDataToPngBytes(data: ImageData): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  return await blob.arrayBuffer();
}

/** Clear (make transparent) a rectangle of `image` in-place. */
export function clearRect(
  image: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): void {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(image.width, Math.floor(rx + rw));
  const y1 = Math.min(image.height, Math.floor(ry + rh));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 0;
      image.data[i + 1] = 0;
      image.data[i + 2] = 0;
      image.data[i + 3] = 0;
    }
  }
}

/** Extract a rectangular region as a new ImageData. */
export function extractRect(
  image: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): ImageData {
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  src.getContext('2d')!.putImageData(image, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = rw;
  dst.height = rh;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, rx, ry, rw, rh, 0, 0, rw, rh);
  return ctx.getImageData(0, 0, rw, rh);
}

/** Source-over composite `floater` onto `image` at (dx, dy). Returns new ImageData. */
export function compositeOnto(
  image: ImageData,
  floater: ImageData,
  dx: number,
  dy: number,
): ImageData {
  const base = document.createElement('canvas');
  base.width = image.width;
  base.height = image.height;
  const bctx = base.getContext('2d')!;
  bctx.putImageData(image, 0, 0);
  const fl = document.createElement('canvas');
  fl.width = floater.width;
  fl.height = floater.height;
  fl.getContext('2d')!.putImageData(floater, 0, 0);
  bctx.drawImage(fl, dx, dy);
  return bctx.getImageData(0, 0, image.width, image.height);
}

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  size = 8,
): void {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const dark = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = dark ? '#3a3a44' : '#4a4a54';
      ctx.fillRect(x, y, size, size);
    }
  }
}
