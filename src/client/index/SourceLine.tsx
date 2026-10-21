import { BotIcon, LinkIcon, UploadIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import type { ReplaySource, ReplaySourceLink } from '../../shared/replay.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { SourceIcon } from '@/components/brand-icon.tsx';

import { sourceLook } from '../source-looks.ts';

/*
 * Line 2 of a feed row leads with where the replay came from: the first context source it links to (a pull
 * request, an issue, a ticket: a link out, new tab, above the row's own link), or how it was made when nothing
 * links it ("Agent capture", "rrweb import").
 */

/** "github · acme/api#12": the provider, then the producer's own label when there is one. */
export function sourceText(source: Pick<ReplaySourceLink, 'provider' | 'label'>) {
  return source.label ? `${source.provider} · ${source.label}` : source.provider;
}

/** Only https URLs become links: a source's URL comes from whoever uploaded the recording. */
function safeHref(url: string) {
  return /^https:\/\//i.test(url) ? url : undefined;
}

function SourceLink({ link, className, shown }: { link: ReplaySourceLink; className: string; shown: string }) {
  const href = safeHref(link.url);
  const look = sourceLook(link.provider);
  const content = (
    <>
      {/* A provider's own icon when it declares one; otherwise every source shares the plain link mark. */}
      {look?.icon ? (
        <SourceIcon provider={link.provider} className="source-mark" />
      ) : (
        <LinkIcon className="source-mark" aria-hidden="true" />
      )}
      <span className="source-link-text">{shown}</span>
      {href ? <AnimatedIcon name="arrow-up-right" className="source-link-arrow" /> : null}
    </>
  );
  return href ? (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${sourceText(link)}${look?.noun ? `, ${look.noun}` : ''} (opens in a new tab)`}
    >
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}

/** The first source as a link out; the rest as "+N" with their names in a popover. */
export function SourceLead({
  sources,
  origin,
  short = false,
}: {
  sources: ReplaySourceLink[] | undefined;
  origin: ReplaySource;
  /** Just the provider ("github") instead of "github · acme/api#12" (the label stays in the accessible name). */
  short?: boolean;
}) {
  const [first, ...rest] = sources ?? [];
  if (!first)
    return (
      <span className="source-lead source-lead-plain">
        {origin === 'human' ? (
          <UploadIcon className="source-mark" aria-hidden="true" />
        ) : (
          <BotIcon className="source-mark" aria-hidden="true" />
        )}
        {/* `human` stays the stored value and `?source=` param; people see it as an imported recording. */}
        {origin === 'human' ? 'rrweb import' : 'Agent capture'}
      </span>
    );
  return (
    <span className="source-lead">
      <SourceLink link={first} className="source-link" shown={short ? first.provider : sourceText(first)} />
      {rest.length > 0 ? (
        // A tap target, not a hover hint: touch has no hover, and the other sources are links worth opening.
        <Popover>
          <PopoverTrigger className="source-more" aria-label={`${rest.length} more ${rest.length === 1 ? 'source' : 'sources'}`}>
            +{rest.length}
          </PopoverTrigger>
          <PopoverContent align="start" className="source-more-list w-auto max-w-80 gap-0.5 p-1">
            {rest.map((link) => (
              <SourceLink key={link.url} link={link} className="source-more-link" shown={sourceText(link)} />
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
