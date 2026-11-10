import type { ReplayLongFrame } from '../../../shared/replay.ts';
import { formatDuration } from '../network/model.ts';
import { forcedLayoutTotal, scriptFileName, scriptFunction, scriptTitle, styleLayoutShare } from './why.ts';

const STRINGS = {
  title: 'What blocked it',
  frame: (duration: string, blocking: string) => `A ${duration} frame, ${blocking} of it blocked input`,
  frameOnly: (duration: string) => `A ${duration} animation frame`,
  forced: (ms: string) => `${ms} forced layout`,
  styleLayout: 'Style and layout',
  share: (percent: number) => `${percent}% of the frame`,
  none: 'No script ran long enough to be listed; the time went to rendering.',
};

/**
 * The scripts that ran inside a long animation frame (longest first, up to three), each by file name and function with
 * its duration and the full address in a tooltip, then the style and layout share when the browser reported it.
 */
export function BlockingScripts({ frame }: { frame: ReplayLongFrame }) {
  const style = styleLayoutShare(frame);
  const forced = forcedLayoutTotal(frame);
  return (
    <section className="np-section pp-scripts" aria-label={STRINGS.title} data-testid="blocking-scripts">
      <h3>{STRINGS.title}</h3>
      <p className="np-aside pp-scripts-lead">
        {frame.blockingDuration > 0
          ? STRINGS.frame(formatDuration(frame.duration), formatDuration(frame.blockingDuration))
          : STRINGS.frameOnly(formatDuration(frame.duration))}
      </p>
      {frame.scripts.length ? (
        <ul className="pp-scripts-list">
          {frame.scripts.map((script, index) => (
            <li key={`${script.sourceURL}:${script.sourceFunctionName}:${index}`} title={scriptTitle(script)}>
              <code className="pp-script-file">{scriptFileName(script.sourceURL)}</code>
              <span className="pp-script-fn">{scriptFunction(script)}</span>
              <strong className="pp-script-ms">{formatDuration(script.duration)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="np-aside pp-scripts-none">{STRINGS.none}</p>
      )}
      {style || forced > 0 ? (
        <dl className="pp-scripts-style">
          {style ? (
            <>
              <dt>{STRINGS.styleLayout}</dt>
              <dd>
                <strong>{formatDuration(style.ms)}</strong>
                <span className="np-aside">{STRINGS.share(Math.round(style.share * 100))}</span>
              </dd>
            </>
          ) : null}
          {forced > 0 ? (
            <>
              <dt>Forced by scripts</dt>
              <dd>
                <strong>{formatDuration(forced)}</strong>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
