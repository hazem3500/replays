/* invariant: tailwind.css is the first import. The bundle's CSS follows import order and tailwind.css declares the
   cascade-layer order (theme < base < app < components < utilities); a component stylesheet with an `@layer app`
   block loaded first would make `app` the lowest layer, so Tailwind's `--ease-out: var(--ease-out)` would win and
   resolve the app's tokens to nothing. */
import './tailwind.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { registerCommentsFeature } from './comments/feature.tsx';
import { persistIndexQueries } from './data/persist.ts';
import { betaMalleable } from './malleable/flag.ts';
import { loadClientPlugins } from './plugins/load.ts';
import { getRouter } from './router.tsx';
import { setClientRouter } from './routing/client.ts';
import { installIndexReturn } from './routing/index-return.ts';
import { installLinkRouting } from './routing/navigate.ts';
import { installPageMotion } from './transitions/page-motion.ts';

registerCommentsFeature();

const router = getRouter();
setClientRouter(router);
installPageMotion(router);
installIndexReturn(router);
installLinkRouting();

// why: the first render stays synchronous (page transitions snapshot it); restored lists land within the skeleton delay.
void persistIndexQueries(router.options.context.queryClient);

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

// invariant: synchronous first render, with the module script render-blocking (index.html), and route loaders that
// never wait on the first load: a page transition's incoming snapshot is the app, not an empty #root.
const app = createRoot(root);
flushSync(() =>
  app.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
);

// Browser entries of the server's plugins (src/client/plugins/): loaded after the first paint, failures isolated.
void loadClientPlugins();

// Beta (REPLAYS_BETA_MALLEABLE): saved user plugins and the agent tools. Off: the code is never requested.
if (betaMalleable()) void import('./malleable/boot.ts').then((module) => module.boot());
