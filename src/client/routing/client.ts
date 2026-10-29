import type { AppRouter } from '../router.tsx';

/* why: the browser's one router (main.tsx), for code outside React that navigates or reads the address (link clicks,
 * the compare picker, Settings' deep link). Never set on a server, which makes a router per request.
 */
let current: AppRouter | undefined;

export function setClientRouter(router: AppRouter) {
  current = router;
}

export function clientRouter() {
  if (!current) throw new Error('The router is not ready yet (main.tsx creates it before the first render)');
  return current;
}
