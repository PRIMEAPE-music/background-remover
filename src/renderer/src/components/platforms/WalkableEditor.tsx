import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthoredDecoration,
  PlatformAsset,
  WalkableHull,
  WalkableRegion,
} from '../../lib/platforms';
import { walkableBoundsSource } from '../../lib/platforms';
import type { Decoration, DecorationProject } from '../../lib/decorations';
import { detectWalkableRegions } from '../../lib/walkableDetect';

export interface WalkableEditorProps {
  asset: PlatformAsset;
  image: ImageData;
  decorationProject: DecorationProject | null;
  decorationThumbnails: Map<string, string>;
  onChange: (patch: {
    walkableRegions?: WalkableRegion[];
    walkableHull?: WalkableHull;
    surfaceCenter?: { x: number; y: number };
    decorationZones?: WalkableRegion[];
    authoredDecorations?: AuthoredDecoration[];
  }) => void;
  onClose: () => void;
}

/** Which set of regions / placements the editor is currently authoring.
 *  The `walkable` and `decorationZones` tabs share the same canvas
 *  drag-rect machinery; `decorations` uses a different click-to-place
 *  flow with a library picker. */
type EditorTab = 'walkable' | 'decorationZones' | 'decorations';

/** Pick an integer display scale so the source PNG ends up comfortably
 *  big without exceeding the editor pane. Mirrors NineSliceEditor's
 *  approach so the two editors feel consistent. */
