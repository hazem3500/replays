import { BotIcon, UploadIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import type { ReplaySource, ReplaySourceLink } from '../../shared/replay.ts';
import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { ProviderIcon, providerMark } from '@/components/provider-icon.tsx';

import { useMediaQuery } from '../media.ts';
import { sourceLook } from '../source-looks.ts';

/*
 * Line 2 of a feed row leads with where the replay came from: the first context source it links to (a pull
 * request, an issue, a ticket), or how it was made when nothing links it ("Agent capture", "rrweb import").
 * Desktop: the provider's icon and the source's label as a link out (new tab), the rest as "+N" in a popover.
 * Phones: one small icon chip at the end of the meta line that opens a sheet of the sources. The row is the thumb's
 * target there; a stray tap on the chip costs a swipe, not a trip out of the app.
 */

/** The index's phone width (INDEX_COMPACT_QUERY in ReplayIndex.tsx, which imports this module). */
const PHONE_QUERY = '(max-width: 640px)';

const strings = {
  newTab: '(opens in a new tab)',
  sources: 'Sources',
  done: 'Done',
  agent: 'Agent capture',
  // why: `human` stays the stored value and `?source=` param; people see it as an imported recording.
  imported: 'rrweb import',
  more: (count: number) => `${count} more ${count === 1 ? 'source' : 'sources'}`,
  chip: (first: string, rest: number) => (rest ? `Sources: ${first} and ${rest} more` : `Source: ${first}`),
};

/** "github · acme/api#12": the provider, then the producer's own label when there is one. */
export function sourceText(source: Pick<ReplaySourceLink, 'provider' | 'label'>) {
  return source.label ? `${source.provider} · ${source.label}` : source.provider;
}

/** "GitHub": the provider's own name for itself, else its id. */
function providerName(provider: string) {
  return sourceLook(provider)?.label ?? provider;
}

/** What a source shows beside its icon: the label alone when the icon already says the provider. */
function shownText(link: ReplaySourceLink, short: boolean) {
  if (short || !link.label) return providerName(link.provider);
  const distinct = Boolean(sourceLook(link.provider)?.icon) || providerMark(link.provider) !== 'link';
  return distinct ? link.label : sourceText(link);
}

function accessibleName(link: ReplaySourceLink) {
  const noun = sourceLook(link.provider)?.noun;
  return `${sourceText(link)}${noun ? `, ${noun}` : ''} ${strings.newTab}`;
}

/** Only https URLs become links: a source's URL comes from whoever uploaded the recording. */
function safeHref(url: string) {
  return /^https:\/\//i.test(url) ? url : undefined;
}

function SourceLink({ link, className, shown }: { link: ReplaySourceLink; className: string; shown: string }) {
  const href = safeHref(link.url);
  const content = (
    <>
      <ProviderIcon provider={link.provider} className="source-mark" />
      <span className="source-link-text">{shown}</span>
      {href ? <AnimatedIcon name="arrow-up-right" className="source-link-arrow" /> : null}
    </>
  );
  return href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer" aria-label={accessibleName(link)}>
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}

/** Desktop: the first source as a link out; the rest as "+N" with their names in a popover. */
function SourceLinks({ first, rest, short }: { first: ReplaySourceLink; rest: ReplaySourceLink[]; short: boolean }) {
  return (
    <span className="source-lead" data-slot="source-lead">
      <SourceLink link={first} className="source-link" shown={shownText(first, short)} />
      {rest.length > 0 ? (
        // why: a tap target, not a hover hint: touch has no hover, and the other sources are links worth opening.
        <Popover>
          <PopoverTrigger className="source-more" aria-label={strings.more(rest.length)}>
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

/** Phones: one icon chip (with "+N") that opens every source in a sheet, each a 48 px row linking out. */
function SourceChipSheet({ sources }: { sources: [ReplaySourceLink, ...ReplaySourceLink[]] }) {
  const [first] = sources;
  const rest = sources.length - 1;
  return (
    <span className="source-lead source-lead-chip" data-slot="source-lead">
      <Drawer>
        <DrawerTrigger className="source-chip" data-slot="source-chip" aria-label={strings.chip(sourceText(first), rest)}>
          <ProviderIcon provider={first.provider} className="source-mark" />
          {rest ? <span className="source-chip-count">+{rest}</span> : null}
        </DrawerTrigger>
        <DrawerContent className="source-sheet">
          <DrawerTitle className="source-sheet-title">{strings.sources}</DrawerTitle>
          <ul className="source-sheet-list">
            {sources.map((link) => {
              const href = safeHref(link.url);
              const noun = sourceLook(link.provider)?.noun ?? providerName(link.provider);
              const body = (
                <>
                  <ProviderIcon provider={link.provider} size={18} className="source-sheet-icon" />
                  <span className="source-sheet-text">
                    <span className="source-sheet-label">{link.label || providerName(link.provider)}</span>
                    <span className="source-sheet-noun">{noun}</span>
                  </span>
                  {href ? <AnimatedIcon name="arrow-up-right" className="source-sheet-arrow" /> : null}
                </>
              );
              return (
                <li key={link.url} data-slot-item="source">
                  {href ? (
                    <a className="source-sheet-row" href={href} target="_blank" rel="noreferrer" aria-label={accessibleName(link)}>
                      {body}
                    </a>
                  ) : (
                    <span className="source-sheet-row">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <DrawerFooter className="sheet-footer">
            <DrawerClose render={<Button variant="secondary" className="h-[44px] w-full text-[13px]" />}>{strings.done}</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </span>
  );
}

export function SourceLead({
  sources,
  origin,
  short = false,
}: {
  sources: ReplaySourceLink[] | undefined;
  origin: ReplaySource;
  /** The provider's name ("GitHub") instead of the source's label (which stays in the accessible name). */
  short?: boolean;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [first, ...rest] = sources ?? [];
  if (!first)
    return (
      <span className="source-lead source-lead-plain">
        {origin === 'human' ? (
          <UploadIcon className="source-mark" aria-hidden="true" />
        ) : (
          <BotIcon className="source-mark" aria-hidden="true" />
        )}
        {origin === 'human' ? strings.imported : strings.agent}
      </span>
    );
  return phone ? <SourceChipSheet sources={[first, ...rest]} /> : <SourceLinks first={first} rest={rest} short={short} />;
}
