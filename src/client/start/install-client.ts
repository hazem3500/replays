import { persistIndexQueries } from '../data/persist.ts';
import { syncViewCookie } from '../index/route-state.ts';
import type { AppRouter } from '../router.tsx';
import { setClientRouter } from '../routing/client.ts';
import { installIndexReturn } from '../routing/index-return.ts';
import { installLinkRouting } from '../routing/navigate.ts';
import { pageOfPublicPath } from '../routing/page-key.ts';
import { preparePage } from '../routing/pages.ts';
import { installPageMotion } from '../transitions/page-motion.ts';

/** The browser's router: navigation, page motion and the persisted index lists (main.tsx does the same for the SPA). */
export function installClient(router: AppRouter) {
  setClientRouter(router);
  // why: direct visits should fetch their player code while Start prepares hydration, before route components load.
  void preparePage(pageOfPublicPath(router, location.pathname, router.options.context.deployment.base)).catch(() => {});
  installPageMotion(router);
  installIndexReturn(router);
  installLinkRouting();
  void persistIndexQueries(router.options.context.queryClient);
  syncViewCookie();
  return router;
}
