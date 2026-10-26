import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import type { ReplayEdits } from '../../shared/edits.ts';
import { MIN_BLUR_SIZE, type ReplayBlur } from '../../shared/effects.ts';
import type { EditorAction, Selection } from './state.ts';
import { updateEffect } from './state.ts';
import { Button } from '@/components/ui/button.tsx';

type BlurBox = Pick<ReplayBlur, 'x' | 'y' | 'width' | 'height'>;

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A box after dragging `handle` by (dx, dy) frame fractions, kept inside the frame and at least MIN_BLUR_SIZE. */
export function dragBox(box: Pick<ReplayBlur, 'x' | 'y' | 'width' | 'height'>, handle: Handle, dx: number, dy: number) {
  if (handle === 'move') {
    return {
      x: round(clamp01(Math.min(1 - box.width, box.x + dx))),
      y: round(clamp01(Math.min(1 - box.height, box.y + dy))),
      width: box.width,
      height: box.height,
    };
  }
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (handle.includes('w')) left = Math.min(right - MIN_BLUR_SIZE, clamp01(left + dx));
  else right = Math.max(left + MIN_BLUR_SIZE, clamp01(right + dx));
  if (handle.includes('n')) top = Math.min(bottom - MIN_BLUR_SIZE, clamp01(top + dy));
  else bottom = Math.max(top + MIN_BLUR_SIZE, clamp01(bottom + dy));
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}

/**
 * Blur boxes drawn directly on the preview, over the recorded frame (the stage's --frame-* box). The selected blur
 * (from the Blur lane, or just added with B) is outlined; it moves by dragging and resizes from its corners; the blur itself is drawn under it by the player (effects-layer.ts), so
 * what you see is what the export hides.
 */
export function BlurOverlay({
  edits,
  selection,
  dispatch,
  placing = false,
  onPlace,
  onCancel,
}: {
  edits: ReplayEdits;
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  placing?: boolean;
  onPlace?: (box: BlurBox) => void;
  onCancel?: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<BlurBox>();
  const stopDrawing = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!placing) stopDrawing.current?.();
    return () => stopDrawing.current?.();
  }, [placing]);
  const latest = useRef(edits);
  useEffect(() => {
    latest.current = edits;
  }, [edits]);
  const selectedId = selection?.kind === 'blur' ? selection.id : undefined;
  // Only the selected box: the zoom holds at 1× while one is selected, so its outline sits exactly on the blur.
  const visible = (edits.blurs ?? []).filter((blur) => blur.id === selectedId);
  if (!visible.length && !placing) return null;

  const draw = (event: ReactPointerEvent) => {
    if (!placing || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(undefined);
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    const boxAt = (next: PointerEvent): BlurBox => {
      const endX = clamp01((next.clientX - rect.left) / rect.width);
      const endY = clamp01((next.clientY - rect.top) / rect.height);
      return {
        x: round(Math.min(x, endX)),
        y: round(Math.min(y, endY)),
        width: round(Math.abs(endX - x)),
        height: round(Math.abs(endY - y)),
      };
    };
    const move = (next: PointerEvent) => setDraft(boxAt(next));
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      stopDrawing.current = undefined;
    };
    const cancel = () => {
      cleanup();
      setDraft(undefined);
    };
    const end = (next: PointerEvent) => {
      cleanup();
      const box = boxAt(next);
      setDraft(undefined);
      if (box.width >= MIN_BLUR_SIZE && box.height >= MIN_BLUR_SIZE) onPlace?.(box);
    };
    stopDrawing.current?.();
    stopDrawing.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  };

  const begin = (event: ReactPointerEvent, blur: ReplayBlur, handle: Handle) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: 'select', selection: { kind: 'blur', id: blur.id } });
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { x: blur.x, y: blur.y, width: blur.width, height: blur.height };
    let first = true;
    const onMove = (next: PointerEvent) => {
      const box = dragBox(start, handle, (next.clientX - startX) / rect.width, (next.clientY - startY) / rect.height);
      dispatch({
        type: 'change',
        edits: updateEffect(latest.current, 'blur', blur.id, box),
        merge: !first,
        select: { kind: 'blur', id: blur.id },
      });
      first = false;
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  return (
    <div ref={frame} className="blur-overlay" data-placing={placing || undefined} data-testid="blur-overlay" onPointerDown={draw}>
      {placing ? (
        <>
          <div className="blur-placement-help" role="status">
            <span>Draw the area to blur</span>
            <Button size="xs" variant="secondary" onClick={() => onPlace?.({ x: 0.35, y: 0.38, width: 0.3, height: 0.14 })}>
              Use centered area
            </Button>
            <Button size="xs" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {draft ? (
            <div
              className="blur-draft"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
            />
          ) : null}
        </>
      ) : null}
      {visible.map((blur) => (
        <div
          key={blur.id}
          className="blur-box"
          data-selected={blur.id === selectedId || undefined}
          data-testid="blur-box"
          style={{ left: `${blur.x * 100}%`, top: `${blur.y * 100}%`, width: `${blur.width * 100}%`, height: `${blur.height * 100}%` }}
          onPointerDown={(event) => begin(event, blur, 'move')}
        >
          {blur.id === selectedId
            ? CORNERS.map((corner) => (
                <span key={corner} className="blur-handle" data-corner={corner} onPointerDown={(event) => begin(event, blur, corner)} />
              ))
            : null}
        </div>
      ))}
    </div>
  );
}
