import {
  assertCaptureProfile,
  CAPTURE_NETWORK,
  type CaptureNetwork,
  type CaptureProfile,
  type NetworkBodyLimits,
} from '../shared/capture-profile.ts';
import type { ReplayCaptured } from '../shared/network-bodies.ts';
import { assertProfileConfig, BUILT_IN_PROFILES, type ProfileConfig } from '../shared/profiles.ts';
import type { ConsoleLevel } from '../shared/replay.ts';

/** What one capture records, after the profile's defaults and the explicit flags are combined. */
export interface CaptureSettings {
  network: CaptureNetwork;
  /** Body limits, only with `network: 'bodies'`. */
  bodies?: NetworkBodyLimits;
  performance: boolean;
  /** Console levels kept; absent keeps all. */
  console?: readonly ConsoleLevel[];
  /** Mask every text node, not only inputs. */
  maskAllText: boolean;
}

/**
 * The capture block of profile `id` as the deployment declares it: core's built-in, overridden by a plugin's, overridden
 * by the config file's (the same order the server merges in). Undefined when no source names the id.
 */
export function profileCapture(
  id: string | undefined,
  sources: { config?: readonly ProfileConfig[] | undefined; plugins?: readonly ProfileConfig[] | undefined },
): CaptureProfile | undefined {
  if (id === undefined) return undefined;
  for (const [index, profile] of (sources.config ?? []).entries()) assertProfileConfig(profile, `profiles[${index}]`);
  const found = [BUILT_IN_PROFILES, sources.plugins ?? [], sources.config ?? []].map((list) => list.find((profile) => profile.id === id));
  const declared = found.filter((profile) => profile !== undefined);
  if (!declared.length) return undefined;
  const capture = declared.findLast((profile) => profile.capture !== undefined)?.capture;
  if (capture !== undefined) assertCaptureProfile(capture, `profile ${id}: capture`);
  return capture ?? {};
}

/** `--network <off|headers|bodies>`, checked. */
export function networkFlag(value: string | undefined): CaptureNetwork | undefined {
  if (value === undefined) return undefined;
  const network = CAPTURE_NETWORK.find((option) => option === value);
  if (!network) throw new Error(`--network must be one of ${CAPTURE_NETWORK.join(', ')}`);
  return network;
}

/**
 * The profile's capture defaults under the explicit flags. invariant: nothing here loosens privacy: bodies stay off
 * unless the profile or `--network bodies` asks, and a privacy setting the CLI cannot honour stops the capture.
 */
export function captureSettings(
  profile: CaptureProfile | undefined,
  flags: { network?: CaptureNetwork | undefined; performance?: boolean | undefined },
): CaptureSettings {
  const own = profile ?? {};
  if (own.privacy?.blockMedia)
    throw new Error('this profile asks for privacy.blockMedia, which the capture CLI cannot apply; record it with the recorder');
  const network = flags.network ?? own.network ?? 'headers';
  return {
    network,
    ...(network === 'bodies' ? { bodies: own.bodies ?? {} } : {}),
    performance: flags.performance ?? own.performance ?? true,
    ...(own.console ? { console: own.console } : {}),
    maskAllText: own.privacy?.maskAllText === true,
  };
}

/** `meta.captured` for a capture: bodies count only when the driver could record them. */
export function capturedRecord(
  settings: Pick<CaptureSettings, 'network' | 'performance' | 'console'>,
  video: boolean,
  bodiesRecorded: boolean,
): ReplayCaptured {
  const network = settings.network === 'bodies' && !bodiesRecorded ? 'headers' : settings.network;
  return { console: settings.console === undefined || settings.console.length > 0, network, performance: settings.performance, video };
}
