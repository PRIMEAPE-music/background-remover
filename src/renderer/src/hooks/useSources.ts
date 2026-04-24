import { useCallback, useRef, useState } from 'react';
import {
  basename,
  makeSourceMeta,
  makeSourceRuntime,
  newSourceId,
  type SourceMeta,
  type SourceRuntime,
} from '../lib/sources';

const MAX_UNDO_COUNT = 5;
// Global byte budget across every source's history. The renderer will OOM long
// before we hit 5 × 400MB, so one global ceiling is safer than per-source.
// Lowered from 400MB — with multi-source, retaining that much ImageData causes
// major GC pauses that look like UI freezes.
const MAX_UNDO_BYTES_GLOBAL = 200 * 1024 * 1024;

export interface UseSourcesApi {
  sources: SourceMeta[];
  activeId: string | null;
  active: SourceMeta | null;
  addSource: (filepath: string, image: ImageData, explicitId?: string) => string;
  removeSource: (id: string) => void;
  setActive: (id: string | null) => void;
  /** Replace an active source's image. Bumps version. */
  setImage: (id: string, next: ImageData) => void;
  /** Partial meta update — merges. */
  updateMeta: (id: string, patch: Partial<SourceMeta>) => void;
  pushHistory: (id: string, prev: ImageData) => void;
  popHistory: (id: string) => ImageData | null;
  dropLastHistory: (id: string) => void;
  clearHistory: (id: string) => void;
  getImage: (id: string | null) => ImageData | null;
  getRuntime: (id: string) => SourceRuntime | null;
  setLiftSnapshot: (id: string, snapshot: ImageData | null) => void;
  setFloater: (id: string, floater: ImageData | null) => void;
  setLifting: (id: string, v: boolean) => void;
  isLifting: (id: string) => boolean;
  /** Drop every source + its runtime data. Used when loading a project. */
  clearAll: () => void;
}

