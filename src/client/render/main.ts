/**
 * The page headless Chromium loads to render a replay to video
 * (src/server/renderer.ts). It mounts the same ReplayController and replay
 * cursor as the viewer, at the recorded viewport 1:1 with no viewer chrome,
 * and exposes `window.__render` so the server can step it frame by frame:
 * `plan()` lists the frames that need a screenshot, `show(i)` seeks to frame i
 * and resolves once the frame is ready to capture. `plan(fps, speed, options)`
 * follows the viewer's options: `skipInactive` fast-forwards idle gaps like
 * the viewer, `captions` draws the step captions (step-caption.ts/.css, scaled
 * up for video) into every frame; posters and previews never ask for them.
 * A video export of an edited replay loads with `?edits=<version>`: the page fetches the stored edit list,
 * checks it is still that version, and plays the edited bundle (src/shared/edits.ts applyEdits), so trims and
 * cuts land in the video exactly as the viewer plays them. Its effects are drawn into every frame through the same
 * EffectsLayer as the viewer (zoom, and blur boxes that hide sensitive content), and its captions replace the step
 * captions. Posters and previews show the replay as recorded.
 */
import './render.css';

import { applyEdits, assertReplayEdits, editListOf, editsVersion, type ReplayEdits } from '../../shared/edits.ts';
import { editCaptionAt, effectsKey } from '../../shared/effects.ts';
import type { PosterMoment } from '../../shared/purposes.ts';
import { isFailedRequest, type ReplayBundle } from '../../shared/replay.ts';
import { buildCursorTrack, cursorInput, cursorPose } from '../cursor-motion.ts';
import { ReplayController } from '../player.ts';
import { idleGaps } from '../../shared/skip.ts';
import { CAPTION_IN_MS, captionAt, captionKey, exportCaptionScale } from '../step-caption.ts';
import { dirtyAt, exportMap, exportTimes, type PlaybackMap, posterMoment, poseKey, type PreviewPlan, previewPlan } from './frames.ts';

export interface RenderApi {
  ready: boolean;
  error?: string;
  viewport: { width: number; height: number };
  duration: number;
  /** `captions`: draw the step captions (video export with captions). */
  plan(fps: number, speed: number, options?: RenderPlanOptions): { count: number; dirty: number[] };
  show(index: number): Promise<void>;
  /**
   * Seeks to the poster moment (posterMoment): a named `moment` (the replay's purpose) or a time in ms (a plugin's
   * `posterAt`), clamped to the replay; waits for its assets and returns that time.
   */
  poster(moment?: PosterMoment | number): Promise<number>;
  /** Frames for the hover preview (frames.ts previewPlan, 3× with idle gaps squeezed). */
  previewPlan(fps: number, maxOutputMs: number): PreviewPlan;
  /** Seeks to `time` (ms); waits for assets when a new document was rebuilt on the way. */
  showAt(time: number): Promise<void>;
}

export interface RenderPlanOptions {
  /** Draw the step captions. */
  captions?: boolean;
  /** Fast-forward idle gaps as the viewer's "skip inactive" does. */
  skipInactive?: boolean;
}

declare global {
  interface Window {
    __render?: RenderApi;
  }
}

/** Full snapshots (type 2) rebuild the document; wait for its images and fonts before capturing. */
const FULL_SNAPSHOT = 2;
const ASSET_WAIT_MS = 4000;

function replayId() {
  const fromQuery = new URLSearchParams(location.search).get('id');
  return fromQuery ?? decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
}

async function assetsSettled(document: Document | null | undefined) {
  if (!document) return;
  const images = [...document.images].filter((image) => !image.complete);
  const pending = [
    ...images.map(
      (image) =>
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
    ),
    document.fonts?.ready,
  ];
  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, ASSET_WAIT_MS))]);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** The stored edit list, when it is still the `version` this render was asked for. */
async function loadEdits(id: string, version: string): Promise<ReplayEdits> {
  const response = await fetch(`/internal/render/${encodeURIComponent(id)}/edits.json`);
  if (!response.ok) throw new Error(`edits ${response.status}`);
  const edits = editListOf((await response.json()) as ReplayEdits);
  assertReplayEdits(edits);
  if (editsVersion(edits) !== version) throw new Error('the edits changed since this export started; export again');
  return edits;
}

