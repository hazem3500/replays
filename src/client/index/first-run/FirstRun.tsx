import { BotIcon, ChevronRightIcon, CircleDotIcon, LinkIcon, TerminalIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible.tsx';

import type { PurposeInfo } from '../../../shared/purposes.ts';
import { copyText } from '../../clipboard.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import { apiUrl } from '../../route.ts';
import { coreWays, FIRST_RUN_SLOT, type FirstRunCommand, type FirstRunContext, type FirstRunWay, firstRunStrings } from './model.ts';

const ICONS = { record: CircleDotIcon, upload: UploadIcon, cli: TerminalIcon, agent: BotIcon, link: LinkIcon } as const;
const COPY_RESET_MS = 2000;
const NO_PURPOSES: readonly PurposeInfo[] = [];

function copyLabel(copied: boolean | undefined, idle: string) {
  if (copied === undefined) return idle;
  return copied ? firstRunStrings.copied : firstRunStrings.copyFailed;
}

/** A command in its own sideways-scrolling box; Copy sits outside the scroll area so it's always reachable. */
function CommandBlock({ command }: { command: FirstRunCommand }) {
  const [copied, setCopied] = useState<boolean>();
  const copy = () =>
    void copyText(command.text).then((ok) => {
      setCopied(ok);
      window.setTimeout(() => setCopied(undefined), COPY_RESET_MS);
    });
  return (
    <figure className="command-block first-run-command">
      <figcaption>
        <span>{command.label}</span>
        <button type="button" className="copy-command" aria-label={firstRunStrings.copyLabel(command.label)} onClick={copy}>
          {copyLabel(copied, firstRunStrings.copy)}
        </button>
      </figcaption>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- why: keyboard users must be able to scroll a long command sideways. */}
      <pre tabIndex={0} aria-label={command.label}>
        <code>{command.text}</code>
      </pre>
      <span className="visually-hidden" role="status">
        {copyLabel(copied, '')}
      </span>
    </figure>
  );
}

function WayCard({ id, way }: { id: string; way: FirstRunWay }) {
  const Icon = ICONS[way.icon ?? 'link'];
  return (
    <section className="first-run-way" data-slot-item={id} aria-labelledby={`first-run-${id}`}>
      <header className="first-run-way-head">
        <Icon className="first-run-way-icon" aria-hidden="true" />
        <h3 id={`first-run-${id}`}>{way.title}</h3>
        {way.badge ? <span className="first-run-badge">{way.badge}</span> : null}
      </header>
      <p className="first-run-way-description">{way.description}</p>
      {way.dropZone ? (
        <div className="first-run-drop">
          <UploadIcon aria-hidden="true" />
          <span>{way.dropZone.label}</span>
          <button type="button" className="button secondary first-run-drop-button" onClick={way.dropZone.onChoose}>
            {way.dropZone.button}
          </button>
        </div>
      ) : null}
      {way.command ? <CommandBlock command={way.command} /> : null}
      {way.more ? (
        <Collapsible className="first-run-more">
          <CollapsibleTrigger className="first-run-more-trigger">
            <ChevronRightIcon aria-hidden="true" />
            {way.more.label}
          </CollapsibleTrigger>
          <CollapsibleContent className="first-run-more-panel">
            <CommandBlock command={way.more.command} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {way.action ? (
        <a className="first-run-link" href={way.action.href} target="_blank" rel="noreferrer">
          {way.action.label}
          <ChevronRightIcon aria-hidden="true" />
        </a>
      ) : null}
    </section>
  );
}

function Purposes({ purposes }: { purposes: readonly PurposeInfo[] }) {
  return (
    <section className="first-run-purposes" aria-label={firstRunStrings.purposesTitle}>
      <h3>{firstRunStrings.purposesTitle}</h3>
      <ul>
        {purposes.map((purpose) => (
          <li key={purpose.id}>
            <strong>{purpose.label}</strong>
            {purpose.retentionDays === undefined ? null : <span>{firstRunStrings.keptFor(purpose.retentionDays)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The index before any replay exists: the ways to make a first one (`index.empty.ways`), and the deployment's purposes. */
export function FirstRun({ onUpload, purposes = NO_PURPOSES }: { onUpload: () => void; purposes?: readonly PurposeInfo[] }) {
  const context: FirstRunContext = {
    origin: location.origin,
    uploadUrl: `${location.origin}${apiUrl(`replays`)}`,
    chooseFile: onUpload,
    purposes,
  };
  const ways = resolveSlot<FirstRunContext, FirstRunWay>(FIRST_RUN_SLOT, coreWays, context);
  return (
    <div className="first-run">
      <header className="first-run-intro">
        <h2>{firstRunStrings.title}</h2>
        <p>{firstRunStrings.lead}</p>
      </header>
      <div className="first-run-ways" role="list" aria-label={firstRunStrings.waysLabel} data-slot={FIRST_RUN_SLOT}>
        {ways.map((descriptor) => (
          <div key={descriptor.id} role="listitem" className="first-run-way-cell">
            <WayCard id={descriptor.id} way={descriptor.render(context)} />
          </div>
        ))}
      </div>
      {purposes.length ? <Purposes purposes={purposes} /> : null}
    </div>
  );
}
