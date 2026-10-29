/* invariant: tailwind.css is the first import (main.tsx says why: the cascade-layer order). */
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

// Browser entries of the server's plugins (src/client/plugins/): loaded after hydration, failures isolated.
void loadClientPlugins();

// Beta (REPLAYS_BETA_MALLEABLE): saved user plugins and the agent tools. Off: the code is never requested.
if (betaMalleable()) void import('../malleable/boot.ts').then((module) => module.boot());
