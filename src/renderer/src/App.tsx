import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar, type ViewMode } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { SliceSidebar } from './components/SliceSidebar';
import { CanvasView } from './components/CanvasView';
import { GridOverlay } from './components/slice/GridOverlay';
import { GuidesOverlay } from './components/slice/GuidesOverlay';
import { BoxesOverlay, type BoxesTool } from './components/slice/BoxesOverlay';
import { SelectOverlay, type SelectTool } from './components/SelectOverlay';
import { SourcesSidebar } from './components/SourcesSidebar';
import { BuilderView, type SelectedCell } from './components/BuilderView';
import { BuilderSidebar } from './components/BuilderSidebar';
import {
  computeAnchorPos,
  contentBoundsInRect,
  DEFAULT_BUILDER,
  getActiveAnimation,
  newAnimation,
  slotScale,
  updateActiveAnimation,
  type BuilderState,
} from './lib/builder';
import {
  addRecentFolder,
  listRecentFolders,
  loadProjectFolder,
  removeRecentFolder,
  saveProjectFolder,
} from './lib/projectFolder';
import { useSources } from './hooks/useSources';
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
  eraseCircle,
  eraseStroke,
  expandCanvas,
  extractRect,
  imageDataToPngBytes,
  loadImageFromBytes,
} from './lib/image-utils';
import type { RGB } from './lib/color';
import {
  computeCells,
  DEFAULT_SLICE,
  detectBlobs,
  extractAllCells,
  packCells,
  type Rect,
  type SliceConfig,
} from './lib/slicing';
import { applyPolygonMask, type Point } from './lib/lasso';
import { loadPresets, savePresets, type SavedPreset } from './lib/presets';

