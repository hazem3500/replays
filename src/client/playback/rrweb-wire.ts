import type { Replayer } from 'rrweb';

import type { ReplayBundle } from '../../shared/replay.ts';

/**
 * The portable wire schema retains extensible rrweb payloads rather than validating a frozen event union.
 * rrweb owns decoding those payloads at mount; its constructor can reject unsupported or malformed data.
 * The typed lint configuration permits only this adapter's protocol assertion, without serializing or rewriting events.
 */
export function rrwebEvents(events: ReplayBundle['events']): ConstructorParameters<typeof Replayer>[0] {
  return events as ConstructorParameters<typeof Replayer>[0];
}
