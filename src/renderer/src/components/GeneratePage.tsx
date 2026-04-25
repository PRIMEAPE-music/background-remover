import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECT_OPTIONS,
  SIZE_OPTIONS,
  getDefaultFolder,
  joinPath,
  pickFilename,
  readSidecar,
  setDefaultFolder,
  sidecarPathFor,
  stem,
  writeSidecar,
  type GeneratedImage,
  type ImageMeta,
  type PromptRow,
  type RowStatus,
  SIDECAR_EXT,
} from '../lib/generate';
import type { GeminiAspect, GeminiSize } from '../../../preload';

export interface GeneratePageProps {
  /** Active project folder, when one is loaded. Used as default save target. */
  projectFolder: string | null;
}

interface ReferenceImage {
  path: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** Object URL for preview thumbnail. Kept stable until ref is replaced. */
  thumbUrl: string;
}

function newRowId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newJobId(): string {
  return `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/png';
}

function formatStatus(s: RowStatus): { text: string; color: string } {
  switch (s.kind) {
    case 'idle':
      return { text: 'idle', color: 'var(--text-dim)' };
    case 'queued':
      return { text: `queued · 0/${s.total}`, color: 'var(--text-dim)' };
    case 'running':
      return { text: `running · ${s.done}/${s.total}`, color: '#f0b400' };
    case 'done':
      return { text: `done · ${s.saved.length}/${s.total}`, color: '#3ec27a' };
    case 'failed':
      return { text: `failed: ${s.reason}`, color: '#e85a5a' };
    case 'cancelled':
      return { text: 'cancelled', color: 'var(--text-dim)' };
  }
}

export function GeneratePage({ projectFolder }: GeneratePageProps) {
  // ---------- API key ----------
  const [apiKey, setApiKey] = useState<string>('');
  const [keyDraft, setKeyDraft] = useState<string>('');
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.geminiLoadKey().then((k) => {
      if (cancelled) return;
      setApiKey(k ?? '');
      setKeyDraft(k ?? '');
      setKeyLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveKey = useCallback(async () => {
    await window.api.geminiSaveKey(keyDraft);
    setApiKey(keyDraft);
  }, [keyDraft]);

  const clearKey = useCallback(async () => {
    await window.api.geminiClearKey();
    setApiKey('');
    setKeyDraft('');
  }, []);

  // ---------- Save folder ----------
  const [defaultFolder, setDefaultFolderState] = useState<string | null>(() => getDefaultFolder());
  const effectiveFolder = projectFolder ?? defaultFolder;

  const pickDefaultFolder = useCallback(async () => {
    const f = await window.api.openFolder();
    if (!f) return;
    setDefaultFolderState(f);
    setDefaultFolder(f);
  }, []);

  // ---------- Reference image ----------
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  useEffect(() => {
    return () => {
      if (referenceImage) URL.revokeObjectURL(referenceImage.thumbUrl);
    };
  }, [referenceImage]);

  const pickReference = useCallback(async () => {
    const paths = await window.api.openImagePaths();
    if (paths.length === 0) return;
    const path = paths[0];
    const bytes = await window.api.readFile(path);
    const filename = path.split(/[\\/]/).pop() ?? path;
    const mime = mimeFromName(filename);
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    const thumbUrl = URL.createObjectURL(blob);
    setReferenceImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.thumbUrl);
      return { path, filename, mime, bytes, thumbUrl };
    });
  }, []);

  const clearReference = useCallback(() => {
    setReferenceImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.thumbUrl);
      return null;
    });
  }, []);

  // ---------- Aspect ratio + size ----------
  const [aspectRatio, setAspectRatio] = useState<GeminiAspect>('1:1');
  const [size, setSize] = useState<GeminiSize>('1K');

  // ---------- Prompt rows ----------
  const [rows, setRows] = useState<PromptRow[]>(() => [
    { id: newRowId(), name: 'image', prompt: '', count: 1 },
  ]);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});

  const addRow = useCallback(() => {
    setRows((rs) => [...rs, { id: newRowId(), name: 'image', prompt: '', count: 1 }]);
  }, []);
  const removeRow = useCallback((id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setStatuses((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  }, []);
  const updateRow = useCallback((id: string, patch: Partial<PromptRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  // ---------- Image list (active folder) ----------
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');

  const refreshImages = useCallback(async () => {
    if (!effectiveFolder) {
      setImages([]);
      return;
    }
    let paths: string[] = [];
    try {
      paths = await window.api.listImages(effectiveFolder);
    } catch {
      setImages([]);
      return;
    }
    paths.sort();
    const next: GeneratedImage[] = [];
    for (const p of paths) {
      const filename = p.split(/[\\/]/).pop() ?? p;
      const meta = await readSidecar(p);
      next.push({ path: p, filename, meta });
    }
    setImages(next);
  }, [effectiveFolder]);

  useEffect(() => {
    refreshImages();
  }, [refreshImages]);

  // Lazy-load thumb urls for visible images. Revoke when image disappears.
  useEffect(() => {
    let cancelled = false;
    const live = new Set(images.map((i) => i.path));
    const loadMissing = async () => {
      for (const img of images) {
        if (cancelled) return;
        if (thumbUrls[img.path]) continue;
        try {
          const bytes = await window.api.readFile(img.path);
          if (cancelled) return;
          const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          setThumbUrls((m) => ({ ...m, [img.path]: url }));
        } catch {
          // ignore — file may have been deleted between list and read.
        }
      }
    };
    loadMissing();
    // Cleanup any urls for paths that have left the list.
    setThumbUrls((m) => {
      const out: Record<string, string> = {};
      for (const [k, url] of Object.entries(m)) {
        if (live.has(k)) out[k] = url;
        else URL.revokeObjectURL(url);
      }
      return out;
    });
    return () => {
      cancelled = true;
    };
  }, [images]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      // Final cleanup on unmount.
      setThumbUrls((m) => {
        for (const url of Object.values(m)) URL.revokeObjectURL(url);
        return {};
      });
    };
  }, []);

  // ---------- Generation ----------
  const cancelRef = useRef<{ flag: boolean; activeJobId: string | null }>({
    flag: false,
    activeJobId: null,
  });
  const [running, setRunning] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  const runBatch = useCallback(async () => {
    if (!apiKey) {
      alert('Set your Gemini API key first.');
      return;
    }
    if (!effectiveFolder) {
      alert('Pick a default save folder, or open a project folder first.');
      return;
    }
    const valid = rows.filter((r) => r.prompt.trim() && r.count > 0 && r.name.trim());
    if (valid.length === 0) {
      alert('Add at least one row with a name, prompt, and count.');
      return;
    }
    // Ensure folder exists.
    try {
      await window.api.mkdir(effectiveFolder);
    } catch {
      // already exists
    }
    // Snapshot existing filenames once; we add to the set as we go to avoid
    // collisions within the same batch.
    let existing: Set<string>;
    try {
      const paths = await window.api.listImages(effectiveFolder);
      existing = new Set(paths.map((p) => (p.split(/[\\/]/).pop() ?? '').toLowerCase()));
    } catch {
      existing = new Set();
    }

    setRunning(true);
    cancelRef.current = { flag: false, activeJobId: null };
    setStatuses((s) => {
      const next = { ...s };
      for (const r of valid) next[r.id] = { kind: 'queued', total: r.count };
      return next;
    });

    // If reference image is set, also persist a copy alongside outputs so the
    // sidecar's `referenceImage` filename resolves later.
    let refImageFilename: string | undefined;
    if (referenceImage) {
      refImageFilename = `_ref_${referenceImage.filename}`;
      try {
        const buf = referenceImage.bytes.buffer.slice(
          referenceImage.bytes.byteOffset,
          referenceImage.bytes.byteOffset + referenceImage.bytes.byteLength,
        ) as ArrayBuffer;
        await window.api.writeFile(joinPath(effectiveFolder, refImageFilename), buf);
        existing.add(refImageFilename.toLowerCase());
      } catch {
        // best-effort; sidecar still records the original filename if write fails
        refImageFilename = referenceImage.filename;
      }
    }

    for (const row of valid) {
      if (cancelRef.current.flag) {
        setStatuses((s) => ({ ...s, [row.id]: { kind: 'cancelled' } }));
        continue;
      }
      const saved: string[] = [];
      try {
        for (let i = 0; i < row.count; i++) {
          if (cancelRef.current.flag) {
            setStatuses((s) => ({ ...s, [row.id]: { kind: 'cancelled', partial: saved } }));
            break;
          }
          const jobId = newJobId();
          cancelRef.current.activeJobId = jobId;
          setStatuses((s) => ({
            ...s,
            [row.id]: { kind: 'running', total: row.count, done: i, jobId },
          }));

          const refArg = referenceImage
            ? {
                mime: referenceImage.mime,
                data: referenceImage.bytes.buffer.slice(
                  referenceImage.bytes.byteOffset,
                  referenceImage.bytes.byteOffset + referenceImage.bytes.byteLength,
                ) as ArrayBuffer,
              }
            : undefined;

          const res = await window.api.geminiGenerate({
            jobId,
            apiKey,
            prompt: row.prompt,
            aspectRatio,
            size,
            referenceImage: refArg,
          });
          cancelRef.current.activeJobId = null;

          if (!res.ok) {
            if (res.kind === 'cancelled') {
              setStatuses((s) => ({ ...s, [row.id]: { kind: 'cancelled', partial: saved } }));
              break;
            }
            setStatuses((s) => ({
              ...s,
              [row.id]: {
                kind: 'failed',
                reason: `${res.kind}: ${res.message.slice(0, 120)}`,
                partial: saved,
              },
            }));
            break;
          }

          const filename = pickFilename(row.name, i, row.count, existing);
          const fullPath = joinPath(effectiveFolder, filename);
          await window.api.writeFile(fullPath, res.imageBytes);
          existing.add(filename.toLowerCase());

          const meta: ImageMeta = {
            prompt: row.prompt,
            model: 'gemini-3-pro-image-preview',
            aspectRatio,
            size,
            referenceImage: refImageFilename,
            createdAt: new Date().toISOString(),
          };
          await writeSidecar(fullPath, meta);
          saved.push(filename);
          setSessionCount((n) => n + 1);
        }
        setStatuses((s) => {
          const cur = s[row.id];
          if (cur && (cur.kind === 'failed' || cur.kind === 'cancelled')) return s;
          return { ...s, [row.id]: { kind: 'done', total: row.count, saved } };
        });
      } catch (e) {
        setStatuses((s) => ({
          ...s,
          [row.id]: { kind: 'failed', reason: (e as Error).message, partial: saved },
        }));
      }
    }

    cancelRef.current = { flag: false, activeJobId: null };
    setRunning(false);
    refreshImages();
  }, [apiKey, effectiveFolder, rows, aspectRatio, size, referenceImage, refreshImages]);

  const cancelBatch = useCallback(async () => {
    cancelRef.current.flag = true;
    const id = cancelRef.current.activeJobId;
    if (id) await window.api.geminiCancel(id);
  }, []);

  // ---------- Image actions ----------
  const startRename = useCallback((img: GeneratedImage) => {
    setRenamingPath(img.path);
    setRenameDraft(stem(img.filename));
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !effectiveFolder) {
      setRenamingPath(null);
      return;
    }
    const draft = renameDraft.trim();
    const img = images.find((i) => i.path === renamingPath);
    if (!img || !draft || draft === stem(img.filename)) {
      setRenamingPath(null);
      return;
    }
    const safe = draft.replace(/[\\/:*?"<>|]+/g, '_');
    const newPng = `${safe}.png`;
    const newPath = joinPath(effectiveFolder, newPng);
    try {
      await window.api.renameFile(img.path, newPath);
      // Move sidecar too if it exists.
      if (img.meta) {
        await window.api.renameFile(sidecarPathFor(img.path), sidecarPathFor(newPath));
      }
    } catch (e) {
      alert(`Rename failed: ${(e as Error).message}`);
    }
    setRenamingPath(null);
    refreshImages();
    if (selectedPath === img.path) setSelectedPath(newPath);
  }, [renamingPath, renameDraft, images, effectiveFolder, refreshImages, selectedPath]);

  const deleteImage = useCallback(
    async (img: GeneratedImage) => {
      if (!confirm(`Delete ${img.filename}? This cannot be undone.`)) return;
      try {
        await window.api.unlinkFile(img.path);
        if (img.meta) {
          try {
            await window.api.unlinkFile(sidecarPathFor(img.path));
          } catch {
            // sidecar may already be gone
          }
        }
      } catch (e) {
        alert(`Delete failed: ${(e as Error).message}`);
        return;
      }
      if (selectedPath === img.path) setSelectedPath(null);
      refreshImages();
    },
    [refreshImages, selectedPath],
  );

  const selectedImage = useMemo(
    () => images.find((i) => i.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  const totalQueued = useMemo(
    () => rows.reduce((n, r) => n + (r.prompt.trim() && r.count > 0 ? r.count : 0), 0),
    [rows],
  );

  return (
    <>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--panel)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
          }}
        >
          <strong>Generate</strong>
          <span style={{ color: 'var(--text-dim)' }}>
            {effectiveFolder ? (
              <>
                Saving to{' '}
                <code style={{ fontSize: 11 }}>
                  {effectiveFolder}
                  {projectFolder ? ' (project)' : ' (default)'}
                </code>
              </>
            ) : (
              'No save folder set — pick one in the sidebar.'
            )}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>
            Session: {sessionCount} image{sessionCount === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gridAutoRows: 'min-content',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {images.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                {effectiveFolder
                  ? 'No images yet. Run a generation to see them here.'
                  : 'Pick a save folder in the sidebar to get started.'}
              </div>
            )}
            {images.map((img) => {
              const url = thumbUrls[img.path];
              const isSelected = selectedPath === img.path;
              return (
                <div
                  key={img.path}
                  onClick={() => setSelectedPath(img.path)}
                  style={{
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 6,
                    background: 'var(--panel)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      background:
                        'linear-gradient(45deg, #3a3a44 25%, transparent 25%), linear-gradient(-45deg, #3a3a44 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a44 75%), linear-gradient(-45deg, transparent 75%, #3a3a44 75%) #2a2a30',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                      borderRadius: 4,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={img.filename}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>…</span>
                    )}
                  </div>
                  {renamingPath === img.path ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        else if (e.key === 'Escape') setRenamingPath(null);
                      }}
                      style={{ fontSize: 11, width: '100%' }}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={img.filename}
                    >
                      {img.filename}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      style={{ flex: 1, fontSize: 11, padding: '2px 4px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(img);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      style={{ flex: 1, fontSize: 11, padding: '2px 4px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteImage(img);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {selectedImage && (
            <aside
              style={{
                width: 260,
                borderLeft: '1px solid var(--border)',
                background: 'var(--panel)',
                padding: 12,
                overflowY: 'auto',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <strong>Metadata</strong>
                <button
                  onClick={() => setSelectedPath(null)}
                  style={{ fontSize: 11, padding: '2px 6px' }}
                >
                  Close
                </button>
              </div>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>File</div>
                <div style={{ wordBreak: 'break-all' }}>{selectedImage.filename}</div>
              </div>
              {selectedImage.meta ? (
                <>
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Prompt</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{selectedImage.meta.prompt}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Model</div>
                    <div>{selectedImage.meta.model}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Aspect / size</div>
                    <div>
                      {selectedImage.meta.aspectRatio}
                      {selectedImage.meta.size ? ` · ${selectedImage.meta.size}` : ''}
                    </div>
                  </div>
                  {selectedImage.meta.referenceImage && (
                    <div>
                      <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Reference</div>
                      <div style={{ wordBreak: 'break-all' }}>
                        {selectedImage.meta.referenceImage}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Created</div>
                    <div>{new Date(selectedImage.meta.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedImage.meta!.prompt);
                    }}
                    style={{ fontSize: 11 }}
                  >
                    Copy prompt
                  </button>
                  <button
                    onClick={() => {
                      const m = selectedImage.meta!;
                      setRows((rs) => [
                        ...rs,
                        {
                          id: newRowId(),
                          name: stem(selectedImage.filename),
                          prompt: m.prompt,
                          count: 1,
                        },
                      ]);
                    }}
                    style={{ fontSize: 11 }}
                  >
                    Re-use prompt as new row
                  </button>
                </>
              ) : (
                <div style={{ color: 'var(--text-dim)' }}>
                  No sidecar metadata ({SIDECAR_EXT}). This image was either added externally or
                  predates the metadata feature.
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
      <aside
        style={{
          width: 320,
          borderLeft: '1px solid var(--border)',
          background: 'var(--panel)',
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <section>
          <label>Gemini API key</label>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={keyLoaded ? 'AIza…' : 'Loading…'}
              disabled={!keyLoaded}
              style={{ flex: 1, fontSize: 11 }}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              style={{ fontSize: 11 }}
              title={showKey ? 'Hide' : 'Show'}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button
              className={keyDraft && keyDraft !== apiKey ? 'primary' : ''}
              onClick={saveKey}
              disabled={!keyLoaded || !keyDraft || keyDraft === apiKey}
              style={{ flex: 1, fontSize: 11 }}
            >
              Save
            </button>
            <button onClick={clearKey} disabled={!apiKey} style={{ flex: 1, fontSize: 11 }}>
              Clear
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
            Stored encrypted via OS keychain. Get a key at aistudio.google.com.
          </div>
        </section>

        <section>
          <label>Save folder</label>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            {projectFolder ? (
              <span style={{ color: '#3ec27a' }}>Using active project folder.</span>
            ) : defaultFolder ? (
              <span
                style={{
                  display: 'block',
                  wordBreak: 'break-all',
                  color: 'var(--text-dim)',
                  fontSize: 10,
                }}
              >
                {defaultFolder}
              </span>
            ) : (
              <span style={{ color: 'var(--text-dim)' }}>None set.</span>
            )}
          </div>
          <button
            onClick={pickDefaultFolder}
            style={{ fontSize: 11, marginTop: 4, width: '100%' }}
          >
            {defaultFolder ? 'Change default folder…' : 'Pick default folder…'}
          </button>
          {!projectFolder && defaultFolder && (
            <button
              onClick={() => {
                setDefaultFolderState(null);
                setDefaultFolder(null);
              }}
              style={{ fontSize: 10, marginTop: 4, width: '100%' }}
            >
              Clear default
            </button>
          )}
        </section>

        <section>
          <label>Reference image (optional)</label>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Applied to every prompt in the batch.
          </div>
          {referenceImage ? (
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: 6,
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            >
              <img
                src={referenceImage.thumbUrl}
                alt="ref"
                style={{ width: 48, height: 48, objectFit: 'contain', background: '#1a1a1f' }}
              />
              <div style={{ flex: 1, fontSize: 11, wordBreak: 'break-all' }}>
                {referenceImage.filename}
              </div>
              <button onClick={clearReference} style={{ fontSize: 11 }}>
                ✕
              </button>
            </div>
          ) : (
            <button onClick={pickReference} style={{ fontSize: 11, marginTop: 4, width: '100%' }}>
              Pick image…
            </button>
          )}
        </section>

        <section>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Aspect</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as GeminiAspect)}
                style={{ width: '100%', fontSize: 11, marginTop: 4 }}
              >
                {ASPECT_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a === 'auto' ? 'auto (prompt-driven)' : a}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Size</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as GeminiSize)}
                style={{ width: '100%', fontSize: 11, marginTop: 4 }}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
            {aspectRatio === 'auto'
              ? 'No aspect sent — model picks. Add ratio cues in your prompt; results will vary.'
              : 'Pixel dims = size × aspect (e.g. 1K 1:1 = 1024², 2K 16:9 ≈ 2048×1152).'}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Prompts</label>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {totalQueued} image{totalQueued === 1 ? '' : 's'} total
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {rows.map((row) => {
              const status = statuses[row.id] ?? { kind: 'idle' as const };
              const fmt = formatStatus(status);
              return (
                <div
                  key={row.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      placeholder="name"
                      style={{ flex: 2, fontSize: 11 }}
                    />
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={row.count}
                      onChange={(e) =>
                        updateRow(row.id, {
                          count: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                        })
                      }
                      style={{ width: 50, fontSize: 11 }}
                      title="How many images to generate from this prompt"
                    />
                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={running}
                      style={{ fontSize: 11 }}
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={row.prompt}
                    onChange={(e) => updateRow(row.id, { prompt: e.target.value })}
                    placeholder="Describe what to generate…"
                    rows={2}
                    style={{ fontSize: 11, resize: 'vertical', minHeight: 36 }}
                  />
                  <div style={{ fontSize: 10, color: fmt.color }}>{fmt.text}</div>
                </div>
              );
            })}
          </div>
          <button
            onClick={addRow}
            disabled={running}
            style={{ fontSize: 11, marginTop: 6, width: '100%' }}
          >
            + Add prompt row
          </button>
        </section>

        <section style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className="primary"
            onClick={runBatch}
            disabled={running || !apiKey || !effectiveFolder || totalQueued === 0}
          >
            {running ? 'Generating…' : `Generate ${totalQueued} image${totalQueued === 1 ? '' : 's'}`}
          </button>
          <button onClick={cancelBatch} disabled={!running}>
            Cancel
          </button>
        </section>
      </aside>
    </>
  );
}
