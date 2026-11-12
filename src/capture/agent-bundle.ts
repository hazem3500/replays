import type { CaptureNetwork, NetworkBodyLimits } from '../shared/capture-profile.ts';
import type { ReplayContext } from '../shared/context.ts';
import type { RedactionRules } from '../shared/redaction.ts';
import { REPLAY_FORMAT_VERSION, type ConsoleLevel, type ReplayBundle, type ReplayPerson, type ReplayStep } from '../shared/replay.ts';
import type { RecorderPrivacyMode } from '../recorder/types.ts';
import { capturedRecord } from './capture-settings.ts';
import { inputsVisible } from './capture-privacy.ts';
import { compressPacingWaits, type PacingSpan } from './pacing-waits.ts';
import { networkEntries, sanitizeReplayBundle, sanitizeUrl } from './sanitize.ts';
import type { RecordedTracks } from './session.ts';

/** A step stamped with the epoch (ms) it happened at, like `RecorderSession.step` and the capture script's steps. */
export type EpochStep = Omit<ReplayStep, 'at'> & { at?: number; epoch: number };

export interface AgentBundleInput {
  id: string;
  title: string;
  url: string;
  viewport: { width: number; height: number };
  /** What `RecorderSession.stop()` returned; its steps (from `session.step`) are placed on the timeline too. */
  tracks: RecordedTracks;
  /** The parsed HAR (Playwright `recordHar`); without it the bundle has no network track. */
  har?: unknown;
  /** More steps, each stamped with its epoch. */
  steps?: readonly EpochStep[];
  tags?: readonly string[];
  profile?: string;
  people?: readonly ReplayPerson[];
  /** The recording has a video file named `session.mp4` next to the bundle. */
  video?: boolean;
  network?: CaptureNetwork;
  /** The HAR carries request and response bodies. */
  bodiesRecorded?: boolean;
  bodies?: NetworkBodyLimits;
  performance?: boolean;
  performanceChosen?: boolean;
  /** Keep only these console levels. */
  console?: readonly ConsoleLevel[];
  privacy?: RecorderPrivacyMode;
  redaction?: RedactionRules;
  context?: ReplayContext;
  suiteRun?: { suiteId: string; runId: string };
  /** Waits to collapse on the timeline, as epoch ranges. */
  pacingSpans?: readonly PacingSpan[];
}

/** The steps on the replay's clock: the caller's epoch-stamped ones and the session's, oldest first. */
function stepsOnClock(input: AgentBundleInput): ReplayStep[] {
  const { origin } = input.tracks;
  return [
    ...(input.steps ?? []).map(({ epoch, ...step }) => ({ ...step, at: Math.max(0, epoch - origin) })),
    ...input.tracks.steps.map((step) => ({ ...step, at: Math.max(0, step.at - origin) })),
  ].sort((a, b) => a.at - b.at);
}

function metaOf(input: AgentBundleInput, network: CaptureNetwork): ReplayBundle['meta'] {
  const { tracks } = input;
  return {
    id: input.id,
    title: input.title,
    url: sanitizeUrl(input.url),
    capturedAt: new Date(tracks.origin).toISOString(),
    duration: tracks.duration,
    viewport: input.viewport,
    eventCount: tracks.events.length,
    version: 1,
    formatVersion: REPLAY_FORMAT_VERSION,
    source: 'agent',
    ...(input.video ? { videoFile: 'session.mp4' } : {}),
    ...(input.tags?.length ? { tags: [...input.tags] } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.people?.length ? { people: [...input.people] } : {}),
    captured: capturedRecord(
      {
        network,
        performance: input.performance ?? true,
        performanceChosen: input.performanceChosen === true,
        ...(input.console ? { console: [...input.console] } : {}),
        inputsVisible: inputsVisible(input.privacy),
      },
      input.video === true,
      input.bodiesRecorded === true,
    ),
  };
}

/**
 * Assembles the bundle an agent capture uploads: the recorded tracks, the network from the HAR, the steps on the
 * replay's clock, the meta, and the host's redaction. `capture()` and a caller recording its own page build it the same way.
 */
export function buildAgentBundle(input: AgentBundleInput): ReplayBundle {
  const { tracks, redaction, har } = input;
  const { origin } = tracks;
  const network = har === undefined ? 'off' : (input.network ?? 'headers');
  const bodiesRecorded = input.bodiesRecorded === true;
  const keepVisibleInputs = inputsVisible(input.privacy);
  const spans = (input.pacingSpans ?? []).map(({ from, to }) => ({ from: from - origin, to: to - origin }));
  let bundle: ReplayBundle = {
    meta: metaOf(input, network),
    events: tracks.events,
    console: input.console ? tracks.console.filter((entry) => input.console?.includes(entry.level)) : tracks.console,
    network:
      network === 'off'
        ? []
        : networkEntries(har, origin, redaction, bodiesRecorded ? (input.bodies ?? {}) : undefined).sort((a, b) => a.at - b.at),
    steps: stepsOnClock(input),
    ...(input.performance === false ? {} : { performance: tracks.performance }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.suiteRun ? { suiteRun: input.suiteRun } : {}),
  };
  bundle = compressPacingWaits(bundle, spans);
  // why: the host's rules also cover what the steps added (labels, the title), as the server's upload pass does.
  if (redaction || bodiesRecorded || keepVisibleInputs) bundle = sanitizeReplayBundle(bundle, redaction, { keepVisibleInputs });
  return bundle;
}
