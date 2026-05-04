import Phaser from 'phaser';
import {
  computeAnchorPos,
  type Emitter,
  type EmitterBlendMode,
  type EmitterConfig,
  type TextureRef,
} from '../builder';
import { computeCells, type AnchorKind } from '../slicing';
import type { SourceMeta } from '../sources';
import { getBankImageCached } from './bank';
import { renderProceduralTexture } from './proceduralTexture';

/**
 * One Phaser.Game instance + a single ParticleScene that owns every emitter
 * for a given layer (front or back) of the animation preview. The scene
 * reconciles its emitter set by id on each `setEmitters` call so the
 * destroy/recreate cost on edits is limited to the spec that actually
 * changed (React's `state.map` keeps unchanged emitter refs stable).
 *
 * The preview never auto-emits — `setFrame` drives all emission so what
 * you see is exactly tied to the React-side animation playhead.
 */

interface EmitterEntry {
  spec: Emitter;
  obj: Phaser.GameObjects.Particles.ParticleEmitter;
}

class ParticleScene extends Phaser.Scene {
  private emitterMap = new Map<string, EmitterEntry>();
  private boxW = 128;
  private boxH = 128;
  private anchor: AnchorKind = 'bottom';
  private currentFrame = 0;
  private prevFrame = -1;
  private sources: SourceMeta[] = [];
  private getSource: (id: string | null) => ImageData | null = () => null;
  private ready = false;
  // Calls that arrive before `create` runs get queued; otherwise we'd silently
  // drop the very first setEmitters during component mount.
  private pendingEmitters: Emitter[] | null = null;
  private pendingFrame: number | null = null;

  constructor() {
    super({ key: 'particles' });
  }

  create(): void {
    this.ready = true;
    if (this.pendingEmitters) {
      void this.applyEmitters(this.pendingEmitters);
      this.pendingEmitters = null;
    }
    if (this.pendingFrame !== null) {
      this.setFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  setBoxSize(w: number, h: number): void {
    this.boxW = w;
    this.boxH = h;
    for (const entry of this.emitterMap.values()) {
      const { dx, dy } = this.anchorPosition(entry.spec.offset);
      entry.obj.setPosition(dx, dy);
    }
  }

  setAnchor(a: AnchorKind): void {
    this.anchor = a;
    for (const entry of this.emitterMap.values()) {
      const { dx, dy } = this.anchorPosition(entry.spec.offset);
      entry.obj.setPosition(dx, dy);
    }
  }

  setSources(
    sources: SourceMeta[],
    getSource: (id: string | null) => ImageData | null,
  ): void {
    this.sources = sources;
    this.getSource = getSource;
  }

  setEmitters(emitters: Emitter[]): void {
    if (!this.ready) {
      this.pendingEmitters = emitters;
      return;
    }
    void this.applyEmitters(emitters);
  }

  setFrame(frameIndex: number): void {
    if (!this.ready) {
      this.pendingFrame = frameIndex;
      return;
    }
    this.currentFrame = frameIndex;
    this.evaluateFrame();
    this.prevFrame = frameIndex;
  }

  private async applyEmitters(emitters: Emitter[]): Promise<void> {
    const seenIds = new Set<string>();
    for (const e of emitters) {
      seenIds.add(e.id);
      const existing = this.emitterMap.get(e.id);
      // Reference equality — patches always create fresh objects (and React's
      // .map keeps unchanged ones stable). Different ref = something changed,
      // safest to destroy + recreate. Preserves correctness over efficiency.
      if (existing && existing.spec === e) continue;
      if (existing) existing.obj.destroy();
      const obj = await this.createPhaserEmitter(e);
      if (obj) this.emitterMap.set(e.id, { spec: e, obj });
      else this.emitterMap.delete(e.id);
    }
    for (const [id, entry] of this.emitterMap) {
      if (!seenIds.has(id)) {
        entry.obj.destroy();
        this.emitterMap.delete(id);
      }
    }
    this.evaluateFrame();
  }

  private evaluateFrame(): void {
    for (const entry of this.emitterMap.values()) {
      this.evaluateEmitterFrame(entry);
    }
  }

  private evaluateEmitterFrame(entry: EmitterEntry): void {
    const { spec, obj } = entry;
    if (spec.endFrame === undefined) {
      // Burst emitter — one-shot on entry into startFrame.
      const justEntered =
        this.currentFrame === spec.startFrame && this.prevFrame !== spec.startFrame;
      if (justEntered) {
        obj.explode(spec.config.quantity);
      }
    } else {
      const inRange =
        this.currentFrame >= spec.startFrame && this.currentFrame <= spec.endFrame;
      if (inRange) {
        if (!obj.emitting) obj.start();
      } else {
        if (obj.emitting) obj.stop();
      }
    }
  }

  private async createPhaserEmitter(
    e: Emitter,
  ): Promise<Phaser.GameObjects.Particles.ParticleEmitter | null> {
    const textureKey = await this.ensureTexture(e.config.texture);
    if (!textureKey) return null;
    const { dx, dy } = this.anchorPosition(e.offset);
    const config = this.translateConfig(e.config);
    const emitter = this.add.particles(dx, dy, textureKey, config);
    emitter.stop(); // gated on by `setFrame`
    // Attach the synthetic-modifier processor if anything in the config needs
    // per-frame logic. Skip for plain emitters so the simple case stays cheap.
    if (hasSyntheticModifiers(e.config)) {
      const processor = new ModifierProcessor(emitter, e.config);
      emitter.addParticleProcessor(processor);
    }
    return emitter;
  }

  private translateConfig(
    c: EmitterConfig,
  ): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
    const out: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      lifespan: c.lifespan as number | { min: number; max: number },
      speed: c.speed as number | { min: number; max: number },
      angle: c.angle as number | { min: number; max: number },
      gravityY: c.gravityY,
      scale: c.scale as number | { start: number; end: number },
      alpha: c.alpha as number | { start: number; end: number },
      quantity: c.quantity,
      // Phaser treats frequency=-1 as "explode-only" (no automatic emission).
      // Anything else is ms between emissions.
      frequency: c.frequency === -1 ? -1 : Math.max(1, c.frequency),
      blendMode: this.translateBlendMode(c.blendMode),
      tint: c.tint,
      emitting: false,
    };
    // Phaser-native extensions — pass through if non-trivial.
    if (c.accelerationX !== undefined && !isZero(c.accelerationX)) {
      out.accelerationX = c.accelerationX as number | { min: number; max: number };
    }
    if (c.accelerationY !== undefined && !isZero(c.accelerationY)) {
      out.accelerationY = c.accelerationY as number | { min: number; max: number };
    }
    if (c.rotateStart !== undefined && !isZero(c.rotateStart)) {
      // `rotate` in Phaser is the visual texture rotation in degrees. If
      // rotateRate is also non-zero, the ModifierProcessor takes over and
      // overwrites this every frame; the initial value still matters for
      // the first render before the processor's first tick.
      out.rotate = c.rotateStart as number | { min: number; max: number };
    }
    return out;
  }

