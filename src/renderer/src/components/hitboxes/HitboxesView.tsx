import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultRectForFrame,
  emptyFrame,
  resolveBody,
  type HitboxEntity,
  type HitboxFrame,
  type HitboxProject,
  type HitboxRect,
  type HitboxSheet,
} from "../../lib/hitboxes";
import {
  floodFillBounds,
  loadSheetImageData,
  tightBoundsInFrame,
  tightBoundsInRect,
} from "../../lib/hitboxesAutoDetect";

type BoxKind = "body" | "hurt" | "attack";

const BOX_COLORS: Record<BoxKind, { stroke: string; fill: string; label: string }> = {
  body: { stroke: "#5fd66e", fill: "rgba(95, 214, 110, 0.18)", label: "Body" },
  hurt: { stroke: "#5b8aff", fill: "rgba(91, 138, 255, 0.18)", label: "Hurt" },
  attack: { stroke: "#ff5566", fill: "rgba(255, 85, 102, 0.22)", label: "Attack" },
};

export interface HitboxesViewProps {
  project: HitboxProject | null;
  projectFolder: string | null;
  sheetUrls: Map<string, string>;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** Replace the loaded project with the patched one. The view doesn't
   *  do partial patches — it sends back the whole HitboxProject so the
   *  App owns the canonical state and decides when to mark dirty. */
  onProjectChange: (next: HitboxProject) => void;
  onSave: () => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onRescan: () => void;
}

/** Top-level Hitboxes mode. Layout (single character per project):
 *
 *   ┌───────────────────────── Toolbar (project ops) ─────────────────┐
 *   │ Open folder…  Rescan  Reload  Save                              │
 *   ├──────────────┬──────────────────────────────┬───────────────────┤
 *   │ Sheet picker │  Frame strip (top)           │   Inspector       │
 *   │ + frame nums │  ──────────────────────────  │  - selected box   │
 *   │              │  Canvas with draggable boxes │  - x / y / w / h  │
 *   │              │                              │  - kind / damage  │
 *   └──────────────┴──────────────────────────────┴───────────────────┘
 */
export function HitboxesView({
  project,
  projectFolder,
  sheetUrls,
  saveStatus,
  onProjectChange,
  onSave,
  onReload,
  onOpenFolder,
  onRescan,
}: HitboxesViewProps) {
  if (!project || !projectFolder) {
    return <EmptyState onOpenFolder={onOpenFolder} />;
  }
  // Single-entity per project for v1. The schema supports multiple but
  // the UI exposes only the first; switch to a dropdown later if needed.
  const entity = project.entities[0];
  if (!entity) {
    return (
      <EmptyState
        onOpenFolder={onOpenFolder}
        message="Manifest has no entities yet — open a folder to scan for sheets."
      />
    );
  }
  const sheets = project.sheets[entity.id] ?? [];
  if (sheets.length === 0) {
    return (
      <EmptyState
        onOpenFolder={onOpenFolder}
        message={`No sprite sheets found for "${entity.id}". Drop sheets matching *_<fps>fps.png into the project folder and click Re-scan.`}
        showRescan
        onRescan={onRescan}
      />
    );
  }

  return (
    <HitboxesEditor
      project={project}
      projectFolder={projectFolder}
      entity={entity}
      sheets={sheets}
      sheetUrls={sheetUrls}
      saveStatus={saveStatus}
      onProjectChange={onProjectChange}
      onSave={onSave}
      onReload={onReload}
      onOpenFolder={onOpenFolder}
      onRescan={onRescan}
    />
  );
}

// ─── Editor ─────────────────────────────────────────────────────────

interface SelectedBox {
  kind: BoxKind;
  /** Index into the array for hurt / attack; ignored for body (single). */
  index: number;
}