function chooseDisplayScale(srcWidth: number, srcHeight: number): number {
  const TARGET_W = 720;
  const TARGET_H = 480;
  const maxByWidth = Math.max(1, Math.floor(TARGET_W / srcWidth));
  const maxByHeight = Math.max(1, Math.floor(TARGET_H / srcHeight));
  return Math.max(1, Math.min(maxByWidth, maxByHeight, 12));
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
/** Tilt handles move ONE top corner vertically (Y only) to skew the
 *  parallelogram. `tilt-left` moves the top-left corner, shifting the
 *  whole rectangle's Y while keeping the right corner where it was;
 *  `tilt-right` moves only the top-right corner via rightTopOffset. */
type TiltHandle = 'tilt-left' | 'tilt-right';

type DragState =
  | { kind: 'create'; sourceStart: { x: number; y: number } }
  | { kind: 'move'; index: number; clientStart: { x: number; y: number }; original: WalkableRegion }
  | {
      kind: 'resize';
      index: number;
      handle: ResizeHandle;
      clientStart: { x: number; y: number };
      original: WalkableRegion;
    }
  | {
      kind: 'tilt';
      index: number;
      handle: TiltHandle;
      clientStart: { x: number; y: number };
      original: WalkableRegion;
    };

/** Default band height for newly-drawn regions and auto-detected ones. */
const DEFAULT_BAND_HEIGHT = 32;

/** Manual zoom bounds. Lower than 0.25× makes regions hard to grab; higher
 *  than 8× rarely useful and starts to introduce floating-point jitter. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
/** Multiplier for one click of the +/- buttons. ~25% per step keeps each
 *  press meaningful without being jumpy. */
const ZOOM_STEP = 1.25;

export function WalkableEditor({
  asset,
  image,
  decorationProject,
  decorationThumbnails,
  onChange,
  onClose,
}: WalkableEditorProps) {
  // Base scale = the auto-fit integer scale that fills the editor pane.
  // `zoom` is a user-controlled multiplier on top of that; the effective
  // scale used for everything (display dims, coord conversion, region
  // rendering) is `baseScale * zoom`.
  const baseScale = chooseDisplayScale(image.width, image.height);
  const [zoom, setZoom] = useState(1);
  const effectiveScale = baseScale * zoom;
  const displayW = image.width * effectiveScale;
  const displayH = image.height * effectiveScale;
  // Which region list the canvas is editing. Both walkable and
  // decoration zones use identical UX (drag-to-create / handles to
  // resize / tilt), so the tab just swaps which array reads & writes.
  const [tab, setTab] = useState<EditorTab>('walkable');
  const regions =
    tab === 'walkable'
      ? asset.walkableRegions ?? []
      : asset.decorationZones ?? [];
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    regions.length > 0 ? 0 : null,
  );
  // Reset selection when switching tabs — index N in the walkable list
  // doesn't correspond to anything meaningful in the decoration list.
  useEffect(() => {
    setSelectedIndex(null);
  }, [tab]);
  // "Hull mode" toggles whether clicking on the canvas creates a new
  // walkable region or instead edits the silhouette hull. Most assets
  // never need an explicit hull (it derives from regions) so it's
  // off by default.
  const [hullMode, setHullMode] = useState(false);
  const [hullDraft, setHullDraft] = useState<WalkableHull | null>(asset.walkableHull ?? null);
  // Ref on the scroll container so we can attach a non-passive wheel
  // listener for ctrl+wheel zoom. React's onWheel is passive by default
  // in modern React, which prevents preventDefault from stopping the
  // browser's native zoom — attaching natively avoids that.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resync local hull draft when the user switches assets without remounting.
  useEffect(() => {
    setHullDraft(asset.walkableHull ?? null);
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset zoom when the asset changes — different assets have different
  // base scales so a "1× user zoom" on a small asset becomes a much
  // larger effective zoom on a tall one. Resetting avoids surprising
  // initial views when navigating between assets.
  useEffect(() => {
    setZoom(1);
  }, [asset.id]);

  // Ctrl+wheel = zoom (centered loosely on the scroll container).
  // Plain wheel still scrolls the container so the user can pan after
  // zooming in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // deltaY > 0 = wheel scrolled down = zoom OUT.
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clamp(z * factor, ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const replaceRegions = useCallback(
    (next: WalkableRegion[]) => {
      // Route writes to the field matching the active tab. Either
      // tab can use the auto-detect / hand-draw machinery; the only
      // difference is which array on the asset gets the result.
      if (tab === 'walkable') onChange({ walkableRegions: next });
      else onChange({ decorationZones: next });
    },
    [onChange, tab],
  );

  const updateRegion = useCallback(
    (index: number, patch: Partial<WalkableRegion>) => {
      const next = regions.map((r, i) => (i === index ? { ...r, ...patch } : r));
      replaceRegions(next);
    },
    [regions, replaceRegions],
  );

  const removeRegion = useCallback(
    (index: number) => {
      const next = regions.filter((_, i) => i !== index);
      replaceRegions(next);
      setSelectedIndex((prev) => {
        if (prev === null) return null;
        if (prev === index) return null;
        return prev > index ? prev - 1 : prev;
      });
    },
    [regions, replaceRegions],
  );

  const addRegion = useCallback(
    (region: WalkableRegion) => {
      const next = [...regions, region];
      replaceRegions(next);
      setSelectedIndex(next.length - 1);
    },
    [regions, replaceRegions],
  );

  const handleAutoDetect = useCallback(() => {
    const detected = detectWalkableRegions(image);
    if (detected.length === 0) return;
    replaceRegions(detected);
    setSelectedIndex(0);
  }, [image, replaceRegions]);

  const handleClearAll = useCallback(() => {
    replaceRegions([]);
    setSelectedIndex(null);
  }, [replaceRegions]);

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
          flexWrap: 'wrap',
        }}
      >
        <button onClick={onClose} style={{ fontSize: 11 }} title="Return to library grid">
          ← Back
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Editing{' '}
          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>
            {asset.filename}
          </span>
        </div>
        {/* Tab switcher: walkable surfaces vs decoration scatter zones.
            Both tabs share the same canvas + drag/resize machinery; the
            tab determines which field on the asset writes are routed to. */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          <button
            onClick={() => setTab('walkable')}
            className={tab === 'walkable' ? 'primary' : ''}
            style={{ fontSize: 11 }}
            title="Author the player's walking surfaces. Yellow center-line = walking line."
          >
            Walkable
          </button>
          <button
            onClick={() => setTab('decorationZones')}
            className={tab === 'decorationZones' ? 'primary' : ''}
            style={{ fontSize: 11 }}
            title="Author decoration scatter zones — restricts where the runtime places flora / props on this platform."
          >
            Deco zones{(asset.decorationZones?.length ?? 0) > 0 ? ` (${asset.decorationZones?.length})` : ''}
          </button>
          <button
            onClick={() => setTab('decorations')}
            className={tab === 'decorations' ? 'primary' : ''}
            style={{ fontSize: 11 }}
            title="Place specific decorations at exact positions on this platform. When ANY decorations are authored here, the runtime spawns ONLY these and skips procedural scatter for this platform."
          >
            Decos{(asset.authoredDecorations?.length ?? 0) > 0 ? ` (${asset.authoredDecorations?.length})` : ''}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleAutoDetect}
          style={{ fontSize: 11 }}
          title="Scan the alpha channel and propose surfaces — overwrites the current list"
        >
          Auto-detect
        </button>
        <button
          onClick={handleClearAll}
          style={{ fontSize: 11 }}
          disabled={regions.length === 0}
          title="Remove all walkable regions and start over"
        >
          Clear
        </button>
        {/* Hull editing only applies to the walkable tab — silhouette
            bounds drive shadow casting, which has nothing to do with
            decoration zones. */}
        {tab === 'walkable' && (
          <button
            onClick={() => setHullMode((v) => !v)}
            className={hullMode ? 'primary' : ''}
            style={{ fontSize: 11 }}
            title="Toggle hull-editing mode — draw the silhouette used for shadow width"
          >
            {hullMode ? 'Editing hull' : 'Edit hull (optional)'}
          </button>
        )}
        {/* Zoom controls. Plain wheel still scrolls the container so
            you can pan after zooming in; ctrl+wheel zooms in/out. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setZoom((z) => clamp(z / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
            style={{ fontSize: 11, minWidth: 24 }}
            title="Zoom out (also: ctrl+scroll wheel)"
            disabled={zoom <= ZOOM_MIN + 0.001}
          >
            −
          </button>
          <button
            onClick={() => setZoom(1)}
            style={{ fontSize: 11, minWidth: 48, fontFamily: 'monospace' }}
            title="Reset zoom to fit"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((z) => clamp(z * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
            style={{ fontSize: 11, minWidth: 24 }}
            title="Zoom in (also: ctrl+scroll wheel)"
            disabled={zoom >= ZOOM_MAX - 0.001}
          >
            +
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          source {image.width}×{image.height}px · display ×{(effectiveScale).toFixed(2)}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {tab === 'decorations' ? (
          <DecorationPlacementView
            asset={asset}
            image={image}
            displayW={displayW}
            displayH={displayH}
            scale={effectiveScale}
            decorationProject={decorationProject}
            decorationThumbnails={decorationThumbnails}
            onChange={(authoredDecorations) =>
              onChange({ authoredDecorations })
            }
          />
        ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              {hullMode
                ? 'Drag to draw the silhouette hull (or click Reset)'
                : tab === 'walkable'
                  ? 'Drag to draw a walkable surface · click to select · handles to resize'
                  : 'Drag to draw a decoration scatter zone · runtime restricts decorations to inside these rects'}
            </div>
            {!hullMode && tab === 'walkable' && (
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                Each rectangle = the platform's visible top FACE (its
                depth). The bright yellow line at the CENTER is where
                the player walks. Cover the full depth of the visible
                top so the walking line lands on the perspective
                midpoint.
              </div>
            )}
            {!hullMode && tab === 'decorationZones' && (
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                Decoration scatter zones constrain WHERE the runtime
                places flora / props on this platform. Empty (no zones)
                = scatter uses the walkable regions' full extent (the
                default). Add zones to carve out "no decoration" areas
                — around a pedestal, on a staircase, between slabs.
                Only the X range matters for scatter; the Y range +
                tilt are ignored here, but kept consistent with the
                walkable editor so the same UI works for both.
              </div>
            )}
            <Canvas
              image={image}
              scale={effectiveScale}
              displayW={displayW}
              displayH={displayH}
              regions={regions}
              selectedIndex={selectedIndex}
              hullMode={hullMode}
              hullDraft={hullDraft}
              onSelect={setSelectedIndex}
              onAdd={addRegion}
              onUpdate={updateRegion}
              onHullChange={(h) => {
                setHullDraft(h);
                onChange({ walkableHull: h ?? undefined });
              }}
            />
          </div>
          <Inspector
            asset={asset}
            regions={regions}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onUpdate={updateRegion}
            onRemove={removeRegion}
            sourceWidth={image.width}
            sourceHeight={image.height}
            hullDraft={hullDraft}
            onResetHull={() => {
              setHullDraft(null);
              onChange({ walkableHull: undefined });
            }}
            onSurfaceCenterChange={(c) => onChange({ surfaceCenter: c ?? undefined })}
          />
        </div>
        )}
      </div>
    </div>
  );
}

// ---- Decoration placement (manual click-to-place) ----------------------

/**
 * Editor for `asset.authoredDecorations` — the user drops specific
 * decorations from the library onto fixed source-pixel coords on this
 * platform's canvas. Replaces procgen scatter on the runtime side.
 *
 * Layout:
 *   ┌─ Canvas ──────────────────────┬─ Sidebar ─────────┐
 *   │ platform image with placed    │ library picker    │
 *   │ decoration thumbnails on top  │ + selected decor  │
 *   │ click to place / select       │ inspector         │
 *   │ drag to move                  │                   │
 *   └───────────────────────────────┴───────────────────┘
 */
function DecorationPlacementView({
  asset,
  image,
  displayW,
  displayH,
  scale,
  decorationProject,
  decorationThumbnails,
  onChange,
}: {
  asset: PlatformAsset;
  image: ImageData;
  displayW: number;
  displayH: number;
  scale: number;
  decorationProject: DecorationProject | null;
  decorationThumbnails: Map<string, string>;
  onChange: (next: AuthoredDecoration[]) => void;
}) {
  const placements = asset.authoredDecorations ?? [];
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /** Which library decoration the user has chosen as the "brush" — the
   *  next click on the canvas places one of these at the click point.
   *  Null = no brush; clicks on empty space deselect any current
   *  placement. */
  const [brushId, setBrushId] = useState<string | null>(null);

  const decoById = useMemo(() => {
    const m = new Map<string, Decoration>();
    if (decorationProject) {
      for (const d of decorationProject.decorations) m.set(d.id, d);
    }
    return m;
  }, [decorationProject]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    index: number;
    clientStart: { x: number; y: number };
    original: AuthoredDecoration;
  } | null>(null);

  // Stage the platform image onto a 1:1 canvas; CSS scales for crisp pixels.
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

  const update = useCallback(
    (next: AuthoredDecoration[]) => onChange(next),
    [onChange],
  );

  const clientToSource = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const x = Math.round((clientX - rect.left) / scale);
      const y = Math.round((clientY - rect.top) / scale);
      return {
        x: Math.max(0, Math.min(image.width, x)),
        y: Math.max(0, Math.min(image.height, y)),
      };
    },
    [scale, image.width, image.height],
  );

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Click on empty canvas: place a new decoration at the click
      // point (using the brush) OR deselect any current placement.
      if (e.target !== e.currentTarget) return;
      const src = clientToSource(e.clientX, e.clientY);
      if (brushId) {
        // Underside placements (vines etc.) snap their Y to the
        // platform's visible bottom — same as the runtime, which
        // ignores authored Y for underside and forces the sprite to
        // hang from the platform's bottom edge. We persist Y =
        // image.height so the saved manifest matches the runtime
        // behavior exactly; the user only authors X for these.
        const brushEntry = decoById.get(brushId);
        const isUnderside = brushEntry?.placement === 'underside';
        const y = isUnderside ? image.height : src.y;
        const next = [...placements, { decorationId: brushId, x: src.x, y }];
        update(next);
        setSelectedIndex(next.length - 1);
      } else {
        setSelectedIndex(null);
      }
    },
    [brushId, placements, clientToSource, update, decoById, image.height],
  );

  const onPlacementPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedIndex(index);
      dragRef.current = {
        index,
        clientStart: { x: e.clientX, y: e.clientY },
        original: { ...placements[index] },
      };
      (containerRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
    },
    [placements],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.clientStart.x) / scale;
      const dy = (e.clientY - drag.clientStart.y) / scale;
      const nx = Math.max(0, Math.min(image.width, Math.round(drag.original.x + dx)));
      // Underside placements lock Y to the platform's visible bottom —
      // the runtime forces it there at spawn time anyway, so dragging
      // an underside marker up/down would be misleading.
      const draggedEntry = decoById.get(drag.original.decorationId);
      const isUnderside = draggedEntry?.placement === 'underside';
      const ny = isUnderside
        ? image.height
        : Math.max(0, Math.min(image.height, Math.round(drag.original.y + dy)));
      const next = placements.map((p, i) =>
        i === drag.index ? { ...p, x: nx, y: ny } : p,
      );
      update(next);
    },
    [scale, image.width, image.height, placements, update, decoById],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const removePlacement = useCallback(
    (index: number) => {
      const next = placements.filter((_, i) => i !== index);
      update(next);
      setSelectedIndex(null);
    },
    [placements, update],
  );

  const updatePlacement = useCallback(
    (index: number, patch: Partial<AuthoredDecoration>) => {
      const next = placements.map((p, i) => (i === index ? { ...p, ...patch } : p));
      update(next);
    },
    [placements, update],
  );

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          {brushId
            ? 'Click on the platform to place the selected decoration · click an existing one to select it · drag to move'
            : 'Pick a decoration from the right pane, then click on the platform to place it · click an existing one to select it · drag to move'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.4 }}>
          When this list has any entries, the runtime spawns ONLY these
          decorations on this platform — it skips procgen scatter
          entirely. Use this for one-off art-directed placements.
        </div>
        <div
          ref={containerRef}
          onPointerDown={onContainerPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: 'relative',
            width: displayW,
            height: displayH,
            background:
              'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 16px 16px',
            border: '1px solid var(--border)',
            userSelect: 'none',
            cursor: brushId ? 'copy' : 'default',
            touchAction: 'none',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: displayW,
              height: displayH,
              imageRendering: 'pixelated',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
          {placements.map((p, i) => (
            <PlacedDecoMarker
              key={i}
              placement={p}
              entry={decoById.get(p.decorationId) ?? null}
              thumbnailUrl={decorationThumbnails.get(p.decorationId) ?? null}
              scale={scale}
              sourceHeight={image.height}
              selected={i === selectedIndex}
              onPointerDown={(e) => onPlacementPointerDown(e, i)}
            />
          ))}
        </div>
      </div>

      <DecorationPickerSidebar
        decorationProject={decorationProject}
        thumbnails={decorationThumbnails}
        brushId={brushId}
        onPickBrush={setBrushId}
        placements={placements}
        selectedIndex={selectedIndex}
        decoById={decoById}
        sourceWidth={image.width}
        sourceHeight={image.height}
        onSelect={setSelectedIndex}
        onRemove={removePlacement}
        onUpdatePlacement={updatePlacement}
      />
    </div>
  );
}

