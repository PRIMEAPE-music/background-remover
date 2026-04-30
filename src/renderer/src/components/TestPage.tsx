import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Animation, BuilderState } from '../lib/builder';
import { composeAnimationFrames } from '../lib/builderExport';
import type { SourceMeta } from '../lib/sources';

export interface TestPageProps {
  builder: BuilderState;
  onBuilderChange: (b: BuilderState) => void;
  sources: SourceMeta[];
  getSource: (id: string | null) => ImageData | null;
}

/** Map KeyboardEvent.code to a short user-friendly label. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'Space') return 'Space';
  if (code === 'Enter') return 'Enter';
  if (code === 'Escape') return 'Esc';
  if (code === 'Backquote') return '`';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Slash') return '/';
  if (code === 'Backslash') return '\\';
  if (code === 'Tab') return 'Tab';
  return code;
}

/** Drives playback for the active animation. Time-based so dropped frames recover. */
interface PlaybackState {
  /** Animation currently playing, or null for "no anim ready". */
  animId: string | null;
  /** ms timestamp when playback of this anim began. */
  startedAt: number;
  /** True only while a one-shot is mid-play; locks out reverts until done. */
  oneShotInProgress: boolean;
}

export function TestPage({ builder, onBuilderChange, sources, getSource }: TestPageProps) {
  const stageRef = useRef<HTMLCanvasElement>(null);
  // Pre-rendered frames per animation. Keyed by anim.id → ImageData[].
  // Animations missing from this map aren't ready (no scaleRef, empty slot,
  // etc.) and show as disabled in the sidebar.
  const [framesCache, setFramesCache] = useState<Record<string, ImageData[]>>({});
  // Pressed bound keys, in press order. Most recently pressed = head.
  const pressedKeysRef = useRef<string[]>([]);
  // Set this to a row id to enter "press a key" capture mode.
  const [capturingRowId, setCapturingRowId] = useState<string | null>(null);

  const playbackRef = useRef<PlaybackState>({
    animId: null,
    startedAt: 0,
    oneShotInProgress: false,
  });
  const [, setRenderTick] = useState(0);

  // ---------- Frame cache ----------
  // Re-render frames whenever builder geometry, animations, or source images
  // change. Cancel the in-flight pass if the deps churn mid-bake.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next: Record<string, ImageData[]> = {};
      for (const anim of builder.animations) {
        const frames = await composeAnimationFrames(anim, builder, sources, getSource);
        if (cancelled) return;
        if (frames) next[anim.id] = frames;
      }
      if (!cancelled) setFramesCache(next);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [builder, sources, getSource]);

  // ---------- Default animation resolution ----------
  const defaultAnimId = useMemo(() => {
    const stored = builder.testDefaultAnimationId;
    if (stored && builder.animations.some((a) => a.id === stored)) return stored;
    // First animation that's actually ready to play; falls back to the first
    // listed even if not ready, so the dropdown reflects user intent.
    const firstReady = builder.animations.find((a) => framesCache[a.id]);
    return firstReady?.id ?? builder.animations[0]?.id ?? null;
  }, [builder.testDefaultAnimationId, builder.animations, framesCache]);

  // ---------- Anim lookup by key ----------
  const animByKey = useMemo(() => {
    const map = new Map<string, Animation>();
    for (const a of builder.animations) {
      for (const k of a.testKeys ?? []) {
        // Last write wins if a key is duplicated across rows; we also enforce
        // uniqueness at bind-time so this branch shouldn't normally fire.
        map.set(k, a);
      }
    }
    return map;
  }, [builder.animations]);

  // ---------- Playback transition helpers ----------
  const startPlayback = useCallback((animId: string | null, oneShot: boolean) => {
    playbackRef.current = {
      animId,
      startedAt: performance.now(),
      oneShotInProgress: oneShot,
    };
  }, []);

  /** Choose the right anim to play given current key state. Skips one-shots
   *  if the user only ever held that key (one-shot is single-fire on press). */
  const selectAnimFromKeys = useCallback((): Animation | null => {
    const keys = pressedKeysRef.current;
    for (let i = keys.length - 1; i >= 0; i--) {
      const a = animByKey.get(keys[i]);
      // Skip one-shots when re-resolving — they're triggered explicitly on
      // keydown and shouldn't auto-replay just because the key is still held.
      if (a && a.testLoop !== false) return a;
    }
    return null;
  }, [animByKey]);

  /** Resolve current anim to display when nothing one-shot is locking us in. */
  const resolveDisplayAnim = useCallback((): string | null => {
    const fromKeys = selectAnimFromKeys();
    if (fromKeys) return fromKeys.id;
    return defaultAnimId;
  }, [selectAnimFromKeys, defaultAnimId]);

  // ---------- Keyboard capture ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Always avoid stealing keys from input/textarea — the row's name
      // field, the key-capture field, anything in the sidebar.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Capture mode: bind this key to the row that requested it.
      if (capturingRowId !== null) {
        e.preventDefault();
        if (e.code === 'Escape') {
          setCapturingRowId(null);
          return;
        }
        // Move the key from any anim that already owns it to this row.
        onBuilderChange({
          ...builder,
          animations: builder.animations.map((a) => {
            const without = (a.testKeys ?? []).filter((k) => k !== e.code);
            if (a.id === capturingRowId) {
              return without.includes(e.code)
                ? { ...a, testKeys: without }
                : { ...a, testKeys: [...without, e.code] };
            }
            return { ...a, testKeys: without };
          }),
        });
        setCapturingRowId(null);
        return;
      }

      // Normal trigger path.
      if (e.repeat) return;
      const anim = animByKey.get(e.code);
      if (!anim) return;
      e.preventDefault();
      if (!pressedKeysRef.current.includes(e.code)) {
        pressedKeysRef.current = [...pressedKeysRef.current, e.code];
      }
      const oneShot = anim.testLoop === false;
      // Only override an in-progress one-shot if the new request is also
      // a one-shot (so the user can cancel/replace one-shot with another) —
      // a held loop key shouldn't interrupt a fired-but-still-playing attack.
      const cur = playbackRef.current;
      if (cur.oneShotInProgress && !oneShot) return;
      startPlayback(anim.id, oneShot);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const idx = pressedKeysRef.current.indexOf(e.code);
      if (idx >= 0) {
        pressedKeysRef.current = pressedKeysRef.current.filter((k) => k !== e.code);
      }
      const cur = playbackRef.current;
      // If the released key was driving a loop anim, fall back. One-shots
      // don't react to release — they finish on their own.
      if (cur.oneShotInProgress) return;
      const next = resolveDisplayAnim();
      if (next !== cur.animId) startPlayback(next, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [animByKey, builder, capturingRowId, onBuilderChange, resolveDisplayAnim, startPlayback]);

  // ---------- Initial / fallback playback when display defaults change ----------
  useEffect(() => {
    const cur = playbackRef.current;
    if (cur.oneShotInProgress) return;
    if (cur.animId) return; // already playing something; let user input drive it
    const next = resolveDisplayAnim();
    if (next) startPlayback(next, false);
  }, [resolveDisplayAnim, startPlayback]);

  // If the default changes (or the previously-playing anim is removed), revert.
  useEffect(() => {
    const cur = playbackRef.current;
    if (cur.oneShotInProgress) return;
    if (cur.animId && !builder.animations.some((a) => a.id === cur.animId)) {
      startPlayback(defaultAnimId, false);
    }
  }, [builder.animations, defaultAnimId, startPlayback]);

  // ---------- Playback / render loop ----------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cur = playbackRef.current;
      const anim = builder.animations.find((a) => a.id === cur.animId);
      const frames = anim ? framesCache[anim.id] : null;
      const canvas = stageRef.current;
      if (canvas && anim && frames && frames.length > 0) {
        const fps = Math.max(1, anim.fps);
        const elapsed = performance.now() - cur.startedAt;
        const idx = Math.floor((elapsed * fps) / 1000);
        let displayIdx: number;
        if (anim.testLoop === false) {
          // One-shot: clamp to last frame, then revert.
          if (idx >= frames.length) {
            displayIdx = frames.length - 1;
            // End-of-one-shot transition.
            if (cur.oneShotInProgress) {
              playbackRef.current = { ...cur, oneShotInProgress: false };
              const next = resolveDisplayAnim();
              if (next !== cur.animId) {
                startPlayback(next, false);
              }
            }
          } else {
            displayIdx = idx;
          }
        } else {
          displayIdx = idx % frames.length;
        }
        const frame = frames[displayIdx];
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.putImageData(frame, 0, 0);
        }
      } else if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      // Bump a render counter once per second so the "Frame X / Y" readout
      // stays roughly current without re-rendering the React tree per tick.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const hudInterval = window.setInterval(() => setRenderTick((t) => t + 1), 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(hudInterval);
    };
  }, [builder.animations, framesCache, resolveDisplayAnim, startPlayback]);

  // ---------- UI handlers ----------
  const setAnimField = useCallback(
    (id: string, patch: Partial<Pick<Animation, 'testKeys' | 'testLoop'>>) => {
      onBuilderChange({
        ...builder,
        animations: builder.animations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      });
    },
    [builder, onBuilderChange],
  );

  const removeKey = useCallback(
    (animId: string, code: string) => {
      const anim = builder.animations.find((a) => a.id === animId);
      if (!anim) return;
      setAnimField(animId, { testKeys: (anim.testKeys ?? []).filter((k) => k !== code) });
    },
    [builder.animations, setAnimField],
  );

  const triggerAnim = useCallback(
    (anim: Animation) => {
      // Click-to-trigger mirrors a keypress: one-shots fire once, loops run
      // until you click another row or release-equivalent. We treat a click
      // like a brief press: loop anims stay active until another button or
      // key takes over; user can hit the default-anim trigger to revert.
      const oneShot = anim.testLoop === false;
      startPlayback(anim.id, oneShot);
    },
    [startPlayback],
  );

  const revertToDefault = useCallback(() => {
    pressedKeysRef.current = [];
    playbackRef.current = { ...playbackRef.current, oneShotInProgress: false };
    startPlayback(defaultAnimId, false);
  }, [defaultAnimId, startPlayback]);

  // Compute live display state for the HUD.
  const cur = playbackRef.current;
  const playingAnim = builder.animations.find((a) => a.id === cur.animId) ?? null;
  const playingFrames = playingAnim ? framesCache[playingAnim.id] : null;
  let hudFrameInfo: string = '–';
  if (playingAnim && playingFrames) {
    const fps = Math.max(1, playingAnim.fps);
    const elapsed = performance.now() - cur.startedAt;
    const rawIdx = Math.floor((elapsed * fps) / 1000);
    const displayIdx =
      playingAnim.testLoop === false
        ? Math.min(rawIdx, playingFrames.length - 1)
        : rawIdx % playingFrames.length;
    hudFrameInfo = `${displayIdx + 1}/${playingFrames.length}`;
  }

  const stageScale = 2;
  const stageW = builder.boxSize.w * stageScale;
  const stageH = builder.boxSize.h * stageScale;

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
          <strong>Test</strong>
          <span style={{ color: 'var(--text-dim)' }}>
            {playingAnim
              ? `Playing: ${playingAnim.name} · ${playingAnim.fps} fps · frame ${hudFrameInfo}${
                  playingAnim.testLoop === false ? ' · once' : ' · loop'
                }`
              : 'No animation playing.'}
          </span>
          <button
            onClick={revertToDefault}
            disabled={!defaultAnimId}
            style={{ marginLeft: 'auto', fontSize: 11 }}
          >
            Revert to default
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
          }}
        >
          {builder.animations.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 24, textAlign: 'center' }}>
              No animations to test. Build one in the Builder tab first.
            </div>
          ) : (
            <div
              style={{
                background:
                  'linear-gradient(45deg, #3a3a44 25%, transparent 25%), linear-gradient(-45deg, #3a3a44 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a44 75%), linear-gradient(-45deg, transparent 75%, #3a3a44 75%) #2a2a30',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
                width: stageW,
                height: stageH,
                border: '1px solid var(--border)',
                position: 'relative',
              }}
            >
              <canvas
                ref={stageRef}
                width={builder.boxSize.w}
                height={builder.boxSize.h}
                style={{
                  width: '100%',
                  height: '100%',
                  imageRendering: 'pixelated',
                  display: 'block',
                }}
              />
            </div>
          )}
        </div>
      </div>
      <aside
        style={{
          width: 340,
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
          <label>Default (when no key held)</label>
          <select
            value={defaultAnimId ?? ''}
            onChange={(e) =>
              onBuilderChange({
                ...builder,
                testDefaultAnimationId: e.target.value || null,
              })
            }
            style={{ width: '100%', fontSize: 11, marginTop: 4 }}
            disabled={builder.animations.length === 0}
          >
            {builder.animations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
            Plays whenever no bound key is held. Set this to your idle to mimic
            an in-game character at rest.
          </div>
        </section>
        <section>
          <label>Animations</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {builder.animations.map((anim) => {
              const ready = !!framesCache[anim.id];
              const keys = anim.testKeys ?? [];
              const isCapturing = capturingRowId === anim.id;
              const isPlaying = anim.id === cur.animId;
              return (
                <div
                  key={anim.id}
                  style={{
                    border: `1px solid ${isPlaying ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 4,
                    padding: 8,
                    background: isPlaying ? 'rgba(95,150,255,0.06)' : undefined,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 12, flex: 1 }}>{anim.name}</strong>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{anim.fps} fps</span>
                    <button
                      onClick={() => triggerAnim(anim)}
                      disabled={!ready}
                      title={ready ? 'Trigger this animation' : 'Animation not ready (check Builder)'}
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >
                      ▶
                    </button>
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: 'var(--text)',
                      textTransform: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={anim.testLoop !== false}
                      onChange={(e) => setAnimField(anim.id, { testLoop: e.target.checked })}
                    />
                    Loop while held
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 'auto' }}>
                      {anim.testLoop === false ? 'one-shot' : 'looping'}
                    </span>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {keys.map((code) => (
                      <span
                        key={code}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: '#2a2a30',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontSize: 11,
                          fontFamily: 'monospace',
                        }}
                      >
                        {keyLabel(code)}
                        <button
                          onClick={() => removeKey(anim.id, code)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-dim)',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: 11,
                          }}
                          title="Remove key"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() =>
                        setCapturingRowId((cur) => (cur === anim.id ? null : anim.id))
                      }
                      className={isCapturing ? 'primary' : ''}
                      style={{ fontSize: 10, padding: '1px 6px' }}
                      title={isCapturing ? 'Press a key… or Esc to cancel' : 'Bind another key'}
                    >
                      {isCapturing ? 'Press a key…' : '+ key'}
                    </button>
                  </div>
                  {!ready && (
                    <div style={{ fontSize: 10, color: '#e8a04a' }}>
                      Not ready — set a scale ref and fill every slot in Builder.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <label>Tips</label>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            • Loop anims play while their key is held; release returns to default.
            <br />• One-shots fire once on press and auto-return to default.
            <br />• Esc cancels key-capture mode.
            <br />• Multi-key: bind several keys to the same anim with "+ key".
          </div>
        </section>
      </aside>
    </>
  );
}
