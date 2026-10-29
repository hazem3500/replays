import type { PosterMoment } from '../../shared/profiles.ts';
import { assertReplayId } from '../../shared/replay.ts';

/** Bump when the poster moment or format changes (the client's poster URL carries it too). */
export const POSTER_VERSION = 2;
/** Bump when the opening still's moment or format changes (the client's URL carries it too). */
export const OPEN_STILL_VERSION = 1;
/** Bump when the preview's speed, cap or encoding changes. */
export const PREVIEW_VERSION = 2;

/**
 * A poster moment other than the default: a profile's named moment or a time (ms) a plugin's `posterAt` chose. The
 * poster's key names it (posterKey), so a changed choice is a different file: nothing stale is served, the old one is
 * pruned with the replay. The default moment keeps the plain key, so stored posters stay valid where nothing chooses.
 */
export type PosterChoice = PosterMoment | number;

/** The id shape `assertReplayId` accepts; listings skip any other top-level prefix. */
export const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Where review suites live, beside the replay prefixes. */
export const SUITES_PREFIX = '_suites/';

/** `''` for the default moment, else `first-error`, `last-step` or `t<ms>`. */
export function posterTag(choice?: PosterChoice): string {
  if (choice === undefined || choice === 'middle-step') return '';
  return typeof choice === 'number' ? `t${Math.max(0, Math.round(choice))}` : choice;
}

const replayFile = (id: string, file: string): string => `${assertReplayId(id)}/${file}`;

/** The uploaded bundle; immutable once written. */
export const replayKey = (id: string): string => replayFile(id, 'replay.json');
/** The list summary sidecar, rebuilt whenever it is missing or stale. */
export const metaKey = (id: string): string => replayFile(id, 'meta.json');
/** `{ by, at }` while someone keeps the replay. */
export const keepKey = (id: string): string => replayFile(id, 'keep.json');
/** The non-destructive edit list. */
export const editsKey = (id: string): string => replayFile(id, 'edits.json');
/** Title, tags and profile changed after upload (the bundle never changes). */
export const overridesKey = (id: string): string => replayFile(id, 'overrides.json');
/** A soft delete: present while the replay is in the trash. */
export const trashKey = (id: string): string => replayFile(id, 'trash.json');
/** The rendered session video. */
export const videoKey = (id: string): string => replayFile(id, 'session.mp4');
/** A committed sample, relative to the sample directory. */
export const sampleKey = (id: string): string => `${assertReplayId(id)}.json`;
/** A review suite. */
export const suiteKey = (id: string): string => `${SUITES_PREFIX}${assertReplayId(id)}.json`;
/** Present while a review suite is kept. */
export const suiteKeepKey = (id: string): string => `${SUITES_PREFIX}${assertReplayId(id)}.keep.json`;

/**
 * The list thumbnail (src/server/posters.ts); under the replay's prefix so retention prunes it with the replay.
 * Versioned: when the poster moment changes, older posters are simply not found and remade. A non-default `choice`
 * (posterTag) is part of the name for the same reason.
 */
export function posterKey(id: string, choice?: PosterChoice): string {
  const tag = posterTag(choice);
  return replayFile(id, `poster.v${POSTER_VERSION}${tag ? `-${tag}` : ''}.jpg`);
}

/**
 * The opening still (src/server/posters.ts): the replay as the viewer first paints it (t = 0), at the poster's size, so
 * the page transition lands on exactly what rrweb draws. Next to the poster.
 */
export const openStillKey = (id: string): string => replayFile(id, `open.v${OPEN_STILL_VERSION}.jpg`);

/** The hover preview clip (src/server/posters.ts), next to the poster. */
export const previewKey = (id: string): string => replayFile(id, `preview.v${PREVIEW_VERSION}.mp4`);

/** A suite file's id and whether it is the suite's keep marker; undefined for anything else under the prefix. */
export function parseSuiteKey(key: string): { id: string; kept: boolean } | undefined {
  const match = /^_suites\/([a-z0-9][a-z0-9-]{0,79})(\.keep)?\.json$/.exec(key);
  const id = match?.[1];
  return id === undefined ? undefined : { id, kept: match?.[2] !== undefined };
}