function HitboxesEditor({
  project,
  projectFolder,
  entity,
  sheets,
  sheetUrls,
  saveStatus,
  onProjectChange,
  onSave,
  onReload,
  onOpenFolder,
  onRescan,
}: {
  project: HitboxProject;
  projectFolder: string;
  entity: HitboxEntity;
  sheets: HitboxSheet[];
  sheetUrls: Map<string, string>;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onProjectChange: (next: HitboxProject) => void;
  onSave: () => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onRescan: () => void;
}) {
  const [selectedSheetFilename, setSelectedSheet] = useState<string>(
    sheets[0]?.filename ?? "",
  );
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [drawKind, setDrawKind] = useState<BoxKind>("hurt");
  const [selected, setSelected] = useState<SelectedBox | null>(null);
  /** Sticky toggle: when ON, body edits (drawing / snapping / auto-fit)
   *  stamp into every frame's per-frame body override instead of just
   *  the current frame. Useful when bodies vary slightly per frame and
   *  the user wants the auto-fit to populate every frame at once. */
  const [applyToAllFrames, setApplyToAllFrames] = useState(false);

  const sheet = useMemo(
    () => sheets.find((s) => s.filename === selectedSheetFilename) ?? sheets[0],
    [sheets, selectedSheetFilename],
  );
  // Reset selected frame if it's out of range for the new sheet.
  useEffect(() => {
    if (!sheet) return;
    if (selectedFrame >= sheet.frameCount) setSelectedFrame(0);
  }, [sheet, selectedFrame]);

  const frame: HitboxFrame =
    sheet?.framesByIndex[selectedFrame] ?? emptyFrame();

  // ─── Mutators (rebuild project, call onProjectChange) ─────────────
  const updateFrame = (mutator: (f: HitboxFrame) => HitboxFrame) => {
    if (!sheet) return;
    const next = mutator({
      body: frame.body ? { ...frame.body } : undefined,
      hurt: frame.hurt.map((r) => ({ ...r })),
      attack: frame.attack.map((r) => ({ ...r })),
    });
    const newSheets = sheets.map((s) =>
      s.filename === sheet.filename
        ? {
            ...s,
            framesByIndex: { ...s.framesByIndex, [selectedFrame]: next },
          }
        : s,
    );
    onProjectChange({
      ...project,
      sheets: { ...project.sheets, [entity.id]: newSheets },
    });
  };

  const updateEntity = (mutator: (e: HitboxEntity) => HitboxEntity) => {
    const next = mutator({ ...entity });
    onProjectChange({
      ...project,
      entities: project.entities.map((e) => (e.id === entity.id ? next : e)),
    });
  };

  const updateSelectedBox = (patch: Partial<HitboxRect>) => {
    if (!selected || !sheet) return;
    if (selected.kind === "body") {
      if (frame.body) {
        updateFrame((f) => ({ ...f, body: { ...f.body!, ...patch } }));
      } else {
        // Selected body refers to defaultBody on entity.
        updateEntity((e) => ({
          ...e,
          defaultBody: { ...(e.defaultBody as HitboxRect), ...patch },
        }));
      }
    } else if (selected.kind === "hurt") {
      updateFrame((f) => ({
        ...f,
        hurt: f.hurt.map((r, i) =>
          i === selected.index ? { ...r, ...patch } : r,
        ),
      }));
    } else {
      updateFrame((f) => ({
        ...f,
        attack: f.attack.map((r, i) =>
          i === selected.index ? { ...r, ...patch } : r,
        ),
      }));
    }
  };

  const removeSelected = () => {
    if (!selected || !sheet) return;
    if (selected.kind === "body") {
      if (frame.body) {
        updateFrame((f) => ({ ...f, body: undefined }));
      } else {
        updateEntity((e) => ({ ...e, defaultBody: null }));
      }
    } else if (selected.kind === "hurt") {
      updateFrame((f) => ({
        ...f,
        hurt: f.hurt.filter((_, i) => i !== selected.index),
      }));
    } else {
      updateFrame((f) => ({
        ...f,
        attack: f.attack.filter((_, i) => i !== selected.index),
      }));
    }
    setSelected(null);
  };

  const addBoxAt = (kind: BoxKind, rect: HitboxRect) => {
    if (kind === "body") {
      if (applyToAllFrames && sheet) {
        // Per-frame body override stamped into every frame. Used
        // when the silhouette varies frame to frame and the user
        // wants to start from one drawn box across all of them.
        const newFrames: HitboxSheet["framesByIndex"] = {};
        for (let i = 0; i < sheet.frameCount; i++) {
          const prev = sheet.framesByIndex[i] ?? emptyFrame();
          newFrames[i] = { ...prev, body: { ...rect } };
        }
        const newSheets = sheets.map((s) =>
          s.filename === sheet.filename ? { ...s, framesByIndex: newFrames } : s,
        );
        onProjectChange({
          ...project,
          sheets: { ...project.sheets, [entity.id]: newSheets },
        });
      } else {
        // Set default body on the entity (frame-level body override is
        // a separate workflow — most rigs use a single defaultBody).
        updateEntity((e) => ({ ...e, defaultBody: rect }));
      }
      setSelected({ kind: "body", index: 0 });
    } else if (kind === "hurt") {
      updateFrame((f) => ({ ...f, hurt: [...f.hurt, rect] }));
      setSelected({ kind: "hurt", index: frame.hurt.length });
    } else {
      const withDefaults: HitboxRect = { ...rect, damage: 1 };
      updateFrame((f) => ({ ...f, attack: [...f.attack, withDefaults] }));
      setSelected({ kind: "attack", index: frame.attack.length });
    }
  };

  // ─── Auto-detect operations ────────────────────────────────────
  //
  // All three share the same alpha-sampling helper module. Errors
  // (sheet unavailable, frame fully transparent) bubble up as null /
  // no-op rather than throwing — keeps the editor responsive even if
  // a sheet failed to load.

  const sheetUrl = sheet ? sheetUrls.get(sheet.filename) ?? null : null;

  /** (A) Snap-to-content: shrink the currently selected box to the
   *  tight bounding rect of opaque pixels inside it. No-op when the
   *  selected box is over fully transparent area. */
  const snapSelectedToContent = async () => {
    if (!sheet || !sheetUrl || !selected) return;
    let box: HitboxRect | null = null;
    if (selected.kind === "body") {
      box = frame.body ?? entity.defaultBody;
    } else if (selected.kind === "hurt") {
      box = frame.hurt[selected.index] ?? null;
    } else {
      box = frame.attack[selected.index] ?? null;
    }
    if (!box) return;
    try {
      const sheetData = await loadSheetImageData(sheetUrl);
      const snapped = tightBoundsInRect(
        sheetData,
        selectedFrame,
        sheet.frameWidth,
        sheet.frameHeight,
        box,
      );
      if (!snapped) return;
      updateSelectedBox(snapped);
    } catch (e) {
      console.warn("[hitboxes] snap-to-content failed:", e);
    }
  };

  /** (B) Auto-fit default body: scan the CURRENT frame for the tight
   *  rect of opaque pixels and use it as the entity's defaultBody.
   *  Replaces the manual draw step for the most common authoring
   *  task. */
  const autoFitDefaultBody = async () => {
    if (!sheet || !sheetUrl) return;
    try {
      const sheetData = await loadSheetImageData(sheetUrl);
      const rect = tightBoundsInFrame(
        sheetData,
        selectedFrame,
        sheet.frameWidth,
        sheet.frameHeight,
      );
      if (!rect) {
        alert(
          "Auto-fit: this frame appears fully transparent. Pick a frame with visible content first.",
        );
        return;
      }
      updateEntity((e) => ({ ...e, defaultBody: { ...rect, tag: "torso" } }));
      setSelected({ kind: "body", index: 0 });
    } catch (e) {
      console.warn("[hitboxes] auto-fit default body failed:", e);
    }
  };

  /** (B+) Auto-fit body per frame: scan EVERY frame in the current
   *  sheet and stamp the tight bounds as a per-frame body override.
   *  Used when the silhouette varies meaningfully between frames
   *  (jump squash, crouch, etc.). */
  const autoFitBodyEveryFrame = async () => {
    if (!sheet || !sheetUrl) return;
    try {
      const sheetData = await loadSheetImageData(sheetUrl);
      const newFrames: HitboxSheet["framesByIndex"] = {
        ...sheet.framesByIndex,
      };
      let filled = 0;
      for (let i = 0; i < sheet.frameCount; i++) {
        const rect = tightBoundsInFrame(
          sheetData,
          i,
          sheet.frameWidth,
          sheet.frameHeight,
        );
        if (!rect) continue;
        const prev = newFrames[i] ?? emptyFrame();
        newFrames[i] = {
          ...prev,
          body: { ...rect, tag: prev.body?.tag ?? "auto-body" },
        };
        filled += 1;
      }
      if (filled === 0) {
        alert("Auto-fit per-frame: every frame appears transparent.");
        return;
      }
      const newSheets = sheets.map((s) =>
        s.filename === sheet.filename ? { ...s, framesByIndex: newFrames } : s,
      );
      onProjectChange({
        ...project,
        sheets: { ...project.sheets, [entity.id]: newSheets },
      });
    } catch (e) {
      console.warn("[hitboxes] auto-fit every frame failed:", e);
    }
  };

  /** (F) Copy current body to all frames: stamps the effective body
   *  (per-frame override or defaultBody) into every frame's body
   *  override, replacing existing per-frame body overrides. */
  const copyBodyToAllFrames = () => {
    if (!sheet) return;
    const body = frame.body ?? entity.defaultBody;
    if (!body) {
      alert(
        "Copy body to all frames: no body to copy. Author a defaultBody or a per-frame body first.",
      );
      return;
    }
    const newFrames: HitboxSheet["framesByIndex"] = {};
    for (let i = 0; i < sheet.frameCount; i++) {
      const prev = sheet.framesByIndex[i] ?? emptyFrame();
      newFrames[i] = { ...prev, body: { ...body } };
    }
    const newSheets = sheets.map((s) =>
      s.filename === sheet.filename ? { ...s, framesByIndex: newFrames } : s,
    );
    onProjectChange({
      ...project,
      sheets: { ...project.sheets, [entity.id]: newSheets },
    });
  };

  /** (C) Alt-click flood-fill region pick. The Canvas dispatches the
   *  source-pixel position; this function flood-fills the contiguous
   *  opaque blob under that point and adds a new box of the current
   *  draw kind with the blob's bounding rect. */
  const pickRegionAt = async (sourceX: number, sourceY: number) => {
    if (!sheet || !sheetUrl) return;
    try {
      const sheetData = await loadSheetImageData(sheetUrl);
      const rect = floodFillBounds(
        sheetData,
        selectedFrame,
        sheet.frameWidth,
        sheet.frameHeight,
        sourceX,
        sourceY,
      );
      if (!rect) return;
      // Apply-to-all-frames support for body: stamp into every frame.
      if (drawKind === "body" && applyToAllFrames) {
        const newFrames: HitboxSheet["framesByIndex"] = {};
        for (let i = 0; i < sheet.frameCount; i++) {
          const prev = sheet.framesByIndex[i] ?? emptyFrame();
          newFrames[i] = { ...prev, body: { ...rect, tag: "auto-body" } };
        }
        const newSheets = sheets.map((s) =>
          s.filename === sheet.filename ? { ...s, framesByIndex: newFrames } : s,
        );
        onProjectChange({
          ...project,
          sheets: { ...project.sheets, [entity.id]: newSheets },
        });
        setSelected({ kind: "body", index: 0 });
      } else {
        addBoxAt(drawKind, rect);
      }
    } catch (e) {
      console.warn("[hitboxes] region pick failed:", e);
    }
  };

  // Keyboard shortcut: Delete to remove selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Toolbar
        projectFolder={projectFolder}
        entityId={entity.id}
        sheetCount={sheets.length}
        saveStatus={saveStatus}
        onSave={onSave}
        onReload={onReload}
        onOpenFolder={onOpenFolder}
        onRescan={onRescan}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <SheetSidebar
          sheets={sheets}
          selectedFilename={sheet?.filename ?? ""}
          onSelect={(fn) => {
            setSelectedSheet(fn);
            setSelectedFrame(0);
            setSelected(null);
          }}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {sheet && (
            <FrameStrip
              sheet={sheet}
              sheetUrl={sheetUrls.get(sheet.filename) ?? null}
              selectedFrame={selectedFrame}
              onSelectFrame={(f) => {
                setSelectedFrame(f);
                setSelected(null);
              }}
            />
          )}
          {sheet && (
            <Canvas
              sheet={sheet}
              sheetUrl={sheetUrls.get(sheet.filename) ?? null}
              frameIndex={selectedFrame}
              entity={entity}
              frame={frame}
              drawKind={drawKind}
              setDrawKind={setDrawKind}
              selected={selected}
              setSelected={setSelected}
              onAddBox={addBoxAt}
              onUpdateSelected={updateSelectedBox}
              onPickRegion={pickRegionAt}
              applyToAllFrames={applyToAllFrames}
              onToggleApplyToAllFrames={() => setApplyToAllFrames((v) => !v)}
            />
          )}
        </div>
        <Inspector
          entity={entity}
          frame={frame}
          selected={selected}
          onUpdateSelected={updateSelectedBox}
          onRemoveSelected={removeSelected}
          onSetDefaultBody={(rect) => {
            updateEntity((e) => ({ ...e, defaultBody: rect }));
          }}
          onUpdateNotes={(notes) => updateEntity((e) => ({ ...e, notes }))}
          onSnapSelectedToContent={snapSelectedToContent}
          onAutoFitDefaultBody={autoFitDefaultBody}
          onAutoFitBodyEveryFrame={autoFitBodyEveryFrame}
          onCopyBodyToAllFrames={copyBodyToAllFrames}
        />
      </div>
    </div>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────

function Toolbar({
  projectFolder,
  entityId,
  sheetCount,
  saveStatus,
  onSave,
  onReload,
  onOpenFolder,
  onRescan,
}: {
  projectFolder: string;
  entityId: string;
  sheetCount: number;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onSave: () => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onRescan: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}
      >
        Hitboxes · {entityId} · {sheetCount} sheet{sheetCount === 1 ? "" : "s"}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onOpenFolder} style={{ fontSize: 11 }}>
        Open folder…
      </button>
      <button onClick={onRescan} style={{ fontSize: 11 }} title="Re-scan the project folder for new sprite sheets">
        Re-scan
      </button>
      <button onClick={onReload} style={{ fontSize: 11 }} title="Re-read hitboxes.json from disk">
        Reload
      </button>
      <button
        onClick={onSave}
        className="primary"
        style={{ fontSize: 11 }}
        disabled={saveStatus === "saving"}
      >
        {saveStatus === "saving"
          ? "Saving…"
          : saveStatus === "saved"
            ? "Saved ✓"
            : saveStatus === "error"
              ? "Save (errored)"
              : "Save"}
      </button>
      <div
        style={{
          flexBasis: "100%",
          fontSize: 10,
          color: "var(--text-dim)",
          fontFamily: "monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={projectFolder}
      >
        {projectFolder}
      </div>
    </div>
  );
}

// ─── Sheet sidebar ──────────────────────────────────────────────────

function SheetSidebar({
  sheets,
  selectedFilename,
  onSelect,
}: {
  sheets: HitboxSheet[];
  selectedFilename: string;
  onSelect: (filename: string) => void;
}) {
  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--panel)",
        padding: 8,
        overflowY: "auto",
        fontSize: 11,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          margin: "0 0 6px",
        }}
      >
        Sheets
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sheets.map((s) => {
          const authoredCount = Object.keys(s.framesByIndex).length;
          const sel = s.filename === selectedFilename;
          return (
            <button
              key={s.filename}
              onClick={() => onSelect(s.filename)}
              style={{
                textAlign: "left",
                fontSize: 11,
                background: sel ? "var(--accent-bg, #2a3a4a)" : "transparent",
                border: sel
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
                borderRadius: 3,
                padding: "4px 6px",
                fontFamily: "monospace",
                cursor: "pointer",
                color: "var(--text)",
              }}
              title={`${s.frameWidth}×${s.frameHeight} · ${s.frameCount} frames · ${authoredCount} authored`}
            >
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.filename.replace(/^.*[/\\]/, "")}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--text-dim)",
                }}
              >
                {s.frameCount}f · {authoredCount} authored
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── Frame strip ────────────────────────────────────────────────────

