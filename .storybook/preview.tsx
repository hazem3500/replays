import { useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Preview } from '@storybook/react-vite';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import { resetIndexCache } from '../src/client/index/index-cache.ts';
import { ThemeContext } from '../src/client/theme.tsx';
import { TooltipProvider } from '../src/client/components/ui/tooltip.tsx';
import { installApi, type MockApi } from '../stories/fixtures/api.ts';
import '../src/client/tailwind.css';
import '../src/client/malleable/malleable.css';
import './storybook.css';
import './recorder-custom.css';
import { RecorderHost } from '../stories/fixtures/recorder-host.tsx';
import { dark } from './theme.ts';

// Only set by the browser verification matrix; normal Storybook uses the toolbar unchanged.
const matrixTheme = import.meta.env.VITE_STORYBOOK_TEST_THEME as 'light' | 'dark' | undefined;

const preview: Preview = {
  tags: ['autodocs'],
  initialGlobals: { theme: 'dark', backgrounds: { value: 'app' } },
  parameters: {
    layout: 'padded',
    ...(matrixTheme ? { themes: { themeOverride: matrixTheme } } : {}),
    docs: { theme: dark, story: { inline: false, height: 600 } },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Foundations',
          'Components',
          'Patterns',
          'Loading',
          'App',
          ['Index', 'Viewer', 'Comparison', 'Editor', 'Settings', 'Recorder'],
        ],
      },
    },
    a11y: { test: 'error' },
    backgrounds: {
      options: {
        app: { name: 'App surface', value: 'var(--surface)' },
        canvas: { name: 'Player canvas', value: 'var(--canvas)' },
        raised: { name: 'Raised surface', value: 'var(--surface-raised)' },
      },
    },
    viewport: {
      options: {
        mobile320: {
          name: 'Mobile · 320',
          styles: { width: '320px', height: '740px' },
          type: 'mobile',
        },
        mobile390: {
          name: 'Mobile · 390',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
        tablet768: {
          name: 'Tablet · 768',
          styles: { width: '768px', height: '800px' },
          type: 'tablet',
        },
        desktop1280: {
          name: 'Desktop · 1280',
          styles: { width: '1280px', height: '800px' },
          type: 'desktop',
        },
      },
    },
  },
  afterEach: () => {
    if (matrixTheme && document.documentElement.dataset.theme !== matrixTheme)
      throw new Error(`Story theme drifted from the requested ${matrixTheme} verification mode`);
  },
  beforeEach: (context) => {
    const api = installApi((context.parameters.api ?? {}) as MockApi);
    const href = location.href;
    const historyState = history.state;
    const stored = new Map<string, string | null>();
    for (const key of ['replays-index-view', 'replays-inspector-collapsed', 'replays-inspector-height', 'replays-inspector-navigation']) {
      stored.set(key, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    if (context.parameters.indexView) localStorage.setItem('replays-index-view', context.parameters.indexView);
    const session = new Map(['replays-index-counts', 'replays-index-newest'].map((key) => [key, sessionStorage.getItem(key)]));
    for (const key of session.keys()) sessionStorage.removeItem(key);
    resetIndexCache();
    // Route-bound components read URL filters on first mount. Preserve Storybook's own query string.
    if (context.parameters.search) history.replaceState(null, '', `${location.pathname}${location.search}&${context.parameters.search}`);
    return () => {
      api.restore();
      for (const [key, value] of session) {
        if (value === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, value);
      }
      resetIndexCache();
      history.replaceState(historyState, '', href);
      for (const [key, value] of stored) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    };
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { dark: 'dark', light: 'light' },
      defaultTheme: 'dark',
      parentSelector: 'html',
      attributeName: 'data-theme',
    }),
    (Story, context) => {
      const client = useMemo(
        () =>
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, refetchOnWindowFocus: false, meta: { storyId: context.id } },
            },
          }),
        [context.id],
      );
      const theme = matrixTheme ?? (context.globals.theme === 'light' ? 'light' : 'dark');
      const framed = context.parameters.layout !== 'fullscreen';
      useEffect(
        () => () => {
          client.clear();
        },
        [client],
      );
      return (
        <ThemeContext.Provider value={{ theme, switchTheme: () => {} }}>
          <QueryClientProvider key={context.id} client={client}>
            <TooltipProvider>
              {framed ? (
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Read-only, scrollable canvases need keyboard access.
                <main className="sb-canvas" tabIndex={0} aria-label={`${context.title} · ${context.name}`}>
                  <div className="sb-canvas-content">
                    <Story key={context.id} />
                  </div>
                </main>
              ) : context.title.startsWith('App/Recorder/RecorderCustom') ? (
                <div className="sb-custom-recorder">
                  <RecorderHost status={String(context.args.mode ?? 'idle')} />
                  <Story key={context.id} />
                </div>
              ) : (
                <Story key={context.id} />
              )}
            </TooltipProvider>
          </QueryClientProvider>
        </ThemeContext.Provider>
      );
    },
  ],
};
export default preview;
