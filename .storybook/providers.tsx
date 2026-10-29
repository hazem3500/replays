import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../src/client/queries.ts';
import { ThemeContext, type Theme } from '../src/client/theme.tsx';
import { TooltipProvider } from '../src/client/components/ui/tooltip.tsx';

const noop = () => {};
// invariant: one value object per theme, so the context never changes identity between renders of a story.
const THEMES = { dark: { theme: 'dark', switchTheme: noop }, light: { theme: 'light', switchTheme: noop } } as const;

/** The app's providers, with a query cache owned by one story so cached data never crosses stories. */
export function StoryProviders({ theme, children }: { theme: Theme; children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <ThemeContext.Provider value={THEMES[theme]}>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
