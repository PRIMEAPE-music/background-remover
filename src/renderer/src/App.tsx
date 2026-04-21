import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar, type ViewMode } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { SliceSidebar } from './components/SliceSidebar';
import { CanvasView } from './components/CanvasView';
import { GridOverlay } from './components/slice/GridOverlay';
import { GuidesOverlay } from './components/slice/GuidesOverlay';
import { BoxesOverlay } from './components/slice/BoxesOverlay';
import { SelectOverlay } from './components/SelectOverlay';
import {
  detectBackgroundColor,
  removeColorFlood,
  removeColorGlobal,
  type DistanceMode,
} from './lib/bg-removal';
import {
  cloneImageData,
  clearRect as clearImageRect,
  compositeOnto,
  extractRect,
  imageDataToPngBytes,
  loadImageFromBytes,
} from './lib/image-utils';
import type { RGB } from './lib/color';
import {
  computeCells,
  DEFAULT_SLICE,
  detectBlobs,
  extractAndNormalizeCell,
  packCells,
  type Rect,
  type SliceConfig,
} from './lib/slicing';
import { loadPresets, savePresets, type SavedPreset } from './lib/presets';

// Undo history is bounded by both count and total pixel bytes, because each
// entry is a full ImageData clone — at 4K+ resolution a few clones can be
// hundreds of MB, which can OOM the renderer.
const MAX_UNDO_COUNT = 10;
const MAX_UNDO_BYTES = 400 * 1024 * 1024;

