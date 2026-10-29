import { formatClock } from '../../../shared/replay.ts';
import { copyText } from '../../clipboard.ts';
import { Button } from '@/components/ui/button.tsx';
import { usePlayer } from '../../player.ts';
import { useViewer } from '../context.ts';
import { DetailHead } from '../network/DetailHead.tsx';
import { CONSOLE_DETAIL_ID, LevelIcon } from './ConsoleList.tsx';
import { type ConsoleRow, frameFile, headline, LEVEL_NAMES, messageParts, type StackFrame, stackFrames } from './model.ts';

const STRINGS = {
  region: (level: string) => `${level} message`,
  close: 'Close message',
  copy: 'Copy message',
  copyStack: 'Copy with stack',
  copied: 'Copied the message',
  copiedStack: 'Copied the message and its stack',
  copyFailed: 'Could not copy to the clipboard',
  time: 'Time',
  page: 'Page',
  source: 'Source',
  stack: (count: number) => `Stack · ${count} ${count === 1 ? 'frame' : 'frames'}`,
  anonymous: '(anonymous)',
  repeated: (count: number) => `Logged ${count} times`,
  seek: (at: number) => `Seek to ${formatClock(at)}`,
  noStack: 'No stack was captured with this message.',
};

/**
 * The selected message, whole: the level and time (Watch from seeks there), the text wrapped with its newlines and
 * any JSON indented, the stack frames found in it, the page it was logged on, and every time a folded run was logged.
 */
export function ConsoleDetail({ row, stacked, onSelect }: { row: ConsoleRow; stacked: boolean; onSelect: (id?: string) => void }) {
  const level = LEVEL_NAMES[row.entry.level];
  const frames = stackFrames(row.entry.message);
  const text = frames.length ? headline(row.entry.message) : row.entry.message;
  const close = () => {
    onSelect();
    requestAnimationFrame(() => document.getElementById(`console-switch-${row.id}`)?.focus());
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape anywhere in the open detail closes it and returns focus to its row.
    <section
      id={CONSOLE_DETAIL_ID}
      className="np-detail cp-detail"
      data-testid="console-detail"
      aria-label={STRINGS.region(level)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
    >
      <DetailHead at={row.at} stacked={stacked} closeLabel={STRINGS.close} onClose={close}>
        <LevelIcon level={row.entry.level} />
        <strong className="cp-detail-level" data-level={row.entry.level}>
          {level}
        </strong>
        <span>{formatClock(row.at)}</span>
      </DetailHead>
      <CopyActions message={row.entry.message} text={text} hasStack={frames.length > 0} />
      <pre className="cp-full" data-testid="console-message">
        {messageParts(text).map((part, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- why: parts are positional slices of one fixed message.
          <span key={index} className={part.kind === 'json' ? 'cp-json' : undefined}>
            {part.text}
          </span>
        ))}
      </pre>
      <Facts row={row} frames={frames} />
      {frames.length ? <Frames frames={frames} /> : <p className="np-note">{STRINGS.noStack}</p>}
      {row.count > 1 ? <Repeats ats={row.ats} /> : null}
    </section>
  );
}

function CopyActions({ message, text, hasStack }: { message: string; text: string; hasStack: boolean }) {
  const { notify } = useViewer();
  const copy = (value: string, done: string) => void copyText(value).then((ok) => notify(ok ? done : STRINGS.copyFailed));
  return (
    <div className="cp-actions">
      <Button variant="ghost" size="sm" onClick={() => copy(text, STRINGS.copied)}>
        {STRINGS.copy}
      </Button>
      {hasStack ? (
        <Button variant="ghost" size="sm" onClick={() => copy(message, STRINGS.copiedStack)}>
          {STRINGS.copyStack}
        </Button>
      ) : null}
    </div>
  );
}

function frameLabel(frame: StackFrame) {
  if (frame.line === undefined) return frame.file;
  return `${frameFile(frame.file)}:${frame.line}:${frame.column ?? 0}`;
}

function Facts({ row, frames }: { row: ConsoleRow; frames: readonly StackFrame[] }) {
  const top = frames.find((frame) => frame.line !== undefined);
  return (
    <dl className="np-facts">
      <dt>{STRINGS.time}</dt>
      <dd>{formatClock(row.at)}</dd>
      {top ? (
        <>
          <dt>{STRINGS.source}</dt>
          <dd className="cp-mono" title={top.file}>
            {frameLabel(top)}
          </dd>
        </>
      ) : null}
      {row.entry.url ? (
        <>
          <dt>{STRINGS.page}</dt>
          <dd className="cp-mono">{row.entry.url}</dd>
        </>
      ) : null}
    </dl>
  );
}

function Frames({ frames }: { frames: readonly StackFrame[] }) {
  return (
    <section className="np-section" aria-label={STRINGS.stack(frames.length)}>
      <h3>{STRINGS.stack(frames.length)}</h3>
      <ol className="cp-frames">
        {frames.map((frame, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- why: a stack lists frames by position; the same frame can repeat.
          <li key={index} data-top={index === 0 || undefined} title={frame.file}>
            <span className="cp-frame-fn">{frame.fn ?? STRINGS.anonymous}</span>
            <span className="cp-frame-file">{frameLabel(frame)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Repeats({ ats }: { ats: readonly number[] }) {
  const player = usePlayer();
  return (
    <section className="np-section" aria-label={STRINGS.repeated(ats.length)}>
      <h3>{STRINGS.repeated(ats.length)}</h3>
      <ul className="cp-repeats">
        {ats.map((at, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- why: two logs can share a millisecond; position is the identity.
          <li key={index}>
            <button type="button" className="seek-time" aria-label={STRINGS.seek(at)} onClick={() => player.seek(at)}>
              <time>{formatClock(at)}</time>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
