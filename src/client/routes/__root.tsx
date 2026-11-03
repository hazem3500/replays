import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

import { rootSearchSchema } from '../../shared/schemas/search.ts';
import type { Deployment } from '../deployment.ts';
import { useHydrated } from '../hooks/use-hydrated.ts';
import { useLoadingMotion } from '../hooks/use-loading-motion.ts';
import { KeptIndex } from '../routing/KeptIndex.tsx';
import { ThemeContext, useTheme } from '../theme.tsx';

export interface RouterContext {
  queryClient: QueryClient;
  deployment: Deployment;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: rootSearchSchema,
  /* why: under Start the root renders the whole document (the server adds index.html's head, src/server/pages/start.ts);
     the SPA build mounts into index.html's #root instead. */
  ...(import.meta.env.REPLAYS_START ? { shellComponent: Document } : {}),
  component: Root,
});

function Document({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    // why: index.html's inline script sets data-theme before hydration; data-hydrated marks when controls respond.
    <html lang="en" data-rendered="" data-hydrated={hydrated ? '' : undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

function Root() {
  useLoadingMotion();
  const themeControls = useTheme();
  // why: one provider: hints open after 500 ms, then neighbours open instantly for 400 ms.
  return (
    <ThemeContext.Provider value={themeControls}>
      <TooltipProvider delay={500} closeDelay={0} timeout={400}>
        <KeptIndex />
        <Outlet />
        <Toaster />
      </TooltipProvider>
    </ThemeContext.Provider>
  );
}
