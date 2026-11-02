import { DEFAULT_BUDGETS, verdictFor, type Verdict } from '../../../shared/diagnostics/budgets.ts';
import { groupInteractions, ms } from '../../../shared/diagnostics/detect.ts';
import type { ReplayBundle } from '../../../shared/replay.ts';
import type { TimelineMarker, TimelineTone } from '../../plugins/api.ts';
import { viewerRegistry } from '../../plugins/registry.ts';

/** The built-in owner of the track in `viewer.scrubber.tracks`, so it shows up and hot-reloads like any other. */
const OWNER = 'core-performance';

const STRINGS = {
  track: 'Performance',
  task: (value: number, verdict: Verdict) => `Long task · ${ms(value)} · ${VERDICT[verdict]}`,
  interaction: (event: string | undefined, value: number, verdict: Verdict) =>
    `Slow ${event ?? 'interaction'} · ${ms(value)} · ${VERDICT[verdict]}`,
};
const VERDICT: Readonly<Record<Verdict, string>> = { good: 'Good', 'needs-improvement': 'Needs work', poor: 'Poor' };
const TONE: Readonly<Record<Verdict, TimelineTone>> = { good: 'neutral', 'needs-improvement': 'warn', poor: 'error' };

/**
 * Long tasks and slow interactions as ranges under the seek bar, toned by verdict. `bundle` is the replay as it plays
 * (edits applied), so ranges sit where the player shows them. Interactions within budget are left out: noise, not news.
 */
export function performanceMarkers(bundle: Pick<ReplayBundle, 'performance'>): TimelineMarker[] {
  const entries = bundle.performance?.entries ?? [];
  const tasks = entries.flatMap((entry): TimelineMarker[] => {
    if (entry.kind !== 'long-task') return [];
    const verdict = verdictFor(entry.value, DEFAULT_BUDGETS['long-task']);
    return [{ atMs: entry.at, durationMs: entry.value, label: STRINGS.task(entry.value, verdict), tone: TONE[verdict] }];
  });
  const interactions = groupInteractions(entries.map((entry, index) => ({ entry, index })))
    .filter((interaction) => interaction.value > DEFAULT_BUDGETS.interaction[0])
    .map((interaction): TimelineMarker => {
      const verdict = verdictFor(interaction.value, DEFAULT_BUDGETS.interaction);
      return {
        atMs: interaction.at,
        durationMs: interaction.value,
        label: STRINGS.interaction(interaction.events.at(-1), interaction.value, verdict),
        tone: TONE[verdict],
      };
    });
  return [...tasks, ...interactions].sort((a, b) => a.atMs - b.atMs);
}

/** Registers (or, on hot reload, replaces) the track. */
export function registerPerformanceTrack() {
  viewerRegistry.replacePlugin(OWNER, (api) =>
    api.registerTimelineTrack({ id: 'ranges', label: STRINGS.track, order: 100, markers: (context) => performanceMarkers(context.replay) }),
  );
}
