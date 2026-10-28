import { clientRouter } from './client.ts';
import { returnsToKeptIndex } from './index-return.ts';
import { isAppPage } from './links.ts';
import { pageOfPublicPath } from './page-key.ts';

/*
 * Navigation for code that holds an href (menus, the command palette, the editor's "Done") and for the page's own
 * address (a viewer's `?t=`, a comparison's layout). Everything goes through the router, so its location, history
 * and Back/Forward stay the page's.
 */

const pathOf = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

/** Opens `href` in this document (a pushed history entry). Returns false when it isn't a page of this app. */
export function navigate(href: string, { replace = false }: { replace?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !isAppPage(url.pathname)) return false;
  const router = clientRouter();
  // why: back to the index this page was opened from: step back in history (its entry and scroll) instead of stacking another.
  if (returnsToKeptIndex(router, url)) router.history.back();
  else void router.navigate({ href: pathOf(url), replace, hashScrollIntoView: false });
  return true;
}

/** Rewrites this page's own address (no page change); `push` adds a history entry, so Back undoes it. */
export function setPageUrl(href: string | URL, { push = false }: { push?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.href === location.href) return;
  void clientRouter().navigate({ href: pathOf(url), replace: !push, resetScroll: false, hashScrollIntoView: false });
}

/** The same page with another query string (path and hash kept). */
export function setSearch(search: string, options: { push?: boolean } = {}) {
  setPageUrl(`${location.pathname}${search}${location.hash}`, options);
}

/** One search parameter of this page's address (a deep link such as `?settings=labs`), or null. */
export function currentSearchParam(name: string) {
  return typeof location === 'undefined' ? null : new URL(location.href).searchParams.get(name);
}

/** Drops one search parameter from this page's address, without a history entry. */
export function dropSearchParam(name: string) {
  const url = new URL(location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  setPageUrl(url.href);
}

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  if (link.origin !== location.origin || link.getAttribute('href')?.startsWith('#') || !isAppPage(link.pathname)) return;
  const router = clientRouter();
  const { base } = router.options.context.deployment;
  // invariant: a link to the page on screen (its own filters, a version switch) stays a normal load, as it always was.
  if (pageOfPublicPath(router, link.pathname, base).key === pageOfPublicPath(router, location.pathname, base).key) return;
  event.preventDefault();
  navigate(link.href);
}

/** Routes plain left clicks on links to other pages of the app through the router. Call once, before the first render. */
export function installLinkRouting() {
  window.addEventListener('click', onClick);
}
