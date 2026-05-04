import { memo, useEffect, useRef } from 'react';

export interface PlatformThumbnailProps {
  image: ImageData | null;
  size: number;
  /** Optional: render at native pixel size, capped at `size`. Default = fit-inside. */
  fit?: 'inside' | 'native';
}

/**
 * Renders an `ImageData` to a canvas at the requested pixel size with
 * pixel-art-friendly scaling (`imageSmoothingEnabled = false`). Used for
 * platform asset thumbnails in both the Sources pane (cell previews) and
 * the Library pane (tagged asset previews).
 *
 * `null` image renders an empty checkered square — useful while loading.
 */
export const PlatformThumbnail = memo(function PlatformThumbnail({
  image,
  size,
  fit = 'inside',
}: PlatformThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    if (!image) return;

    // Stage to a native-size temp canvas, then drawImage scaled.
    const temp = document.createElement('canvas');
    temp.width = image.width;
    temp.height = image.height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(image, 0, 0);

    const fitScale = Math.min(size / image.width, size / image.height);
    const scale = fit === 'native' ? Math.min(fitScale, 1) : Math.min(fitScale, 8);
    const drawW = Math.max(1, Math.floor(image.width * scale));
    const drawH = Math.max(1, Math.floor(image.height * scale));
    const dx = Math.floor((size - drawW) / 2);
    const dy = Math.floor((size - drawH) / 2);
    ctx.drawImage(temp, 0, 0, image.width, image.height, dx, dy, drawW, drawH);
  }, [image, size, fit]);

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
