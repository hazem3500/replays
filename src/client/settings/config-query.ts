import { queryOptions } from '@tanstack/react-query';

import type { ClientConfig } from '../config.ts';
import { apiUrl } from '../route.ts';

const REPO = 'https://github.com/hazem3500/replays';
export const SETTINGS_LINKS = {
  cli: `${REPO}#quickstart`,
  auth: `${REPO}#authentication`,
  labs: `${REPO}#beta-features-and-labs`,
  docs: `${REPO}#readme`,
  issues: `${REPO}/issues`,
};

/** `GET /api/config`: the same cache entry the viewer reads; a deployment's config does not change while a page is open. */
export const configQuery = queryOptions({
  queryKey: ['config'] as const,
  queryFn: async ({ signal }) => {
    const response = await fetch(apiUrl('config'), { signal });
    if (!response.ok) throw new Error(`Config failed to load (${response.status})`);
    return (await response.json()) as ClientConfig;
  },
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function serverUrl() {
  return new URL(apiUrl('config').replace(/\/api\/config$/, ''), window.location.origin).href.replace(/\/$/, '');
}