async function start() {
  const id = replayId();
  const editsParam = new URLSearchParams(location.search).get('edits');
  const [response, edits] = await Promise.all([
    fetch(`/internal/render/${encodeURIComponent(id)}/bundle.json`),
    editsParam ? loadEdits(id, editsParam) : undefined,
  ]);
  if (!response.ok) throw new Error(`bundle ${response.status}`);
  const { bundle, effects } = applyEdits((await response.json()) as ReplayBundle, edits);
  const host = document.querySelector<HTMLElement>('#render-host');
  if (!host) throw new Error('no render host');
  const { width, height } = bundle.meta.viewport;
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;

  const controller = new ReplayController(bundle, { effects });
  controller.mount(host);
  const first = bundle.events[0]?.timestamp ?? 0;
  const eventTimes = Float64Array.from(bundle.events, (event) => event.timestamp - first);
  const snapshotTimes = eventTimes.filter((_, index) => bundle.events[index]?.type === FULL_SNAPSHOT);
  // The same pure track ReplayCursor draws from, so "cursor changed" matches what lands on screen.
  const track = buildCursorTrack(cursorInput(bundle.events));
  const cursorKey = (time: number) => poseKey(cursorPose(track, first + time));
  let captions = false;
  // The edit list's own captions, when it has any, are always drawn (they are part of the edit).
  const editCaptions = effects.captions.length > 0;
  const captionFrame = (time: number) =>
    editCaptions
      ? editCaptionAt(effects.captions, time, map.outputAt)
      : captions
        ? captionAt(bundle.steps, time, controller.duration, map.outputAt)
        : undefined;
  const effectsAt = (time: number) =>
    editCaptions || effects.zooms.length || effects.blurs.length ? effectsKey(effects, { width, height }, time) : '';
  let map: PlaybackMap = exportMap({ duration: controller.duration, speed: 1 });
  let times: number[] = [0];
  let shownAt = -1;
  // Exported captions are larger than the viewer's, proportional to the recorded viewport.
  host.style.setProperty('--caption-scale', String(exportCaptionScale(width)));

  // The step caption, built like Viewer.tsx's StepCaption and posed per frame: its CSS entrance
  // animation is paused at this frame's moment, so every frame is deterministic.
  let caption: { root: HTMLElement; text: HTMLElement; index: number } | undefined;
  const drawCaption = async (time: number) => {
    const frame = captionFrame(time);
    if (!frame) {
      caption?.root.remove();
      caption = undefined;
      return;
    }
    if (caption?.index !== frame.index) {
      caption?.root.remove();
      const root = document.createElement('div');
      root.className = 'step-caption';
      root.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'step-caption-text';
      const label = document.createElement('span');
      label.className = 'step-caption-label';
      label.textContent = frame.label;
      if (editCaptions) text.append(label);
      else {
        const number = document.createElement('span');
        number.className = 'step-caption-number';
        number.textContent = String(frame.index + 1);
        text.append(number, label);
      }
      root.append(text);
      host.append(root);
      caption = { root, text, index: frame.index };
      await document.fonts.load('500 14px "Inter Variable"', `${frame.index + 1} ${frame.label}`).catch(() => undefined);
    }
    caption.text.style.animationPlayState = 'paused';
    caption.text.style.animationDelay = `${-Math.min(frame.enteredMs, CAPTION_IN_MS)}ms`;
  };

  const api: RenderApi = {
    ready: false,
    viewport: { width, height },
    duration: controller.duration,
    plan(fps, speed, options = {}) {
      captions = Boolean(options.captions) && bundle.steps.length > 0;
      const gaps = options.skipInactive ? idleGaps(bundle.events as unknown as Parameters<typeof idleGaps>[0]) : [];
      map = exportMap({ duration: controller.duration, speed, gaps });
      times = exportTimes(map, fps, controller.duration);
      const dirty = dirtyAt(
        times,
        eventTimes,
        captions || editCaptions
          ? (time) => `${cursorKey(time)}|${captionKey(captionFrame(time))}|${effectsAt(time)}`
          : (time) => `${cursorKey(time)}|${effectsAt(time)}`,
      );
      return { count: times.length, dirty };
    },
    async show(index) {
      await api.showAt(times[Math.min(index, times.length - 1)] ?? 0);
    },
    async showAt(time) {
      const previous = shownAt;
      shownAt = time;
      controller.seek(time);
      await drawCaption(time);
      const navigated = previous < 0 || time < previous || snapshotTimes.some((at) => at > previous && at <= time);
      // rrweb applies the DOM synchronously and Page.captureScreenshot waits for a fresh compositor frame,
      // so only a navigation (new document, new images and fonts) needs to wait here.
      if (navigated) {
        await assetsSettled(host.querySelector('iframe')?.contentDocument);
        await nextFrame();
      }
    },
    previewPlan(nextFps, maxOutputMs) {
      return previewPlan({ eventTimes, duration: controller.duration, fps: nextFps, maxOutputMs });
    },
    async poster(moment) {
      const time = posterMoment({
        ...(typeof moment === 'number' ? { at: moment } : moment ? { moment } : {}),
        errorTimes: [
          ...bundle.console.filter((entry) => entry.level === 'error').map((entry) => entry.at),
          ...bundle.network.filter(isFailedRequest).map((entry) => entry.at),
        ],
        stepTimes: bundle.steps.map((step) => step.at),
        snapshotTimes,
        duration: controller.duration,
      });
      document.documentElement.dataset.poster = '';
      controller.seek(time);
      await assetsSettled(host.querySelector('iframe')?.contentDocument);
      await nextFrame();
      return time;
    },
  };
  window.__render = api;
  await api.show(0);
  api.ready = true;
}

start().catch((error: unknown) => {
  window.__render = {
    ready: true,
    error: error instanceof Error ? error.message : String(error),
    viewport: { width: 0, height: 0 },
    duration: 0,
    plan: () => ({ count: 0, dirty: [] }),
    show: async () => undefined,
    showAt: async () => undefined,
    previewPlan: () => ({ times: [], dirty: [], capped: false, coveredMs: 0 }),
    poster: async () => 0,
  };
});