export function App() {
  // Image pixels live in a ref — NEVER in React state or props. React/DevTools
  // snapshotting multi-MB ImageData through the reconciler was adding seconds
  // per setState. `imageMeta` is a tiny state value that changes whenever the
  // pixels change, giving components something cheap to depend on.
  const imageRef = useRef<ImageData | null>(null);
  const imageVersionRef = useRef(0);
  const [imageMeta, setImageMeta] = useState<{
    width: number;
    height: number;
    version: number;
  } | null>(null);
  const image = imageRef.current;

  const setImage = useCallback((next: ImageData | null) => {
    imageRef.current = next;
    if (next) {
      imageVersionRef.current++;
      setImageMeta({
        width: next.width,
        height: next.height,
        version: imageVersionRef.current,
      });
    } else {
      setImageMeta(null);
    }
  }, []);

  const [filepath, setFilepath] = useState<string | null>(null);
  // History is also held in a ref so the array of ImageData clones never goes
  // through the reconciler. A small state counter triggers UI updates
  // (undo-enabled button).
  const historyRef = useRef<ImageData[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  const [mode, setMode] = useState<ViewMode>('remove');

  // Remove-BG state
  const [pickedColor, setPickedColor] = useState<RGB | null>(null);
  const [hoverColor, setHoverColor] = useState<RGB | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [tolerance, setTolerance] = useState(20);
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('lab');
  const [floodFill, setFloodFill] = useState(false);

  // Slice state
  const [slice, setSlice] = useState<SliceConfig>(DEFAULT_SLICE);
  const [selectedCellIndex, setSelectedCellIndex] = useState<number | null>(null);
  const [viewZoom, setViewZoom] = useState(1);
  const [presets, setPresets] = useState<SavedPreset[]>([]);

  // Select+Move state
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  const [selectionOffset, setSelectionOffset] = useState<{ x: number; y: number } | null>(null);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [floater, setFloater] = useState<ImageData | null>(null);
  const [liftSnapshot, setLiftSnapshot] = useState<ImageData | null>(null);
  // React may not have rendered floater=truthy by the time the next mousemove
  // fires, so guard against double-lift with a ref.
  const liftingRef = useRef(false);

  useEffect(() => setPresets(loadPresets()), []);

  const pushHistory = useCallback((prev: ImageData) => {
    const h = historyRef.current;
    h.push(prev);
    while (h.length > MAX_UNDO_COUNT) h.shift();
    let bytes = 0;
    for (const e of h) bytes += e.data.byteLength;
    while (h.length > 1 && bytes > MAX_UNDO_BYTES) {
      bytes -= h[0].data.byteLength;
      h.shift();
    }
    setHistoryLen(h.length);
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setHistoryLen(0);
  }, []);

  const popHistory = useCallback((): ImageData | null => {
    const h = historyRef.current;
    if (h.length === 0) return null;
    const prev = h.pop()!;
    setHistoryLen(h.length);
    return prev;
  }, []);

  const dropLastHistory = useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    h.pop();
    setHistoryLen(h.length);
  }, []);

  const appRenderCount = useRef(0);
  appRenderCount.current++;
  if (appRenderCount.current % 5 === 1) {
    console.log('[perf] App render #', appRenderCount.current, 'at', performance.now().toFixed(0));
  }

  const ingestImage = useCallback(async (path: string, bytes: Uint8Array) => {
    const ext = path.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'bmp'
            ? 'image/bmp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/png';
    // Drop the old image + history BEFORE starting the decode, so we don't
    // briefly hold both (which can OOM for large images with undo history).
    setImage(null);
    setFilepath(null);
    clearHistory();
    setPickedColor(null);
    setSelectedCellIndex(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setSelectionConfirmed(false);
    setFloater(null);
    setLiftSnapshot(null);
    liftingRef.current = false;
    await new Promise<void>((r) => setTimeout(r, 0));
    const data = await loadImageFromBytes(bytes, mime);
    setImage(data);
    setFilepath(path);
  }, [setImage, clearHistory]);

  const openImage = useCallback(async () => {
    const paths = await window.api.openImagePaths();
    if (paths.length === 0) return;
    const bytes = await window.api.readFile(paths[0]);
    await ingestImage(paths[0], bytes);
  }, [ingestImage]);

  const handleFileDrop = useCallback(
    async (file: File) => {
      console.log('[perf] drop received at', performance.now().toFixed(1));
      const t0 = performance.now();
      const buf = new Uint8Array(await file.arrayBuffer());
      console.log('[perf] blob read', (performance.now() - t0).toFixed(1), 'ms');
      await ingestImage(file.name, buf);
      console.log('[perf] ingest returned', (performance.now() - t0).toFixed(1), 'ms');
    },
    [ingestImage],
  );

  const saveImage = useCallback(async () => {
    if (!image) return;
    const base = filepath
      ? filepath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      : 'output';
    const bytes = await imageDataToPngBytes(image);
    await window.api.saveImage(`${base}_transparent.png`, bytes);
  }, [image, filepath]);

  const handleHover = useCallback((x: number, y: number, c: RGB | null) => {
    setHoverPos(x < 0 ? null : { x, y });
    setHoverColor(c);
  }, []);

  const handleViewportChange = useCallback((z: number) => {
    setViewZoom(z);
  }, []);

  const getImage = useCallback(() => imageRef.current, []);

  const handlePick = useCallback(
    (x: number, y: number, color: RGB) => {
      if (!image) return;
      setPickedColor(color);
      if (floodFill) {
        pushHistory(cloneImageData(image));
        const next = cloneImageData(image);
        removeColorFlood(next.data, next.width, next.height, x, y, {
          tolerance,
          mode: distanceMode,
        });
        setImage(next);
      }
    },
    [image, floodFill, tolerance, distanceMode, pushHistory],
  );

  const handleRemoveGlobal = useCallback(() => {
    if (!image || !pickedColor) return;
    pushHistory(cloneImageData(image));
    const next = cloneImageData(image);
    removeColorGlobal(next.data, pickedColor, { tolerance, mode: distanceMode });
    setImage(next);
  }, [image, pickedColor, tolerance, distanceMode, pushHistory]);

  const handleAutoDetect = useCallback(() => {
    if (!image) return;
    setPickedColor(detectBackgroundColor(image.data, image.width, image.height));
  }, [image]);

  const handleUndo = useCallback(() => {
    const prev = popHistory();
    if (!prev) return;
    setImage(prev);
    // Any in-flight selection is invalidated by undo.
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setSelectionConfirmed(false);
    liftingRef.current = false;
  }, [popHistory, setImage]);

  // ---- Slice / export ----
  const cells = useMemo(
    () => (image ? computeCells(slice, image.width, image.height) : []),
    [slice, image],
  );

  // Only compute the per-cell processed previews when the user is actually in
  // slice mode. This is a heavy operation (per-cell full-image putImageData +
  // content-bounds scan) and re-running it on every image load was the main
  // cause of the long stall after dropping a new image.
  const processedCells = useMemo(() => {
    if (!image || mode !== 'slice') return [] as ImageData[];
    return cells.map((r, i) =>
      extractAndNormalizeCell(image, r, slice.overrides[i], slice.normalize),
    );
  }, [image, cells, slice.overrides, slice.normalize, mode]);

  const joinPath = (folder: string, filename: string) => {
    const sep = folder.includes('\\') ? '\\' : '/';
    return folder.endsWith(sep) ? folder + filename : `${folder}${sep}${filename}`;
  };

  const exportCells = useCallback(async () => {
    if (!image || processedCells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = filepath
      ? filepath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      : 'cell';
    const pad = String(processedCells.length - 1).length;
    for (let i = 0; i < processedCells.length; i++) {
      const bytes = await imageDataToPngBytes(processedCells[i]);
      await window.api.writeFile(
        joinPath(folder, `${base}_${String(i).padStart(pad, '0')}.png`),
        bytes,
      );
    }
  }, [image, processedCells, filepath]);

  const exportAtlas = useCallback(async () => {
    if (!image || processedCells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = filepath
      ? filepath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      : 'atlas';
    // Pack into as-square-as-possible grid.
    const cols = Math.max(1, Math.ceil(Math.sqrt(processedCells.length)));
    const packed = packCells(processedCells, {
      columns: cols,
      pngFilename: `${base}.png`,
      frameName: base,
      // Default pivot = bottom-center (matches feet-anchored sprites). User-facing UI can be added later.
      pivot: { x: 0.5, y: 1 },
    });
    const pngBytes = await imageDataToPngBytes(packed.png);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(packed.atlas, null, 2));
    await window.api.writeFile(joinPath(folder, `${base}.png`), pngBytes);
    await window.api.writeFile(
      joinPath(folder, `${base}.json`),
      jsonBytes.buffer.slice(jsonBytes.byteOffset, jsonBytes.byteOffset + jsonBytes.byteLength) as ArrayBuffer,
    );
  }, [image, processedCells, filepath]);

  const autoRepack = useCallback(async () => {
    if (!image || processedCells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = filepath
      ? filepath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      : 'sheet';
    const cols = Math.max(1, Math.ceil(Math.sqrt(processedCells.length)));
    const packed = packCells(processedCells, {
      columns: cols,
      pngFilename: `${base}_repacked.png`,
      frameName: base,
    });
    const pngBytes = await imageDataToPngBytes(packed.png);
    await window.api.writeFile(joinPath(folder, `${base}_repacked.png`), pngBytes);
  }, [image, processedCells, filepath]);

  const autoDetectBlobs = useCallback(() => {
    if (!image) return;
    const rects = detectBlobs(image, 16, 1);
    setSlice((s) => ({ ...s, mode: 'boxes', boxes: { rects } }));
    setSelectedCellIndex(null);
  }, [image]);

  const handleSavePreset = useCallback(
    (name: string) => {
      const next: SavedPreset[] = [
        ...presets.filter((p) => p.name !== name),
        { name, config: JSON.parse(JSON.stringify(slice)) },
      ];
      setPresets(next);
      savePresets(next);
    },
    [presets, slice],
  );

  const handleLoadPreset = useCallback((p: SavedPreset) => {
    setSlice(p.config);
    setSelectedCellIndex(null);
  }, []);

  const handleDeletePreset = useCallback(
    (name: string) => {
      const next = presets.filter((p) => p.name !== name);
      setPresets(next);
      savePresets(next);
    },
    [presets],
  );

  // ---- Select + Move ----
  const commitFloater = useCallback(() => {
    if (!image || !floater || !selectionOffset) {
      setFloater(null);
      setLiftSnapshot(null);
      setSelectionRect(null);
      setSelectionOffset(null);
      setSelectionConfirmed(false);
      liftingRef.current = false;
      return;
    }
    // The snapshot was pushed to history at lift-time; now composite the floater.
    const next = compositeOnto(image, floater, selectionOffset.x, selectionOffset.y);
    setImage(next);
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setSelectionConfirmed(false);
    liftingRef.current = false;
  }, [image, floater, selectionOffset]);

  const cancelSelection = useCallback(() => {
    if (liftSnapshot) {
      setImage(liftSnapshot);
      dropLastHistory();
    }
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setSelectionConfirmed(false);
    liftingRef.current = false;
  }, [liftSnapshot, setImage, dropLastHistory]);

  const defineSelection = useCallback(
    (rect: Rect) => {
      if (floater) return;
      setSelectionRect(rect);
      setSelectionOffset({ x: rect.x, y: rect.y });
      // Drawing a new selection always un-confirms — user has to re-approve.
      setSelectionConfirmed(false);
    },
    [floater],
  );

  const confirmSelection = useCallback(() => {
    if (!selectionRect) return;
    if (selectionRect.width <= 0 || selectionRect.height <= 0) return;
    setSelectionConfirmed(true);
  }, [selectionRect]);

  const moveSelection = useCallback(
    (next: { x: number; y: number }, ensureLifted: boolean, copy: boolean) => {
      if (!image || !selectionRect) return;
      if (selectionRect.width <= 0 || selectionRect.height <= 0) return;
      if (ensureLifted && !liftingRef.current) {
        // First move triggers the lift: snapshot, clear source (unless copy), extract floater.
        liftingRef.current = true;
        // History + liftSnapshot share one clone — both are treated as immutable.
        const snap = cloneImageData(image);
        pushHistory(snap);
        setLiftSnapshot(snap);
        const f = extractRect(
          image,
          selectionRect.x,
          selectionRect.y,
          selectionRect.width,
          selectionRect.height,
        );
        setFloater(f);
        if (!copy) {
          const cleared = cloneImageData(image);
          clearImageRect(
            cleared,
            selectionRect.x,
            selectionRect.y,
            selectionRect.width,
            selectionRect.height,
          );
          setImage(cleared);
        }
      }
      setSelectionOffset(next);
    },
    [image, selectionRect, pushHistory],
  );

  const eraseFloater = useCallback(() => {
    setFloater(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setSelectionConfirmed(false);
    liftingRef.current = false;
  }, []);

  // Auto-commit or cancel when leaving select mode.
  useEffect(() => {
    if (mode !== 'select' && floater) {
      commitFloater();
    }
  }, [mode, floater, commitFloater]);

  // Keyboard: H / V flip for selected cell in slice mode.
  useEffect(() => {
    if (mode !== 'slice') return;
    const handler = (e: KeyboardEvent) => {
      if (selectedCellIndex === null) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key !== 'h' && key !== 'v') return;
      e.preventDefault();
      const current = slice.overrides[selectedCellIndex] ?? {};
      const axis = key === 'h' ? 'flipH' : 'flipV';
      setSlice((s) => ({
        ...s,
        overrides: {
          ...s.overrides,
          [selectedCellIndex]: { ...current, [axis]: !current[axis] },
        },
      }));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, selectedCellIndex, slice.overrides]);

  const sliceOverlay = image && mode === 'slice' ? (
    <>
      {slice.mode === 'grid' && (
        <GridOverlay
          cells={cells}
          overrides={slice.overrides}
          zoom={viewZoom}
          imageWidth={image.width}
          imageHeight={image.height}
          selectedIndex={selectedCellIndex}
          onSelect={setSelectedCellIndex}
        />
      )}
      {slice.mode === 'guides' && (
        <GuidesOverlay
          config={slice.guides}
          onChange={(g) => setSlice({ ...slice, guides: g })}
          zoom={viewZoom}
          imageWidth={image.width}
          imageHeight={image.height}
        />
      )}
      {slice.mode === 'boxes' && (
        <BoxesOverlay
          config={slice.boxes}
          overrides={slice.overrides}
          onChange={(b) => setSlice({ ...slice, boxes: b })}
          zoom={viewZoom}
          imageWidth={image.width}
          imageHeight={image.height}
          selectedIndex={selectedCellIndex}
          onSelectedIndexChange={setSelectedCellIndex}
        />
      )}
    </>
  ) : null;

  const selectOverlay = image && mode === 'select' ? (
    <SelectOverlay
      imageWidth={image.width}
      imageHeight={image.height}
      zoom={viewZoom}
      selectionRect={selectionRect}
      offset={selectionOffset}
      confirmed={selectionConfirmed}
      floater={floater}
      onDefine={defineSelection}
      onConfirm={confirmSelection}
      onMove={moveSelection}
      onCommit={commitFloater}
      onCancel={cancelSelection}
      onEraseFloater={eraseFloater}
    />
  ) : null;

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) return;
        handleFileDrop(file);
      }}
    >
      <Toolbar
        filename={filepath}
        hasImage={!!image}
        mode={mode}
        onModeChange={setMode}
        onOpen={openImage}
        onSave={saveImage}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <CanvasView
          imageMeta={imageMeta}
          getImage={getImage}
          onPick={mode === 'remove' ? handlePick : undefined}
          onHover={handleHover}
          pickEnabled={mode === 'remove'}
          onViewportChange={handleViewportChange}
        >
          {sliceOverlay}
          {selectOverlay}
        </CanvasView>
        {mode === 'remove' ? (
          <Sidebar
            tolerance={tolerance}
            onToleranceChange={setTolerance}
            mode={distanceMode}
            onModeChange={setDistanceMode}
            floodFill={floodFill}
            onFloodFillChange={setFloodFill}
            pickedColor={pickedColor}
            hoverColor={hoverColor}
            hoverPos={hoverPos}
            onPickedColorChange={setPickedColor}
            onRemoveGlobal={handleRemoveGlobal}
            onAutoDetect={handleAutoDetect}
            onUndo={handleUndo}
            canUndo={historyLen > 0}
            hasImage={!!image}
          />
        ) : mode === 'slice' ? (
          <SliceSidebar
            config={slice}
            onConfigChange={setSlice}
            imageWidth={image?.width ?? 0}
            imageHeight={image?.height ?? 0}
            cellCount={cells.length}
            previewFrames={processedCells}
            selectedCellIndex={selectedCellIndex}
            onSelectedCellIndexChange={setSelectedCellIndex}
            onExportCells={exportCells}
            onExportAtlas={exportAtlas}
            onAutoDetectBlobs={autoDetectBlobs}
            onAutoRepack={autoRepack}
            canExport={!!image && cells.length > 0}
            presets={presets}
            onSavePreset={handleSavePreset}
            onLoadPreset={handleLoadPreset}
            onDeletePreset={handleDeletePreset}
          />
        ) : (
          <SelectSidebar
            hasImage={!!image}
            hasSelection={!!selectionRect}
            hasFloater={!!floater}
            selectionConfirmed={selectionConfirmed}
            onConfirm={confirmSelection}
            onCommit={commitFloater}
            onCancel={cancelSelection}
            onUndo={handleUndo}
            canUndo={historyLen > 0}
          />
        )}
      </div>
    </div>
  );
}

