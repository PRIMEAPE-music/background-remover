import { useEffect, useRef, useState } from 'react';
import type { Emitter } from '../../../lib/builder';
import { PhaserPreview } from '../../../lib/particles/phaserPreview';
import type { AnchorKind } from '../../../lib/slicing';
import type { SourceMeta } from '../../../lib/sources';

export interface PhaserParticleOverlayProps {
  /** Logical width — Phaser canvas size, CSS-scaled by parent transform. */
  width: number;
  /** Logical height. */
  height: number;
  anchor: AnchorKind;
  emitters: Emitter[];
  /** Current animation frame index. Drives burst timing and on/off state. */
  frameIndex: number;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

/**
 * Mounts one transparent Phaser.Game instance to render a set of emitters.
 * BuilderPreview stacks two of these (back-layer + front-layer) around the
 * sprite so emitter-vs-sprite z-order is correct.
 *
 * Emitter changes are debounced 80ms — the editor's slider drags emit a
 * stream of patches, and recreating the underlying ParticleEmitter on every
 * frame would visibly thrash. The debounce is short enough that releasing a
 * slider feels instant.
 */
export function PhaserParticleOverlay({
  width,
  height,
  anchor,
  emitters,
  frameIndex,
  sources,
  getSource,
}: PhaserParticleOverlayProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<PhaserPreview | null>(null);

  // Debounce emitter list changes. Position/anchor/frame/sources update live.
  const [debouncedEmitters, setDebouncedEmitters] = useState(emitters);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEmitters(emitters), 80);
    return () => clearTimeout(t);
  }, [emitters]);

  // Mount/unmount — created once, destroyed on unmount.
  useEffect(() => {
    if (!parentRef.current) return;
    const preview = new PhaserPreview({
      parent: parentRef.current,
      width,
      height,
      anchor,
      sources,
      getSource,
    });
    previewRef.current = preview;
    return () => {
      preview.destroy();
      previewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: mount once; subsequent prop changes flow via setters below

  useEffect(() => {
    previewRef.current?.resize(width, height);
  }, [width, height]);

  useEffect(() => {
    previewRef.current?.setAnchor(anchor);
  }, [anchor]);

  useEffect(() => {
    previewRef.current?.setSources(sources, getSource);
  }, [sources, getSource]);

  useEffect(() => {
    previewRef.current?.setEmitters(debouncedEmitters);
  }, [debouncedEmitters]);

  useEffect(() => {
    previewRef.current?.setFrame(frameIndex);
  }, [frameIndex]);

  return (
    <div
      ref={parentRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
      }}
    />
  );
}
