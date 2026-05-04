import { useCallback, useEffect, useMemo, useRef } from 'react';
import { renderNineSlice } from '../../lib/nineSlice';
import type { PlatformAsset, SliceBorders } from '../../lib/platforms';

export interface NineSliceEditorProps {
  asset: PlatformAsset;
  image: ImageData;
  onChange: (slice: SliceBorders) => void;
  onClose: () => void;
}

/** Source-pixel widths the live preview row renders at, left to right. */
const PREVIEW_WIDTHS = [100, 200, 400, 800];

/** Editor display scale — pick an integer scale so the source PNG ends up
 *  comfortably big without exceeding ~720px wide. Floor at 1× so giant
 *  sources still fit. */
function chooseDisplayScale(srcWidth: number, srcHeight: number): number {
  const TARGET_W = 720;
  const TARGET_H = 280;
  // Largest scale ≤ TARGET_W/srcWidth that's a whole integer ≥ 1, plus a
  // height cap so tall sources don't overflow vertically.
  const maxByWidth = Math.max(1, Math.floor(TARGET_W / srcWidth));
  const maxByHeight = Math.max(1, Math.floor(TARGET_H / srcHeight));
  return Math.max(1, Math.min(maxByWidth, maxByHeight, 12));
}

/**
 * Visual 9-slice editor. Takes over the library pane while open. The
 * preview shows the source PNG at an integer scale with four draggable
 * border lines (two vertical: left/right insets; two horizontal: top/
 * bottom insets). Underneath, live "stretch previews" render the platform
 * at common runtime widths so the user can see the slice doing its job.
 */