function SelectSidebar({
  hasImage,
  hasSelection,
  hasFloater,
  selectionConfirmed,
  onConfirm,
  onCommit,
  onCancel,
  onUndo,
  canUndo,
}: {
  hasImage: boolean;
  hasSelection: boolean;
  hasFloater: boolean;
  selectionConfirmed: boolean;
  onConfirm: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const canConfirm = hasSelection && !selectionConfirmed && !hasFloater;
  return (
    <aside
      style={{
        width: 280,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <section>
        <label>Select + Move</label>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Use this to re-space overlapping sprites before slicing.
          <br />• Drag on the image to draw a selection rectangle (yellow).
          <br />• Click Confirm (or press Enter) to lock it in (red).
          <br />• Drag inside the confirmed box to lift and move the pixels (green).
          <br />• Alt + drag (or alt + arrow) makes a copy instead.
          <br />• Arrows nudge by 1px, shift+arrows by 10px.
          <br />• Enter commits · Escape reverts.
          <br />• Delete erases the lifted area.
        </div>
      </section>
      <section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className={canConfirm ? 'primary' : undefined}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            Confirm selection
          </button>
          <button
            className={hasFloater ? 'primary' : undefined}
            onClick={onCommit}
            disabled={!hasFloater}
          >
            Commit move
          </button>
          <button onClick={onCancel} disabled={!hasSelection && !hasFloater}>
            Cancel / clear
          </button>
          <button onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
        </div>
      </section>
      {!hasImage && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Open an image first.</div>
      )}
    </aside>
  );
}
