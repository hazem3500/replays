import { apiUrl } from '../route.ts';

const REPO = 'https://github.com/hazem3500/replays';
export const SETTINGS_LINKS = {
  cli: `${REPO}#quickstart`,
  auth: `${REPO}#authentication`,
  labs: `${REPO}#beta-features-and-labs`,
  docs: `${REPO}#readme`,
  issues: `${REPO}/issues`,
};

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function serverUrl() {
  return new URL(apiUrl('config').replace(/\/api\/config$/, ''), window.location.origin).href.replace(/\/$/, '');
}
