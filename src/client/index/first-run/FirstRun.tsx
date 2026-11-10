import { useQuery } from '@tanstack/react-query';
import { BotIcon, CircleDotIcon, LinkIcon, TerminalIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Disclosure } from '@/components/ui/disclosure.tsx';

import type { ProfileInfo } from '../../../shared/profiles.ts';
import { copyText } from '../../clipboard.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import { apiUrl } from '../../api/fetch.ts';
import { useHydrated } from '../../hooks/use-hydrated.ts';
import { configQuery } from '../../queries.ts';
import { helpLink } from '../../settings/config-query.ts';
import { coreWays, FIRST_RUN_SLOT, type FirstRunCommand, type FirstRunContext, type FirstRunWay, firstRunStrings } from './model.ts';

const ICONS = { record: CircleDotIcon, upload: UploadIcon, cli: TerminalIcon, agent: BotIcon, link: LinkIcon } as const;
const COPY_RESET_MS = 2000;
const NO_PROFILES: readonly ProfileInfo[] = [];

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
        <Disclosure className="first-run-more" summary={way.more.label}>
          <CommandBlock command={way.more.command} />
        </Disclosure>
      ) : null}
      {way.action ? (
        <a className="first-run-link" href={way.action.href} target="_blank" rel="noreferrer">
          {way.action.label}
          <AnimatedIcon name="chevron-right" />
        </a>
      ) : null}
    </section>
  );
}

function Profiles({ profiles }: { profiles: readonly ProfileInfo[] }) {
  return (
    <section className="first-run-profiles" aria-label={firstRunStrings.profilesTitle}>
      <h3>{firstRunStrings.profilesTitle}</h3>
      <ul>
        {profiles.map((profile) => (
          <li key={profile.id}>
            <strong>{profile.label}</strong>
            {profile.retentionDays === undefined ? null : <span>{firstRunStrings.keptFor(profile.retentionDays)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The index before any replay exists: the ways to make a first one (`index.empty.ways`), and the deployment's profiles. */
export function FirstRun({ onUpload, profiles = NO_PROFILES }: { onUpload: () => void; profiles?: readonly ProfileInfo[] }) {
  // why: a server render has no location; the commands take the page's origin once hydrated, so both renders agree.
  const origin = useHydrated() ? location.origin : '';
  const recorderGuide = helpLink(useQuery(configQuery).data, 'recorderGuide');
  const context: FirstRunContext = {
    origin,
    uploadUrl: `${origin}${apiUrl(`replays`)}`,
    chooseFile: onUpload,
    profiles,
    ...(recorderGuide ? { recorderGuide } : {}),
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
      {profiles.length ? <Profiles profiles={profiles} /> : null}
    </div>
  );
}
