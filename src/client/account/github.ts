import { appBase } from '../api/fetch.ts';
import { deleteGithubLink } from '../data/github-link.ts';

/**
 * Where "Connect GitHub" goes. On the public origin the server starts GitHub's authorize page and brings the person back
 * to this page. On any other host of the same server, `start` (from the link state) names the public origin's start URL:
 * the whole flow runs there, and `return` brings the person back here when this host is one the server serves.
 */
export function githubConnectHref(start?: string) {
  if (start && new URL(start, window.location.href).origin !== window.location.origin)
    return `${start}?return=${encodeURIComponent(window.location.href)}`;
  const here = `${window.location.pathname}${window.location.search}`;
  return `${appBase()}/auth/github/start?next=${encodeURIComponent(here)}`;
}

/** Removes the link, then reloads: the identity (avatar, For you) is read once per page, so a reload shows it as it is now. */
export async function disconnectGithub() {
  if (await deleteGithubLink()) window.location.reload();
}