/** A placed decoration shown on the canvas. The thumbnail is anchored
 *  on the canvas at the placement's source-px coords (scaled to display).
 *  Anchor matches the runtime: bottom-anchored decorations show their
 *  BOTTOM at the placement Y, underside ones show their TOP. */
function PlacedDecoMarker({
  placement,
  entry,
  thumbnailUrl,
  scale,
  sourceHeight,
  selected,
  onPointerDown,
}: {
  placement: AuthoredDecoration;
  entry: Decoration | null;
  thumbnailUrl: string | null;
  scale: number;
  /** Height of the source platform image in source pixels — used to
   *  force underside markers to render at the platform's visible
   *  bottom edge, matching runtime behavior (which ignores authored
   *  Y for undersides and snaps to the platform bottom). */
  sourceHeight: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Display dims — match the runtime render scale (0.336 for sheets,
  // 1.0 for singles) so what the user sees here is roughly what the
  // game shows, modulo the editor's own zoom.
  const isSheet = entry?.kind === 'sheet';
  const renderScale = entry ? (isSheet ? 0.336 : 1.0) : 0.5;
  const dispScale = renderScale * scale;
  const frameW = entry
    ? isSheet
      ? entry.frameWidth
      : entry.width
    : 64;
  const frameH = entry
    ? isSheet
      ? entry.frameHeight
      : entry.height
    : 64;
  const w = frameW * dispScale;
  const h = frameH * dispScale;
  // Anchor: bottom-anchored = sprite bottom at (x, y); underside = top at (x, y).
  // Underside ignores authored Y and snaps to the platform's visible
  // bottom — matches the runtime, which forces underside spawns to
  // hang from `spriteTop + renderedHeight`. So legacy placements with
  // outdated Y values still preview at the correct position.
  const placement_kind = entry?.placement === 'underside' ? 'underside' : 'topside';
  const dispX = placement.x * scale;
  const dispY =
    placement_kind === 'underside' ? sourceHeight * scale : placement.y * scale;
  const left = dispX - w / 2;
  const top = placement_kind === 'underside' ? dispY : dispY - h;

  // Sheet thumbnail = first frame via background-position cropping.
  const sheetTotalW = isSheet ? entry!.frameWidth * entry!.frameCount : 0;
  const thumbStyle: React.CSSProperties =
    isSheet && thumbnailUrl
      ? {
          width: w,
          height: h,
          backgroundImage: `url(${thumbnailUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${sheetTotalW * dispScale}px ${h}px`,
          backgroundPosition: '0 0',
          imageRendering: 'pixelated',
          pointerEvents: 'auto',
          cursor: 'move',
          opacity: 0.92,
          outline: selected ? '2px solid #ffe680' : '1px solid rgba(255,255,255,0.2)',
        }
      : {
          width: w,
          height: h,
          backgroundImage: thumbnailUrl ? `url(${thumbnailUrl})` : undefined,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          background: thumbnailUrl ? undefined : 'rgba(255, 100, 100, 0.4)',
          imageRendering: 'pixelated',
          pointerEvents: 'auto',
          cursor: 'move',
          opacity: 0.92,
          outline: selected ? '2px solid #ffe680' : '1px solid rgba(255,255,255,0.2)',
        };

  return (
    <div
      onPointerDown={onPointerDown}
      style={{ position: 'absolute', left, top }}
    >
      <div style={thumbStyle} />
      {/* Anchor dot — shows EXACT placement point on the canvas. */}
      <div
        style={{
          position: 'absolute',
          left: w / 2 - 3,
          top: placement_kind === 'underside' ? -3 : h - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          background: selected ? '#ffe680' : 'rgba(255, 230, 120, 0.8)',
          border: '1px solid #1e1e22',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** Right-side picker + inspector for the decorations tab. Top half:
 *  scrollable library grid grouped by category. Bottom half: list of
 *  current placements with selection / numeric edit / remove. */
function DecorationPickerSidebar({
  decorationProject,
  thumbnails,
  brushId,
  onPickBrush,
  placements,
  selectedIndex,
  decoById,
  sourceWidth,
  sourceHeight,
  onSelect,
  onRemove,
  onUpdatePlacement,
}: {
  decorationProject: DecorationProject | null;
  thumbnails: Map<string, string>;
  brushId: string | null;
  onPickBrush: (id: string | null) => void;
  placements: AuthoredDecoration[];
  selectedIndex: number | null;
  decoById: Map<string, Decoration>;
  sourceWidth: number;
  sourceHeight: number;
  onSelect: (i: number | null) => void;
  onRemove: (i: number) => void;
  onUpdatePlacement: (i: number, patch: Partial<AuthoredDecoration>) => void;
}) {
  const selected = selectedIndex !== null ? placements[selectedIndex] : null;
  const selectedEntry = selected ? decoById.get(selected.decorationId) ?? null : null;

  return (
    <aside
      style={{
        width: 300,
        flexShrink: 0,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontSize: 12,
        maxHeight: 'calc(100vh - 200px)',
        overflow: 'hidden',
      }}
    >
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Library — click to set as brush
        </div>
        {!decorationProject || decorationProject.decorations.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            No decorations loaded. Open a decorations.json in
            Decorations mode first, then come back.
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 4,
            }}
          >
            {decorationProject.decorations.map((d) => (
              <LibraryThumb
                key={d.id}
                deco={d}
                thumbnailUrl={thumbnails.get(d.id) ?? null}
                selected={d.id === brushId}
                onClick={() => onPickBrush(d.id === brushId ? null : d.id)}
              />
            ))}
          </div>
        )}
        {brushId && (
          <button
            onClick={() => onPickBrush(null)}
            style={{ fontSize: 11 }}
            title="Stop placing — clicking the canvas will deselect instead"
          >
            Cancel brush
          </button>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Placements ({placements.length})
        </div>
        {placements.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            None yet. Pick a brush above and click on the platform.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
            {placements.map((p, i) => (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className={i === selectedIndex ? 'primary' : ''}
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  padding: '3px 6px',
                }}
              >
                #{i + 1} · {p.decorationId.slice(0, 22)} · {p.x},{p.y}
              </button>
            ))}
          </div>
        )}
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Editing #{(selectedIndex ?? 0) + 1}
              {selectedEntry ? ` — ${selectedEntry.id}` : ' — (missing decoration!)'}
            </div>
            <NumericRow
              label="x"
              value={selected.x}
              min={0}
              max={sourceWidth}
              onChange={(v) =>
                onUpdatePlacement(selectedIndex!, { x: v })
              }
            />
            <NumericRow
              label="y"
              value={selected.y}
              min={0}
              max={sourceHeight}
              onChange={(v) =>
                onUpdatePlacement(selectedIndex!, { y: v })
              }
            />
            <button onClick={() => onRemove(selectedIndex!)} style={{ fontSize: 11 }}>
              Remove
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}

function LibraryThumb({
  deco,
  thumbnailUrl,
  selected,
  onClick,
}: {
  deco: Decoration;
  thumbnailUrl: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const isSheet = deco.kind === 'sheet';
  const sheetTotalW = isSheet ? deco.frameWidth * deco.frameCount : 0;
  const thumbStyle: React.CSSProperties =
    isSheet && thumbnailUrl
      ? {
          width: '100%',
          height: 56,
          backgroundImage: `url(${thumbnailUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${(sheetTotalW * 56) / deco.frameHeight}px 56px`,
          backgroundPosition: '0 0',
          imageRendering: 'pixelated',
        }
      : {
          width: '100%',
          height: 56,
          backgroundImage: thumbnailUrl ? `url(${thumbnailUrl})` : undefined,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          background: thumbnailUrl ? undefined : 'rgba(255,255,255,0.06)',
          imageRendering: 'pixelated',
        };
  return (
    <button
      onClick={onClick}
      title={`${deco.id} · ${deco.category}/${deco.sizeClass}${deco.placement === 'underside' ? ' · underside' : ''}`}
      style={{
        background: selected ? 'var(--accent-bg, #2a3a4a)' : '#1e1e22',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 3,
        padding: 2,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 2,
      }}
    >
      <div style={thumbStyle} />
    </button>
  );
}

// ---- Canvas with overlays ----------------------------------------------

function Canvas({
  image,
  scale,
  displayW,
  displayH,
  regions,
  selectedIndex,
  hullMode,
  hullDraft,
  onSelect,
  onAdd,
  onUpdate,
  onHullChange,
}: {
  image: ImageData;
  scale: number;
  displayW: number;
  displayH: number;
  regions: WalkableRegion[];
  selectedIndex: number | null;
  hullMode: boolean;
  hullDraft: WalkableHull | null;
  onSelect: (i: number | null) => void;
  onAdd: (r: WalkableRegion) => void;
  onUpdate: (i: number, patch: Partial<WalkableRegion>) => void;
  onHullChange: (h: WalkableHull | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const hullDragRef = useRef<{ x: number; y: number } | null>(null);
  const [draftRect, setDraftRect] = useState<WalkableRegion | null>(null);
  const [draftHull, setDraftHull] = useState<WalkableHull | null>(null);

  // Stage the source PNG onto a 1:1 canvas; we scale up via CSS for crisp pixels.
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

  /** Convert a client (event) point into source-pixel coords. */
  const clientToSource = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const x = Math.round((clientX - rect.left) / scale);
      const y = Math.round((clientY - rect.top) / scale);
      return {
        x: Math.max(0, Math.min(image.width, x)),
        y: Math.max(0, Math.min(image.height, y)),
      };
    },
    [scale, image.width, image.height],
  );

  // ---- Region creation / move / resize ----------------------------------

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Hull mode: drag to draw the hull rect from start to end.
      if (hullMode) {
        const start = clientToSource(e.clientX, e.clientY);
        hullDragRef.current = start;
        setDraftHull({
          left: start.x,
          right: start.x + 1,
          top: start.y,
          bottom: start.y + 1,
        });
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      // Region creation: starting on empty canvas (not on an existing rect)
      // begins a drag that creates a new region. Clicking on an existing
      // rect selects it instead — handled by the rect's own onPointerDown.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onSelect(null);
      const start = clientToSource(e.clientX, e.clientY);
      dragRef.current = { kind: 'create', sourceStart: start };
      setDraftRect({ x: start.x, y: start.y, width: 1, height: DEFAULT_BAND_HEIGHT });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [hullMode, clientToSource, onSelect],
  );

  const onContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Hull mode drag
      if (hullMode && hullDragRef.current) {
        const start = hullDragRef.current;
        const cur = clientToSource(e.clientX, e.clientY);
        setDraftHull({
          left: Math.min(start.x, cur.x),
          right: Math.max(start.x, cur.x),
          top: Math.min(start.y, cur.y),
          bottom: Math.max(start.y, cur.y),
        });
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === 'create') {
        const cur = clientToSource(e.clientX, e.clientY);
        const x = Math.min(drag.sourceStart.x, cur.x);
        const y = Math.min(drag.sourceStart.y, cur.y);
        const width = Math.max(1, Math.abs(cur.x - drag.sourceStart.x));
        // Preserve the typed band height while dragging so the user gets
        // a stable preview of the surface depth they're committing to.
        const height = Math.max(
          DEFAULT_BAND_HEIGHT,
          Math.abs(cur.y - drag.sourceStart.y),
        );
        setDraftRect({ x, y, width, height });
      } else if (drag.kind === 'move') {
        const dx = (e.clientX - drag.clientStart.x) / scale;
        const dy = (e.clientY - drag.clientStart.y) / scale;
        const x = clamp(Math.round(drag.original.x + dx), 0, image.width - drag.original.width);
        const y = clamp(Math.round(drag.original.y + dy), 0, image.height - drag.original.height);
        onUpdate(drag.index, { x, y });
      } else if (drag.kind === 'resize') {
        const dx = (e.clientX - drag.clientStart.x) / scale;
        const dy = (e.clientY - drag.clientStart.y) / scale;
        const next = applyResize(drag.original, drag.handle, dx, dy, image.width, image.height);
        onUpdate(drag.index, next);
      } else if (drag.kind === 'tilt') {
        const dy = (e.clientY - drag.clientStart.y) / scale;
        if (drag.handle === 'tilt-left') {
          // Moving the top-LEFT corner moves the region's `y` AND
          // counter-shifts `rightTopOffset` so the top-right corner
          // stays put — the user's intuition is "I'm dragging just
          // this corner."
          const currentTilt = drag.original.rightTopOffset ?? 0;
          const newY = clamp(
            Math.round(drag.original.y + dy),
            0,
            image.height - drag.original.height,
          );
          const realDy = newY - drag.original.y;
          onUpdate(drag.index, {
            y: newY,
            rightTopOffset: currentTilt - realDy,
          });
        } else {
          // tilt-right: move only the top-right corner via rightTopOffset.
          const currentTilt = drag.original.rightTopOffset ?? 0;
          // Clamp so the right corner doesn't escape the source bounds.
          const minOffset = -drag.original.y;
          const maxOffset = image.height - drag.original.y - drag.original.height;
          const nextTilt = clamp(Math.round(currentTilt + dy), minOffset, maxOffset);
          onUpdate(drag.index, { rightTopOffset: nextTilt === 0 ? undefined : nextTilt });
        }
      }
    },
    [hullMode, clientToSource, onUpdate, scale, image.width, image.height],
  );

  const onContainerPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      // Commit hull drag.
      if (hullMode && hullDragRef.current && draftHull) {
        // Reject empty / degenerate drags; nudge to at least 4×4 so the
        // user sees something they can edit.
        const w = draftHull.right - draftHull.left;
        const h = draftHull.bottom - draftHull.top;
        if (w >= 4 && h >= 4) onHullChange(draftHull);
        hullDragRef.current = null;
        setDraftHull(null);
        return;
      }

      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) {
        setDraftRect(null);
        return;
      }
      if (drag.kind === 'create' && draftRect) {
        // Commit the new region only if it's wider than a few pixels —
        // accidental clicks otherwise spawn unusable hairline rects.
        if (draftRect.width >= 4) onAdd(draftRect);
      }
      setDraftRect(null);
    },
    [hullMode, draftHull, onHullChange, draftRect, onAdd],
  );

  const onRegionPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (hullMode) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect(index);
      const handle = (e.target as HTMLElement).dataset.handle as
        | ResizeHandle
        | TiltHandle
        | undefined;
      if (handle === 'tilt-left' || handle === 'tilt-right') {
        dragRef.current = {
          kind: 'tilt',
          index,
          handle,
          clientStart: { x: e.clientX, y: e.clientY },
          original: { ...regions[index] },
        };
      } else if (handle) {
        dragRef.current = {
          kind: 'resize',
          index,
          handle,
          clientStart: { x: e.clientX, y: e.clientY },
          original: { ...regions[index] },
        };
      } else {
        dragRef.current = {
          kind: 'move',
          index,
          clientStart: { x: e.clientX, y: e.clientY },
          original: { ...regions[index] },
        };
      }
      (containerRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
    },
    [hullMode, onSelect, regions],
  );

  const liveHull = draftHull ?? hullDraft;

  return (
    <div
      ref={containerRef}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      style={{
        position: 'relative',
        width: displayW,
        height: displayH,
        background:
          'repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 16px 16px',
        border: '1px solid var(--border)',
        userSelect: 'none',
        cursor: hullMode ? 'crosshair' : 'crosshair',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: displayW,
          height: displayH,
          imageRendering: 'pixelated',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
      {/* Hull overlay (silhouette / shadow bounds) */}
      {liveHull && (
        <div
          style={{
            position: 'absolute',
            left: liveHull.left * scale,
            top: liveHull.top * scale,
            width: (liveHull.right - liveHull.left) * scale,
            height: (liveHull.bottom - liveHull.top) * scale,
            border: '1px dashed rgba(140, 200, 255, 0.8)',
            background: 'rgba(140, 200, 255, 0.06)',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Existing walkable regions */}
      {regions.map((r, i) => (
        <RegionRect
          key={i}
          region={r}
          scale={scale}
          selected={i === selectedIndex}
          dim={hullMode}
          onPointerDown={(e) => onRegionPointerDown(e, i)}
        />
      ))}
      {/* In-flight create rect */}
      {draftRect && (
        <div
          style={{
            position: 'absolute',
            left: draftRect.x * scale,
            top: draftRect.y * scale,
            width: draftRect.width * scale,
            height: draftRect.height * scale,
            border: '1px dashed rgba(120, 220, 120, 0.9)',
            background: 'rgba(120, 220, 120, 0.18)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// ---- Region rectangle with handles -------------------------------------

function RegionRect({
  region,
  scale,
  selected,
  dim,
  onPointerDown,
}: {
  region: WalkableRegion;
  scale: number;
  selected: boolean;
  dim: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Region geometry in display pixels. The parallelogram tilts the TOP
  // edge: TL stays at (x, y), TR moves vertically by `tilt`. The bottom
  // edge stays parallel so the shape remains a parallelogram.
  const x = region.x * scale;
  const y = region.y * scale;
  const w = region.width * scale;
  const h = region.height * scale;
  const tilt = (region.rightTopOffset ?? 0) * scale;
  const baseAlpha = dim ? 0.04 : 0.16;

  // Bounding box that the absolute-positioned wrapper occupies. Needs to
  // be tall enough to fit the tilted parallelogram + handle slop on
  // both top and bottom of the tilt range.
  const tiltAbove = tilt < 0 ? -tilt : 0;
  const tiltBelow = tilt > 0 ? tilt : 0;
  const wrapperTop = y - tiltAbove - 8;
  const wrapperHeight = h + tiltAbove + tiltBelow + 16;
  const wrapperLeft = x - 8;
  const wrapperWidth = w + 16;

  // Local coords inside the wrapper. The tilt offset above shifts
  // everything down by `tiltAbove + 8` so negative tilts are visible.
  const localOriginY = tiltAbove + 8;
  const localOriginX = 8;

  // Parallelogram vertices, local to the wrapper SVG.
  const TLx = localOriginX;
  const TLy = localOriginY;
  const TRx = localOriginX + w;
  const TRy = localOriginY + tilt;
  const BRx = TRx;
  const BRy = TRy + h;
  const BLx = TLx;
  const BLy = TLy + h;
  const polygonPoints = `${TLx},${TLy} ${TRx},${TRy} ${BRx},${BRy} ${BLx},${BLy}`;
  // Walking-surface line: runs through the CENTER of the parallelogram
  // (mid-left → mid-right). The runtime treats the rectangle as the
  // platform's visible top FACE — for perspective platforms with depth,
  // the actual walking line sits in the middle of that face, not at the
  // back-edge top. The bright accent line draws here so authoring
  // matches what you'll get in-game.
  const MLx = TLx;
  const MLy = TLy + h / 2;
  const MRx = TRx;
  const MRy = TRy + h / 2;

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        left: wrapperLeft,
        top: wrapperTop,
        width: wrapperWidth,
        height: wrapperHeight,
        cursor: 'move',
      }}
    >
      {/* SVG renders the parallelogram body + the bright top-edge accent */}
      <svg
        width={wrapperWidth}
        height={wrapperHeight}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <polygon
          points={polygonPoints}
          fill={`rgba(120, 220, 120, ${baseAlpha})`}
          stroke={
            selected
              ? 'rgba(120, 220, 120, 1)'
              : 'rgba(120, 220, 120, 0.6)'
          }
          strokeWidth={1}
        />
        {/* Walking-surface line: center of the parallelogram. The bright
            yellow line is "where the player's feet land". The top edge of
            the rectangle is just the visual boundary of the platform's
            top face. */}
        <line
          x1={MLx}
          y1={MLy}
          x2={MRx}
          y2={MRy}
          stroke={selected ? 'rgba(255, 230, 120, 1)' : 'rgba(255, 230, 120, 0.7)'}
          strokeWidth={2}
        />
      </svg>
      {/* Click target covers the parallelogram area for selection / move */}
      <svg
        width={wrapperWidth}
        height={wrapperHeight}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
      >
        <polygon points={polygonPoints} fill="rgba(0,0,0,0)" stroke="none" />
      </svg>
      {selected && (
        <>
          {/* Bounding-box resize handles (axis-aligned to the rectangle's
              x/y/width/height — they ignore tilt). */}
          <Handle x={TLx} y={localOriginY} cursor="nwse-resize" handle="nw" />
          <Handle x={TRx} y={localOriginY} cursor="nesw-resize" handle="ne" />
          <Handle x={TLx} y={localOriginY + h} cursor="nesw-resize" handle="sw" />
          <Handle x={TRx} y={localOriginY + h} cursor="nwse-resize" handle="se" />
          <Handle x={TLx + w / 2} y={localOriginY} cursor="ns-resize" handle="n" />
          <Handle x={TLx + w / 2} y={localOriginY + h} cursor="ns-resize" handle="s" />
          <Handle x={TLx} y={localOriginY + h / 2} cursor="ew-resize" handle="w" />
          <Handle x={TRx} y={localOriginY + h / 2} cursor="ew-resize" handle="e" />
          {/* Tilt handles — yellow, on the actual top edge. Drag UP/DOWN
              to slope that side independently. */}
          <Handle
            x={TLx}
            y={TLy}
            cursor="ns-resize"
            handle="tilt-left"
            color="rgba(255, 230, 120, 1)"
            title="Tilt left side up/down (Y only)"
          />
          <Handle
            x={TRx}
            y={TRy}
            cursor="ns-resize"
            handle="tilt-right"
            color="rgba(255, 230, 120, 1)"
            title="Tilt right side up/down (Y only)"
          />
        </>
      )}
    </div>
  );
}

function Handle({
  x,
  y,
  cursor,
  handle,
  color,
  title,
}: {
  x: number;
  y: number;
  cursor: string;
  handle: string;
  color?: string;
  title?: string;
}) {
  return (
    <div
      data-handle={handle}
      title={title}
      style={{
        position: 'absolute',
        left: x - 5,
        top: y - 5,
        width: 10,
        height: 10,
        background: color ?? 'rgba(120, 220, 120, 1)',
        border: '1px solid #1e1e22',
        cursor,
      }}
    />
  );
}

function applyResize(
  original: WalkableRegion,
  handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
  dx: number,
  dy: number,
  imageW: number,
  imageH: number,
): Partial<WalkableRegion> {
  let { x, y, width, height } = original;
  const right = x + width;
  const bottom = y + height;
  if (handle.includes('w')) {
    const nx = clamp(Math.round(x + dx), 0, right - 4);
    width = right - nx;
    x = nx;
  }
  if (handle.includes('e')) {
    const nr = clamp(Math.round(right + dx), x + 4, imageW);
    width = nr - x;
  }
  if (handle.includes('n')) {
    const ny = clamp(Math.round(y + dy), 0, bottom - 4);
    height = bottom - ny;
    y = ny;
  }
  if (handle.includes('s')) {
    const nb = clamp(Math.round(bottom + dy), y + 4, imageH);
    height = nb - y;
  }
  return { x, y, width, height };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---- Right-side inspector ----------------------------------------------

function Inspector({
  asset,
  regions,
  selectedIndex,
  onSelect,
  onUpdate,
  onRemove,
  sourceWidth,
  sourceHeight,
  hullDraft,
  onResetHull,
  onSurfaceCenterChange,
}: {
  asset: PlatformAsset;
  regions: WalkableRegion[];
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
  onUpdate: (i: number, patch: Partial<WalkableRegion>) => void;
  onRemove: (i: number) => void;
  sourceWidth: number;
  sourceHeight: number;
  hullDraft: WalkableHull | null;
  onResetHull: () => void;
  onSurfaceCenterChange: (c: { x: number; y: number } | null) => void;
}) {
  // Computed bounds — the runtime falls back to this when no explicit hull
  // is set. Surface the value so the user knows what they're getting.
  const computed = useMemo(() => walkableBoundsSource({ walkableHull: hullDraft ?? undefined, walkableRegions: regions }), [hullDraft, regions]);

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontSize: 12,
      }}
    >
      <section>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
          Walkable regions ({regions.length})
        </div>
        {regions.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            None yet. Drag on the canvas to draw, or click Auto-detect.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {regions.map((r, i) => (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className={i === selectedIndex ? 'primary' : ''}
                style={{
                  fontSize: 11,
                  textAlign: 'left',
                  fontFamily: 'monospace',
                  padding: '4px 8px',
                }}
              >
                #{i + 1} · {r.x},{r.y} · {r.width}×{r.height}
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedIndex !== null && regions[selectedIndex] && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Region #{selectedIndex + 1}
          </div>
          <NumericRow
            label="x"
            value={regions[selectedIndex].x}
            min={0}
            max={sourceWidth - regions[selectedIndex].width}
            onChange={(v) => onUpdate(selectedIndex, { x: v })}
          />
          <NumericRow
            label="y"
            value={regions[selectedIndex].y}
            min={0}
            max={sourceHeight - regions[selectedIndex].height}
            onChange={(v) => onUpdate(selectedIndex, { y: v })}
          />
          <NumericRow
            label="width"
            value={regions[selectedIndex].width}
            min={4}
            max={sourceWidth - regions[selectedIndex].x}
            onChange={(v) => onUpdate(selectedIndex, { width: v })}
          />
          <NumericRow
            label="height"
            value={regions[selectedIndex].height}
            min={4}
            max={sourceHeight - regions[selectedIndex].y}
            onChange={(v) => onUpdate(selectedIndex, { height: v })}
          />
          <NumericRow
            label="tilt"
            value={regions[selectedIndex].rightTopOffset ?? 0}
            // Allow tilt to span the full image height in either direction;
            // visual clamping at the canvas is enforced by the drag handler.
            min={-sourceHeight}
            max={sourceHeight}
            onChange={(v) =>
              onUpdate(selectedIndex, { rightTopOffset: v === 0 ? undefined : v })
            }
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            Tilt = top-right Y offset relative to top-left. Positive = right
            side lower (slope down to the right). Drag the yellow corner
            handles for visual control.
          </div>
          <button
            onClick={() => onRemove(selectedIndex)}
            style={{ fontSize: 11, marginTop: 6 }}
          >
            Delete region
          </button>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Hull (shadow bounds)</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {hullDraft
            ? `authored · l${hullDraft.left} r${hullDraft.right} t${hullDraft.top} b${hullDraft.bottom}`
            : computed
              ? `auto · l${computed.left} r${computed.right} t${computed.top} b${computed.bottom}`
              : '—'}
        </div>
        {hullDraft && (
          <button onClick={onResetHull} style={{ fontSize: 11 }}>
            Reset to auto
          </button>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Surface center (icon anchor)
        </div>
        <SurfaceCenterEditor
          surfaceCenter={asset.surfaceCenter ?? null}
          fallback={
            computed
              ? { x: (computed.left + computed.right) / 2, y: (computed.top + computed.bottom) / 2 }
              : null
          }
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={onSurfaceCenterChange}
        />
      </section>
    </aside>
  );
}

function NumericRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ width: 48, color: 'var(--text-dim)' }}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(clamp(Math.round(n), min, max));
        }}
        style={{ flex: 1, fontFamily: 'monospace' }}
      />
    </label>
  );
}

function SurfaceCenterEditor({
  surfaceCenter,
  fallback,
  sourceWidth,
  sourceHeight,
  onChange,
}: {
  surfaceCenter: { x: number; y: number } | null;
  fallback: { x: number; y: number } | null;
  sourceWidth: number;
  sourceHeight: number;
  onChange: (v: { x: number; y: number } | null) => void;
}) {
  const effective = surfaceCenter ?? fallback;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
        {surfaceCenter
          ? `authored · ${surfaceCenter.x},${surfaceCenter.y}`
          : effective
            ? `auto · ${Math.round(effective.x)},${Math.round(effective.y)}`
            : '—'}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="number"
          value={effective?.x ?? 0}
          min={0}
          max={sourceWidth}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const x = clamp(Math.round(n), 0, sourceWidth);
            onChange({ x, y: effective?.y ?? Math.round(sourceHeight / 2) });
          }}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
          placeholder="x"
        />
        <input
          type="number"
          value={effective?.y ?? 0}
          min={0}
          max={sourceHeight}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const y = clamp(Math.round(n), 0, sourceHeight);
            onChange({ x: effective?.x ?? Math.round(sourceWidth / 2), y });
          }}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
          placeholder="y"
        />
      </div>
      {surfaceCenter && (
        <button onClick={() => onChange(null)} style={{ fontSize: 11 }}>
          Reset to auto
        </button>
      )}
    </div>
  );
}
