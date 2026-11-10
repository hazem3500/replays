import { droppedVerdict, fpsVerdict, summarizeFrames } from '../../../shared/frame-timing.ts';
import type { ReplayPerformanceTrack } from '../../../shared/replay.ts';
import { VERDICT_WORDS, type Verdict } from './model.ts';

const STRINGS = {
  median: 'Median frame rate',
  slowest: 'Slowest second',
  dropped: 'Dropped frames',
  droppedHint: 'Estimated against a 60 Hz display, summed over the recording.',
  none: 'Frame timing not recorded',
  noSamples: 'No foreground frame samples captured',
  shiftsUnavailable: 'Layout shift: not available in this browser',
};

function Stat({ label, value, unit, verdict, hint }: { label: string; value: string; unit?: string; verdict: Verdict; hint?: string }) {
  return (
    <li>
      <div className="pp-vital" title={hint}>
        <span className="pp-vital-label">{label}</span>
        <span className="pp-vital-value">
          <span>
            {value}
            {unit ? <span className="pp-unit"> {unit}</span> : null}
          </span>
          <span className="pp-verdict" data-verdict={verdict}>
            <span className="pp-dot" aria-hidden="true" />
            {VERDICT_WORDS[verdict]}
          </span>
        </span>
      </div>
    </li>
  );
}

/** The foreground cadence as stat items in the vitals cards' style, with the layout-shift observation as a muted note. */
export function CadenceSummary({ track }: { track: ReplayPerformanceTrack }) {
  const summary = summarizeFrames(track.frames);
  const shifts = track.supported.includes('layout-shift') ? (track.layoutShifts?.length ?? 0) : undefined;
  const note =
    shifts === undefined
      ? STRINGS.shiftsUnavailable
      : shifts > 0
        ? `${shifts} layout ${shifts === 1 ? 'shift' : 'shifts'} captured`
        : undefined;
  if (!summary)
    return (
      <p className="pp-cadence-note" role="status">
        {track.supported.includes('animation-frame') ? STRINGS.noSamples : STRINGS.none}
        {note ? <span> · {note}</span> : null}
      </p>
    );
  return (
    <div className="pp-vitals pp-cadence" role="status">
      <ul aria-label="Frame rate">
        <Stat label={STRINGS.median} value={String(Math.round(summary.p50))} unit="fps" verdict={fpsVerdict(summary.p50)} />
        <Stat label={STRINGS.slowest} value={String(Math.round(summary.min))} unit="fps" verdict={fpsVerdict(summary.min)} />
        <Stat
          label={STRINGS.dropped}
          value={`~${summary.dropped}`}
          verdict={droppedVerdict(summary.dropped, summary.seconds)}
          hint={STRINGS.droppedHint}
        />
      </ul>
      {note ? <span className="pp-cadence-aside">{note}</span> : null}
    </div>
  );
}
