import { apiUrl } from '../api/fetch.ts';
import type { ClientConfig } from '../config.ts';
import type { LinkKey } from '../../shared/help-links.ts';

const REPO = 'https://github.com/hazem3500/replays';
/** This project's own docs: what a link shows unless the host sets it (or hides it with `false`). */
const DEFAULT_LINKS: Record<LinkKey, string> = {
  source: `${REPO}#quickstart`,
  cliGuide: `${REPO}#quickstart`,
  authGuide: `${REPO}#authentication`,
  labs: `${REPO}#beta-features-and-labs`,
  docs: `${REPO}#readme`,
  issues: `${REPO}/issues`,
  recorderGuide: `${REPO}/blob/main/docs/recorder.md`,
};

/**
 * Where a help link goes, or undefined to show none: nothing until the config has loaded (so a host's own docs never
 * flash behind the project's), and nothing where the host set the link to `false`.
 */
export function helpLink(config: Pick<ClientConfig, 'links'> | undefined, key: LinkKey): string | undefined {
  if (!config) return undefined;
  const set = config.links?.[key];
  return set === false ? undefined : (set ?? DEFAULT_LINKS[key]);
}

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function serverUrl() {
  return new URL(apiUrl('config').replace(/\/api\/config$/, ''), window.location.origin).href.replace(/\/$/, '');
}