export function App() {
  // Destructure the stable callbacks/ref-readers from useSources so downstream
  // useCallback/useEffect deps don't churn on the fresh wrapper object.
  const {
    sources: sourcesList,
    activeId,
    active,
    addSource,
    removeSource,
    setActive,
    setImage: setSourceImage,
    updateMeta,
    pushHistory,
    popHistory,
    dropLastHistory,
    getImage: getSourceImage,
    getRuntime,
    setLiftSnapshot,
    setFloater: setSourceFloater,
    setLifting,
    isLifting,
    clearAll,
  } = useSources();

  const [mode, setMode] = useState<ViewMode>('remove');

  // Remove-BG tuning — app-global so it carries across source switches.
  const [pickedColor, setPickedColor] = useState<RGB | null>(null);
  // Hover state is only *displayed* in the Remove BG sidebar; tracking it in
  // a ref + flushing to React state only when the Remove sidebar needs it
  // avoids 60-Hz App re-renders on every mousemove.
  const [hover, _setHoverRaw] = useState<{ pos: { x: number; y: number } | null; color: RGB | null }>(
    { pos: null, color: null },
  );
  const [tolerance, setTolerance] = useState(20);
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('lab');
  const [floodFill, setFloodFill] = useState(false);
  // Remove-BG tool: 'pick' picks + removes colors, 'erase' paints transparency
  // with a circular brush.
  const [removeBgTool, setRemoveBgTool] = useState<'pick' | 'erase'>('pick');
  const [eraseBrushSize, setEraseBrushSize] = useState(20);
  // Ref for the last mouse position during an erase stroke, so fast drags
  // get interpolated instead of leaving gaps.
  const lastErasePosRef = useRef<{ x: number; y: number } | null>(null);

  // Slice tooling (per-mode UI choices, not per-source).
  const [viewZoom, setViewZoom] = useState(1);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [boxesTool, setBoxesTool] = useState<BoxesTool>('rect');
  const [selectTool, setSelectTool] = useState<SelectTool>('rect');

  // Builder — one scratch project at a time, optionally persisted via
  // projects API (localStorage). `projectName` is the current project's
  // name — empty until first save.
  const [builder, setBuilder] = useState<BuilderState>(DEFAULT_BUILDER);
  const [builderSelectedCell, setBuilderSelectedCell] = useState<SelectedCell | null>(null);
  const [builderSelectedSlot, setBuilderSelectedSlot] = useState<number | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFoldersState] = useState<
    Array<{ path: string; name: string; at: string }>
  >(() => listRecentFolders());
  const refreshRecent = useCallback(() => setRecentFoldersState(listRecentFolders()), []);

  // Remove-BG color swatches — persisted in localStorage so they survive
  // restarts. 12 slots seems like a nice middle ground.
  const [bgSwatches, setBgSwatchesState] = useState<(RGB | null)[]>(() => {
    try {
      const raw = localStorage.getItem('bg-swatches');
      if (!raw) return Array(12).fill(null);
      const parsed = JSON.parse(raw) as (RGB | null)[];
      if (!Array.isArray(parsed)) return Array(12).fill(null);
      const out = Array(12).fill(null) as (RGB | null)[];
      for (let i = 0; i < Math.min(12, parsed.length); i++) out[i] = parsed[i] ?? null;
      return out;
    } catch {
      return Array(12).fill(null);
    }
  });
  const setBgSwatches = useCallback((s: (RGB | null)[]) => {
    setBgSwatchesState(s);
    try {
      localStorage.setItem('bg-swatches', JSON.stringify(s));
    } catch {
      // ignored
    }
  }, []);

  useEffect(() => setPresets(loadPresets()), []);

  // ---------- Ingestion ----------

  const ingestImage = useCallback(
    async (path: string, bytes: Uint8Array) => {
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
      await new Promise<void>((r) => setTimeout(r, 0));
      const data = await loadImageFromBytes(bytes, mime);
      addSource(path, data);
    },
    [addSource],
  );

  const openImage = useCallback(async () => {
    const paths = await window.api.openImagePaths();
    if (paths.length === 0) return;
    for (const p of paths) {
      const bytes = await window.api.readFile(p);
      await ingestImage(p, bytes);
    }
  }, [ingestImage]);

  const handleFileDrop = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) continue;
        const buf = new Uint8Array(await file.arrayBuffer());
        await ingestImage(file.name, buf);
      }
    },
    [ingestImage],
  );

  const saveImage = useCallback(async () => {
    if (!active) return;
    const img = getSourceImage(active.id);
    if (!img) return;
    const base = active.filename.replace(/\.[^.]+$/, '');
    const bytes = await imageDataToPngBytes(img);
    await window.api.saveImage(`${base}_transparent.png`, bytes);
  }, [active, getSourceImage]);

  // ---------- Canvas plumbing ----------

  // Stabilize imageMeta identity — a fresh object literal every render would
  // retrigger CanvasView's createImageBitmap effect on every App update.
  const imageMeta = useMemo(
    () =>
      active ? { width: active.width, height: active.height, version: active.version } : null,
    [active?.width, active?.height, active?.version],
  );
  const getImage = useCallback(() => getSourceImage(activeId), [getSourceImage, activeId]);

  // Keep a ref of the latest hover so we can read it from event handlers
  // without having to store it in React state on every mousemove.
  const hoverRef = useRef<{ pos: { x: number; y: number } | null; color: RGB | null }>({
    pos: null,
    color: null,
  });
  const hoverRafRef = useRef<number | null>(null);
  const modeRef = useRef<ViewMode>(mode);
  modeRef.current = mode;
  const handleHover = useCallback((x: number, y: number, c: RGB | null) => {
    const pos = x < 0 ? null : { x, y };
    hoverRef.current = { pos, color: c };
    // Only surface hover into React state in Remove mode (where the sidebar
    // displays it), and throttle to one flush per animation frame so 60-Hz
    // mousemoves don't cause 60-Hz App re-renders.
    if (modeRef.current !== 'remove') return;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const { pos: p, color: col } = hoverRef.current;
      _setHoverRaw((prev) => {
        if (prev.pos?.x === p?.x && prev.pos?.y === p?.y && prev.color === col) return prev;
        return { pos: p, color: col };
      });
    });
  }, []);

  const handleViewportChange = useCallback((z: number) => {
    setViewZoom(z);
  }, []);

  // ---------- Remove BG ----------

  const handlePick = useCallback(
    (x: number, y: number, color: RGB) => {
      if (!activeId) return;
      const img = getSourceImage(activeId);
      if (!img) return;
      setPickedColor(color);
      if (floodFill) {
        const next = cloneImageData(img);
        removeColorFlood(next.data, next.width, next.height, x, y, {
          tolerance,
          mode: distanceMode,
        });
        pushHistory(activeId, img);
        setSourceImage(activeId, next);
      }
    },
    [activeId, floodFill, tolerance, distanceMode, getSourceImage, pushHistory, setSourceImage],
  );

  const handleRemoveGlobal = useCallback(() => {
    if (!activeId || !pickedColor) return;
    const img = getSourceImage(activeId);
    if (!img) return;
    const next = cloneImageData(img);
    removeColorGlobal(next.data, pickedColor, { tolerance, mode: distanceMode });
    pushHistory(activeId, img);
    setSourceImage(activeId, next);
  }, [activeId, pickedColor, tolerance, distanceMode, getSourceImage, pushHistory, setSourceImage]);

  // ---------- Projects ----------

  const handleProjectNew = useCallback(() => {
    clearAll();
    setBuilder(DEFAULT_BUILDER);
    setBuilderSelectedCell(null);
    setBuilderSelectedSlot(null);
    setProjectName('');
    setProjectFolder(null);
    setPickedColor(null);
    setTolerance(20);
    setDistanceMode('lab');
    setFloodFill(false);
  }, [clearAll]);

  /**
   * Save the current state. Two modes:
   *  - **Overwrite**: when we already know the project's own folder (from a
   *    previous save or load), write straight into it. No dialog, no nesting.
   *  - **Fresh save** (`mode: 'new'`): prompt the user for a *parent* folder,
   *    create a `<project-name>/` subfolder inside, and write everything
   *    there. The project is always its own self-contained folder.
   */
  const handleProjectSave = useCallback(
    async (name: string, mode: 'overwrite' | 'new' = 'overwrite') => {
      const trimmed = name.trim();
      if (!trimmed) return;

      let targetFolder: string;
      let nest: boolean;
      if (mode === 'overwrite' && projectFolder) {
        targetFolder = projectFolder;
        nest = false;
      } else {
        const picked = await window.api.openFolder();
        if (!picked) return;
        targetFolder = picked;
        nest = true;
      }

      const payloadSources: Array<{
        id: string;
        filename: string;
        image: ImageData;
        slice: import('./lib/slicing').SliceConfig;
      }> = [];
      for (const s of sourcesList) {
        const img = getSourceImage(s.id);
        if (!img) continue;
        payloadSources.push({ id: s.id, filename: s.filename, image: img, slice: s.slice });
      }

      const { projectFolder: actualFolder } = await saveProjectFolder(
        {
          name: trimmed,
          folderPath: targetFolder,
          sources: payloadSources,
          builder,
          pickedColor,
          tolerance,
          distanceMode,
          floodFill,
        },
        { nestInSubfolder: nest },
      );
      setProjectName(trimmed);
      setProjectFolder(actualFolder);
      addRecentFolder(actualFolder, trimmed);
      refreshRecent();
    },
    [
      projectFolder,
      sourcesList,
      getSourceImage,
      builder,
      pickedColor,
      tolerance,
      distanceMode,
      floodFill,
      refreshRecent,
    ],
  );

  const handleProjectLoad = useCallback(
    async (folderPath?: string) => {
      let folder = folderPath;
      if (!folder) {
        folder = (await window.api.openFolder()) ?? undefined;
        if (!folder) return;
      }
      const result = await loadProjectFolder(folder);
      if (!result) {
        alert(`No project.spriteproj.json found in:\n${folder}`);
        removeRecentFolder(folder);
        refreshRecent();
        return;
      }
      clearAll();
      setBuilder(DEFAULT_BUILDER);
      setBuilderSelectedCell(null);
      setBuilderSelectedSlot(null);
      setProjectName(result.project.name);
      setProjectFolder(folder);
      setPickedColor(result.project.pickedColor);
      setTolerance(result.project.tolerance);
      setDistanceMode(result.project.distanceMode);
      setFloodFill(result.project.floodFill);
      for (const src of result.sources) {
        // Preserve the saved source id so animation-slot refs still resolve.
        const id = addSource(src.filepath, src.image, src.id);
        updateMeta(id, { slice: src.slice });
      }
      setBuilder(result.project.builder);
      addRecentFolder(folder, result.project.name);
      refreshRecent();
      if (result.missing.length > 0) {
        console.warn('[project] missing source files:', result.missing);
      }
    },
    [clearAll, addSource, updateMeta, refreshRecent],
  );

  const handleRecentRemove = useCallback(
    (folder: string) => {
      removeRecentFolder(folder);
      refreshRecent();
    },
    [refreshRecent],
  );

  const handleExpandCanvas = useCallback(
    (target: number) => {
      if (!activeId) return;
      const img = getSourceImage(activeId);
      if (!img) return;
      if (img.width >= target && img.height >= target) return;
      const next = expandCanvas(img, target, target);
      pushHistory(activeId, img);
      setSourceImage(activeId, next);
    },
    [activeId, getSourceImage, pushHistory, setSourceImage],
  );

  const handleRemoveGlobalAllSources = useCallback(() => {
    if (!pickedColor) return;
    for (const s of sourcesList) {
      const img = getSourceImage(s.id);
      if (!img) continue;
      const next = cloneImageData(img);
      removeColorGlobal(next.data, pickedColor, { tolerance, mode: distanceMode });
      pushHistory(s.id, img);
      setSourceImage(s.id, next);
    }
  }, [pickedColor, tolerance, distanceMode, sourcesList, getSourceImage, pushHistory, setSourceImage]);

  /**
   * Eraser — mutates the active source's ImageData in place for speed (a
   * fresh clone per mouse-move would allocate 17MB/frame). We clone ONCE at
   * stroke start to seed the history entry, then mutate + bump version on
   * every subsequent sample.
   */
  const handleErase = useCallback(
    (x: number, y: number, isStart: boolean) => {
      if (!activeId) return;
      const img = getSourceImage(activeId);
      if (!img) return;
      if (isStart) {
        // Snapshot for undo, then allow in-place mutation of the live image.
        pushHistory(activeId, cloneImageData(img));
        lastErasePosRef.current = null;
      }
      const last = lastErasePosRef.current;
      if (last) {
        eraseStroke(img.data, img.width, img.height, last.x, last.y, x, y, eraseBrushSize);
      } else {
        eraseCircle(img.data, img.width, img.height, x, y, eraseBrushSize);
      }
      lastErasePosRef.current = { x, y };
      // Re-assigning the same ref bumps the version → CanvasView re-decodes
      // a fresh ImageBitmap from the mutated buffer.
      setSourceImage(activeId, img);
    },
    [activeId, eraseBrushSize, getSourceImage, pushHistory, setSourceImage],
  );

  const handleEraseEnd = useCallback(() => {
    lastErasePosRef.current = null;
  }, []);

  const handleAutoDetect = useCallback(() => {
    if (!activeId) return;
    const img = getSourceImage(activeId);
    if (!img) return;
    setPickedColor(detectBackgroundColor(img.data, img.width, img.height));
  }, [activeId, getSourceImage]);

  const handleUndo = useCallback(() => {
    if (!activeId) return;
    const prev = popHistory(activeId);
    if (!prev) return;
    setSourceImage(activeId, prev);
    // Any in-flight selection on this source is invalidated by undo.
    setSourceFloater(activeId, null);
    setLiftSnapshot(activeId, null);
    setLifting(activeId, false);
    updateMeta(activeId, {
      selectionRect: null,
      lassoPolygon: null,
      selectionOffset: null,
      selectionConfirmed: false,
    });
  }, [activeId, popHistory, setSourceImage, setSourceFloater, setLiftSnapshot, setLifting, updateMeta]);

  // ---------- Slice / export ----------

  const activeImage = active ? getSourceImage(active.id) : null;
  // Pull narrow slice fields out so downstream memos can depend on reference
  // identity of just the fields that actually invalidate their work, not the
  // whole `active` meta (which changes on every selection/history tweak).
  const activeSlice = active?.slice;

  const cells = useMemo(
    () => (activeImage && activeSlice ? computeCells(activeSlice, activeImage.width, activeImage.height) : []),
    [activeImage, activeSlice],
  );

  // Preview/export work is now done on-demand: AnimationPreview lazy-extracts
  // the current frame, and export handlers batch-extract inside a button click.
  // Holding all extracted cells in state caused multi-GB memory pressure during
  // rapid source switches (each switch retained ~16MB of new ImageData).

  const setSlice = useCallback(
    (nextOrUpdater: SliceConfig | ((s: SliceConfig) => SliceConfig)) => {
      if (!activeId || !active) return;
      const next =
        typeof nextOrUpdater === 'function'
          ? (nextOrUpdater as (s: SliceConfig) => SliceConfig)(active.slice)
          : nextOrUpdater;
      updateMeta(activeId, { slice: next });
    },
    [activeId, active, updateMeta],
  );

  const setSelectedCellIndex = useCallback(
    (i: number | null) => {
      if (!activeId) return;
      updateMeta(activeId, { selectedCellIndex: i });
    },
    [activeId, updateMeta],
  );

  const joinPath = (folder: string, filename: string) => {
    const sep = folder.includes('\\') ? '\\' : '/';
    return folder.endsWith(sep) ? folder + filename : `${folder}${sep}${filename}`;
  };

  const exportCells = useCallback(async () => {
    if (!active || !activeImage || !activeSlice || cells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = active.filename.replace(/\.[^.]+$/, '');
    const extracted = extractAllCells(activeImage, cells, activeSlice.overrides, activeSlice.normalize);
    const pad = String(extracted.length - 1).length;
    for (let i = 0; i < extracted.length; i++) {
      const bytes = await imageDataToPngBytes(extracted[i]);
      await window.api.writeFile(
        joinPath(folder, `${base}_${String(i).padStart(pad, '0')}.png`),
        bytes,
      );
    }
  }, [active, activeImage, activeSlice, cells]);

  const exportAtlas = useCallback(async () => {
    if (!active || !activeImage || !activeSlice || cells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = active.filename.replace(/\.[^.]+$/, '');
    const extracted = extractAllCells(activeImage, cells, activeSlice.overrides, activeSlice.normalize);
    const cols = Math.max(1, Math.ceil(Math.sqrt(extracted.length)));
    const packed = packCells(extracted, {
      columns: cols,
      pngFilename: `${base}.png`,
      frameName: base,
      pivot: { x: 0.5, y: 1 },
    });
    const pngBytes = await imageDataToPngBytes(packed.png);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(packed.atlas, null, 2));
    await window.api.writeFile(joinPath(folder, `${base}.png`), pngBytes);
    await window.api.writeFile(
      joinPath(folder, `${base}.json`),
      jsonBytes.buffer.slice(
        jsonBytes.byteOffset,
        jsonBytes.byteOffset + jsonBytes.byteLength,
      ) as ArrayBuffer,
    );
  }, [active, activeImage, activeSlice, cells]);

  const autoRepack = useCallback(async () => {
    if (!active || !activeImage || !activeSlice || cells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = active.filename.replace(/\.[^.]+$/, '');
    const extracted = extractAllCells(activeImage, cells, activeSlice.overrides, activeSlice.normalize);
    const cols = Math.max(1, Math.ceil(Math.sqrt(extracted.length)));
    const packed = packCells(extracted, {
      columns: cols,
      pngFilename: `${base}_repacked.png`,
      frameName: base,
    });
    const pngBytes = await imageDataToPngBytes(packed.png);
    await window.api.writeFile(joinPath(folder, `${base}_repacked.png`), pngBytes);
  }, [active, activeImage, activeSlice, cells]);

  const autoDetectBlobs = useCallback(
    (mergeGap: number) => {
      if (!activeId || !active) return;
      const img = getSourceImage(activeId);
      if (!img) return;
      // Yield to the browser so the button's active state can paint before the
      // sync flood-fill + merge scan blocks the main thread.
      requestAnimationFrame(() => {
        const rects = detectBlobs(img, 16, 1, 0, mergeGap);
        updateMeta(activeId, {
          slice: { ...active.slice, mode: 'boxes', boxes: { rects } },
          selectedCellIndex: null,
        });
      });
    },
    [activeId, active, getSourceImage, updateMeta],
  );

  const handleSavePreset = useCallback(
    (name: string) => {
      if (!active) return;
      const next: SavedPreset[] = [
        ...presets.filter((p) => p.name !== name),
        { name, config: JSON.parse(JSON.stringify(active.slice)) },
      ];
      setPresets(next);
      savePresets(next);
    },
    [presets, active],
  );

  const handleLoadPreset = useCallback(
    (p: SavedPreset) => {
      if (!activeId) return;
      updateMeta(activeId, { slice: p.config, selectedCellIndex: null });
    },
    [activeId, updateMeta],
  );

  const handleDeletePreset = useCallback(
    (name: string) => {
      const next = presets.filter((p) => p.name !== name);
      setPresets(next);
      savePresets(next);
    },
    [presets],
  );

  // ---------- Select + Move ----------

  const commitFloater = useCallback(
    (id: string | null = activeId) => {
      if (!id) return;
      const rt = getRuntime(id);
      const meta = sourcesList.find((s) => s.id === id);
      const img = getSourceImage(id);
      if (!rt || !meta) return;
      if (!img || !rt.floater || !meta.selectionOffset) {
        setSourceFloater(id, null);
        setLiftSnapshot(id, null);
        setLifting(id, false);
        updateMeta(id, {
          selectionRect: null,
          lassoPolygon: null,
          selectionOffset: null,
          selectionConfirmed: false,
        });
        return;
      }
      const next = compositeOnto(img, rt.floater, meta.selectionOffset.x, meta.selectionOffset.y);
      setSourceImage(id, next);
      setSourceFloater(id, null);
      setLiftSnapshot(id, null);
      setLifting(id, false);
      updateMeta(id, {
        selectionRect: null,
        lassoPolygon: null,
        selectionOffset: null,
        selectionConfirmed: false,
      });
    },
    [activeId, sourcesList, getRuntime, getSourceImage, setSourceImage, setSourceFloater, setLiftSnapshot, setLifting, updateMeta],
  );

  const cancelSelection = useCallback(() => {
    if (!activeId) return;
    const rt = getRuntime(activeId);
    if (rt?.liftSnapshot) {
      setSourceImage(activeId, rt.liftSnapshot);
      dropLastHistory(activeId);
    }
    setSourceFloater(activeId, null);
    setLiftSnapshot(activeId, null);
    setLifting(activeId, false);
    updateMeta(activeId, {
      selectionRect: null,
      lassoPolygon: null,
      selectionOffset: null,
      selectionConfirmed: false,
    });
  }, [activeId, getRuntime, setSourceImage, dropLastHistory, setSourceFloater, setLiftSnapshot, setLifting, updateMeta]);

  const defineSelection = useCallback(
    (rect: Rect, polygon: Point[] | null) => {
      if (!activeId || !active || active.hasFloater) return;
      updateMeta(activeId, {
        selectionRect: rect,
        lassoPolygon: polygon,
        selectionOffset: { x: rect.x, y: rect.y },
        selectionConfirmed: false,
      });
    },
    [activeId, active, updateMeta],
  );

  const confirmSelection = useCallback(() => {
    if (!activeId || !active?.selectionRect) return;
    if (active.selectionRect.width <= 0 || active.selectionRect.height <= 0) return;
    updateMeta(activeId, { selectionConfirmed: true });
  }, [activeId, active, updateMeta]);

  const moveSelection = useCallback(
    (next: { x: number; y: number }, ensureLifted: boolean, copy: boolean) => {
      if (!activeId || !active) return;
      const img = getSourceImage(activeId);
      const rect = active.selectionRect;
      if (!img || !rect) return;
      if (rect.width <= 0 || rect.height <= 0) return;
      if (ensureLifted && !isLifting(activeId)) {
        setLifting(activeId, true);
        pushHistory(activeId, img);
        setLiftSnapshot(activeId, img);
        const f = extractRect(img, rect.x, rect.y, rect.width, rect.height);
        if (active.lassoPolygon) {
          applyPolygonMask(f, active.lassoPolygon, rect.x, rect.y);
        }
        setSourceFloater(activeId, f);
        if (!copy) {
          const cleared = cloneImageData(img);
          if (active.lassoPolygon) {
            clearImageByFloater(cleared, f, rect.x, rect.y);
          } else {
            clearImageRect(cleared, rect.x, rect.y, rect.width, rect.height);
          }
          setSourceImage(activeId, cleared);
        }
      }
      updateMeta(activeId, { selectionOffset: next });
    },
    [activeId, active, getSourceImage, isLifting, setLifting, pushHistory, setLiftSnapshot, setSourceFloater, setSourceImage, updateMeta],
  );

  const eraseFloater = useCallback(() => {
    if (!activeId) return;
    setSourceFloater(activeId, null);
    setLifting(activeId, false);
    updateMeta(activeId, {
      selectionRect: null,
      lassoPolygon: null,
      selectionOffset: null,
      selectionConfirmed: false,
    });
  }, [activeId, setSourceFloater, setLifting, updateMeta]);

  // Auto-commit when leaving select mode OR switching away from a source with a floater.
  const prevModeActiveRef = useRef<{ mode: ViewMode; activeId: string | null }>({ mode, activeId });
  useEffect(() => {
    const prev = prevModeActiveRef.current;
    if (prev.mode === 'select' && mode !== 'select' && prev.activeId) {
      const rt = getRuntime(prev.activeId);
      if (rt?.floater) commitFloater(prev.activeId);
    }
    if (prev.activeId && prev.activeId !== activeId) {
      const rt = getRuntime(prev.activeId);
      if (rt?.floater) commitFloater(prev.activeId);
    }
    prevModeActiveRef.current = { mode, activeId };
  }, [mode, activeId, commitFloater, getRuntime]);

  // Keyboard: H / V flip for selected cell in slice mode.
  useEffect(() => {
    if (mode !== 'slice' || !activeId || !active) return;
    const handler = (e: KeyboardEvent) => {
      const idx = active.selectedCellIndex;
      if (idx === null) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key !== 'h' && key !== 'v') return;
      e.preventDefault();
      const current = active.slice.overrides[idx] ?? {};
      const axis = key === 'h' ? 'flipH' : 'flipV';
      updateMeta(activeId, {
        slice: {
          ...active.slice,
          overrides: {
            ...active.slice.overrides,
            [idx]: { ...current, [axis]: !current[axis] },
          },
        },
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, activeId, active, updateMeta]);

  // When entering Builder mode with no animations, auto-create a default one
  // so slot controls, frame box, etc. are immediately usable. New users
  // wouldn't realize the slot controls are gated on the Animations section.
  useEffect(() => {
    if (mode !== 'builder') return;
    if (builder.animations.length > 0) return;
    const a = newAnimation('animation', 0);
    setBuilder((b) => {
      if (b.animations.length > 0) return b;
      return { ...b, animations: [a], activeAnimationId: a.id };
    });
  }, [mode, builder.animations.length]);

  // Keyboard: Arrow up/down nudges the focused builder slot's Y-offset on the
  // active animation.
  useEffect(() => {
    if (mode !== 'builder' || builderSelectedSlot === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const delta = e.key === 'ArrowUp' ? step : -step;
      setBuilder((b) => {
        const active = getActiveAnimation(b);
        if (!active) return b;
        const next = active.slots.map((s, i) =>
          i === builderSelectedSlot ? { ...s, yOffset: s.yOffset + delta } : s,
        );
        return updateActiveAnimation(b, { slots: next });
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, builderSelectedSlot]);

  // Export the current builder strip — compose each slot's sprite at its
  // scale/anchor/offset into a single PNG sized (boxW × slotCount) × boxH.
  const exportBuilderStrip = useCallback(async () => {
    const { boxSize, anchor, scaleRef } = builder;
    const active = getActiveAnimation(builder);
    if (!active) return;
    const slots = active.slots;
    const animationName = active.name;
    if (!scaleRef || slots.length === 0 || !slots.every((s) => s.cell)) return;
    const width = boxSize.w * slots.length;
    const height = boxSize.h;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.cell) continue;
      const source = sourcesList.find((s) => s.id === slot.cell!.sourceId);
      if (!source) continue;
      const img = getSourceImage(source.id);
      if (!img) continue;
      const srcCells = computeCells(source.slice, source.width, source.height);
      const rect = srcCells[slot.cell.cellIndex];
      if (!rect) continue;
      const bounds = contentBoundsInRect(img, rect);
      if (!bounds) continue;
      const ratio = slotScale(scaleRef, slot);
      const drawW = Math.max(1, Math.round(bounds.width * ratio));
      const drawH = Math.max(1, Math.round(bounds.height * ratio));
      const { dx, dy } = computeAnchorPos(anchor, boxSize, drawW, drawH, slot.yOffset);
      const bitmap = await createImageBitmap(
        img,
        rect.x + bounds.x,
        rect.y + bounds.y,
        bounds.width,
        bounds.height,
        { resizeWidth: drawW, resizeHeight: drawH, resizeQuality: 'low' },
      );
      const override = source.slice.overrides[slot.cell.cellIndex] ?? {};
      const flipH = !!override.flipH;
      const flipV = !!override.flipV;
      const slotX = i * boxSize.w + dx;
      if (flipH || flipV) {
        ctx.save();
        ctx.translate(slotX + drawW / 2, dy + drawH / 2);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(bitmap, -drawW / 2, -drawH / 2);
        ctx.restore();
      } else {
        ctx.drawImage(bitmap, slotX, dy);
      }
      bitmap.close();
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) return;
    const bytes = await blob.arrayBuffer();
    const safeName = (animationName || 'animation').replace(/[^\w\-]+/g, '_');
    await window.api.saveImage(`${safeName}.png`, bytes);
  }, [builder, sourcesList, getSourceImage]);

  const runtime = activeId ? getRuntime(activeId) : null;
  const floater = runtime?.floater ?? null;

  const sliceOverlay =
    activeImage && active && mode === 'slice' ? (
      <>
        {active.slice.mode === 'grid' && (
          <GridOverlay
            cells={cells}
            overrides={active.slice.overrides}
            zoom={viewZoom}
            imageWidth={activeImage.width}
            imageHeight={activeImage.height}
            selectedIndex={active.selectedCellIndex}
            onSelect={setSelectedCellIndex}
          />
        )}
        {active.slice.mode === 'guides' && (
          <GuidesOverlay
            config={active.slice.guides}
            onChange={(g) => setSlice({ ...active.slice, guides: g })}
            zoom={viewZoom}
            imageWidth={activeImage.width}
            imageHeight={activeImage.height}
          />
        )}
        {active.slice.mode === 'boxes' && (
          <BoxesOverlay
            config={active.slice.boxes}
            overrides={active.slice.overrides}
            onChange={(b) => setSlice({ ...active.slice, boxes: b })}
            zoom={viewZoom}
            imageWidth={activeImage.width}
            imageHeight={activeImage.height}
            selectedIndex={active.selectedCellIndex}
            onSelectedIndexChange={setSelectedCellIndex}
            tool={boxesTool}
          />
        )}
      </>
    ) : null;

  const selectOverlay =
    activeImage && active && mode === 'select' ? (
      <SelectOverlay
        imageWidth={activeImage.width}
        imageHeight={activeImage.height}
        zoom={viewZoom}
        tool={selectTool}
        selectionRect={active.selectionRect}
        lassoPolygon={active.lassoPolygon}
        offset={active.selectionOffset}
        confirmed={active.selectionConfirmed}
        floater={floater}
        onDefine={defineSelection}
        onConfirm={confirmSelection}
        onMove={moveSelection}
        onCommit={() => commitFloater(activeId)}
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
        handleFileDrop(e.dataTransfer.files);
      }}
    >
      <Toolbar
        filename={active?.filename ?? null}
        hasImage={!!active}
        mode={mode}
        onModeChange={setMode}
        onOpen={openImage}
        onSave={saveImage}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <SourcesSidebar
          sources={sourcesList}
          activeId={activeId}
          onSelect={setActive}
          onRemove={removeSource}
          getImage={getSourceImage}
        />
        {mode === 'builder' ? (
          <>
            <BuilderView
              state={builder}
              onStateChange={setBuilder}
              sources={sourcesList}
              getSource={getSourceImage}
              selectedCell={builderSelectedCell}
              onSelectCell={setBuilderSelectedCell}
              selectedSlotIndex={builderSelectedSlot}
              onSelectSlot={setBuilderSelectedSlot}
            />
            <BuilderSidebar
              state={builder}
              onStateChange={setBuilder}
              sources={sourcesList}
              getSource={getSourceImage}
              selectedCell={builderSelectedCell}
              selectedSlotIndex={builderSelectedSlot}
              onDeselectSlot={() => setBuilderSelectedSlot(null)}
              onDeselectCell={() => setBuilderSelectedCell(null)}
              onExport={exportBuilderStrip}
              projectName={projectName}
              projectFolder={projectFolder}
              recentFolders={recentFolders}
              onProjectSave={(n) => handleProjectSave(n, 'overwrite')}
              onProjectSaveAs={(n) => handleProjectSave(n, 'new')}
              onProjectLoad={handleProjectLoad}
              onProjectLoadRecent={handleProjectLoad}
              onRecentRemove={handleRecentRemove}
              onProjectNew={handleProjectNew}
            />
          </>
        ) : (
          <>
            <CanvasView
              imageMeta={imageMeta}
              getImage={getImage}
              onPick={mode === 'remove' && removeBgTool === 'pick' ? handlePick : undefined}
              onHover={handleHover}
              pickEnabled={mode === 'remove' && removeBgTool === 'pick'}
              eraserEnabled={mode === 'remove' && removeBgTool === 'erase'}
              eraserBrushSize={eraseBrushSize}
              onErase={handleErase}
              onEraseEnd={handleEraseEnd}
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
            hoverColor={hover.color}
            hoverPos={hover.pos}
            onPickedColorChange={setPickedColor}
            onRemoveGlobal={handleRemoveGlobal}
            onRemoveGlobalAllSources={handleRemoveGlobalAllSources}
            onAutoDetect={handleAutoDetect}
            onUndo={handleUndo}
            canUndo={(active?.historyLen ?? 0) > 0}
            hasImage={!!active}
            sourceCount={sourcesList.length}
            swatches={bgSwatches}
            onSwatchesChange={setBgSwatches}
            tool={removeBgTool}
            onToolChange={setRemoveBgTool}
            eraseBrushSize={eraseBrushSize}
            onEraseBrushSizeChange={setEraseBrushSize}
          />
        ) : mode === 'slice' ? (
          <SliceSidebar
            config={active?.slice ?? DEFAULT_FALLBACK_SLICE}
            onConfigChange={setSlice}
            imageWidth={active?.width ?? 0}
            imageHeight={active?.height ?? 0}
            cellCount={cells.length}
            getPreviewSource={getSourceImage}
            previewSourceId={activeId}
            previewCells={cells}
            selectedCellIndex={active?.selectedCellIndex ?? null}
            onSelectedCellIndexChange={setSelectedCellIndex}
            onExportCells={exportCells}
            onExportAtlas={exportAtlas}
            onAutoDetectBlobs={autoDetectBlobs}
            onAutoRepack={autoRepack}
            boxesTool={boxesTool}
            onBoxesToolChange={setBoxesTool}
            canExport={!!active && cells.length > 0}
            presets={presets}
            onSavePreset={handleSavePreset}
            onLoadPreset={handleLoadPreset}
            onDeletePreset={handleDeletePreset}
          />
        ) : (
          <SelectSidebar
            hasImage={!!active}
            hasSelection={!!active?.selectionRect}
            hasFloater={!!floater}
            selectionConfirmed={active?.selectionConfirmed ?? false}
            tool={selectTool}
            onToolChange={setSelectTool}
            onConfirm={confirmSelection}
            onCommit={() => commitFloater(activeId)}
            onCancel={cancelSelection}
            onUndo={handleUndo}
            canUndo={(active?.historyLen ?? 0) > 0}
            imageWidth={active?.width ?? 0}
            imageHeight={active?.height ?? 0}
            onExpandCanvas={handleExpandCanvas}
          />
        )}
          </>
        )}
      </div>
    </div>
  );
}

