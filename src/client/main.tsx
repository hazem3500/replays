/* invariant: tailwind.css is the first import. The bundle's CSS follows import order and tailwind.css declares the
   cascade-layer order (theme < base < app < components < utilities); a component stylesheet with an `@layer app`
   block loaded first would make `app` the lowest layer, so Tailwind's `--ease-out: var(--ease-out)` would win and
   resolve the app's tokens to nothing. */
import './tailwind.css';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { registerCommentsFeature } from './comments/feature.tsx';
import { betaMalleable } from './malleable/flag.ts';
import { loadClientPlugins } from './plugins/load.ts';

registerCommentsFeature();

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

// Synchronous first render, with the module script render-blocking (index.html): a page transition's
// incoming snapshot is the app, not an empty #root, so the top bar can stay put across pages.
const app = createRoot(root);
flushSync(() =>
  app.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

// Browser entries of the server's plugins (src/client/plugins/): loaded after the first paint, failures isolated.
void loadClientPlugins();

// Beta (REPLAYS_BETA_MALLEABLE): saved user plugins and the agent tools. Off: the code is never requested.
if (betaMalleable()) void import('./malleable/boot.ts').then((module) => module.boot());