export function NineSliceEditor({
  asset,
  image,
  onChange,
  onClose,
}: NineSliceEditorProps) {
  const scale = chooseDisplayScale(image.width, image.height);
  const displayW = image.width * scale;
  const displayH = image.height * scale;

  // Stage the image once so the preview canvases can drawImage from it.
  const sourceCanvas = useMemo(() => imageDataToCanvas(image), [image]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e22',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button onClick={onClose} style={{ fontSize: 11 }} title="Return to library grid">
          ← Back
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Editing 9-slice borders for{' '}
          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>
            {asset.filename}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          source {image.width}×{image.height}px · display ×{scale}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 880 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              Source · drag the dashed lines to set border insets
            </div>
            <SourcePreview
              image={image}
              borders={asset.slice}
              scale={scale}
              onChange={onChange}
              displayW={displayW}
              displayH={displayH}
            />
          </div>

          <NumericInputs
            borders={asset.slice}
            sourceW={image.width}
            sourceH={image.height}
            onChange={onChange}
          />

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              Live stretch preview at {PREVIEW_WIDTHS.join(' / ')} px
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              {PREVIEW_WIDTHS.map((w) => (
                <StretchPreviewCell
                  key={w}
                  source={sourceCanvas}
                  borders={asset.slice}
                  width={w}
                  height={image.height}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                lineHeight: 1.4,
                marginTop: 6,
              }}
            >
              Each preview renders at the requested width with the source's
              native height. Corners stay fixed; the middle stretches. If the
              left + right corners alone exceed a target width, the middle
              shrinks to zero and the corners overlap.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Source preview with draggable borders ------------------------------

function SourcePreview({
  image,
  borders,
  scale,
  onChange,
  displayW,
  displayH,
}: {
  image: ImageData;
  borders: SliceBorders;
  scale: number;
  onChange: (s: SliceBorders) => void;
  displayW: number;
  displayH: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw the source PNG once into the canvas at native size, scaled up via
  // CSS transform so we keep crisp pixel edges.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(image, 0, 0);
  }, [image]);

  return (
    <div
      style={{
        position: 'relative',
        width: displayW,
        height: displayH,
        background:
          'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 16px 16px',
        border: '1px solid var(--border)',
        userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: displayW,
          height: displayH,
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
      <BorderLine
        side="left"
        sourcePos={borders.left}
        sourceMax={image.width}
        otherInset={borders.right}
        scale={scale}
        displayLength={displayH}
        onChange={(v) => onChange({ ...borders, left: v })}
      />
      <BorderLine
        side="right"
        sourcePos={borders.right}
        sourceMax={image.width}
        otherInset={borders.left}
        scale={scale}
        displayLength={displayH}
        onChange={(v) => onChange({ ...borders, right: v })}
      />
      <BorderLine
        side="top"
        sourcePos={borders.top}
        sourceMax={image.height}
        otherInset={borders.bottom}
        scale={scale}
        displayLength={displayW}
        onChange={(v) => onChange({ ...borders, top: v })}
      />
      <BorderLine
        side="bottom"
        sourcePos={borders.bottom}
        sourceMax={image.height}
        otherInset={borders.top}
        scale={scale}
        displayLength={displayW}
        onChange={(v) => onChange({ ...borders, bottom: v })}
      />
    </div>
  );
}

/**
 * A single draggable border line. Positions itself based on which side it
 * represents — `left`/`top` are insets from the start (position = inset);
 * `right`/`bottom` are insets from the end (position = max - inset). The
 * `otherInset` argument is the opposite side's value, used to clamp drags
 * so the two never cross each other.
 */
function BorderLine({
  side,
  sourcePos,
  sourceMax,
  otherInset,
  scale,
  displayLength,
  onChange,
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  sourcePos: number;
  sourceMax: number;
  otherInset: number;
  scale: number;
  displayLength: number;
  onChange: (v: number) => void;
}) {
  const isVertical = side === 'left' || side === 'right';
  const isFromEnd = side === 'right' || side === 'bottom';

  // Display offset of this line from the start of the relevant axis.
  const offsetSrc = isFromEnd ? sourceMax - sourcePos : sourcePos;
  const offsetDisplay = offsetSrc * scale;

  const dragRef = useRef<{ startClient: number; startSource: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        startClient: isVertical ? e.clientX : e.clientY,
        startSource: sourcePos,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [isVertical, sourcePos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (isVertical ? e.clientX : e.clientY) - drag.startClient;
      const deltaSource = delta / scale;
      // Right/bottom insets count "inward from the far edge", which means
      // dragging the line toward the start grows the inset.
      const sign = isFromEnd ? -1 : 1;
      const next = Math.round(drag.startSource + deltaSource * sign);
      const maxInset = sourceMax - otherInset;
      const clamped = Math.max(0, Math.min(maxInset, next));
      onChange(clamped);
    },
    [isVertical, isFromEnd, scale, sourceMax, otherInset, onChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'transparent',
    cursor: isVertical ? 'ew-resize' : 'ns-resize',
    touchAction: 'none',
  };
  const lineStyle: React.CSSProperties = isVertical
    ? {
        ...baseStyle,
        left: offsetDisplay - 4,
        top: 0,
        width: 8,
        height: displayLength,
      }
    : {
        ...baseStyle,
        top: offsetDisplay - 4,
        left: 0,
        height: 8,
        width: displayLength,
      };

  // The visual rule itself — a thin colored stripe in the middle of the
  // pointer-target band. Color-coded by axis so the user knows which is
  // which without relying on labels.
  const ruleStyle: React.CSSProperties = isVertical
    ? {
        position: 'absolute',
        left: 3,
        top: 0,
        width: 2,
        height: '100%',
        borderLeft: `2px dashed ${isFromEnd ? '#ff8060' : '#6aa9ff'}`,
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        top: 3,
        left: 0,
        height: 2,
        width: '100%',
        borderTop: `2px dashed ${isFromEnd ? '#ff8060' : '#6aa9ff'}`,
        pointerEvents: 'none',
      };

  return (
    <div
      style={lineStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={`${side}: ${sourcePos}px (drag to adjust)`}
    >
      <div style={ruleStyle} />
    </div>
  );
}

// ---- Numeric inputs -----------------------------------------------------

function NumericInputs({
  borders,
  sourceW,
  sourceH,
  onChange,
}: {
  borders: SliceBorders;
  sourceW: number;
  sourceH: number;
  onChange: (s: SliceBorders) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(180px, 240px))',
        gap: 12,
      }}
    >
      <NumberField
        label="Left inset"
        value={borders.left}
        max={sourceW - borders.right}
        accent="#6aa9ff"
        onChange={(v) => onChange({ ...borders, left: v })}
      />
      <NumberField
        label="Right inset"
        value={borders.right}
        max={sourceW - borders.left}
        accent="#ff8060"
        onChange={(v) => onChange({ ...borders, right: v })}
      />
      <NumberField
        label="Top inset"
        value={borders.top}
        max={sourceH - borders.bottom}
        accent="#6aa9ff"
        onChange={(v) => onChange({ ...borders, top: v })}
      />
      <NumberField
        label="Bottom inset"
        value={borders.bottom}
        max={sourceH - borders.top}
        accent="#ff8060"
        onChange={(v) => onChange({ ...borders, bottom: v })}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  max,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  accent: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          marginBottom: 0,
          fontSize: 11,
          textTransform: 'none',
          letterSpacing: 0,
        }}
      >
        <span style={{ color: accent }}>■ </span>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="range"
          min={0}
          max={Math.max(0, max)}
          step={1}
          value={Math.min(value, max)}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value))))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={0}
          max={Math.max(0, max)}
          value={value}
          onChange={(e) =>
            onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))))
          }
          style={{ width: 64, textAlign: 'right' }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28 }}>
          / {max}
        </span>
      </div>
    </div>
  );
}

// ---- Stretch preview cells ----------------------------------------------

function StretchPreviewCell({
  source,
  borders,
  width,
  height,
}: {
  source: HTMLCanvasElement;
  borders: SliceBorders;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Display scale for rendering — height is small (e.g. 32) so we scale up
  // for readability, but keep it pixel-perfect.
  const displayScale = Math.max(1, Math.min(4, Math.floor(64 / height)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sliced = renderNineSlice(source, borders, width, height);
    // Scale up for display.
    const dispW = width * displayScale;
    const dispH = height * displayScale;
    canvas.width = dispW;
    canvas.height = dispH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(sliced, 0, 0, width, height, 0, 0, dispW, dispH);
  }, [source, borders, width, height, displayScale]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <canvas
        ref={canvasRef}
        style={{
          imageRendering: 'pixelated',
          background:
            'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 8px 8px',
          border: '1px solid var(--border)',
        }}
      />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
        {width}×{height}
      </div>
    </div>
  );
}

// ---- Helpers ------------------------------------------------------------

function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(img, 0, 0);
  return c;
}
