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
import type { SelectedCell } from './lib/builder';
import { BuilderLayout } from './components/builder/BuilderLayout';
import { GeneratePage } from './components/GeneratePage';
import { TestPage } from './components/TestPage';
import {
  DEFAULT_BUILDER,
  getActiveAnimation,
  newAnimation,
  updateActiveAnimation,
  type BuilderState,
  type Slot,
} from './lib/builder';
import { composeAnimationStrip, safeAnimationFilename } from './lib/builderExport';
import {
  buildAnimationParticleJson,
  buildProjectParticleJson,
  bundleBankTextures,
  dirname as particlesDirname,
  encodeJsonBytes as encodeParticlesJsonBytes,
  joinPath as particlesJoinPath,
  safeProjectFilename,
} from './lib/particlesExport';
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
import { replaceColorGlobal, replaceColorHueShift } from './lib/color-replace';
import type { ReplaceMode } from './components/Sidebar';
import {
  cloneImageData,
  clearRect as clearImageRect,
  compositeOnto,
  compositeRotated,
  eraseCircle,
  eraseStroke,
  expandCanvas,
  extractRect,
  flipImageDataHorizontal,
  flipImageDataVertical,
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
import { seedIfNeeded as seedParticleBuiltins } from './lib/particles/seedBuiltins';
import {
  DEFAULT_PLATFORM_PROJECT,
  defaultSliceBorders,
  derivePlatformFilename,
  newPlatformAssetId,
  type PlatformAsset,
  type PlatformProject,
} from './lib/platforms';
import {
  addRecentPlatformFolder,
  dirnameOf,
  findPlatformProjectFolder,
  joinPath as platformJoinPath,
  listRecentPlatformFolders,
  loadPlatformProject,
  removeRecentPlatformFolder,
  savePlatformProject,
  type SaveAssetInput as PlatformSaveAssetInput,
} from './lib/platformProject';
import { PlatformsView } from './components/platforms/PlatformsView';
import { DecorationsView } from './components/decorations/DecorationsView';
import {
  DEFAULT_DECORATION_PROJECT,
  type Decoration,
  type DecorationProject,
} from './lib/decorations';
import {
  disposeThumbnails,
  loadDecorationProject,
  saveDecorationProject,
} from './lib/decorationsProject';
import {
  syncDecorationsForFolder,
  bulkDetectBottomPadding,
  bulkDetectUnderside,
} from './lib/decorationsAutoDetect';
import { upscaleImageData } from './lib/upscale';

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
    pushFuture,
    popFuture,
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
  // Sources picked from the SourcesSidebar (in remove mode) for batch
  // remove/replace. Independent of `activeId` — a source can be active without
  // being in the selection, and vice versa.
  const [colorSelection, setColorSelection] = useState<Set<string>>(() => new Set());
  const toggleColorSelection = useCallback((id: string) => {
    setColorSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllColorSources = useCallback(() => {
    setColorSelection(new Set(sourcesList.map((s) => s.id)));
  }, [sourcesList]);
  const clearColorSelection = useCallback(() => {
    setColorSelection(new Set());
  }, []);
  // Color tab tool: 'pick' picks + removes colors, 'erase' paints transparency
  // with a circular brush, 'replace' swaps a source color (with tolerance) for
  // a fill color, scaling the per-pixel deviation so shading is preserved.
  const [removeBgTool, setRemoveBgTool] = useState<'pick' | 'erase' | 'replace'>('pick');
  const [eraseBrushSize, setEraseBrushSize] = useState(20);
  const [replaceFill, setReplaceFill] = useState<RGB | null>(null);
  const [replaceFillTolerance, setReplaceFillTolerance] = useState(20);
  const [replaceMode, setReplaceMode] = useState<ReplaceMode>('delta');
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
  // Per-animation placement history (past/future slot snapshots). Recorded
  // before any placement, clear, or slot-count change so the user can undo.
  const [placementHistory, setPlacementHistory] = useState<
    Record<string, { past: Slot[][]; future: Slot[][] }>
  >({});
  const recordPlacement = useCallback((animationId: string, prevSlots: Slot[]) => {
    setPlacementHistory((h) => {
      const cur = h[animationId] ?? { past: [], future: [] };
      return {
        ...h,
        [animationId]: {
          past: [...cur.past, prevSlots].slice(-50),
          future: [],
        },
      };
    });
  }, []);
  const undoPlacement = useCallback(() => {
    const aid = builder.activeAnimationId;
    if (!aid) return;
    const entry = placementHistory[aid];
    if (!entry || entry.past.length === 0) return;
    const last = entry.past[entry.past.length - 1];
    const currentSlots = getActiveAnimation(builder)?.slots ?? [];
    setPlacementHistory((h) => ({
      ...h,
      [aid]: {
        past: entry.past.slice(0, -1),
        future: [...entry.future, currentSlots].slice(-50),
      },
    }));
    setBuilder((b) => updateActiveAnimation(b, { slots: last }));
  }, [builder, placementHistory]);
  const redoPlacement = useCallback(() => {
    const aid = builder.activeAnimationId;
    if (!aid) return;
    const entry = placementHistory[aid];
    if (!entry || entry.future.length === 0) return;
    const next = entry.future[entry.future.length - 1];
    const currentSlots = getActiveAnimation(builder)?.slots ?? [];
    setPlacementHistory((h) => ({
      ...h,
      [aid]: {
        past: [...entry.past, currentSlots].slice(-50),
        future: entry.future.slice(0, -1),
      },
    }));
    setBuilder((b) => updateActiveAnimation(b, { slots: next }));
  }, [builder, placementHistory]);
  const canUndoPlacement =
    !!builder.activeAnimationId &&
    (placementHistory[builder.activeAnimationId]?.past.length ?? 0) > 0;
  const canRedoPlacement =
    !!builder.activeAnimationId &&
    (placementHistory[builder.activeAnimationId]?.future.length ?? 0) > 0;
  const [projectName, setProjectName] = useState<string>('');
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFoldersState] = useState<
    Array<{ path: string; name: string; at: string }>
  >(() => listRecentFolders());
  const refreshRecent = useCallback(() => setRecentFoldersState(listRecentFolders()), []);

  // Platforms mode state — independent project + asset library that survives
  // mode switches. assetImages is a separate Map<id, ImageData> rather than
  // embedded in the project so the manifest stays cleanly serializable.
  const [platformProject, setPlatformProject] = useState<PlatformProject>(
    DEFAULT_PLATFORM_PROJECT,
  );
  const [platformAssetImages, setPlatformAssetImages] = useState<Map<string, ImageData>>(
    new Map(),
  );
  const [platformProjectName, setPlatformProjectName] = useState<string>('');
  const [platformProjectFolder, setPlatformProjectFolder] = useState<string | null>(null);
  const [platformRecentFolders, setPlatformRecentFoldersState] = useState(() =>
    listRecentPlatformFolders(),
  );
  const refreshPlatformRecent = useCallback(
    () => setPlatformRecentFoldersState(listRecentPlatformFolders()),
    [],
  );

  // Decorations mode state — independent project folder. The sprites
  // can live anywhere (builder project, raw export folder, AscensionGame
  // assets folder), so Decorations mode tracks its own folder rather
  // than piggybacking on Platforms. Auto-loads from the Platforms
  // folder on open as a convenience when decorations.json sits there,
  // but can also be pointed at a separate folder via the "Open" buttons.
  const [decorationProject, setDecorationProject] = useState<DecorationProject | null>(null);
  const [decorationProjectFolder, setDecorationProjectFolder] = useState<string | null>(null);
  const [decorationThumbnails, setDecorationThumbnails] = useState<Map<string, string>>(
    new Map(),
  );
  const [decorationSaveStatus, setDecorationSaveStatus] =
    useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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

  // Fill-color swatches for the Replace tool — separate palette from source
  // swatches because users typically save bg colors in one and character/fill
  // tones in the other.
  const [fillSwatches, setFillSwatchesState] = useState<(RGB | null)[]>(() => {
    try {
      const raw = localStorage.getItem('replace-fill-swatches');
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
  const setFillSwatches = useCallback((s: (RGB | null)[]) => {
    setFillSwatchesState(s);
    try {
      localStorage.setItem('replace-fill-swatches', JSON.stringify(s));
    } catch {
      // ignored
    }
  }, []);

  useEffect(() => setPresets(loadPresets()), []);

  // Drop selection entries whose source has been removed (or after clearAll).
  useEffect(() => {
    setColorSelection((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(sourcesList.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sourcesList]);

  // First-run seeding for the cross-project particle library (textures + emitter
  // presets). Idempotent across runs via an internal localStorage flag.
  useEffect(() => {
    seedParticleBuiltins().catch((err) =>
      console.error('[particles] built-in seeding failed:', err),
    );
  }, []);

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
      // Flood-remove only applies in the Remove tool — Replace just sets the
      // source color and waits for the Apply button.
      if (removeBgTool !== 'pick') return;
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
    [activeId, removeBgTool, floodFill, tolerance, distanceMode, getSourceImage, pushHistory, setSourceImage],
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

  // ---------- Platforms project ----------

  const handlePlatformProjectNew = useCallback(() => {
    setPlatformProject(DEFAULT_PLATFORM_PROJECT);
    setPlatformAssetImages(new Map());
    setPlatformProjectName('');
    setPlatformProjectFolder(null);
  }, []);

  const handlePlatformProjectSave = useCallback(
    async (name: string, saveMode: 'overwrite' | 'new' = 'overwrite') => {
      const trimmed = name.trim();
      if (!trimmed) return;
      let targetFolder: string;
      let nest: boolean;
      if (saveMode === 'overwrite' && platformProjectFolder) {
        targetFolder = platformProjectFolder;
        nest = false;
      } else {
        const picked = await window.api.openFolder();
        if (!picked) return;
        targetFolder = picked;
        nest = true;
      }
      const saveAssets: PlatformSaveAssetInput[] = [];
      for (const a of platformProject.assets) {
        const img = platformAssetImages.get(a.id);
        if (!img) continue;
        saveAssets.push({ asset: a, image: img });
      }
      const { projectFolder: actualFolder } = await savePlatformProject(
        { name: trimmed, folderPath: targetFolder, assets: saveAssets },
        { nestInSubfolder: nest },
      );
      setPlatformProjectName(trimmed);
      setPlatformProjectFolder(actualFolder);
      addRecentPlatformFolder(actualFolder, trimmed);
      refreshPlatformRecent();
    },
    [platformProject, platformAssetImages, platformProjectFolder, refreshPlatformRecent],
  );

  const handlePlatformProjectLoad = useCallback(
    async (folderPath?: string) => {
      let pickedFolder = folderPath;
      if (!pickedFolder) {
        pickedFolder = (await window.api.openFolder()) ?? undefined;
        if (!pickedFolder) return;
      }
      // Locate the actual project folder. Picking the parent of a renamed
      // project still works as long as platforms.json sits one level deep.
      const folder = await findPlatformProjectFolder(pickedFolder);
      if (!folder) {
        alert(`No platforms.json found in:\n${pickedFolder}\nor any direct subfolder.`);
        removeRecentPlatformFolder(pickedFolder);
        refreshPlatformRecent();
        return;
      }
      const result = await loadPlatformProject(folder);
      if (!result) {
        alert(`No platforms.json found in:\n${folder}`);
        removeRecentPlatformFolder(folder);
        refreshPlatformRecent();
        return;
      }
      setPlatformProject(result.project);
      setPlatformAssetImages(result.assetImages);
      setPlatformProjectName(result.project.name);
      setPlatformProjectFolder(folder);
      addRecentPlatformFolder(folder, result.project.name);
      refreshPlatformRecent();
      if (result.missing.length > 0) {
        console.warn('[platforms] missing files:', result.missing);
      }
      // Convenience: if the platforms folder ALSO contains a
      // decorations.json, auto-load it. Decoration sprites usually live
      // in the builder project rather than the platforms project — but
      // when both happen to share a folder, this saves an extra click.
      // Decorations mode also has its own "Open decorations.json…"
      // button for the common case where the two are separate.
      try {
        disposeThumbnails(decorationThumbnails);
        const decoResult = await loadDecorationProject(folder);
        if (decoResult) {
          setDecorationProject(decoResult.project);
          setDecorationProjectFolder(folder);
          setDecorationThumbnails(decoResult.thumbnails);
          if (decoResult.missing.length > 0) {
            console.warn('[decorations] missing files:', decoResult.missing);
          }
          setDecorationSaveStatus('idle');
        }
        // No decorations.json here? Leave any previously-loaded
        // decoration project intact — the user may have explicitly
        // opened decorations from a different folder and is just
        // switching between platforms projects.
      } catch (err) {
        console.warn('[decorations] auto-load failed:', err);
      }
    },
    // decorationThumbnails purposefully omitted — including it would
    // re-fire the loader every time thumbnails change (which it does
    // on every load) and create an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshPlatformRecent],
  );

  /** Load by pointing directly at a `platforms.json` file. The actual
   *  project folder is the file's parent directory, so this works even when
   *  the folder has been renamed since the recents list was last updated. */
  const handlePlatformProjectLoadFile = useCallback(async () => {
    const file = await window.api.openSpecificFile({
      title: 'Open platforms.json',
      filterName: 'Platforms project',
      extensions: ['json'],
    });
    if (!file) return;
    await handlePlatformProjectLoad(dirnameOf(file));
  }, [handlePlatformProjectLoad]);

  // ---- Decoration handlers ---------------------------------------------

  const handleUpdateDecoration = useCallback(
    (id: string, patch: Partial<Decoration>) => {
      setDecorationProject((prev) => {
        if (!prev) return prev;
        let touched = false;
        const next = prev.decorations.map((d): Decoration => {
          if (d.id !== id) return d;
          touched = true;
          // Spread types are awkward across the discriminated union; the
          // editor only patches fields that are valid for the asset's
          // existing kind, so a typed `any` cast is safe and minimal.
          return { ...d, ...patch } as Decoration;
        });
        if (!touched) return prev;
        return { ...prev, decorations: next };
      });
      setDecorationSaveStatus('idle');
    },
    [],
  );

  /** Drop a decoration entry from the manifest. Disposes its thumbnail
   *  blob URL too so we don't leak object URLs. The PNG on disk is left
   *  alone — re-running Re-scan will re-add it (auto-classified) unless
   *  the user manually deletes the file. The user must hit Save to
   *  persist the removal to disk. */
  const handleRemoveDecoration = useCallback(
    (id: string) => {
      setDecorationProject((prev) => {
        if (!prev) return prev;
        const next = prev.decorations.filter((d) => d.id !== id);
        if (next.length === prev.decorations.length) return prev;
        return { ...prev, decorations: next };
      });
      // Dispose just this entry's thumbnail URL.
      setDecorationThumbnails((prev) => {
        const url = prev.get(id);
        if (!url) return prev;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setDecorationSaveStatus('idle');
    },
    [],
  );

  const handleSaveDecorations = useCallback(async () => {
    if (!decorationProjectFolder || !decorationProject) return;
    setDecorationSaveStatus('saving');
    try {
      await saveDecorationProject(decorationProjectFolder, decorationProject);
      setDecorationSaveStatus('saved');
      // Drop "saved" indicator after a moment so it doesn't linger.
      setTimeout(() => {
        setDecorationSaveStatus((s) => (s === 'saved' ? 'idle' : s));
      }, 2000);
    } catch (err) {
      console.warn('[decorations] save failed:', err);
      setDecorationSaveStatus('error');
    }
  }, [decorationProjectFolder, decorationProject]);

  const handleReloadDecorations = useCallback(async () => {
    if (!decorationProjectFolder) return;
    disposeThumbnails(decorationThumbnails);
    const result = await loadDecorationProject(decorationProjectFolder);
    if (result) {
      setDecorationProject(result.project);
      setDecorationThumbnails(result.thumbnails);
    } else {
      setDecorationProject(null);
      setDecorationThumbnails(new Map());
    }
    setDecorationSaveStatus('idle');
  }, [decorationProjectFolder, decorationThumbnails]);

  /** Open a decorations.json by either picking a folder (and looking
   *  for decorations.json inside it) OR picking the JSON file directly.
   *  Decorations mode uses this for the common case where the
   *  decoration sprites live somewhere distinct from the platforms
   *  project (e.g. inside the Builder project, or a raw assets folder). */
  const handleOpenDecorationFolder = useCallback(async () => {
    const folder = await window.api.openFolder();
    if (!folder) return;
    disposeThumbnails(decorationThumbnails);
    const result = await loadDecorationProject(folder);
    if (!result) {
      alert(`No decorations.json found in:\n${folder}`);
      return;
    }
    setDecorationProject(result.project);
    setDecorationProjectFolder(folder);
    setDecorationThumbnails(result.thumbnails);
    setDecorationSaveStatus('idle');
    if (result.missing.length > 0) {
      console.warn('[decorations] missing files:', result.missing);
    }
  }, [decorationThumbnails]);

  /** Re-scan the current decoration project folder for new/removed
   *  PNGs and merge into the manifest. Same logic that runs after a
   *  Builder export — useful when the user has copied sprites in by
   *  hand or moved files around. Reloads thumbnails afterward so the
   *  UI reflects the on-disk state. */
  const handleRescanDecorations = useCallback(async () => {
    if (!decorationProjectFolder) return;
    try {
      const result = await syncDecorationsForFolder(decorationProjectFolder);
      if (result) {
        // Reload from disk so the UI picks up auto-classified additions
        // and dropped entries.
        disposeThumbnails(decorationThumbnails);
        const reloadResult = await loadDecorationProject(decorationProjectFolder);
        if (reloadResult) {
          setDecorationProject(reloadResult.project);
          setDecorationThumbnails(reloadResult.thumbnails);
        }
        const parts = [`${result.totalCount} total`];
        if (result.addedCount > 0) parts.push(`+${result.addedCount} new`);
        if (result.removedCount > 0) parts.push(`-${result.removedCount} removed`);
        alert(`Re-scan complete: ${parts.join(', ')}.\n\nManifest: ${result.manifestPath}`);
      } else {
        alert(`No decoration content found in:\n${decorationProjectFolder}`);
      }
    } catch (err) {
      console.warn('[decorations] re-scan failed:', err);
      alert(`Re-scan failed:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [decorationProjectFolder, decorationThumbnails]);

  /** Scan every sheet decoration's source PNG bottom-up for the
   *  first opaque row, and stamp the resulting transparent-rows count
   *  as `visibleBottomPadding` on each entry. Lets the user batch-fix
   *  the "decoration floats above the platform" problem in one click
   *  instead of authoring numbers per asset. Preserves existing
   *  authored values that are LARGER than the detected one (the
   *  author probably knows better than alpha-scanning when they've
   *  already set a number). */
  const handleAutoDetectDecorationPadding = useCallback(async () => {
    if (!decorationProjectFolder || !decorationProject) return;
    try {
      const patches = await bulkDetectBottomPadding(
        decorationProjectFolder,
        decorationProject.decorations,
      );
      if (patches.size === 0) {
        alert('No bottom-transparent rows detected in any sheet. Either every PNG is already tight or the alpha scan found nothing — no changes made.');
        return;
      }
      let touched = 0;
      setDecorationProject((prev) => {
        if (!prev) return prev;
        const next = prev.decorations.map((d): Decoration => {
          const proposed = patches.get(d.id);
          if (proposed === undefined) return d;
          // Don't overwrite a larger authored value — the user may
          // have hand-tuned past the alpha-scan baseline.
          const current = d.visibleBottomPadding ?? 0;
          if (current >= proposed) return d;
          touched += 1;
          // The cast is safe: we're patching a single optional field
          // that lives in the DecorationBase contract regardless of
          // the asset's discriminated kind.
          return { ...d, visibleBottomPadding: proposed } as Decoration;
        });
        return { ...prev, decorations: next };
      });
      setDecorationSaveStatus('idle');
      alert(`Detected padding for ${patches.size} sheet(s); updated ${touched} entries (authored values >= detected were left alone).\nClick Save to persist.`);
    } catch (err) {
      console.warn('[decorations] auto-detect padding failed:', err);
      alert(`Auto-detect failed:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [decorationProjectFolder, decorationProject]);

  /** Bulk-flip placement → 'underside' for entries whose PNG content
   *  sits in the TOP portion of the frame (vines, hanging moss, etc.).
   *  Catches mis-classified entries that the filename-based auto-classifier
   *  missed because their name doesn't say "vine" — e.g. an entry called
   *  `flora_5_raw_05.png` that's actually a hanging vine.
   *
   *  Only flips topside → underside; entries the user already set to
   *  underside are left alone. */
  const handleAutoDetectDecorationUnderside = useCallback(async () => {
    if (!decorationProjectFolder || !decorationProject) return;
    try {
      const flipIds = await bulkDetectUnderside(
        decorationProjectFolder,
        decorationProject.decorations,
      );
      if (flipIds.size === 0) {
        alert('No top-heavy PNGs detected. Every entry already has its visible content in the bottom or center of the frame — nothing to flip.');
        return;
      }
      let touched = 0;
      const flippedNames: string[] = [];
      setDecorationProject((prev) => {
        if (!prev) return prev;
        const next = prev.decorations.map((d): Decoration => {
          if (!flipIds.has(d.id)) return d;
          // Don't override an authored 'underside' (would be a no-op
          // anyway). Only flip topside (default) → underside.
          if ((d.placement ?? 'topside') === 'underside') return d;
          touched += 1;
          flippedNames.push(d.id);
          return { ...d, placement: 'underside' } as Decoration;
        });
        return { ...prev, decorations: next };
      });
      setDecorationSaveStatus('idle');
      const preview = flippedNames.slice(0, 8).join(', ');
      const more = flippedNames.length > 8 ? ` (+${flippedNames.length - 8} more)` : '';
      alert(`Detected ${flipIds.size} top-heavy PNG(s); flipped ${touched} entries to placement: underside.\n\n${preview}${more}\n\nClick Save to persist.`);
    } catch (err) {
      console.warn('[decorations] auto-detect underside failed:', err);
      alert(`Auto-detect failed:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [decorationProjectFolder, decorationProject]);

  const handleOpenDecorationFile = useCallback(async () => {
    const file = await window.api.openSpecificFile({
      title: 'Open decorations.json',
      filterName: 'Decorations project',
      extensions: ['json'],
    });
    if (!file) return;
    const folder = dirnameOf(file);
    disposeThumbnails(decorationThumbnails);
    const result = await loadDecorationProject(folder);
    if (!result) {
      alert(`Could not parse decorations.json at:\n${file}`);
      return;
    }
    setDecorationProject(result.project);
    setDecorationProjectFolder(folder);
    setDecorationThumbnails(result.thumbnails);
    setDecorationSaveStatus('idle');
    if (result.missing.length > 0) {
      console.warn('[decorations] missing files:', result.missing);
    }
  }, [decorationThumbnails]);

  const handlePlatformRecentRemove = useCallback(
    (folder: string) => {
      removeRecentPlatformFolder(folder);
      refreshPlatformRecent();
    },
    [refreshPlatformRecent],
  );

  const handleAddPlatformAsset = useCallback((image: ImageData) => {
    // Generate the id outside the setter so we can use it in both updates
    // without racing against an intermediate render.
    const id = newPlatformAssetId();
    setPlatformProject((p) => {
      const filename = derivePlatformFilename(
        { biome: 'DEPTHS', type: 'STANDARD' },
        p.assets,
      );
      const newAsset: PlatformAsset = {
        id,
        filename,
        biome: 'DEPTHS',
        type: 'STANDARD',
        slice: defaultSliceBorders(image.width),
        width: image.width,
        height: image.height,
      };
      return { ...p, assets: [...p.assets, newAsset] };
    });
    setPlatformAssetImages((m) => {
      const next = new Map(m);
      next.set(id, image);
      return next;
    });
  }, []);

  const handleUpdatePlatformAsset = useCallback(
    (id: string, patch: Partial<PlatformAsset>) => {
      // Stamp lastModifiedMs on every patch so the library highlight reflects
      // the most recent edit. The caller can override by including a value
      // in `patch` (e.g. when batch-updating without changing the timestamp).
      const stamped: Partial<PlatformAsset> = {
        lastModifiedMs: Date.now(),
        ...patch,
      };
      setPlatformProject((p) => ({
        ...p,
        assets: p.assets.map((a) => (a.id === id ? { ...a, ...stamped } : a)),
      }));
    },
    [],
  );

  const handleRemovePlatformAsset = useCallback((id: string) => {
    setPlatformProject((p) => ({
      ...p,
      assets: p.assets.filter((a) => a.id !== id),
    }));
    setPlatformAssetImages((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Batch-upscale every library asset using the bundled ESRGAN model. The
   * upscaled PNG is written back to disk (replacing the original), the
   * in-memory ImageData is updated, and the asset's width/height are
   * stamped to the new dims so subsequent UI/export math reflects reality.
   *
   * Skips assets without an in-memory ImageData (shouldn't happen unless
   * the asset's PNG failed to load) and assets whose project hasn't been
   * saved yet (we need a folder to write into).
   */
  const handlePlatformUpscaleAll = useCallback(
    async (
      onProgress: (current: number, total: number, filename: string) => void,
      shouldCancel: () => boolean,
      assetIds?: ReadonlySet<string>,
    ) => {
      if (!platformProjectFolder) {
        alert(
          'Save the project to a folder first — the upscaler writes new PNGs back to disk.',
        );
        return;
      }
      const assets = assetIds
        ? platformProject.assets.filter((a) => assetIds.has(a.id))
        : platformProject.assets;
      // Phase 0: report "warming up" so the UI shows something during the
      // model's first-use load (~80MB download/parse).
      onProgress(0, assets.length, '(loading model…)');
      const folder = platformProjectFolder;
      let writes = 0;
      let failures = 0;
      const failureLog: string[] = [];
      for (let i = 0; i < assets.length; i++) {
        if (shouldCancel()) break;
        const asset = assets[i];
        const img = platformAssetImages.get(asset.id);
        if (!img) {
          onProgress(i + 1, assets.length, `${asset.filename} (skipped — no image)`);
          continue;
        }
        onProgress(i, assets.length, asset.filename);
        let upscaled: ImageData;
        try {
          upscaled = await upscaleImageData(img);
        } catch (err) {
          console.error('[upscale] model failed for', asset.filename, err);
          failureLog.push(`${asset.filename}: ${(err as Error).message ?? err}`);
          failures++;
          onProgress(i + 1, assets.length, `${asset.filename} (model failed)`);
          continue;
        }
        const path = platformJoinPath(folder, asset.filename);
        try {
          const bytes = await imageDataToPngBytes(upscaled);
          await window.api.writeFile(path, bytes);
          // Per-write log so the user can confirm in DevTools that files
          // are actually being replaced on disk (and at what new size).
          console.log(
            `[upscale] wrote ${path} ${img.width}×${img.height} → ${upscaled.width}×${upscaled.height} (${(bytes.byteLength / 1024).toFixed(0)}KB)`,
          );
          writes++;
        } catch (err) {
          console.error('[upscale] write failed for', path, err);
          failureLog.push(`${asset.filename}: write failed — ${(err as Error).message ?? err}`);
          failures++;
          onProgress(i + 1, assets.length, `${asset.filename} (write failed)`);
          continue;
        }
        // Update in-memory ImageData so subsequent renders use the new
        // resolution without a manual reload.
        setPlatformAssetImages((m) => {
          const next = new Map(m);
          next.set(asset.id, upscaled);
          return next;
        });
        // Stamp new dims + lastModified on the asset so the library
        // highlight reflects the change and downstream sizing math is
        // accurate.
        handleUpdatePlatformAsset(asset.id, {
          width: upscaled.width,
          height: upscaled.height,
        });
        onProgress(i + 1, assets.length, asset.filename);
        // Brief pause between assets — gives the renderer a chance to
        // paint the progress update and lets tfjs's GPU resources settle
        // before the next inference.
        await new Promise((r) => setTimeout(r, 100));
      }
      // Final summary so the user knows the result without having to
      // sift the DevTools console.
      const summary = `Upscale finished: ${writes} written, ${failures} failed${shouldCancel() ? ' (cancelled)' : ''}.`;
      console.log(`[upscale] ${summary}`);
      if (failures > 0) {
        alert(
          `${summary}\n\n` +
            failureLog.slice(0, 8).join('\n') +
            (failureLog.length > 8 ? `\n…and ${failureLog.length - 8} more.` : ''),
        );
      } else if (writes > 0) {
        // Quiet success — log only.
      } else {
        alert(`Upscale produced no writes. Check the DevTools console for details.`);
      }
    },
    [
      platformProject.assets,
      platformProjectFolder,
      platformAssetImages,
      handleUpdatePlatformAsset,
    ],
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

  const handleRemoveGlobalSelected = useCallback(() => {
    if (!pickedColor || colorSelection.size === 0) return;
    for (const s of sourcesList) {
      if (!colorSelection.has(s.id)) continue;
      const img = getSourceImage(s.id);
      if (!img) continue;
      const next = cloneImageData(img);
      removeColorGlobal(next.data, pickedColor, { tolerance, mode: distanceMode });
      pushHistory(s.id, img);
      setSourceImage(s.id, next);
    }
  }, [
    pickedColor,
    colorSelection,
    tolerance,
    distanceMode,
    sourcesList,
    getSourceImage,
    pushHistory,
    setSourceImage,
  ]);

  const applyReplaceTo = useCallback(
    (data: Uint8ClampedArray, source: RGB, fill: RGB) => {
      if (replaceMode === 'hue') {
        replaceColorHueShift(data, {
          source,
          fill,
          sourceTolerance: tolerance,
          mode: distanceMode,
        });
      } else {
        replaceColorGlobal(data, {
          source,
          fill,
          sourceTolerance: tolerance,
          fillTolerance: replaceFillTolerance,
          mode: distanceMode,
        });
      }
    },
    [replaceMode, tolerance, replaceFillTolerance, distanceMode],
  );

  const handleReplaceColor = useCallback(() => {
    if (!activeId || !pickedColor || !replaceFill) return;
    const img = getSourceImage(activeId);
    if (!img) return;
    const next = cloneImageData(img);
    applyReplaceTo(next.data, pickedColor, replaceFill);
    pushHistory(activeId, img);
    setSourceImage(activeId, next);
  }, [
    activeId,
    pickedColor,
    replaceFill,
    applyReplaceTo,
    getSourceImage,
    pushHistory,
    setSourceImage,
  ]);

  const handleReplaceColorAllSources = useCallback(() => {
    if (!pickedColor || !replaceFill) return;
    for (const s of sourcesList) {
      const img = getSourceImage(s.id);
      if (!img) continue;
      const next = cloneImageData(img);
      applyReplaceTo(next.data, pickedColor, replaceFill);
      pushHistory(s.id, img);
      setSourceImage(s.id, next);
    }
  }, [
    pickedColor,
    replaceFill,
    applyReplaceTo,
    sourcesList,
    getSourceImage,
    pushHistory,
    setSourceImage,
  ]);

  const handleReplaceColorSelected = useCallback(() => {
    if (!pickedColor || !replaceFill || colorSelection.size === 0) return;
    for (const s of sourcesList) {
      if (!colorSelection.has(s.id)) continue;
      const img = getSourceImage(s.id);
      if (!img) continue;
      const next = cloneImageData(img);
      applyReplaceTo(next.data, pickedColor, replaceFill);
      pushHistory(s.id, img);
      setSourceImage(s.id, next);
    }
  }, [
    pickedColor,
    replaceFill,
    colorSelection,
    applyReplaceTo,
    sourcesList,
    getSourceImage,
    pushHistory,
    setSourceImage,
  ]);

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
    const cur = getSourceImage(activeId);
    const prev = popHistory(activeId);
    if (!prev) return;
    if (cur) pushFuture(activeId, cur);
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
    setFloaterAngle(0);
  }, [activeId, getSourceImage, popHistory, pushFuture, setSourceImage, setSourceFloater, setLiftSnapshot, setLifting, updateMeta]);

  const handleRedo = useCallback(() => {
    if (!activeId) return;
    const cur = getSourceImage(activeId);
    const next = popFuture(activeId);
    if (!next) return;
    // keepFuture: we're moving forward in the redo trail, not creating a new
    // edit, so the rest of the future stack must remain reachable.
    if (cur) pushHistory(activeId, cur, { keepFuture: true });
    setSourceImage(activeId, next);
    setSourceFloater(activeId, null);
    setLiftSnapshot(activeId, null);
    setLifting(activeId, false);
    updateMeta(activeId, {
      selectionRect: null,
      lassoPolygon: null,
      selectionOffset: null,
      selectionConfirmed: false,
    });
    setFloaterAngle(0);
  }, [activeId, getSourceImage, popFuture, pushHistory, setSourceImage, setSourceFloater, setLiftSnapshot, setLifting, updateMeta]);

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

  // Export each cell as its raw bounding-box PNG — no normalization, no flip
  // overrides, no padding, no trim. The PNG is exactly `rect.width × rect.height`
  // and contains the source pixels under that rect verbatim. Useful when the
  // user wants to ship blobs at their natural size and apply transforms in-engine.
  const exportRawCells = useCallback(async () => {
    if (!active || !activeImage || cells.length === 0) return;
    const folder = await window.api.openFolder();
    if (!folder) return;
    const base = active.filename.replace(/\.[^.]+$/, '');
    const pad = String(cells.length - 1).length;
    for (let i = 0; i < cells.length; i++) {
      const rect = cells[i];
      const raw = extractRect(activeImage, rect.x, rect.y, rect.width, rect.height);
      const bytes = await imageDataToPngBytes(raw);
      await window.api.writeFile(
        joinPath(folder, `${base}_raw_${String(i).padStart(pad, '0')}.png`),
        bytes,
      );
    }
  }, [active, activeImage, cells]);

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

  const autoDetectBlobsAllSources = useCallback(
    async (mergeGap: number) => {
      // Each source's blob scan is a synchronous main-thread block; yield
      // between sources so the toolbar/progress can paint between sheets.
      for (const s of sourcesList) {
        const img = getSourceImage(s.id);
        if (!img) continue;
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const rects = detectBlobs(img, 16, 1, 0, mergeGap);
        updateMeta(s.id, {
          slice: { ...s.slice, mode: 'boxes', boxes: { rects } },
          selectedCellIndex: null,
        });
      }
    },
    [sourcesList, getSourceImage, updateMeta],
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

  // Floater rotation in radians. App-scoped because only the active source's
  // floater is editable at a time (auto-commit fires on source switch). Reset
  // to 0 whenever the floater is cleared (commit / cancel / erase / paste).
  const [floaterAngle, setFloaterAngle] = useState(0);

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
        setFloaterAngle(0);
        return;
      }
      const next =
        floaterAngle !== 0
          ? compositeRotated(
              img,
              rt.floater,
              meta.selectionOffset.x + rt.floater.width / 2,
              meta.selectionOffset.y + rt.floater.height / 2,
              floaterAngle,
            )
          : compositeOnto(img, rt.floater, meta.selectionOffset.x, meta.selectionOffset.y);
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
      setFloaterAngle(0);
    },
    [activeId, floaterAngle, sourcesList, getRuntime, getSourceImage, setSourceImage, setSourceFloater, setLiftSnapshot, setLifting, updateMeta],
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
    setFloaterAngle(0);
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
    setFloaterAngle(0);
  }, [activeId, setSourceFloater, setLifting, updateMeta]);

  /**
   * Lift the current confirmed selection if it isn't already a floater.
   * Returns the live floater (or null if nothing to lift). Shared between
   * flip and the move-on-arrow path so both get the same lift semantics.
   */
  const ensureFloaterLifted = useCallback((): ImageData | null => {
    if (!activeId || !active) return null;
    const rt = getRuntime(activeId);
    if (rt?.floater) return rt.floater;
    if (!active.selectionRect || !active.selectionConfirmed) return null;
    const img = getSourceImage(activeId);
    if (!img) return null;
    const rect = active.selectionRect;
    pushHistory(activeId, img);
    setLiftSnapshot(activeId, img);
    setLifting(activeId, true);
    const f = extractRect(img, rect.x, rect.y, rect.width, rect.height);
    if (active.lassoPolygon) {
      applyPolygonMask(f, active.lassoPolygon, rect.x, rect.y);
    }
    setSourceFloater(activeId, f);
    const cleared = cloneImageData(img);
    if (active.lassoPolygon) {
      clearImageByFloater(cleared, f, rect.x, rect.y);
    } else {
      clearImageRect(cleared, rect.x, rect.y, rect.width, rect.height);
    }
    setSourceImage(activeId, cleared);
    return f;
  }, [
    activeId,
    active,
    getRuntime,
    getSourceImage,
    pushHistory,
    setLiftSnapshot,
    setLifting,
    setSourceFloater,
    setSourceImage,
  ]);

  const flipFloater = useCallback(
    (dir: 'h' | 'v') => {
      if (!activeId) return;
      const floater = ensureFloaterLifted();
      if (!floater) return;
      const flipped =
        dir === 'h' ? flipImageDataHorizontal(floater) : flipImageDataVertical(floater);
      setSourceFloater(activeId, flipped);
    },
    [activeId, ensureFloaterLifted, setSourceFloater],
  );

  /**
   * Sidebar / overlay rotate handlers. The angle is tracked separately from
   * the floater bytes — applied only at commit-time via compositeRotated, so
   * repeated rotations don't compound interpolation loss.
   */
  const startRotation = useCallback(() => {
    // Lift the selection so the rotation handle has something to rotate.
    ensureFloaterLifted();
  }, [ensureFloaterLifted]);

  const rotateFloaterBy = useCallback(
    (deltaRad: number) => {
      ensureFloaterLifted();
      setFloaterAngle((a) => a + deltaRad);
    },
    [ensureFloaterLifted],
  );

  const setFloaterAngleAbsolute = useCallback(
    (angle: number) => {
      ensureFloaterLifted();
      setFloaterAngle(angle);
    },
    [ensureFloaterLifted],
  );

  const resetFloaterRotation = useCallback(() => setFloaterAngle(0), []);

  // App-scoped clipboard for Select+Move copy/paste. Holds the most recent
  // copied selection's pixels + the rect it came from so paste lands at the
  // same position by default.
  const [selectionClipboard, setSelectionClipboard] = useState<{
    image: ImageData;
    offset: { x: number; y: number };
  } | null>(null);

  const copySelection = useCallback(() => {
    if (!activeId || !active) return;
    const rt = getRuntime(activeId);
    let copy: ImageData | null = null;
    let offset = { x: 0, y: 0 };
    if (rt?.floater && active.selectionOffset) {
      // Already lifted — copy the floater + its current display position.
      copy = cloneImageData(rt.floater);
      offset = { ...active.selectionOffset };
    } else if (active.selectionRect && active.selectionConfirmed) {
      // Confirmed but not lifted — extract straight from source, no mutation.
      const img = getSourceImage(activeId);
      if (!img) return;
      const rect = active.selectionRect;
      const extracted = extractRect(img, rect.x, rect.y, rect.width, rect.height);
      if (active.lassoPolygon) {
        applyPolygonMask(extracted, active.lassoPolygon, rect.x, rect.y);
      }
      copy = extracted;
      offset = { x: rect.x, y: rect.y };
    }
    if (!copy) return;
    setSelectionClipboard({ image: copy, offset });
  }, [activeId, active, getRuntime, getSourceImage]);

  const pasteSelection = useCallback(() => {
    if (!activeId || !active || !selectionClipboard) return;
    // Commit any in-flight floater first so the prior move isn't lost.
    const rt = getRuntime(activeId);
    if (rt?.floater) commitFloater(activeId);
    const img = getSourceImage(activeId);
    if (!img) return;
    pushHistory(activeId, img);
    setLiftSnapshot(activeId, img);
    setLifting(activeId, true);
    const f = cloneImageData(selectionClipboard.image);
    setSourceFloater(activeId, f);
    const rect = {
      x: Math.max(0, Math.min(img.width - f.width, selectionClipboard.offset.x)),
      y: Math.max(0, Math.min(img.height - f.height, selectionClipboard.offset.y)),
      width: f.width,
      height: f.height,
    };
    updateMeta(activeId, {
      selectionRect: rect,
      lassoPolygon: null,
      selectionOffset: { x: rect.x, y: rect.y },
      selectionConfirmed: true,
    });
    setFloaterAngle(0);
  }, [
    activeId,
    active,
    selectionClipboard,
    getRuntime,
    commitFloater,
    getSourceImage,
    pushHistory,
    setLiftSnapshot,
    setLifting,
    setSourceFloater,
    updateMeta,
  ]);

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

  // Keyboard: H / V flip the floater in select mode; Ctrl+C / Ctrl+V copy/paste.
  useEffect(() => {
    if (mode !== 'select') return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'c') {
        e.preventDefault();
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault();
        pasteSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'h') {
        e.preventDefault();
        flipFloater('h');
      } else if (key === 'v') {
        e.preventDefault();
        flipFloater('v');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, flipFloater, copySelection, pasteSelection]);

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

  // Keyboard: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) for placement undo/redo in Builder mode.
  useEffect(() => {
    if (mode !== 'builder') return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoPlacement();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoPlacement();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, undoPlacement, redoPlacement]);

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

  // Export the active animation as a strip via Save dialog. Also emits the
  // particles JSON next to it and bundles any referenced bank textures so the
  // exported folder is self-contained and the runtime can load everything by
  // looking next to the JSON.
  const exportBuilderStrip = useCallback(async () => {
    const active = getActiveAnimation(builder);
    if (!active) return;
    const bytes = await composeAnimationStrip(active, builder, sourcesList, getSourceImage);
    if (!bytes) return;
    const pngPath = await window.api.saveImage(
      `${safeAnimationFilename(active.name, active.fps)}.png`,
      bytes,
    );
    if (!pngPath) return;
    // Particles JSON sits next to the strip with a parallel filename.
    const jsonPath = pngPath.replace(/\.png$/i, '.particles.json');
    const json = buildAnimationParticleJson(active, builder, sourcesList);
    await window.api.writeFile(jsonPath, encodeParticlesJsonBytes(json));
    const dir = particlesDirname(pngPath);
    const result = await bundleBankTextures(dir, active.emitters ?? []);
    if (result.missing.length > 0) {
      console.warn('[particles] missing bank textures during export:', result.missing);
    }
  }, [builder, sourcesList, getSourceImage]);

  // Export every animation that's ready into the project folder. Also writes
  // a single project-wide particles JSON aggregating every animation's
  // emitters and bundles every referenced bank texture next to it.
  const exportAllAnimationsToProject = useCallback(async () => {
    if (!projectFolder) return;
    const skipped: string[] = [];
    for (const anim of builder.animations) {
      const bytes = await composeAnimationStrip(anim, builder, sourcesList, getSourceImage);
      if (!bytes) {
        skipped.push(anim.name);
        continue;
      }
      const filename = `${safeAnimationFilename(anim.name, anim.fps)}.png`;
      await window.api.writeFile(particlesJoinPath(projectFolder, filename), bytes);
    }
    // Write the project-wide particles JSON regardless of skipped animations
    // — it's the source of truth for emitter configs and includes every
    // animation, even those not yet ready to export as a strip.
    const projectJson = buildProjectParticleJson(
      builder,
      sourcesList,
      projectName || 'project',
    );
    const projectFilename = `${safeProjectFilename(projectName)}.particles.json`;
    await window.api.writeFile(
      particlesJoinPath(projectFolder, projectFilename),
      encodeParticlesJsonBytes(projectJson),
    );
    // Bundle every bank texture referenced anywhere in the project.
    const allEmitters = builder.animations.flatMap((a) => a.emitters ?? []);
    const bundleResult = await bundleBankTextures(projectFolder, allEmitters);
    if (bundleResult.missing.length > 0) {
      console.warn('[particles] missing bank textures during export:', bundleResult.missing);
    }
    // Sync decorations.json. The Builder export drops `*_Nfps.png`
    // sheets directly into `projectFolder`, which is the same shape
    // Decorations mode reads. Running the sync after every export
    // means the manifest stays current with whatever was just written
    // — new sheets get auto-classified entries, removed sheets are
    // dropped, and existing user edits (category overrides, behavior
    // weight tweaks, hazard chains) are preserved verbatim. The sync
    // also recognizes the `decorations_sheets/` + `decorations_singles/`
    // sibling layout in case the project folder is structured that way.
    let decoSyncSummary = '';
    try {
      const result = await syncDecorationsForFolder(projectFolder);
      if (result) {
        const parts = [`${result.totalCount} decoration${result.totalCount === 1 ? '' : 's'}`];
        if (result.addedCount > 0) parts.push(`+${result.addedCount} new`);
        if (result.removedCount > 0) parts.push(`-${result.removedCount} removed`);
        decoSyncSummary = `\n\nUpdated decorations.json (${parts.join(', ')}).`;
      }
    } catch (err) {
      console.warn('[decorations] sync after export failed:', err);
    }

    if (skipped.length > 0) {
      alert(
        `Skipped ${skipped.length} unfinished animation${skipped.length > 1 ? 's' : ''}:\n` +
          skipped.map((n) => `• ${n}`).join('\n') +
          `\n\n(Need a scale lock + every slot filled to export the strip.)\n\n` +
          `Wrote ${projectFilename} + ${bundleResult.written.length} bundled texture(s).${decoSyncSummary}`,
      );
    } else {
      alert(
        `Exported ${builder.animations.length} animation strip(s) + ${projectFilename} + ${bundleResult.written.length} bundled texture(s) into:\n${projectFolder}${decoSyncSummary}`,
      );
    }
  }, [builder, sourcesList, getSourceImage, projectFolder, projectName]);

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
        angle={floaterAngle}
        onDefine={defineSelection}
        onConfirm={confirmSelection}
        onMove={moveSelection}
        onRotate={setFloaterAngleAbsolute}
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
          selectable={mode === 'remove'}
          selectedIds={colorSelection}
          onToggleSelected={toggleColorSelection}
          onSelectAll={selectAllColorSources}
          onClearSelection={clearColorSelection}
        />
        {mode === 'generate' ? (
          <GeneratePage projectFolder={projectFolder} />
        ) : mode === 'test' ? (
          <TestPage
            builder={builder}
            onBuilderChange={setBuilder}
            sources={sourcesList}
            getSource={getSourceImage}
          />
        ) : mode === 'platforms' ? (
          <PlatformsView
            project={platformProject}
            assetImages={platformAssetImages}
            sources={sourcesList}
            getSource={getSourceImage}
            onAddAsset={handleAddPlatformAsset}
            onUpdateAsset={handleUpdatePlatformAsset}
            onRemoveAsset={handleRemovePlatformAsset}
            decorationProject={decorationProject}
            decorationThumbnails={decorationThumbnails}
            projectName={platformProjectName}
            projectFolder={platformProjectFolder}
            recentFolders={platformRecentFolders}
            onProjectSave={(n) => handlePlatformProjectSave(n, 'overwrite')}
            onProjectSaveAs={(n) => handlePlatformProjectSave(n, 'new')}
            onProjectLoad={handlePlatformProjectLoad}
            onProjectLoadFile={handlePlatformProjectLoadFile}
            onProjectLoadRecent={handlePlatformProjectLoad}
            onRecentRemove={handlePlatformRecentRemove}
            onProjectNew={handlePlatformProjectNew}
            onUpscaleAll={handlePlatformUpscaleAll}
          />
        ) : mode === 'decorations' ? (
          <DecorationsView
            project={decorationProject}
            projectFolder={decorationProjectFolder}
            thumbnails={decorationThumbnails}
            onUpdate={handleUpdateDecoration}
            onRemove={handleRemoveDecoration}
            onSave={handleSaveDecorations}
            onReload={handleReloadDecorations}
            onOpenFolder={handleOpenDecorationFolder}
            onOpenFile={handleOpenDecorationFile}
            onRescan={handleRescanDecorations}
            onAutoDetectPadding={handleAutoDetectDecorationPadding}
            onAutoDetectUnderside={handleAutoDetectDecorationUnderside}
            saveStatus={decorationSaveStatus}
          />
        ) : mode === 'builder' ? (
          <BuilderLayout
            state={builder}
            onStateChange={setBuilder}
            sources={sourcesList}
            getSource={getSourceImage}
            selectedCell={builderSelectedCell}
            onSelectCell={setBuilderSelectedCell}
            selectedSlotIndex={builderSelectedSlot}
            onSelectSlot={setBuilderSelectedSlot}
            onRecordPlacement={recordPlacement}
            onUndoPlacement={undoPlacement}
            onRedoPlacement={redoPlacement}
            canUndoPlacement={canUndoPlacement}
            canRedoPlacement={canRedoPlacement}
            onDeselectCell={() => setBuilderSelectedCell(null)}
            onDeselectSlot={() => setBuilderSelectedSlot(null)}
            projectName={projectName}
            projectFolder={projectFolder}
            recentFolders={recentFolders}
            onProjectSave={(n) => handleProjectSave(n, 'overwrite')}
            onProjectSaveAs={(n) => handleProjectSave(n, 'new')}
            onProjectLoad={handleProjectLoad}
            onProjectLoadRecent={handleProjectLoad}
            onRecentRemove={handleRecentRemove}
            onProjectNew={handleProjectNew}
            onExport={exportBuilderStrip}
            onExportAllToProject={exportAllAnimationsToProject}
            hasProjectFolder={!!projectFolder}
          />
        ) : (
          <>
            <CanvasView
              imageMeta={imageMeta}
              getImage={getImage}
              onPick={
                mode === 'remove' && (removeBgTool === 'pick' || removeBgTool === 'replace')
                  ? handlePick
                  : undefined
              }
              onHover={handleHover}
              pickEnabled={
                mode === 'remove' && (removeBgTool === 'pick' || removeBgTool === 'replace')
              }
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
            onRemoveGlobalSelected={handleRemoveGlobalSelected}
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
            replaceFill={replaceFill}
            onReplaceFillChange={setReplaceFill}
            replaceFillTolerance={replaceFillTolerance}
            onReplaceFillToleranceChange={setReplaceFillTolerance}
            onReplaceColor={handleReplaceColor}
            onReplaceColorAllSources={handleReplaceColorAllSources}
            onReplaceColorSelected={handleReplaceColorSelected}
            selectedSourceCount={colorSelection.size}
            fillSwatches={fillSwatches}
            onFillSwatchesChange={setFillSwatches}
            replaceMode={replaceMode}
            onReplaceModeChange={setReplaceMode}
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
            onExportRawCells={exportRawCells}
            onExportAtlas={exportAtlas}
            onAutoDetectBlobs={autoDetectBlobs}
            onAutoDetectBlobsAllSources={autoDetectBlobsAllSources}
            sourceCount={sourcesList.length}
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
            onRedo={handleRedo}
            canRedo={(active?.futureLen ?? 0) > 0}
            imageWidth={active?.width ?? 0}
            imageHeight={active?.height ?? 0}
            onExpandCanvas={handleExpandCanvas}
            onFlipH={() => flipFloater('h')}
            onFlipV={() => flipFloater('v')}
            onCopy={copySelection}
            onPaste={pasteSelection}
            hasClipboard={!!selectionClipboard}
            angle={floaterAngle}
            onStartRotation={startRotation}
            onRotateBy={rotateFloaterBy}
            onSetAngle={setFloaterAngleAbsolute}
            onResetRotation={resetFloaterRotation}
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
  onRedo,
  canRedo,
  imageWidth,
  imageHeight,
  onExpandCanvas,
  onFlipH,
  onFlipV,
  onCopy,
  onPaste,
  hasClipboard,
  angle,
  onStartRotation,
  onRotateBy,
  onSetAngle,
  onResetRotation,
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
  onRedo: () => void;
  canRedo: boolean;
  imageWidth: number;
  imageHeight: number;
  onExpandCanvas: (target: number) => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onCopy: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
  angle: number;
  onStartRotation: () => void;
  onRotateBy: (deltaRad: number) => void;
  onSetAngle: (rad: number) => void;
  onResetRotation: () => void;
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onUndo} disabled={!canUndo} style={{ flex: 1 }}>
              Undo
            </button>
            <button onClick={onRedo} disabled={!canRedo} style={{ flex: 1 }}>
              Redo
            </button>
          </div>
        </div>
      </section>
      <section>
        <label>Transform</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onFlipH}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ flex: 1 }}
            title="Flip the lifted selection horizontally (H)"
          >
            ↔ Flip H
          </button>
          <button
            onClick={onFlipV}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ flex: 1 }}
            title="Flip the lifted selection vertically (V)"
          >
            ↕ Flip V
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Lifts the selection if it isn't already.
        </div>
      </section>
      <section>
        <label>Rotate</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onStartRotation}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            className={hasFloater && angle !== 0 ? 'primary' : undefined}
            style={{ flex: 1 }}
            title="Lift the selection so the rotation handle is ready to drag"
          >
            ↻ Rotate
          </button>
          <button
            onClick={() => onRotateBy(-Math.PI / 2)}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ flex: 1 }}
            title="Rotate 90° counter-clockwise"
          >
            -90°
          </button>
          <button
            onClick={() => onRotateBy(Math.PI / 2)}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ flex: 1 }}
            title="Rotate 90° clockwise"
          >
            +90°
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <input
            type="number"
            value={Math.round((angle * 180) / Math.PI)}
            onChange={(e) => {
              const deg = Number(e.target.value) || 0;
              onSetAngle((deg * Math.PI) / 180);
            }}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ width: 70, fontSize: 11 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>deg</span>
          <button
            onClick={onResetRotation}
            disabled={angle === 0}
            style={{ marginLeft: 'auto', fontSize: 11 }}
          >
            Reset
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
          Drag the circle handle above the selection to rotate freely. Hold
          shift while dragging to snap to 15°.
        </div>
      </section>
      <section>
        <label>Clipboard</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onCopy}
            disabled={!hasFloater && !(selectionConfirmed && hasSelection)}
            style={{ flex: 1 }}
            title="Copy the selection's pixels to the in-app clipboard (Ctrl+C)"
          >
            Copy
          </button>
          <button
            onClick={onPaste}
            disabled={!hasClipboard || !hasImage}
            style={{ flex: 1 }}
            title="Paste as a new floater at its original position (Ctrl+V)"
          >
            Paste
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Paste lands at the copied rect's position; drag to move, Enter to commit.
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