function FrameStrip({
  sheet,
  sheetUrl,
  selectedFrame,
  onSelectFrame,
}: {
  sheet: HitboxSheet;
  sheetUrl: string | null;
  selectedFrame: number;
  onSelectFrame: (f: number) => void;
}) {
  const thumbH = 48;
  const thumbW =
    sheet.frameWidth > 0
      ? Math.round((thumbH * sheet.frameWidth) / sheet.frameHeight)
      : thumbH;
  const totalW = sheet.frameWidth * sheet.frameCount;
  const scale = thumbH / sheet.frameHeight;

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "#1a1a1f",
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {Array.from({ length: sheet.frameCount }, (_, i) => {
        const sel = i === selectedFrame;
        const authored = !!sheet.framesByIndex[i];
        const style: React.CSSProperties = sheetUrl
          ? {
              width: thumbW,
              height: thumbH,
              backgroundImage: `url(${sheetUrl})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${totalW * scale}px ${thumbH}px`,
              backgroundPosition: `-${i * sheet.frameWidth * scale}px 0`,
              imageRendering: "pixelated",
              cursor: "pointer",
              border: sel
                ? "2px solid var(--accent)"
                : authored
                  ? "1px solid #5b8aff"
                  : "1px solid var(--border)",
              borderRadius: 2,
              flexShrink: 0,
              position: "relative",
            }
          : {
              width: thumbW,
              height: thumbH,
              background:
                "repeating-conic-gradient(#2a2a30 0% 25%, #1e1e22 0% 50%) 50% / 12px 12px",
              cursor: "pointer",
              border: sel
                ? "2px solid var(--accent)"
                : "1px solid var(--border)",
              borderRadius: 2,
              flexShrink: 0,
            };
        return (
          <div
            key={i}
            onClick={() => onSelectFrame(i)}
            style={style}
            title={`Frame ${i}${authored ? " (authored)" : ""}`}
          >
            <div
              style={{
                position: "absolute",
                top: 1,
                left: 2,
                fontSize: 9,
                color: "#fff",
                textShadow: "0 0 2px black",
                fontFamily: "monospace",
                pointerEvents: "none",
              }}
            >
              {i}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Canvas ─────────────────────────────────────────────────────────

interface DragState {
  /** What we're doing with the pointer. */
  mode: "draw" | "move" | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br";
  /** For draw: the kind we're creating. For move/resize: the selected box. */
  kind: BoxKind;
  /** Source-pixel coords where the drag started. */
  startX: number;
  startY: number;
  /** The original rect at drag start (for move/resize). */
  origRect: HitboxRect;
}

function Canvas({
  sheet,
  sheetUrl,
  frameIndex,
  entity,
  frame,
  drawKind,
  setDrawKind,
  selected,
  setSelected,
  onAddBox,
  onUpdateSelected,
  onPickRegion,
  applyToAllFrames,
  onToggleApplyToAllFrames,
}: {
  sheet: HitboxSheet;
  sheetUrl: string | null;
  frameIndex: number;
  entity: HitboxEntity;
  frame: HitboxFrame;
  drawKind: BoxKind;
  setDrawKind: (k: BoxKind) => void;
  selected: SelectedBox | null;
  setSelected: (s: SelectedBox | null) => void;
  onAddBox: (kind: BoxKind, rect: HitboxRect) => void;
  onUpdateSelected: (patch: Partial<HitboxRect>) => void;
  /** Alt-click flood-fill region picker. Source-pixel coords. */
  onPickRegion: (sx: number, sy: number) => void;
  applyToAllFrames: boolean;
  onToggleApplyToAllFrames: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Auto-fit zoom on sheet change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || sheet.frameWidth === 0) return;
    const avail = Math.min(el.clientWidth, el.clientHeight);
    const z = Math.max(0.25, Math.min(2.0, (avail - 32) / sheet.frameHeight));
    setZoom(z);
  }, [sheet.frameWidth, sheet.frameHeight, sheet.filename]);

  const dispW = sheet.frameWidth * zoom;
  const dispH = sheet.frameHeight * zoom;
  const totalW = sheet.frameWidth * sheet.frameCount * zoom;

  const effectiveBody = resolveBody(entity, frame);

  const clientToSource = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / zoom;
    const y = (clientY - rect.top) / zoom;
    return {
      x: Math.max(0, Math.min(sheet.frameWidth, Math.round(x))),
      y: Math.max(0, Math.min(sheet.frameHeight, Math.round(y))),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const src = clientToSource(e.clientX, e.clientY);
    // Alt-click: flood-fill the contiguous opaque region under the
    // cursor and create a box of the current draw kind around it.
    // Skips the drag-to-draw flow entirely.
    if (e.altKey) {
      e.preventDefault();
      onPickRegion(src.x, src.y);
      return;
    }
    // Begin draw of a new box of `drawKind` at click point.
    dragRef.current = {
      mode: "draw",
      kind: drawKind,
      startX: src.x,
      startY: src.y,
      origRect: { x: src.x, y: src.y, w: 0, h: 0 },
    };
    (containerRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const src = clientToSource(e.clientX, e.clientY);
    if (drag.mode === "draw") {
      const x = Math.min(drag.startX, src.x);
      const y = Math.min(drag.startY, src.y);
      const w = Math.abs(src.x - drag.startX);
      const h = Math.abs(src.y - drag.startY);
      // Live preview by mutating the dragRef; final commit on pointerup.
      drag.origRect = { x, y, w, h };
      // Force re-render via a tiny zoom no-op? Use state instead:
      setDragPreview({ x, y, w, h, kind: drag.kind });
    } else if (drag.mode === "move") {
      const dx = src.x - drag.startX;
      const dy = src.y - drag.startY;
      onUpdateSelected({
        x: Math.max(0, Math.min(sheet.frameWidth - drag.origRect.w, drag.origRect.x + dx)),
        y: Math.max(0, Math.min(sheet.frameHeight - drag.origRect.h, drag.origRect.y + dy)),
      });
    } else {
      const dx = src.x - drag.startX;
      const dy = src.y - drag.startY;
      const r = { ...drag.origRect };
      const minSize = 4;
      if (drag.mode === "resize-br") {
        r.w = Math.max(minSize, drag.origRect.w + dx);
        r.h = Math.max(minSize, drag.origRect.h + dy);
      } else if (drag.mode === "resize-bl") {
        const newX = Math.min(drag.origRect.x + drag.origRect.w - minSize, drag.origRect.x + dx);
        r.x = Math.max(0, newX);
        r.w = drag.origRect.w + (drag.origRect.x - r.x);
        r.h = Math.max(minSize, drag.origRect.h + dy);
      } else if (drag.mode === "resize-tr") {
        const newY = Math.min(drag.origRect.y + drag.origRect.h - minSize, drag.origRect.y + dy);
        r.y = Math.max(0, newY);
        r.h = drag.origRect.h + (drag.origRect.y - r.y);
        r.w = Math.max(minSize, drag.origRect.w + dx);
      } else if (drag.mode === "resize-tl") {
        const newX = Math.min(drag.origRect.x + drag.origRect.w - minSize, drag.origRect.x + dx);
        const newY = Math.min(drag.origRect.y + drag.origRect.h - minSize, drag.origRect.y + dy);
        r.x = Math.max(0, newX);
        r.y = Math.max(0, newY);
        r.w = drag.origRect.w + (drag.origRect.x - r.x);
        r.h = drag.origRect.h + (drag.origRect.y - r.y);
      }
      onUpdateSelected({
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.w),
        h: Math.round(r.h),
      });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag && drag.mode === "draw") {
      if (drag.origRect.w >= 4 && drag.origRect.h >= 4) {
        onAddBox(drag.kind, drag.origRect);
      }
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  const beginBoxDrag = (
    e: React.PointerEvent,
    box: HitboxRect,
    kind: BoxKind,
    index: number,
    mode: DragState["mode"],
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected({ kind, index });
    const src = clientToSource(e.clientX, e.clientY);
    dragRef.current = {
      mode,
      kind,
      startX: src.x,
      startY: src.y,
      origRect: { ...box },
    };
    (containerRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const [dragPreview, setDragPreview] = useState<
    (HitboxRect & { kind: BoxKind }) | null
  >(null);

  const renderBox = (box: HitboxRect, kind: BoxKind, index: number) => {
    const sel =
      selected && selected.kind === kind && selected.index === index;
    const colors = BOX_COLORS[kind];
    return (
      <div
        key={`${kind}-${index}`}
        onPointerDown={(e) => beginBoxDrag(e, box, kind, index, "move")}
        style={{
          position: "absolute",
          left: box.x * zoom,
          top: box.y * zoom,
          width: box.w * zoom,
          height: box.h * zoom,
          border: `1.5px solid ${colors.stroke}`,
          background: colors.fill,
          boxShadow: sel ? `0 0 0 2px #ffe680 inset` : "none",
          cursor: "move",
          fontSize: 9,
          color: colors.stroke,
          fontFamily: "monospace",
          pointerEvents: "auto",
          padding: "1px 3px",
          boxSizing: "border-box",
        }}
        title={`${colors.label}${box.tag ? ` · ${box.tag}` : ""}`}
      >
        {box.tag ?? colors.label}
        {sel && (
          <>
            <ResizeHandle
              pos="tl"
              onPointerDown={(e) =>
                beginBoxDrag(e, box, kind, index, "resize-tl")
              }
            />
            <ResizeHandle
              pos="tr"
              onPointerDown={(e) =>
                beginBoxDrag(e, box, kind, index, "resize-tr")
              }
            />
            <ResizeHandle
              pos="bl"
              onPointerDown={(e) =>
                beginBoxDrag(e, box, kind, index, "resize-bl")
              }
            />
            <ResizeHandle
              pos="br"
              onPointerDown={(e) =>
                beginBoxDrag(e, box, kind, index, "resize-br")
              }
            />
          </>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        background: "#0e0e12",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Frame {frameIndex} / {sheet.frameCount - 1} · {sheet.frameWidth}×{sheet.frameHeight}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Draw:</span>
        {(["body", "hurt", "attack"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setDrawKind(k)}
            style={{
              fontSize: 11,
              padding: "3px 8px",
              cursor: "pointer",
              border: `1px solid ${BOX_COLORS[k].stroke}`,
              background:
                drawKind === k ? BOX_COLORS[k].stroke + "44" : "transparent",
              color: BOX_COLORS[k].stroke,
              borderRadius: 3,
            }}
          >
            {BOX_COLORS[k].label}
          </button>
        ))}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            marginLeft: 8,
            cursor: "pointer",
            color: applyToAllFrames ? "#ffe680" : "var(--text-dim)",
          }}
          title="When ON, drawing a body box (or alt-click body region pick) stamps it into every frame of this sheet as a per-frame body override. Off = body goes to entity defaultBody."
        >
          <input
            type="checkbox"
            checked={applyToAllFrames}
            onChange={onToggleApplyToAllFrames}
          />
          Apply body to all frames
        </label>
        <span style={{ fontSize: 11, marginLeft: 8 }}>Zoom</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: 90 }}
        />
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-dim)" }}>
          {zoom.toFixed(2)}×
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: "relative",
            width: dispW,
            height: dispH,
            background:
              "repeating-conic-gradient(#1f1f24 0% 25%, #14141a 0% 50%) 50% / 16px 16px",
            border: "1px solid var(--border)",
            cursor: dragRef.current ? "crosshair" : "crosshair",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {sheetUrl && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: dispW,
                height: dispH,
                backgroundImage: `url(${sheetUrl})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${totalW}px ${dispH}px`,
                backgroundPosition: `-${frameIndex * sheet.frameWidth * zoom}px 0`,
                imageRendering: "pixelated",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Effective body: per-frame override OR defaultBody (rendered greyed). */}
          {effectiveBody &&
            renderBox(
              effectiveBody,
              "body",
              0,
            )}
          {frame.hurt.map((b, i) => renderBox(b, "hurt", i))}
          {frame.attack.map((b, i) => renderBox(b, "attack", i))}
          {/* Live draw preview. */}
          {dragPreview && dragPreview.w > 0 && dragPreview.h > 0 && (
            <div
              style={{
                position: "absolute",
                left: dragPreview.x * zoom,
                top: dragPreview.y * zoom,
                width: dragPreview.w * zoom,
                height: dragPreview.h * zoom,
                border: `1.5px dashed ${BOX_COLORS[dragPreview.kind].stroke}`,
                background: BOX_COLORS[dragPreview.kind].fill,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({
  pos,
  onPointerDown,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const styles: React.CSSProperties = {
    position: "absolute",
    width: 8,
    height: 8,
    background: "#ffe680",
    border: "1px solid #000",
    borderRadius: 1,
    cursor:
      pos === "tl" || pos === "br" ? "nwse-resize" : "nesw-resize",
    pointerEvents: "auto",
  };
  if (pos === "tl") {
    styles.left = -4;
    styles.top = -4;
  } else if (pos === "tr") {
    styles.right = -4;
    styles.top = -4;
  } else if (pos === "bl") {
    styles.left = -4;
    styles.bottom = -4;
  } else {
    styles.right = -4;
    styles.bottom = -4;
  }
  return <div style={styles} onPointerDown={onPointerDown} />;
}

// ─── Inspector ──────────────────────────────────────────────────────

function Inspector({
  entity,
  frame,
  selected,
  onUpdateSelected,
  onRemoveSelected,
  onSetDefaultBody,
  onUpdateNotes,
  onSnapSelectedToContent,
  onAutoFitDefaultBody,
  onAutoFitBodyEveryFrame,
  onCopyBodyToAllFrames,
}: {
  entity: HitboxEntity;
  frame: HitboxFrame;
  selected: SelectedBox | null;
  onUpdateSelected: (patch: Partial<HitboxRect>) => void;
  onRemoveSelected: () => void;
  onSetDefaultBody: (rect: HitboxRect) => void;
  onUpdateNotes: (notes: string) => void;
  /** Snap-to-content for the selected box (A). */
  onSnapSelectedToContent: () => void;
  /** Auto-fit defaultBody from the current frame (B). */
  onAutoFitDefaultBody: () => void;
  /** Auto-fit a per-frame body override on every frame in the sheet (B+). */
  onAutoFitBodyEveryFrame: () => void;
  /** Stamp the effective body into every frame's body override (F). */
  onCopyBodyToAllFrames: () => void;
}) {
  let selectedBox: HitboxRect | null = null;
  if (selected) {
    if (selected.kind === "body") {
      selectedBox = frame.body ?? entity.defaultBody;
    } else if (selected.kind === "hurt") {
      selectedBox = frame.hurt[selected.index] ?? null;
    } else {
      selectedBox = frame.attack[selected.index] ?? null;
    }
  }

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--panel)",
        padding: 12,
        overflowY: "auto",
        fontSize: 12,
      }}
    >
      <section style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 4,
          }}
        >
          Entity · {entity.id}
        </div>
        <div style={{ fontSize: 11, marginBottom: 6 }}>Default body</div>
        {entity.defaultBody ? (
          <RectFields
            box={entity.defaultBody}
            onChange={(patch) =>
              onSetDefaultBody({ ...entity.defaultBody!, ...patch })
            }
          />
        ) : (
          <button
            onClick={() => onSetDefaultBody(defaultRectForFrame(64, 64))}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            Add default body
          </button>
        )}
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 }}>
          Used for collision + as the implicit hurt box for any frame
          without authored hurt boxes. Replace the hardcoded BODY_*
          constants in AnimationConfig.ts.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          <button
            onClick={onAutoFitDefaultBody}
            style={btn("primary")}
            title="Alpha-scan the CURRENT frame for opaque pixels and set defaultBody to that tight rect."
          >
            Auto-fit body (this frame)
          </button>
          <button
            onClick={onAutoFitBodyEveryFrame}
            style={btn()}
            title="Alpha-scan every frame in this sheet and stamp a tight per-frame body override on each. Use when the silhouette varies meaningfully (jump squash, crouch, etc.)."
          >
            Auto-fit body (per-frame)
          </button>
          <button
            onClick={onCopyBodyToAllFrames}
            style={btn()}
            title="Copy the CURRENT effective body (per-frame override or defaultBody) into every frame's body override. Use after hand-tuning one frame to propagate it across the sheet."
          >
            Copy body to all frames
          </button>
        </div>
      </section>

      {selected && selectedBox ? (
        <section
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: BOX_COLORS[selected.kind].stroke,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 6,
            }}
          >
            Selected · {BOX_COLORS[selected.kind].label}
            {selected.kind !== "body" && ` #${selected.index}`}
          </div>
          <RectFields box={selectedBox} onChange={onUpdateSelected} />
          <label
            style={{
              fontSize: 11,
              display: "block",
              marginTop: 6,
            }}
          >
            Tag
          </label>
          <input
            type="text"
            value={selectedBox.tag ?? ""}
            onChange={(e) =>
              onUpdateSelected({ tag: e.target.value || undefined })
            }
            placeholder="e.g. head, weapon-tip"
            style={{ fontSize: 11, fontFamily: "monospace", width: "100%" }}
          />

          {selected.kind === "attack" && (
            <>
              <label style={{ fontSize: 11, display: "block", marginTop: 6 }}>
                Damage
              </label>
              <input
                type="number"
                step={1}
                min={0}
                value={selectedBox.damage ?? 0}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onUpdateSelected({
                    damage: Number.isFinite(n) ? n : undefined,
                  });
                }}
                style={{ fontSize: 11, fontFamily: "monospace", width: "100%" }}
              />
              <div
                style={{ display: "flex", gap: 6, marginTop: 6 }}
              >
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11 }}>Knock X</label>
                  <input
                    type="number"
                    step={10}
                    value={selectedBox.knockbackX ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onUpdateSelected({
                        knockbackX: Number.isFinite(n) ? n : undefined,
                      });
                    }}
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      width: "100%",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11 }}>Knock Y</label>
                  <input
                    type="number"
                    step={10}
                    value={selectedBox.knockbackY ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onUpdateSelected({
                        knockbackY: Number.isFinite(n) ? n : undefined,
                      });
                    }}
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      width: "100%",
                    }}
                  />
                </div>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  marginTop: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedBox.multiHit === true}
                  onChange={(e) =>
                    onUpdateSelected({
                      multiHit: e.target.checked || undefined,
                    })
                  }
                />
                Multi-hit (hits same target multiple times per swing)
              </label>
            </>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button
              onClick={onSnapSelectedToContent}
              style={btn()}
              title="Shrink this box to the tight rect of opaque pixels INSIDE it. Use after drawing a rough rect — snaps it pixel-perfect to the silhouette."
            >
              Snap to content
            </button>
            <button
              onClick={onRemoveSelected}
              style={{
                fontSize: 11,
                padding: "5px 10px",
                background: "#3a1f1f",
                color: "#ffb0b0",
                border: "1px solid #5a2a2a",
                cursor: "pointer",
                borderRadius: 3,
              }}
            >
              Delete
            </button>
          </div>
        </section>
      ) : (
        <section style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            <strong>Drawing:</strong> click + drag empty canvas to draw a
            new box of the kind selected in the toolbar (Body / Hurt /
            Attack). Click an existing box to select it.
            <br /><br />
            <strong>Alt-click:</strong> flood-fill the contiguous opaque
            region under the cursor and create a box of the current draw
            kind around it. Fastest way to box up a specific body part
            (head, weapon-tip, etc.) — two clicks per box.
            <br /><br />
            <strong>Delete</strong> or <strong>Backspace</strong> removes
            the selected box.
          </div>
        </section>
      )}

      <section style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <label style={{ fontSize: 11 }}>Notes</label>
        <textarea
          value={entity.notes ?? ""}
          onChange={(e) => onUpdateNotes(e.target.value)}
          rows={3}
          placeholder="Author-time notes — not used by the runtime."
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            width: "100%",
            marginTop: 4,
          }}
        />
      </section>
    </aside>
  );
}

