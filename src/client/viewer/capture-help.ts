import type { ReplaySource } from '../../shared/replay.ts';

export type CaptureTrack = 'performance' | 'bodies' | 'console' | 'network';

/** What a not-captured state says: what is missing, why it matters, and how this replay's source can capture it. */
export interface CaptureHelp {
  title: string;
  why: string;
  /** How the recording's own source captures it: a recorder option, or a CLI command. */
  how: string;
  /** The text to copy for `how`. */
  snippet: string;
  /** The CLI's way, offered under "Using the command line?" when the source is the browser recorder. */
  cli?: string;
}

const NAMES: Record<CaptureTrack, string> = {
  performance: 'performance data',
  bodies: 'request and response bodies',
  console: 'console output',
  network: 'network requests',
};

const WHY: Record<CaptureTrack, string> = {
  performance: 'Timings show what made a step slow: long tasks, layout shifts and slow requests.',
  bodies: 'Bodies show what the app sent and what it got back, which is often where a failure explains itself.',
  console: 'Logs and errors explain what went wrong between the steps you can see.',
  network: 'Requests show which calls a step waited on and which ones failed.',
};

const RECORDER: Partial<Record<CaptureTrack, string>> = {
  bodies: "capture: { network: 'bodies' }",
  console: "capture: { console: ['log', 'warn', 'error'] }",
  network: "capture: { network: 'headers' }",
};

const AGAIN: Record<CaptureTrack, string> = {
  performance: 'Capture again without --no-performance:',
  bodies: 'Capture again with --network bodies:',
  console: 'Capture again with the command line:',
  network: 'Capture again with the command line:',
};

function command(track: CaptureTrack, url: string) {
  const target = url || '<url>';
  return track === 'bodies' ? `replays capture ${target} --network bodies` : `replays capture ${target}`;
}

/**
 * The help for a track this recording lacks. `source` is the replay's (the browser recorder records `human` replays;
 * agents and the CLI record `agent` ones); `url` is the page it recorded, so a command can be copied as is.
 */
export function captureHelp(track: CaptureTrack, source: ReplaySource, url: string): CaptureHelp {
  const title = `This recording has no ${NAMES[track]}`;
  const cli = command(track, url);
  const option = RECORDER[track];
  if (source === 'human' && option)
    return { title, why: WHY[track], how: 'Turn it on in the recorder’s options, then record again:', snippet: option, cli };
  if (source === 'human')
    return {
      title,
      why: WHY[track],
      how: 'The browser recorder doesn’t record it. Capture this page with the command line:',
      snippet: cli,
    };
  return { title, why: WHY[track], how: AGAIN[track], snippet: cli };
}
