import { ArrowUpDownIcon, CpuIcon, GlobeIcon, MonitorIcon, MousePointerClickIcon, ServerIcon, SquareTerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { copyText } from '../../clipboard.ts';
import { notify } from '../../toast.ts';
import { ms } from '../../../shared/diagnostics/detect.ts';
import type { EvidenceRef, Issue, IssueLayer, IssueLink } from '../../../shared/diagnostics/types.ts';
import { formatClock, type ReplayBundle } from '../../../shared/replay.ts';
import { curlCommand } from '../network/model.ts';
import { EvidenceLanes } from './EvidenceLanes.tsx';
import { linked, type LaneData } from './evidence.ts';
import type { TimeDomain } from '../time-axis.ts';

export const STRINGS = {
  layer: { frontend: 'Frontend', backend: 'Backend', network: 'Network' } satisfies Record<IssueLayer, string>,
  likely: (layer: IssueLayer) => `Likely ${STRINGS.layer[layer]}`,
  unfolded: 'How it unfolded',
  happening: 'What was happening',
  window: '±1 s',
  watch: (at: number) => `Watch from ${formatClock(at)}`,
  open: { request: 'Open in Network', performance: 'Open in Performance', console: 'Open in Console', step: 'Go to step' } satisfies Record<
    EvidenceRef['kind'],
    string
  >,
  curl: 'Copy as cURL',
  copied: 'Copied cURL',
  copyFailed: 'Could not copy to the clipboard',
  offset: (value: number) => `+${ms(Math.max(0, value))}`,
  openRow: (label: string) => `Open ${label}`,
};

export const LAYER_ICON: Record<IssueLayer, ReactNode> = {
  frontend: <MonitorIcon aria-hidden="true" />,
  backend: <ServerIcon aria-hidden="true" />,
  network: <GlobeIcon aria-hidden="true" />,
};

const LINK_ICON: Record<EvidenceRef['kind'], ReactNode> = {
  step: <MousePointerClickIcon aria-hidden="true" />,
  request: <ArrowUpDownIcon aria-hidden="true" />,
  console: <SquareTerminalIcon aria-hidden="true" />,
  performance: <CpuIcon aria-hidden="true" />,
};

export function LayerChip({ layer, likely = false }: { layer: IssueLayer; likely?: boolean }) {
  return (
    <span className="issue-layer" data-layer={layer}>
      {LAYER_ICON[layer]}
      {likely ? STRINGS.likely(layer) : STRINGS.layer[layer]}
    </span>
  );
}

function ChainLink({
  link,
  first,
  origin,
  onSeek,
  onOpen,
}: {
  link: IssueLink;
  first: boolean;
  origin: number;
  onSeek: (at: number) => void;
  onOpen: (ref: EvidenceRef) => void;
}) {
  const mono = link.ref.kind === 'request' || link.ref.kind === 'console';
  return (
    <li className="issue-link" data-tone={link.tone} data-role={link.role}>
      <span className="issue-link-icon">{LINK_ICON[link.ref.kind]}</span>
      <button type="button" className="issue-link-main" aria-label={STRINGS.openRow(link.label)} onClick={() => onOpen(link.ref)}>
        <span className="issue-link-label" data-mono={mono || undefined}>
          {link.label}
        </span>
        {link.detail ? <span className="issue-link-detail">{link.detail}</span> : null}
      </button>
      <button type="button" className="issue-time" title={formatClock(link.at)} onClick={() => onSeek(link.at)}>
        {first ? formatClock(link.at) : STRINGS.offset(link.at - origin)}
      </button>
    </li>
  );
}

/** One issue's case: the reason, the chain in time order, the ±1 s lanes, and the ways into the drill-downs. */
export function IssueEvidence({
  issue,
  bundle,
  data,
  window,
  heading = true,
  onSeek,
  onOpen,
}: {
  issue: Issue;
  /** The captured bundle, for the request behind "Copy as cURL". */
  bundle: ReplayBundle;
  data: LaneData;
  window: TimeDomain;
  /** Phones show the issue's title in its card, not again here. */
  heading?: boolean;
  onSeek: (at: number) => void;
  onOpen: (ref: EvidenceRef) => void;
}) {
  const origin = issue.chain[0]?.at ?? issue.at;
  const start = issue.chain.find((link) => link.role === 'trigger')?.at ?? issue.at;
  const request =
    issue.primary.kind === 'request' ? bundle.network.find((entry) => entry.id === (issue.primary as { id: string }).id) : undefined;
  return (
    <div className="issue-evidence" data-testid="issue-evidence">
      {heading ? (
        <h2 className="issue-evidence-title">
          <span className="issue-severity" data-severity={issue.severity} aria-hidden="true" />
          {issue.title}
        </h2>
      ) : null}
      <p className="issue-reason">
        <LayerChip layer={issue.layer} likely /> {issue.reason}
      </p>
      <h3 className="issue-subhead">{STRINGS.unfolded}</h3>
      <ol className="issue-chain">
        {issue.chain.map((link, index) => (
          <ChainLink key={`${link.role}-${index}`} link={link} first={index === 0} origin={origin} onSeek={onSeek} onOpen={onOpen} />
        ))}
      </ol>
      <h3 className="issue-subhead">
        {STRINGS.happening} <span>{STRINGS.window}</span>
      </h3>
      <EvidenceLanes
        data={data}
        window={window}
        focus={{ from: issue.at, to: issue.end }}
        isLinked={(ref) => linked(issue, ref)}
        onOpen={onOpen}
      />
      <div className="issue-actions">
        <Button variant="outline" size="sm" onClick={() => onSeek(Math.max(0, start - 500))}>
          {STRINGS.watch(Math.max(0, start - 500))}
        </Button>
        {issue.primary.kind !== 'step' ? (
          <Button variant="ghost" size="sm" onClick={() => onOpen(issue.primary)}>
            {STRINGS.open[issue.primary.kind]}
          </Button>
        ) : null}
        {request ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyText(curlCommand(request)).then((ok) => notify(ok ? STRINGS.copied : STRINGS.copyFailed))}
          >
            {STRINGS.curl}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
