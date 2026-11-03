import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { msw } from 'msw/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const source = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  features: { sidebarOnboardingChecklist: false },
  staticDirs: [
    { from: '../src/client/fonts', to: '/fonts' },
    { from: '../public/assets/brand', to: '/brand' },
  ],
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
    builder: { name: '@storybook/builder-vite', options: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } },
  },
  async viteFinal(viteConfig) {
    // why: prebundle all authored motion entry points before stories load, avoiding first-navigation dependency reloads.
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      include: [...(viteConfig.optimizeDeps?.include ?? []), 'motion', 'motion/mini', 'motion/react', 'motion/react-m'],
    };
    // why: the app's HTML transforms, multi-page inputs and dev proxy don't apply to an isolated story canvas.
    // why: worker-only serves mockServiceWorker.js in dev and emits it into storybook-static without a committed copy.
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss(), msw({ mode: 'worker-only' })];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      // why: package subpaths point at dist/, which a fresh checkout has not built; stories run the source.
      alias: {
        '@': source('client'),
        '@hazem3500/replays/recorder/kit': source('recorder/kit/index.ts'),
        '@hazem3500/replays/recorder/react': source('recorder/react/index.tsx'),
        '@hazem3500/replays/recorder/ui': source('recorder/ui/index.ts'),
        '@hazem3500/replays/recorder/testing': source('recorder/testing/index.ts'),
        '@hazem3500/replays/recorder': source('recorder/index.ts'),
      },
    };
    return viteConfig;
  },
};
export default config;