function RectFields({
  box,
  onChange,
}: {
  box: HitboxRect;
  onChange: (patch: Partial<HitboxRect>) => void;
}) {
  const num = (k: keyof HitboxRect, v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    onChange({ [k]: Math.round(n) } as Partial<HitboxRect>);
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
      }}
    >
      <NumField label="x" value={box.x} onChange={(v) => num("x", v)} />
      <NumField label="y" value={box.y} onChange={(v) => num("y", v)} />
      <NumField label="w" value={box.w} onChange={(v) => num("w", v)} />
      <NumField label="h" value={box.h} onChange={(v) => num("h", v)} />
    </div>
  );
}

/** Inspector button style — keeps the auto-detect / propagation
 *  buttons visually consistent without inlining the same object
 *  literal four times. */
function btn(kind: "primary" | "secondary" = "secondary"): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "5px 8px",
    cursor: "pointer",
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: kind === "primary" ? "var(--accent-bg, #2a3a4a)" : "transparent",
    color: "var(--text)",
    flex: 1,
    textAlign: "center" as const,
  };
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ fontSize: 10, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "var(--text-dim)", fontFamily: "monospace" }}>
        {label}
      </span>
      <input
        type="number"
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 11, fontFamily: "monospace", width: "100%" }}
      />
    </label>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

function EmptyState({
  onOpenFolder,
  message,
  showRescan,
  onRescan,
}: {
  onOpenFolder: () => void;
  message?: string;
  showRescan?: boolean;
  onRescan?: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-dim)",
        fontSize: 13,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 540, lineHeight: 1.5 }}>
        <strong style={{ display: "block", marginBottom: 12, fontSize: 14 }}>
          No hitbox project loaded.
        </strong>
        <div style={{ marginBottom: 16 }}>
          {message ??
            "Pick a folder containing your character / enemy sprite sheets (e.g. AscensionGame's `assets/sprites/newborn/`). The mode discovers `*_<fps>fps.png` files automatically and scaffolds a `hitboxes.json` next to them."}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button onClick={onOpenFolder} className="primary">
            Open folder…
          </button>
          {showRescan && onRescan && (
            <button onClick={onRescan}>Re-scan</button>
          )}
        </div>
      </div>
    </div>
  );
}
