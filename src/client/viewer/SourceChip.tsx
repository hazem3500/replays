import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { SourceIcon } from '@/components/brand-icon.tsx';

import type { ReplaySourceRef } from '../../shared/context.ts';
import { sourceLook } from '../source-looks.ts';

export interface ChipSource {
  provider: string;
  url: string;
  /** Short text beside the mark; defaults to the provider. */
  label?: string | undefined;
}

/** The link the topbar shows: the run's own first source, else the suite's subject. Only https URLs qualify. */
export function topbarSource(sources: ReplaySourceRef[] | undefined, subject?: ChipSource): ChipSource | undefined {
  const own = sources?.find((source) => source.url.startsWith('https://'));
  if (own) return { provider: own.provider, url: own.url, label: own.label ?? own.ref };
  return subject?.url.startsWith('https://') ? subject : undefined;
}

/** A quiet link chip for the replay's source, beside the topbar title: provider mark, label, ↗. */
export function SourceChip({ source }: { source: ChipSource }) {
  const text = source.label || source.provider;
  // "thread C123/p456, Acme Chat thread (opens in a new tab)": the provider's noun says what the link is.
  const noun = sourceLook(source.provider)?.noun;
  return (
    <Hint label={text} side="bottom" align="start">
      <a
        className="topbar-source-chip"
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="source-chip"
        aria-label={`${text}${noun ? `, ${noun}` : ''} (opens in a new tab)`}
      >
        <SourceIcon provider={source.provider} size={12} />
        <span>{text}</span>
        <AnimatedIcon name="arrow-up-right" />
      </a>
    </Hint>
  );
}
