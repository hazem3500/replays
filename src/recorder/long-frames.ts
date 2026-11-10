import { MAX_LONG_FRAMES } from './interaction-math.ts';
import type { ReplayLongFrame, ReplayLongFrameScript, ReplayPerformanceTrack } from '../shared/replay.ts';
import { redactText } from './redact.ts';

const MIN_DURATION_MS = 50;
const MAX_PER_MINUTE = 30;
const MAX_SCRIPTS = 3;

interface FrameScript {
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
  invokerType?: string;
  duration?: number;
  forcedStyleAndLayoutDuration?: number;
}

interface FrameEntry extends PerformanceEntry {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: FrameScript[];
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Origin and path only: no credentials, query or hash, and opaque path segments are redacted. Non-web schemes keep the scheme. */
export function scriptOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${url.protocol}`;
    return redactText(`${url.origin}${url.pathname}`, 200);
  } catch {
    return '';
  }
}

/** An invoker is a selector-like label or a URL; URLs lose their query and hash. */
function invokerLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.startsWith('http') ? scriptOrigin(value) : value;
  return redactText(text, 120);
}

/** The heaviest scripts of one frame, trimmed to the fields the viewer explains slowness with. */
export function trimScripts(scripts: readonly FrameScript[] | undefined): ReplayLongFrameScript[] {
  return [...(scripts ?? [])]
    .sort((a, b) => num(b.duration) - num(a.duration))
    .slice(0, MAX_SCRIPTS)
    .map((script) => ({
      sourceURL: scriptOrigin(script.sourceURL),
      sourceFunctionName: redactText(String(script.sourceFunctionName ?? ''), 80),
      invoker: invokerLabel(script.invoker),
      invokerType: redactText(String(script.invokerType ?? ''), 40),
      duration: num(script.duration),
      forcedStyleAndLayoutDuration: num(script.forcedStyleAndLayoutDuration),
    }));
}

function longFrame(entry: FrameEntry): ReplayLongFrame {
  const offset = (value: number | undefined) => Math.max(0, num((value ?? 0) - entry.startTime));
  return {
    at: performance.timeOrigin + entry.startTime,
    duration: num(entry.duration),
    blockingDuration: num(entry.blockingDuration),
    renderStart: offset(entry.renderStart),
    styleAndLayoutStart: offset(entry.styleAndLayoutStart),
    scripts: trimScripts(entry.scripts),
  };
}

/** Keeps the frame once it passes the duration floor and the per-minute and total caps; returns whether it was kept. */
export function createLongFrameFilter() {
  const perMinute = new Map<number, number>();
  let total = 0;
  return (entry: PerformanceEntry): boolean => {
    if (total >= MAX_LONG_FRAMES || !(entry.duration > MIN_DURATION_MS) || !(entry.startTime >= 0)) return false;
    const minute = Math.floor(entry.startTime / 60_000);
    const used = perMinute.get(minute) ?? 0;
    if (used >= MAX_PER_MINUTE) return false;
    perMinute.set(minute, used + 1);
    total += 1;
    return true;
  };
}

/** Observes Long Animation Frames (Chromium) into `track.longFrames`; returns the stop function. */
export function captureLongFrames(
  track: ReplayPerformanceTrack,
  grow: (bytes: number) => void,
  onFrame: () => void = () => {},
): () => void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
    return () => {};
  }
  const keep = createLongFrameFilter();
  let active = true;
  try {
    const observer = new PerformanceObserver((list) => {
      if (!active) return;
      for (const entry of list.getEntries()) {
        if (!keep(entry)) continue;
        const frame = longFrame(entry);
        const frames = track.longFrames ?? [];
        if (!track.longFrames) Object.assign(track, { longFrames: frames });
        frames.push(frame);
        grow(JSON.stringify(frame).length);
      }
      onFrame();
    });
    observer.observe({ type: 'long-animation-frame', buffered: false });
    track.supported.push('long-animation-frame');
    return () => {
      active = false;
      observer.disconnect();
    };
  } catch {
    // why: advertised observer types may still be unavailable under browser policy.
    return () => {};
  }
}
