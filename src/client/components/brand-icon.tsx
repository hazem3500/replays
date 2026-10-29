import { cn } from '@/lib/utils.ts';

import { ProviderIcon } from './provider-icon.tsx';

/**
 * The mark of a replay source's provider in the viewer (the top bar's source chip, the Context panel), drawn exactly as
 * the index draws it (provider-icon.tsx): the provider's declared icon, else its built-in mark (GitHub, GitLab, Slack,
 * Linear, Jira, Notion), else a link glyph. `brand-icon` keeps the viewer's sizing rules.
 */
export function SourceIcon({ provider, size = 14, className }: { provider: string; size?: number; className?: string }) {
  return <ProviderIcon provider={provider} size={size} className={cn('brand-icon', className)} />;
}
