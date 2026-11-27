import type { ReplayBundle } from '../../shared/replay.ts';
import { isRecord } from '../../shared/validate.ts';

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const MEDIA_INTERACTION = 7;
const MEDIA_TAGS = new Set(['audio', 'video']);

type WireEvent = ReplayBundle['events'][number];

const isMediaInteraction = (event: WireEvent) =>
  event.type === INCREMENTAL && isRecord(event.data) && event.data.source === MEDIA_INTERACTION;

function recordTags(node: unknown, tags: Map<number, string>) {
  if (!isRecord(node)) return;
  if (typeof node.id === 'number' && typeof node.tagName === 'string') tags.set(node.id, node.tagName.toLowerCase());
  if (Array.isArray(node.childNodes)) for (const child of node.childNodes) recordTags(child, tags);
}

/**
 * The events without media interactions recorded on elements that are not `<audio>` or `<video>`.
 * why: a player component that dispatches its own `play`/`pause` events is recorded as a media interaction, and
 * rrweb's replayer then calls `pause()` on that element at every pause; it has none, so every paused seek throws
 * and nothing after it (the comparison's other recordings) is rendered. Such an element has no media state to replay.
 */
export function withoutForeignMediaEvents(events: WireEvent[]): WireEvent[] {
  if (!events.some(isMediaInteraction)) return events;
  const tags = new Map<number, string>();
  return events.filter((event) => {
    if (!isRecord(event.data)) return true;
    if (event.type === FULL_SNAPSHOT) recordTags(event.data.node, tags);
    else if (event.type === INCREMENTAL && event.data.source === MUTATION && Array.isArray(event.data.adds))
      for (const addition of event.data.adds) if (isRecord(addition)) recordTags(addition.node, tags);
    if (!isMediaInteraction(event) || typeof event.data.id !== 'number') return true;
    const tag = tags.get(event.data.id);
    return tag === undefined || MEDIA_TAGS.has(tag);
  });
}
