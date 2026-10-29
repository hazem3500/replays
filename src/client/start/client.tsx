/* invariant: tailwind.css is the first import (main.tsx says why: the cascade-layer order). */
// oxlint-disable-next-line import/no-unassigned-import -- why: the app's stylesheet is imported for its side effect.
import '../tailwind.css';
import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { betaMalleable } from '../malleable/flag.ts';
import { loadClientPlugins } from '../plugins/load.ts';

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

// why: the server's plugin browser entries load after hydration, so a failing one never holds the page.
void loadClientPlugins();

// why: beta (REPLAYS_BETA_MALLEABLE): saved user plugins and the agent tools; off, their code is never requested.
if (betaMalleable()) void import('../malleable/boot.ts').then((module) => module.boot());