  private translateBlendMode(mode: EmitterBlendMode): Phaser.BlendModes {
    switch (mode) {
      case 'ADD':
        return Phaser.BlendModes.ADD;
      case 'MULTIPLY':
        return Phaser.BlendModes.MULTIPLY;
      case 'SCREEN':
        return Phaser.BlendModes.SCREEN;
      default:
        return Phaser.BlendModes.NORMAL;
    }
  }

  private async ensureTexture(t: TextureRef): Promise<string | null> {
    const key = textureKey(t);
    if (this.textures.exists(key)) return key;
    const img = await resolveTextureImageData(t, this.sources, this.getSource);
    if (!img) return null;
    const canvas = imageDataToCanvas(img);
    this.textures.addCanvas(key, canvas);
    return key;
  }

  private anchorPosition(offset: { x: number; y: number }): { dx: number; dy: number } {
    // Pass drawW=drawH=0 to get the raw anchor point (e.g. bottom-center for
    // 'bottom' anchor) rather than a sprite's top-left position.
    const { dx, dy } = computeAnchorPos(this.anchor, { w: this.boxW, h: this.boxH }, 0, 0, 0);
    return { dx: dx + offset.x, dy: dy + offset.y };
  }
}

export interface PhaserPreviewInit {
  parent: HTMLDivElement;
  width: number;
  height: number;
  anchor: AnchorKind;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

export class PhaserPreview {
  private game: Phaser.Game;
  private scene: ParticleScene;

  constructor(init: PhaserPreviewInit) {
    this.scene = new ParticleScene();
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      width: init.width,
      height: init.height,
      transparent: true,
      parent: init.parent,
      scene: this.scene,
      // Defaults are fine; we don't need physics, audio, or input plumbing.
      banner: false,
      fps: { target: 60, smoothStep: false },
      // Tell Phaser this canvas is decorative — disabling input prevents it
      // from grabbing pointer events even with parent's pointer-events:none.
      input: false,
    });
    this.scene.setBoxSize(init.width, init.height);
    this.scene.setAnchor(init.anchor);
    this.scene.setSources(init.sources, init.getSource);
  }

  setBoxSize(w: number, h: number): void {
    this.scene.setBoxSize(w, h);
  }

  setAnchor(a: AnchorKind): void {
    this.scene.setAnchor(a);
  }

  setSources(
    sources: SourceMeta[],
    getSource: (id: string | null) => ImageData | null,
  ): void {
    this.scene.setSources(sources, getSource);
  }

  setEmitters(emitters: Emitter[]): void {
    this.scene.setEmitters(emitters);
  }

  setFrame(frameIndex: number): void {
    this.scene.setFrame(frameIndex);
  }

  resize(w: number, h: number): void {
    this.game.scale.resize(w, h);
    this.scene.setBoxSize(w, h);
  }

  destroy(): void {
    this.game.destroy(true);
  }
}

// ---- Synthetic motion modifiers -----------------------------------------
//
// Phaser doesn't have native fields for swirling, drag-style decay, or
// sinusoidal oscillation. We implement them via a custom ParticleProcessor
// that runs each frame per particle. The exported JSON carries the same
// {swirl, drag, wave, rotateRate} fields, and the AscensionGame runtime
// uses an equivalent processor so what you see in the preview matches.