// Used as a safe fallback when no source is active so SliceSidebar receives a
// stable shape. Never actually edited — callbacks noop when no active source.
const DEFAULT_FALLBACK_SLICE: SliceConfig = { ...DEFAULT_SLICE };

/**
 * Zero the alpha in `target` for every pixel where the masked `floater`
 * (already shaped by the lasso polygon) is opaque. Used to clear the source
 * when lifting a lasso selection.
 */
function clearImageByFloater(target: ImageData, floater: ImageData, fx: number, fy: number): void {
  const tw = target.width;
  const th = target.height;
  const fw = floater.width;
  const fh = floater.height;
  const tpx = target.data;
  const fpx = floater.data;
  const x0 = Math.max(0, fx);
  const y0 = Math.max(0, fy);
  const x1 = Math.min(tw, fx + fw);
  const y1 = Math.min(th, fy + fh);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const fi = ((y - fy) * fw + (x - fx)) * 4 + 3;
      if (fpx[fi] > 0) tpx[(y * tw + x) * 4 + 3] = 0;
    }
  }
}

function SelectSidebar({
  hasImage,
  hasSelection,
  hasFloater,
  selectionConfirmed,
  tool,
  onToolChange,
  onConfirm,
  onCommit,
  onCancel,
  onUndo,
  canUndo,
  imageWidth,
  imageHeight,
  onExpandCanvas,
}: {
  hasImage: boolean;
  hasSelection: boolean;
  hasFloater: boolean;
  selectionConfirmed: boolean;
  tool: SelectTool;
  onToolChange: (t: SelectTool) => void;
  onConfirm: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onUndo: () => void;
  canUndo: boolean;
  imageWidth: number;
  imageHeight: number;
  onExpandCanvas: (target: number) => void;
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
        <label>Tool</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(['rect', 'lasso'] as const).map((t) => (
            <button
              key={t}
              className={tool === t ? 'primary' : ''}
              onClick={() => onToolChange(t)}
              disabled={hasFloater}
              style={{ flex: 1, textTransform: 'capitalize' }}
              title={hasFloater ? 'Commit or cancel the current move first' : undefined}
            >
              {t === 'rect' ? 'Rectangle' : 'Lasso'}
            </button>
          ))}
        </div>
      </section>
      <section>
        <label>Select + Move</label>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Use this to re-space overlapping sprites before slicing.
          <br />• {tool === 'lasso' ? 'Drag to trace a free-form lasso' : 'Drag to draw a rectangle'} (yellow).
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
      <section>
        <label>Canvas</label>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          Current: {imageWidth}×{imageHeight}. Expand when you need more room to spread
          overlapping sprites apart. Original is centered; extra space is transparent.
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {[3000, 4000, 6000].map((n) => (
            <button
              key={n}
              onClick={() => onExpandCanvas(n)}
              disabled={!hasImage || hasFloater || (imageWidth >= n && imageHeight >= n)}
              style={{ flex: 1, fontSize: 11 }}
              title={
                hasFloater
                  ? 'Commit or cancel your move first'
                  : `Pad the active source's canvas to ${n}×${n}`
              }
            >
              {n}
            </button>
          ))}
        </div>
      </section>
      {!hasImage && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Open an image first.</div>
      )}
    </aside>
  );
}
