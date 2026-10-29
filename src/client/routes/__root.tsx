import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { Toaster } from '@/components/ui/sonner.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

import { rootSearchSchema } from '../../shared/schemas/search.ts';
import type { Deployment } from '../deployment.ts';
import { KeptIndex } from '../routing/KeptIndex.tsx';
import { ThemeContext, useTheme } from '../theme.tsx';

export interface RouterContext {
  queryClient: QueryClient;
  deployment: Deployment;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: rootSearchSchema,
  component: Root,
});

function Root() {
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
