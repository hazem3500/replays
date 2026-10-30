import { RENDER_SPEEDS, type RenderSpeed } from '../../client/render/frames.ts';
import { HttpError } from '../../shared/http-error.ts';

export type RenderSpeedOption = RenderSpeed;
export const RENDER_SPEED_OPTIONS: readonly RenderSpeedOption[] = RENDER_SPEEDS;

/** Everything about a render besides its replay and speed; absent means off. */
export interface RenderOptions {
  /** Draw the viewer's step captions into the frames. */
  captions?: boolean;
  /** Fast-forward idle gaps as the viewer's "skip inactive" does; absent means on, like the player. */
  skipInactive?: boolean;
  /** The edit list's version (editsVersion) the video applies; '' or absent renders the replay as recorded. */
  edits?: string;
}

/** An edit list version as names carry it (editsVersion: base 36). */
export const EDITS_VERSION_PATTERN = /^[a-z0-9]{1,16}$/;

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** The replay id, or a 400 for anything that could escape its storage prefix. */
export function assertRenderId(id: string): string {
  if (!REPLAY_ID.test(id)) throw new HttpError(400, 'invalid replay id');
  return id;
}

export const normalizeRenderOptions = (options: RenderOptions): Required<RenderOptions> => ({
  captions: Boolean(options.captions),
  skipInactive: options.skipInactive !== false,
  edits: options.edits ?? '',
});

/**
 * `<speed>x`, `-skip` with skip inactive (the default), `-cc` with step captions, `-e<edits>` with an edit list: names the
 * job, its MP4 and its state file. Without `-skip` it is the full-idle-time render, as every render before skip was.
 */
export const renderVariant = (speed: RenderSpeedOption, options: RenderOptions = {}): string =>
  `${speed}x${options.skipInactive === false ? '' : '-skip'}${options.captions ? '-cc' : ''}${options.edits ? `-e${options.edits}` : ''}`;

export const renderJobId = (id: string, speed: RenderSpeedOption, options: RenderOptions = {}): string =>
  `${id}-${renderVariant(speed, options)}`;

/** The stored MP4, under the replay's prefix so retention prunes it with the replay. */
export const renderOutputKey = (id: string, speed: RenderSpeedOption, options: RenderOptions = {}): string =>
  `${assertRenderId(id)}/rendered-${renderVariant(speed, options)}.mp4`;

/** The job's mirrored state, so a job a dead process left behind reads as failed after a restart. */
export const renderStateKey = (id: string, speed: RenderSpeedOption, options: RenderOptions = {}): string =>
  `${assertRenderId(id)}/render-${renderVariant(speed, options)}.json`;

const isSpeed = (value: number): value is RenderSpeedOption => RENDER_SPEED_OPTIONS.some((speed) => speed === value);

/** The inverse of renderVariant for a `render-<variant>.json` state file name, or undefined. */
export function parseStateFile(name: string): { speed: RenderSpeedOption; options: Required<RenderOptions> } | undefined {
  const match = /^render-([\d.]+)x(-skip)?(-cc)?(?:-e([a-z0-9]{1,16}))?\.json$/.exec(name);
  const speed = Number(match?.[1]);
  if (!match || !isSpeed(speed)) return;
  return { speed, options: { skipInactive: Boolean(match[2]), captions: Boolean(match[3]), edits: match[4] ?? '' } };
}

/**
 * One short line for the job status. Playwright launch errors carry pages of browser logs; keep the first line plus the
 * browser's own stderr line ("error while loading shared libraries…", "No usable sandbox…").
 */
export function summarizeError(reason: unknown): string {
  const lines = (reason instanceof Error ? reason.message : String(reason)).split('\n');
  const browserError = lines.find((line) => /\]\[err\] /.test(line))?.replace(/^.*\]\[err\]\s*/, '');
  const first = lines[0] ?? '';
  return (browserError ? `${first} (${browserError})` : first).slice(0, 300);
}