export function useSources(): UseSourcesApi {
  const runtimeRef = useRef<Map<string, SourceRuntime>>(new Map());
  const liftingRef = useRef<Map<string, boolean>>(new Map());
  const versionCounterRef = useRef(0);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  // Mirror of `sources` state in a ref so stable callbacks can read the
  // latest meta list without going through setSources.
  const sourcesRef = useRef<SourceMeta[]>(sources);
  sourcesRef.current = sources;

  const nextVersion = () => {
    versionCounterRef.current += 1;
    return versionCounterRef.current;
  };

  const trimGlobalHistory = useCallback(() => {
    // Sweep: if total history bytes exceed the global ceiling, drop the
    // oldest entry from whichever source currently holds the most memory
    // until under budget.
    const runtimes = runtimeRef.current;
    let bytes = 0;
    for (const rt of runtimes.values()) {
      for (const h of rt.history) bytes += h.data.byteLength;
    }
    while (bytes > MAX_UNDO_BYTES_GLOBAL) {
      let victim: SourceRuntime | null = null;
      let victimBytes = 0;
      for (const rt of runtimes.values()) {
        if (rt.history.length === 0) continue;
        let rb = 0;
        for (const h of rt.history) rb += h.data.byteLength;
        if (rb > victimBytes) {
          victimBytes = rb;
          victim = rt;
        }
      }
      if (!victim || victim.history.length === 0) break;
      const dropped = victim.history.shift()!;
      bytes -= dropped.data.byteLength;
    }
  }, []);

  const addSource = useCallback(
    (filepath: string, image: ImageData, explicitId?: string): string => {
      const id = explicitId ?? newSourceId();
      const filename = basename(filepath);
      const version = nextVersion();
      const meta = makeSourceMeta({ id, filepath, filename, image, version });
      const runtime = makeSourceRuntime(image);
      runtimeRef.current.set(id, runtime);
      setSources((prev) => [...prev, meta]);
      setActiveIdState((cur) => (cur === null ? id : cur));
      return id;
    },
    [],
  );

  const removeSource = useCallback((id: string) => {
    runtimeRef.current.delete(id);
    liftingRef.current.delete(id);
    setSources((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = prev.slice(0, idx).concat(prev.slice(idx + 1));
      setActiveIdState((cur) => {
        if (cur !== id) return cur;
        return next[idx]?.id ?? next[idx - 1]?.id ?? next[0]?.id ?? null;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((id: string | null) => {
    setActiveIdState(id);
  }, []);

  const setImage = useCallback((id: string, next: ImageData) => {
    const rt = runtimeRef.current.get(id);
    if (!rt) return;
    rt.image = next;
    const v = nextVersion();
    setSources((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, width: next.width, height: next.height, version: v } : s,
      ),
    );
  }, []);

  const updateMeta = useCallback((id: string, patch: Partial<SourceMeta>) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const pushHistory = useCallback(
    (id: string, prev: ImageData) => {
      const rt = runtimeRef.current.get(id);
      if (!rt) return;
      rt.history.push(prev);
      while (rt.history.length > MAX_UNDO_COUNT) rt.history.shift();
      trimGlobalHistory();
      setSources((p) => p.map((s) => (s.id === id ? { ...s, historyLen: rt.history.length } : s)));
    },
    [trimGlobalHistory],
  );

  const popHistory = useCallback((id: string): ImageData | null => {
    const rt = runtimeRef.current.get(id);
    if (!rt || rt.history.length === 0) return null;
    const prev = rt.history.pop()!;
    setSources((p) => p.map((s) => (s.id === id ? { ...s, historyLen: rt.history.length } : s)));
    return prev;
  }, []);

  const dropLastHistory = useCallback((id: string) => {
    const rt = runtimeRef.current.get(id);
    if (!rt || rt.history.length === 0) return;
    rt.history.pop();
    setSources((p) => p.map((s) => (s.id === id ? { ...s, historyLen: rt.history.length } : s)));
  }, []);

  const clearHistory = useCallback((id: string) => {
    const rt = runtimeRef.current.get(id);
    if (!rt) return;
    rt.history = [];
    setSources((p) => p.map((s) => (s.id === id ? { ...s, historyLen: 0 } : s)));
  }, []);

  const getImage = useCallback((id: string | null): ImageData | null => {
    if (!id) return null;
    return runtimeRef.current.get(id)?.image ?? null;
  }, []);

  const getRuntime = useCallback((id: string) => runtimeRef.current.get(id) ?? null, []);

  const setLiftSnapshot = useCallback((id: string, snapshot: ImageData | null) => {
    const rt = runtimeRef.current.get(id);
    if (!rt) return;
    rt.liftSnapshot = snapshot;
    setSources((p) => p.map((s) => (s.id === id ? { ...s, hasLiftSnapshot: !!snapshot } : s)));
  }, []);

  const setFloater = useCallback((id: string, floater: ImageData | null) => {
    const rt = runtimeRef.current.get(id);
    if (!rt) return;
    rt.floater = floater;
    setSources((p) => p.map((s) => (s.id === id ? { ...s, hasFloater: !!floater } : s)));
  }, []);

  const setLifting = useCallback((id: string, v: boolean) => {
    liftingRef.current.set(id, v);
  }, []);

  const isLifting = useCallback((id: string) => liftingRef.current.get(id) === true, []);

  const clearAll = useCallback(() => {
    runtimeRef.current.clear();
    liftingRef.current.clear();
    setSources([]);
    setActiveIdState(null);
  }, []);

  const active = activeId ? sources.find((s) => s.id === activeId) ?? null : null;

  return {
    sources,
    activeId,
    active,
    addSource,
    removeSource,
    setActive,
    setImage,
    updateMeta,
    pushHistory,
    popHistory,
    dropLastHistory,
    clearHistory,
    getImage,
    getRuntime,
    setLiftSnapshot,
    setFloater,
    setLifting,
    isLifting,
    clearAll,
  };
}
