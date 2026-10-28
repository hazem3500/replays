import type { Preview } from '@storybook/react-vite';
import { queryClient } from '../src/client/queries.ts';
import { applyStoryHandlers, startNetwork, type NetworkParameters } from '../stories/mocks/network.ts';
import { StoryProviders } from './providers.tsx';
import { dark } from './theme.ts';
import '../src/client/tailwind.css';
import '../src/client/malleable/malleable.css';
import './storybook.css';
import '../stories/recorder/recorder-workbench.css';

const preview: Preview = {
  tags: ['autodocs'],
  globalTypes: {
    theme: {
      description: 'App theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark', icon: 'moon' },
          { value: 'light', title: 'Light', icon: 'sun' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark', backgrounds: { value: 'page' } },
  parameters: {
    layout: 'padded',
    controls: { expanded: true, sort: 'requiredFirst' },
    docs: { theme: dark, toc: true },
    a11y: { test: 'error' },
    backgrounds: {
      options: {
        page: { name: 'Page', value: 'var(--page)' },
        surface: { name: 'Surface', value: 'var(--surface)' },
        raised: { name: 'Raised', value: 'var(--surface-raised)' },
        canvas: { name: 'Player canvas', value: 'var(--canvas)' },
      },
    },
    viewport: {
      options: {
        phone: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        narrow: { name: 'Phone 320', styles: { width: '320px', height: '700px' }, type: 'mobile' },
        tablet: { name: 'Tablet 768', styles: { width: '768px', height: '1024px' }, type: 'tablet' },
        desktop: { name: 'Desktop 1280', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
      },
    },
    options: {
      storySort: {
        order: ['Introduction', 'Foundations', 'Components', 'Recorder', ['Overview', 'Default UI', '*'], 'Extensions', 'App', '*'],
      },
    },
  },
  beforeAll: async () => {
    await startNetwork();
  },
  beforeEach: (context) => {
    applyStoryHandlers(context.parameters.network as NetworkParameters | undefined);
    queryClient.clear();
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'light' ? 'light' : 'dark';
      // why: set before children render so portals, Base UI popups and the recorder's shadow root read the same theme.
      document.documentElement.dataset.theme = theme;
      return (
        <StoryProviders key={context.id} theme={theme}>
          <Story />
        </StoryProviders>
      );
    },
  ],
};
export default preview;
