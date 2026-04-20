import { useCallback, useEffect, useMemo, useState } from 'react';
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

const MAX_UNDO = 20;

export function App() {
  const [image, setImage] = useState<ImageData | null>(null);
  const [filepath, setFilepath] = useState<string | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);

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
  const [floater, setFloater] = useState<ImageData | null>(null);
  const [liftSnapshot, setLiftSnapshot] = useState<ImageData | null>(null);

  useEffect(() => setPresets(loadPresets()), []);

  const pushHistory = useCallback((prev: ImageData) => {
    setHistory((h) => {
      const next = [...h, prev];
      if (next.length > MAX_UNDO) next.shift();
      return next;
    });
  }, []);

  const openImage = useCallback(async () => {
    const results = await window.api.openImages();
    if (results.length === 0) return;
    const first = results[0];
    const ext = first.path.split('.').pop()?.toLowerCase();
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
    const data = await loadImageFromBytes(first.data, mime);
    setImage(data);
    setFilepath(first.path);
    setHistory([]);
    setPickedColor(null);
    setSelectedCellIndex(null);
    setSelectionRect(null);
    setSelectionOffset(null);
    setFloater(null);
    setLiftSnapshot(null);
  }, []);

  const saveImage = useCallback(async () => {
    if (!image) return;
    const base = filepath
      ? filepath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      : 'output';
    const bytes = await imageDataToPngBytes(image);
    await window.api.saveImage(`${base}_transparent.png`, bytes);
  }, [image, filepath]);

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
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setImage(prev);
    // Any in-flight selection is invalidated by undo.
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
  }, [history]);

  // ---- Slice / export ----
  const cells = useMemo(
    () => (image ? computeCells(slice, image.width, image.height) : []),
    [slice, image],
  );

  const processedCells = useMemo(() => {
    if (!image) return [] as ImageData[];
    return cells.map((r, i) =>
      extractAndNormalizeCell(image, r, slice.overrides[i], slice.normalize),
    );
  }, [image, cells, slice.overrides, slice.normalize]);

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
      return;
    }
    // The snapshot was pushed to history at lift-time; now composite the floater.
    const next = compositeOnto(image, floater, selectionOffset.x, selectionOffset.y);
    setImage(next);
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
  }, [image, floater, selectionOffset]);

  const cancelSelection = useCallback(() => {
    if (liftSnapshot) {
      setImage(liftSnapshot);
      setHistory((h) => h.slice(0, -1));
    }
    setFloater(null);
    setLiftSnapshot(null);
    setSelectionRect(null);
    setSelectionOffset(null);
  }, [liftSnapshot]);

  const defineSelection = useCallback(
    (rect: Rect) => {
      if (floater) return;
      setSelectionRect(rect);
      setSelectionOffset({ x: rect.x, y: rect.y });
    },
    [floater],
  );

  const moveSelection = useCallback(
    (next: { x: number; y: number }, ensureLifted: boolean, copy: boolean) => {
      if (!image || !selectionRect) return;
      if (ensureLifted) {
        // First move triggers the lift: snapshot, clear source (unless copy), extract floater.
        pushHistory(cloneImageData(image));
        setLiftSnapshot(cloneImageData(image));
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
      floater={floater}
      onDefine={defineSelection}
      onMove={moveSelection}
      onCommit={commitFloater}
      onCancel={cancelSelection}
      onEraseFloater={eraseFloater}
    />
  ) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
          image={image}
          onPick={mode === 'remove' ? handlePick : undefined}
          onHover={(x, y, c) => {
            setHoverPos(x < 0 ? null : { x, y });
            setHoverColor(c);
          }}
          pickEnabled={mode === 'remove'}
          onViewportChange={(z) => setViewZoom(z)}
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
            canUndo={history.length > 0}
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
            onCommit={commitFloater}
            onCancel={cancelSelection}
            onUndo={handleUndo}
            canUndo={history.length > 0}
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
  onCommit,
  onCancel,
  onUndo,
  canUndo,
}: {
  hasImage: boolean;
  hasSelection: boolean;
  hasFloater: boolean;
  onCommit: () => void;
  onCancel: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
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
          <br />• Drag on the image to draw a selection rectangle.
          <br />• Drag inside the selection to lift and move the pixels.
          <br />• Alt + drag (or alt + arrow) makes a copy instead.
          <br />• Arrows nudge by 1px, shift+arrows by 10px.
          <br />• Enter commits · Escape reverts.
          <br />• Delete erases the lifted area.
        </div>
      </section>
      <section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className="primary"
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
