import { CURSOR_MOTION_STYLES, type CursorMotionStyle } from '../../shared/cursor.ts';
import { planStyle } from '../cursor-styles.ts';
import { REST_HEADING } from '../cursor-motion.ts';

export interface CursorMotionPreview {
  style: CursorMotionStyle;
  label: string;
  description: string;
  /** The planned hotspot path, fitted into PREVIEW_BOX. */
  trace: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** SMIL `animateMotion` timing along `trace`, rests included. */
  keyPoints: string;
  keyTimes: string;
  durationMs: number;
}

export const PREVIEW_BOX = { width: 112, height: 56 } as const;

const COPY: Record<CursorMotionStyle, { label: string; description: string }> = {
  signature_arc: { label: 'Signature arc', description: 'A soft arc with a gentle follow-through' },
  spring_settle: { label: 'Spring settle', description: 'Lands with a small springy wobble' },
  magnetic: { label: 'Magnetic', description: 'Speeds up, then snaps onto the target' },
  comet_swoop: { label: 'Comet swoop', description: 'A wide, sweeping arc' },
  adaptive: { label: 'Adaptive', description: 'Direct for short moves, a swoop for long ones' },
  classic: { label: 'Classic', description: 'Banked turns and a springy stop' },
};

/** A typical recorded move in page points: down-left to up-right, long enough to show each style's shape. */
const FROM = { x: 0, y: 150 };
const TO = { x: 420, y: 0 };
/** Room for the arrow, which hangs right of and below its hotspot. */
const PAD = { left: 8, top: 8, right: 18, bottom: 18 };
const REST_BEFORE_MS = 450;
const REST_AFTER_MS = 900;
const MAX_POINTS = 48;

const round = (value: number) => Math.round(value * 10) / 10;

function preview(style: CursorMotionStyle): CursorMotionPreview {
  const raw = planStyle(style, FROM, TO, REST_HEADING);
  const step = Math.max(1, Math.ceil(raw.length / MAX_POINTS));
  const samples = raw.filter((_, index) => index % step === 0 || index === raw.length - 1);
  const xs = samples.map((p) => p.x);
  const ys = samples.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 1);
  const spanY = Math.max(Math.max(...ys) - minY, 1);
  const innerW = PREVIEW_BOX.width - PAD.left - PAD.right;
  const innerH = PREVIEW_BOX.height - PAD.top - PAD.bottom;
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offsetX = PAD.left + (innerW - spanX * scale) / 2;
  const offsetY = PAD.top + (innerH - spanY * scale) / 2;
  const points = samples.map((p) => ({ x: round(offsetX + (p.x - minX) * scale), y: round(offsetY + (p.y - minY) * scale) }));
  let length = 0;
  let previous = points[0] ?? FROM;
  const lengths = points.map((p) => {
    length += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
    return length;
  });
  const total = Math.max(length, 1e-6);
  const durationMs = REST_BEFORE_MS + (samples.at(-1)?.t ?? 0) + REST_AFTER_MS;
  const times = samples.map((p) => (REST_BEFORE_MS + p.t) / durationMs);
  const fractions = lengths.map((at) => Math.min(at / total, 1));
  return {
    style,
    ...COPY[style],
    trace: points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '),
    start: points[0] ?? FROM,
    end: points.at(-1) ?? TO,
    keyPoints: [0, ...fractions, 1].map((value) => value.toFixed(4)).join(';'),
    keyTimes: [0, ...times, 1].map((value) => value.toFixed(4)).join(';'),
    durationMs: Math.round(durationMs),
  };
}

/** Every style's mini-preview, planned once with the same planner the replay uses. */
export const CURSOR_MOTION_PREVIEWS: readonly CursorMotionPreview[] = CURSOR_MOTION_STYLES.map(preview);
