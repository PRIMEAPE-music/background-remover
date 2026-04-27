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
  /**
   * Push the previous image onto the undo stack. By default this also clears
   * the redo stack — the standard "new edit invalidates redo" rule. Pass
   * `{ keepFuture: true }` from a redo handler so subsequent redos still work.
   */
  pushHistory: (id: string, prev: ImageData, opts?: { keepFuture?: boolean }) => void;
  popHistory: (id: string) => ImageData | null;
  dropLastHistory: (id: string) => void;
  clearHistory: (id: string) => void;
  /** Push the current image onto the redo stack — used by the undo handler. */
  pushFuture: (id: string, image: ImageData) => void;
  /** Pop the next image off the redo stack — used by the redo handler. */
  popFuture: (id: string) => ImageData | null;
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
    // Sweep: if total undo+redo bytes exceed the global ceiling, drop the
    // oldest entry from whichever source currently holds the most memory
    // until under budget. Both stacks count toward the budget — a long redo
    // trail can grow just as large as undo and exhausts the same RAM.
    const runtimes = runtimeRef.current;
    const stackBytes = (rt: SourceRuntime) => {
      let b = 0;
      for (const h of rt.history) b += h.data.byteLength;
      for (const f of rt.future) b += f.data.byteLength;
      return b;
    };
    let bytes = 0;
    for (const rt of runtimes.values()) bytes += stackBytes(rt);
    while (bytes > MAX_UNDO_BYTES_GLOBAL) {
      let victim: SourceRuntime | null = null;
      let victimBytes = 0;
      for (const rt of runtimes.values()) {
        if (rt.history.length === 0 && rt.future.length === 0) continue;
        const rb = stackBytes(rt);
        if (rb > victimBytes) {
          victimBytes = rb;
          victim = rt;
        }
      }
      if (!victim) break;
      // Prefer dropping from the redo trail first (less disruptive than losing
      // an undo step), then from the oldest history entry.
      let dropped: ImageData | undefined;
      if (victim.future.length > 0) dropped = victim.future.shift();
      else if (victim.history.length > 0) dropped = victim.history.shift();
      if (!dropped) break;
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
    (id: string, prev: ImageData, opts?: { keepFuture?: boolean }) => {
      const rt = runtimeRef.current.get(id);
      if (!rt) return;
      rt.history.push(prev);
      while (rt.history.length > MAX_UNDO_COUNT) rt.history.shift();
      // Standard undo/redo: any new edit kills the redo trail. The redo
      // handler bypasses this by passing keepFuture so its own popFuture +
      // pushHistory pair doesn't immolate the rest of the stack.
      if (!opts?.keepFuture) rt.future = [];
      trimGlobalHistory();
      setSources((p) =>
        p.map((s) =>
          s.id === id
            ? { ...s, historyLen: rt.history.length, futureLen: rt.future.length }
            : s,
        ),
      );
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
    rt.future = [];
    setSources((p) =>
      p.map((s) => (s.id === id ? { ...s, historyLen: 0, futureLen: 0 } : s)),
    );
  }, []);

  const pushFuture = useCallback(
    (id: string, image: ImageData) => {
      const rt = runtimeRef.current.get(id);
      if (!rt) return;
      rt.future.push(image);
      while (rt.future.length > MAX_UNDO_COUNT) rt.future.shift();
      trimGlobalHistory();
      setSources((p) => p.map((s) => (s.id === id ? { ...s, futureLen: rt.future.length } : s)));
    },
    [trimGlobalHistory],
  );

  const popFuture = useCallback((id: string): ImageData | null => {
    const rt = runtimeRef.current.get(id);
    if (!rt || rt.future.length === 0) return null;
    const next = rt.future.pop()!;
    setSources((p) => p.map((s) => (s.id === id ? { ...s, futureLen: rt.future.length } : s)));
    return next;
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
    pushFuture,
    popFuture,
    getImage,
    getRuntime,
    setLiftSnapshot,
    setFloater,
    setLifting,
    isLifting,
    clearAll,
  };
}
