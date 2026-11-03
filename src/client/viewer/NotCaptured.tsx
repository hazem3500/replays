import { GaugeIcon } from 'lucide-react';

import { CopyButton } from '@/components/copy-button.tsx';
import { Disclosure } from '@/components/ui/disclosure.tsx';
import { StateView } from '@/components/ui/state-view.tsx';

import type { ReplayMeta } from '../../shared/replay.ts';
import { type CaptureTrack, captureHelp } from './capture-help.ts';

const STRINGS = {
  copy: 'Copy',
  cliTitle: 'Using the command line?',
  cliWhat:
    'The replays CLI records a page with a real browser from your terminal or CI, and keeps performance, console and network by default. Run:',
  peers: (names: readonly string[]) => `${names.join(', ')} recorded it: show ${names.length === 1 ? 'it' : 'one of them'} in the panels.`,
};

const NO_PEERS: readonly string[] = [];

/** A command or option with its copy button, in the panel's mono line. */
function Snippet({ value }: { value: string }) {
  return (
    <span className="not-captured-snippet">
      <code>{value}</code>
      <CopyButton value={value} label={`${STRINGS.copy}: ${value}`} />
    </span>
  );
}

/**
 * A track this recording did not capture, as a panel StateView: why the data matters and how this replay's source
 * captures it (the recorder's option, or the CLI command behind "Using the command line?"). In a comparison,
 * `peers` names the recordings that did capture it.
 */
export function NotCaptured({
  track,
  meta,
  peers = NO_PEERS,
  testId,
}: {
  track: CaptureTrack;
  meta: Pick<ReplayMeta, 'source' | 'url'>;
  peers?: readonly string[];
  testId?: string;
}) {
  const help = captureHelp(track, meta.source ?? 'agent', meta.url);
  return (
    <StateView
      kind={
        track === 'performance'
          ? { kind: 'not-captured', illustration: <GaugeIcon className="size-5 text-[var(--text-tertiary)]" aria-hidden="true" /> }
          : 'not-captured'
      }
      layout="panel"
      title={help.title}
      cause={help.why}
      testId={testId}
    >
      <div className="not-captured-how">
        <p>{help.how}</p>
        <Snippet value={help.snippet} />
        {peers.length ? <p>{STRINGS.peers(peers)}</p> : null}
        {help.cli ? (
          <Disclosure className="not-captured-cli" panelClassName="not-captured-cli-panel" summary={STRINGS.cliTitle}>
            <p>{STRINGS.cliWhat}</p>
            <Snippet value={help.cli} />
          </Disclosure>
        ) : null}
      </div>
    </StateView>
  );
}
