import { contentTypeAllowed, DEFAULT_BODY_LIMITS, type RecorderBodyLimits } from './body-limits.ts';
import type { ReplayCaptured, ReplayConsoleLevel } from './bundle-types.ts';
import type { RecorderCapture, RecorderCaptureNetwork, RecorderOptions } from './types.ts';

const NETWORK: readonly RecorderCaptureNetwork[] = ['off', 'headers', 'bodies'];

export type ResolvedCapture = {
  network: RecorderCaptureNetwork;
  bodies: RecorderBodyLimits;
  consoleLevels: readonly ReplayConsoleLevel[];
  maskAllText: boolean;
  blockMedia: boolean;
};

function assertCapture(capture: RecorderCapture) {
  if (capture.network !== undefined && !NETWORK.includes(capture.network))
    throw new Error(`capture.network must be one of ${NETWORK.join(', ')}`);
  if (capture.bodies === undefined) return;
  if (capture.network !== 'bodies') throw new Error('capture.bodies only applies with network: "bodies"');
  const { maxBytes, contentTypes } = capture.bodies;
  if (maxBytes !== undefined && !(Number.isInteger(maxBytes) && maxBytes >= 0 && maxBytes <= DEFAULT_BODY_LIMITS.maxBytes))
    throw new Error(`capture.bodies.maxBytes must be a whole number of bytes from 0 to ${DEFAULT_BODY_LIMITS.maxBytes}`);
  const loosens = contentTypes?.find(
    (type) => typeof type !== 'string' || !contentTypeAllowed(type.replace('*', 'x'), DEFAULT_BODY_LIMITS.contentTypes),
  );
  if (loosens !== undefined) throw new Error(`capture.bodies.contentTypes can only narrow ${DEFAULT_BODY_LIMITS.contentTypes.join(', ')}`);
}

/**
 * The capture a recorder runs with. invariant: `capture` (often a profile's
 * block) only tightens privacy, and `privacy.captureNetwork: false` keeps the
 * network off whatever it says.
 */
export function resolveCapture(options: Pick<RecorderOptions, 'capture' | 'privacy'>): ResolvedCapture {
  const capture = options.capture ?? {};
  const privacy = options.privacy ?? {};
  assertCapture(capture);
  const sanitize = privacy.sanitize !== false;
  return {
    network: privacy.captureNetwork === false ? 'off' : (capture.network ?? 'headers'),
    bodies: capture.bodies ?? {},
    consoleLevels: privacy.consoleLevels ?? capture.console ?? ['warn', 'error'],
    maskAllText: (sanitize && privacy.maskAllText !== false) || capture.privacy?.maskAllText === true,
    blockMedia: privacy.blockMedia !== false || capture.privacy?.blockMedia === true,
  };
}

/** `meta.captured`: the recorder never records performance entries or video. */
export function capturedRecord(capture: ResolvedCapture, bodiesRead: boolean): ReplayCaptured {
  const network = capture.network === 'bodies' && !bodiesRead ? 'headers' : capture.network;
  return { console: capture.consoleLevels.length > 0, network, performance: false, video: false };
}