interface ParticleData {
  elapsedSec: number;
  /** Last wave offset applied; we add the delta each frame so wave doesn't
   *  permanently shift the particle out of the path other forces produce. */
  lastWaveOffset: number;
}

class ModifierProcessor extends Phaser.GameObjects.Particles.ParticleProcessor {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private config: EmitterConfig;
  private dataMap = new WeakMap<
    Phaser.GameObjects.Particles.Particle,
    ParticleData
  >();

  constructor(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    config: EmitterConfig,
  ) {
    super(0, 0, true);
    this.emitter = emitter;
    this.config = config;
  }

  update(particle: Phaser.GameObjects.Particles.Particle, delta: number): void {
    const dt = delta / 1000;
    if (dt <= 0) return;
    const data = this.getData(particle);
    data.elapsedSec += dt;

    // Swirl — tangential acceleration perpendicular to the radius vector.
    // Particles spiral around the emitter as their existing velocity carries
    // them outward (or wherever else gravity/speed wants them to go).
    if (this.config.swirl) {
      const rx = particle.x - this.emitter.x;
      const ry = particle.y - this.emitter.y;
      const dist = Math.hypot(rx, ry);
      if (dist > 0.001) {
        // Perpendicular (rotated 90° CCW): (-ry, rx).
        const tx = -ry / dist;
        const ty = rx / dist;
        const s = this.config.swirl.strength;
        particle.velocityX += tx * s * dt;
        particle.velocityY += ty * s * dt;
      }
    }

    // Drag — exponential velocity decay. A coefficient of 1 cuts speed to
    // ~37% over 1 second; 5 is "near-instant stop".
    if (this.config.drag && this.config.drag > 0) {
      const decay = Math.exp(-this.config.drag * dt);
      particle.velocityX *= decay;
      particle.velocityY *= decay;
    }

    // Wave — direct position offset along an axis. Track the previous
    // offset and add the delta each frame so the wave rides along whatever
    // base path other forces produce (rather than overriding position).
    if (this.config.wave && this.config.wave.amplitude > 0) {
      const phase = data.elapsedSec * 2 * Math.PI * this.config.wave.frequency;
      const next = Math.sin(phase) * this.config.wave.amplitude;
      const deltaOffset = next - data.lastWaveOffset;
      data.lastWaveOffset = next;
      if (this.config.wave.axis === 'x') particle.x += deltaOffset;
      else particle.y += deltaOffset;
    }

    // Continuous rotation (degrees per second).
    if (this.config.rotateRate && this.config.rotateRate !== 0) {
      // Phaser's particle.angle is in degrees.
      particle.angle += this.config.rotateRate * dt;
    }
  }

  private getData(p: Phaser.GameObjects.Particles.Particle): ParticleData {
    let d = this.dataMap.get(p);
    if (!d) {
      d = { elapsedSec: 0, lastWaveOffset: 0 };
      this.dataMap.set(p, d);
    }
    return d;
  }
}

function hasSyntheticModifiers(c: EmitterConfig): boolean {
  if (c.swirl) return true;
  if (c.drag && c.drag > 0) return true;
  if (c.wave && c.wave.amplitude > 0) return true;
  if (c.rotateRate && c.rotateRate !== 0) return true;
  return false;
}

function isZero(v: number | { min: number; max: number }): boolean {
  if (typeof v === 'number') return v === 0;
  return v.min === 0 && v.max === 0;
}

// ---- Helpers ------------------------------------------------------------

function textureKey(t: TextureRef): string {
  if (t.kind === 'procedural') return `proc:${t.shape}:${t.size}:${t.softness}`;
  if (t.kind === 'bank') return `bank:${t.name}`;
  return `sprite:${t.sourceId}:${t.cellIndex}`;
}

async function resolveTextureImageData(
  t: TextureRef,
  sources: SourceMeta[],
  getSource: (id: string | null) => ImageData | null,
): Promise<ImageData | null> {
  if (t.kind === 'procedural') {
    return renderProceduralTexture(t.shape, t.size, t.softness);
  }
  if (t.kind === 'bank') {
    return getBankImageCached(t.name);
  }
  // projectSprite
  const src = sources.find((s) => s.id === t.sourceId);
  if (!src) return null;
  const img = getSource(src.id);
  if (!img) return null;
  const cells = computeCells(src.slice, src.width, src.height);
  const rect = cells[t.cellIndex];
  if (!rect) return null;
  return extractRect(img, rect.x, rect.y, rect.width, rect.height);
}

function extractRect(
  src: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  const out = new ImageData(w, h);
  for (let yi = 0; yi < h; yi++) {
    const sy = y + yi;
    if (sy < 0 || sy >= src.height) continue;
    for (let xi = 0; xi < w; xi++) {
      const sx = x + xi;
      if (sx < 0 || sx >= src.width) continue;
      const sIdx = (sy * src.width + sx) * 4;
      const dIdx = (yi * w + xi) * 4;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(img, 0, 0);
  return canvas;
}
