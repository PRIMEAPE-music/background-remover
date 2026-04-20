# Background Remover

Desktop app for removing backgrounds from sprite images and preparing sprite sheets for game engines (Phaser 3 in particular).

Built specifically to shortcut the manual Photopea/GIMP workflow of: remove BG → slice → resize each sprite to a consistent size → re-align → save each frame → build an atlas.

## Features

### Remove BG
- Click-to-pick color removal with tolerance slider (LAB perceptual or RGB distance)
- Contiguous flood-fill toggle (remove only the connected region) or global (strip every matching pixel)
- Auto-detect background from image corners
- One-click presets for common sprite backgrounds (magenta, green, blue, white, black, cyan)
- 20-level undo

### Select + Move
- Draw a rectangle around a sprite and drag it to fix overlaps *before* slicing
- Alt + drag or alt + arrow to duplicate instead of move
- Arrow keys nudge 1px, shift+arrows 10px
- Enter commits · Escape reverts · Delete erases lifted area

### Sprite sheet slicer
- **Grid mode** — cols/rows with margins and spacing, plus one-click frame-size presets (92×128, 64×64, 96×144, 128×176, 148×200)
- **Guides mode** — draggable vertical/horizontal cut lines for non-uniform sheets
- **Boxes mode** — draw arbitrary bounding boxes, drag to move, corner handles to resize
- **Auto-detect sprite blobs** — finds every connected opaque region and creates boxes automatically (run after removing BG)
- **Per-cell flip** — H/V keyboard shortcut or sidebar toggle, shown on the cell overlay
- Save slice configs as reusable presets

### Normalization (fixes the "Photopea resize" workflow)
- Target frame size with presets
- Trim transparent borders per cell
- Anchor options: 3×3 grid (top-left, top, …, bottom-right). **Bottom-center** is the killer for feet-aligned characters
- Scaling modes:
  - `none` — paste as-is
  - `fit` — scale down to fit target, preserve aspect
  - `content-height` — **scale each sprite so its opaque content matches the target height**. Hands you consistently-sized characters regardless of source variation.
- Configurable padding

### Animation preview
- Cycle through processed cells at 1–30 FPS in the sidebar
- Play/pause, scrub, step

### Export
- Individual PNGs (named `{base}_00.png`, `{base}_01.png`, …)
- **Phaser 3 atlas** — packed PNG + JSON matching `this.load.atlas()` format, default pivot at bottom-center
- **Auto-repack** — emit a clean new grid sheet from your cells, eliminating original overlap and spacing issues

## Tech stack

- Electron 33
- React 19 + TypeScript 5.9
- Vite 5 via electron-vite

## Scripts

```bash
npm install
npm run dev          # launch with HMR
npm run build        # production bundle in out/
npm run typecheck    # strict TS across main and renderer
```

## Project layout

```
electron.vite.config.ts
src/
├── main/index.ts         # Electron main, IPC handlers
├── preload/index.ts      # contextBridge API (window.api)
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── slice/    # Grid, Guides, Boxes overlays
        │   ├── CanvasView.tsx
        │   ├── SelectOverlay.tsx
        │   ├── Sidebar.tsx
        │   ├── SliceSidebar.tsx
        │   ├── Toolbar.tsx
        │   └── AnimationPreview.tsx
        └── lib/
            ├── bg-removal.ts
            ├── color.ts
            ├── image-utils.ts
            ├── slicing.ts
            └── presets.ts
```

## Workflow example (monk idle from a messy sheet)

1. **Open** the sheet.
2. **Remove BG** → auto-detect corner color → adjust tolerance → "Remove picked color".
3. **Select + Move** overlapping sprites apart if needed.
4. **Slice** → *Auto-detect sprite blobs* for scattered sheets, or *Grid* with the 92×128 preset for uniform ones.
5. Click a cell, press `H` to flip any sprites facing the wrong way.
6. Turn on **Normalize on export**, anchor **bottom-center**, scale mode **content-height**, target **92×128**.
7. Watch the **animation preview** — confirms the feet land in the same spot.
8. **Export Phaser 3 atlas** → pick a folder → get `monk_idle.png` + `monk_idle.json`.
9. In your game: `this.load.atlas('monk_idle', 'monk_idle.png', 'monk_idle.json');`
