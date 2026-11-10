import { apiUrl, appBase } from '../api/fetch.ts';

/** Where "Connect GitHub" goes: the server starts GitHub's authorize page and brings the person back to this page. */
export function githubConnectHref() {
  const here = `${window.location.pathname}${window.location.search}`;
  return `${appBase()}/auth/github/start?next=${encodeURIComponent(here)}`;
}

/** Removes the link, then reloads: the identity (avatar, For you) is read once per page, so a reload shows it as it is now. */
export async function disconnectGithub() {
  const response = await fetch(apiUrl('plugins/github-connect/link'), { method: 'DELETE' });
  if (response.ok) window.location.reload();
}
