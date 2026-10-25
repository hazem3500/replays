import { useEffect } from 'react';
import type { Preview } from '@storybook/react-vite';
import { ThemeContext } from '../src/client/theme.tsx';
import { TooltipProvider } from '../src/client/components/ui/tooltip.tsx';
import '../src/client/tailwind.css';
import '../src/client/styles.css';
import '../src/client/malleable/malleable.css';

const preview: Preview = {
  globalTypes: {
    theme: { description: 'Viewer theme', toolbar: { icon: 'circlehollow', items: ['dark', 'light'], dynamicTitle: true } },
  },
  initialGlobals: { theme: 'dark' },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'light' ? 'light' : 'dark';
      useEffect(() => {
        document.documentElement.dataset.theme = theme;
      }, [theme]);
      return (
        <ThemeContext.Provider value={{ theme, switchTheme: () => {} }}>
          <TooltipProvider>
            <Story />
          </TooltipProvider>
        </ThemeContext.Provider>
      );
    },
  ],
};
export default preview;
