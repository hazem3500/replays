import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils.ts';

import { apiUrl } from '../route.ts';
import { PosterPlaceholder } from './PosterPlaceholder.tsx';
import { currentPreviewEnvironment, previewsAllowed } from './preview.ts';

/*
 * A replay's list thumbnail: a plain lazy <img> of GET /api/replays/<id>/poster over a placeholder that is never a
 * made-up letter (PosterPlaceholder.tsx: the poster's ThumbHash, else the recorded host, or a suite's run mosaic). The
 * server answers 202 while it renders the poster, and 404/503 when there is none; an <img> cannot read those, so after
 * an error one HEAD request decides between "retry after Retry-After" and "keep the placeholder". A 503 switches
 * posters off for the page: every poster still waiting stops breathing at once and settles on its placeholder (its
 * <img> stays, since a poster stored before posters went off is still served).
 *
 * While `playing` (the row is hovered or reached by keyboard, preview.ts), a muted looping <video> of
 * GET /api/replays/<id>/preview (the replay at 3×, idle gaps squeezed) fades in over the poster with a
 * progress hairline; it is unmounted (stopped and reset) when the row is left. Nothing is fetched
 * until then; a HEAD first tells ready (200) from rendering (202, polled while hovered) and off (503).
 */

/** Matches POSTER_VERSION on the server: a new poster moment busts week-long cached posters. */
const POSTER_VERSION = 2;

const MAX_RETRIES = 6;
let postersOff = false;
const offListeners = new Set<() => void>();

function setPostersOff(next: boolean) {
  if (postersOff === next) return;
  postersOff = next;
  for (const listener of offListeners) listener();
}

function subscribePostersOff(listener: () => void) {
  offListeners.add(listener);
  return () => void offListeners.delete(listener);
}

/** Test hook: forget a previous 503. */
export function resetPosters() {
  setPostersOff(false);
}

type State = { id: string | undefined; phase: 'loading' | 'ready' | 'none'; attempt: number };

// why: with posters off a stored poster is still served, so each poster still asks once, without the breathing.
const initialState = (id: string | undefined): State => ({ id, phase: id ? 'loading' : 'none', attempt: 0 });

export function Poster({
  id,
  host,
  className,
  size = 'row',
  playing = false,
  badge,
  caption,
  onPreviewEnd,
  onPreviewHalf,
  thumbhash,
  fallback,
}: {
  /** Replay id; absent draws the placeholder only (a suite run without a recording). */
  id: string | undefined;
  host: string;
  /** The summary's ThumbHash: the placeholder paints the poster's colours until it loads, then crossfades to it. */
  thumbhash?: string | undefined;
  /** Shown instead of the replay's own placeholder: a suite's run mosaic. */
  fallback?: ReactNode;
  className?: string;
  size?: 'row' | 'card' | 'mini' | 'fill';
  /** Play the hover preview (when this device allows autoplay). */
  playing?: boolean;
  /** Bottom-right overlay: a replay's duration, or a suite's run count. */
  badge?: ReactNode;
  /** Bottom-left overlay (a suite's cycling run label); keyed by the caller so it fades in on each change. */
  caption?: ReactNode;
  /** Play the preview once (no loop) and say when it ends, or when there is none to play (suite cycling). */
  onPreviewEnd?: () => void;
  /** Called once when the preview passes halfway (to warm the next one). */
  onPreviewHalf?: () => void;
}) {
  const [stored, setState] = useState<State>(() => initialState(id));
  // A different replay starts over (derived during render rather than reset in an effect).
  const state = stored.id === id ? stored : initialState(id);
  if (stored !== state) setState(state);
  const src = id
    ? `${apiUrl(`replays/${encodeURIComponent(id)}/poster`)}?v=${POSTER_VERSION}${state.attempt ? `&try=${state.attempt}` : ''}`
    : '';

  const failed = () => {
    if (!id || postersOff || state.attempt >= MAX_RETRIES) {
      setState((current) => ({ ...current, phase: 'none' }));
      return;
    }
    const attempt = state.attempt;
    void fetch(src, { method: 'HEAD' })
      .then((response) => {
        if (response.status === 503 && !response.headers.get('retry-after')) setPostersOff(true);
        if (response.status !== 202 && response.status !== 503) throw new Error(String(response.status));
        if (postersOff) throw new Error('posters off');
        const wait = Math.min(30, Math.max(1, Number(response.headers.get('retry-after')) || 2)) * 1000 * (1 + attempt / 2);
        window.setTimeout(
          () => setState((current) => (current.attempt === attempt ? { ...current, phase: 'loading', attempt: attempt + 1 } : current)),
          wait,
        );
      })
      .catch(() => setState((current) => (current.attempt === attempt ? { ...current, phase: 'none' } : current)));
  };

  const off = useSyncExternalStore(
    subscribePostersOff,
    () => postersOff,
    () => false,
  );
  // why: "on its way" breathes only while a poster can still arrive; with posters off it settles on the placeholder.
  const phase = state.phase === 'loading' && off ? 'none' : state.phase;
  return (
    <span className={cn('poster', `poster-${size}`, className)} data-phase={phase} aria-hidden="true">
      <PosterPlaceholder host={host} thumbhash={thumbhash} fallback={fallback} />
      {id && state.phase !== 'none' ? (
        <img
          key={state.attempt}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState((current) => ({ ...current, phase: 'ready' }))}
          onError={failed}
        />
      ) : null}
      {badge ? <span className="poster-badge">{badge}</span> : null}
      {caption}
      {playing && id && !previewsOff && previewsAllowed(currentPreviewEnvironment()) ? (
        <PreviewVideo
          key={id}
          id={id}
          {...(onPreviewEnd ? { onEnd: onPreviewEnd } : {})}
          {...(onPreviewHalf ? { onHalf: onPreviewHalf } : {})}
        />
      ) : null}
    </span>
  );
}

