import { persistIndexQueries } from '../data/persist.ts';
import { syncViewCookie } from '../ReplayIndex.tsx';
import type { AppRouter } from '../router.tsx';
import { setClientRouter } from '../routing/client.ts';
import { installIndexReturn } from '../routing/index-return.ts';
import { installLinkRouting } from '../routing/navigate.ts';
import { installPageMotion } from '../transitions/page-motion.ts';

/** The browser's router: navigation, page motion and the persisted index lists (main.tsx does the same for the SPA). */
export function installClient(router: AppRouter) {
  setClientRouter(router);
  installPageMotion(router);
  installIndexReturn(router);
  installLinkRouting();
  void persistIndexQueries(router.options.context.queryClient);
  syncViewCookie();
  return router;
}
