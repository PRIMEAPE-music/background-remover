import { memo, useEffect, useRef } from 'react';
import type { TextureRef } from '../../../lib/builder';
import { getBankImageCached } from '../../../lib/particles/bank';
import { renderProceduralTexture } from '../../../lib/particles/proceduralTexture';
import { computeCells } from '../../../lib/slicing';
import type { SourceMeta } from '../../../lib/sources';

export interface TextureThumbnailProps {
  texture: TextureRef;
  /** Pixel size of the rendered thumbnail (square). */
  size: number;
  /** Required for `kind: 'projectSprite'` references. */
  sources?: SourceMeta[];
  getSource?: (id: string | null) => ImageData | null;
}

/**
 * Renders any TextureRef (procedural, bank, project sprite) into a small
 * canvas at the requested pixel size. Procedural textures regenerate
 * synchronously; bank textures use the cached decoder; project sprites
 * extract their cell rect from the live ImageData. Pixel-art scaling is
 * preserved (`imageSmoothingEnabled = false`) so 4×4 dots upscale crisply.
 */
export const TextureThumbnail = memo(function TextureThumbnail({
  texture,
  size,
  sources,
  getSource,
}: TextureThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    (async () => {
      const img = await resolveTextureImage(texture, sources, getSource);
      if (cancelled || !img) return;
      drawCentered(ctx, img, size);
    })();

    return () => {
      cancelled = true;
    };
  }, [texture, size, sources, getSource]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        background:
          'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 8px 8px',
        imageRendering: 'pixelated',
      }}
    />
  );
});

async function resolveTextureImage(
  texture: TextureRef,
  sources: SourceMeta[] | undefined,
  getSource: ((id: string | null) => ImageData | null) | undefined,
): Promise<ImageData | null> {
  if (texture.kind === 'procedural') {
    return renderProceduralTexture(texture.shape, texture.size, texture.softness);
  }
  if (texture.kind === 'bank') {
    return getBankImageCached(texture.name);
  }
  // projectSprite — extract the named cell rect from the source's ImageData.
  if (!sources || !getSource) return null;
  const src = sources.find((s) => s.id === texture.sourceId);
  if (!src) return null;
  const img = getSource(src.id);
  if (!img) return null;
  const cells = computeCells(src.slice, src.width, src.height);
  const rect = cells[texture.cellIndex];
  if (!rect) return null;
  const out = new ImageData(rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < rect.width; x++) {
      const sx = rect.x + x;
      if (sx < 0 || sx >= img.width) continue;
      const sIdx = (sy * img.width + sx) * 4;
      const dIdx = (y * rect.width + x) * 4;
      out.data[dIdx] = img.data[sIdx];
      out.data[dIdx + 1] = img.data[sIdx + 1];
      out.data[dIdx + 2] = img.data[sIdx + 2];
      out.data[dIdx + 3] = img.data[sIdx + 3];
    }
  }
  return out;
}

function drawCentered(ctx: CanvasRenderingContext2D, img: ImageData, size: number): void {
  // Stage to a native-size temp canvas, then drawImage with smoothing off so
  // pixel art upscales cleanly. putImageData ignores transform and scale, so
  // we can't use it directly to scale.
  const temp = document.createElement('canvas');
  temp.width = img.width;
  temp.height = img.height;
  const tempCtx = temp.getContext('2d');
  if (!tempCtx) return;
  tempCtx.putImageData(img, 0, 0);

  // Fit-inside-square: scale so the longer dimension matches `size`. Don't
  // upscale beyond ~8× for tiny textures so a 1×1 pixel doesn't fill the
  // whole thumb (it would look identical to a 4×4 square).
  const fitScale = Math.min(size / img.width, size / img.height);
  const scale = Math.min(fitScale, 8);
  const drawW = Math.max(1, Math.floor(img.width * scale));
  const drawH = Math.max(1, Math.floor(img.height * scale));
  const dx = Math.floor((size - drawW) / 2);
  const dy = Math.floor((size - drawH) / 2);
  ctx.drawImage(temp, 0, 0, img.width, img.height, dx, dy, drawW, drawH);
}