type PreviewInfo =
  | { status: 'ready'; capped: boolean; coversMs: number; speed: number }
  | { status: 'pending'; retryMs: number }
  | { status: 'none' };

/** Per page: what the server said about each replay's preview (ready ones are not asked again). */
const previews = new Map<string, PreviewInfo>();
let previewsOff = false;

/** Test hook. */
export function resetPreviews() {
  previews.clear();
  previewsOff = false;
}

/** Matches PREVIEW_VERSION on the server: a new speed or encoding busts week-long cached previews. */
const PREVIEW_VERSION = 2;

export const previewUrl = (id: string) => `${apiUrl(`replays/${encodeURIComponent(id)}/preview`)}?v=${PREVIEW_VERSION}`;

/** One HEAD: 200 ready (with the clip's speed and span), 202 rendering, 503 without Retry-After off for the page. */
export async function probePreview(id: string, signal?: AbortSignal): Promise<PreviewInfo> {
  const response = await fetch(previewUrl(id), { method: 'HEAD', ...(signal ? { signal } : {}) });
  const retry = response.headers.get('retry-after');
  // A 202 is also response.ok: it means the clip is still rendering, never a playable video.
  if (response.status === 200)
    return {
      status: 'ready',
      capped: response.headers.get('x-preview-capped') === '1',
      coversMs: Number(response.headers.get('x-preview-covers-ms')) || 0,
      speed: Number(response.headers.get('x-preview-speed')) || 3,
    };
  if (response.status === 202 || (response.status === 503 && retry))
    return { status: 'pending', retryMs: Math.min(30, Math.max(1, Number(retry) || 2)) * 1000 };
  if (response.status === 503) previewsOff = true;
  return { status: 'none' };
}

/** How long a run without a preview keeps the front while a suite cycles, before moving on. */
const NO_PREVIEW_HOLD_MS = 2500;

/** Warms a replay's preview (HEAD + a low-priority prefetch of the clip), e.g. the next run in a suite's cycle. */
export function prefetchPreview(id: string) {
  if (previews.has(id) || previewsOff) return;
  void probePreview(id)
    .then((info) => {
      if (info.status !== 'pending') previews.set(id, info);
      if (info.status !== 'ready' || document.querySelector(`link[data-preview-prefetch="${CSS.escape(id)}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'video';
      link.href = previewUrl(id);
      link.dataset.previewPrefetch = id;
      document.head.append(link);
    })
    .catch(() => undefined);
}

function PreviewVideo({ id, onEnd, onHalf }: { id: string; onEnd?: () => void; onHalf?: () => void }) {
  const [info, setInfo] = useState<PreviewInfo | undefined>(() => previews.get(id));
  const [shown, setShown] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ onEnd, onHalf });
  useEffect(() => {
    callbacks.current = { onEnd, onHalf };
  });

  // Cycling and nothing to play (no preview, or it never finished rendering): hold the poster, then move on.
  useEffect(() => {
    if (info?.status !== 'none' || !callbacks.current.onEnd) return;
    const timer = window.setTimeout(() => callbacks.current.onEnd?.(), NO_PREVIEW_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [info]);

  // Ask the server (and keep asking while the row stays hovered and the clip is still rendering).
  useEffect(() => {
    if (info?.status === 'ready' || info?.status === 'none') return;
    const controller = new AbortController();
    let timer = 0;
    const ask = (tries: number) =>
      void probePreview(id, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          if (next.status !== 'pending') previews.set(id, next);
          if (next.status === 'pending' && tries < 10) timer = window.setTimeout(() => ask(tries + 1), next.retryMs);
          else setInfo(next.status === 'pending' ? { status: 'none' } : next);
        })
        .catch(() => undefined);
    ask(0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, info]);

  // The progress hairline follows the clip every frame (timeupdate is too coarse to look smooth).
  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    let half = false;
    const tick = () => {
      const element = video.current;
      if (element && bar.current && element.duration > 0) {
        const progress = element.currentTime / element.duration;
        bar.current.style.transform = `scaleX(${progress})`;
        if (!half && progress > 0.5) {
          half = true;
          callbacks.current.onHalf?.();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  if (info?.status !== 'ready') return null;
  return (
    <>
      <video
        ref={video}
        className="poster-video"
        data-shown={shown || undefined}
        src={previewUrl(id)}
        muted
        // Looping on its own; a suite cycling through its runs plays each once and moves on.
        loop={!onEnd}
        playsInline
        autoPlay
        preload="auto"
        disablePictureInPicture
        onPlaying={() => setShown(true)}
        onEnded={() => callbacks.current.onEnd?.()}
      />
      <span className="poster-progress" data-shown={shown || undefined}>
        <span ref={bar} />
      </span>
    </>
  );
}
