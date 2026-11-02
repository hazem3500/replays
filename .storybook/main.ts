import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const allowedHosts = process.env.STORYBOOK_ALLOWED_HOSTS?.split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const clientPort = process.env.STORYBOOK_HMR_CLIENT_PORT ? Number(process.env.STORYBOOK_HMR_CLIENT_PORT) : undefined;
const protocol = process.env.STORYBOOK_HMR_PROTOCOL;
if (clientPort !== undefined && (!Number.isInteger(clientPort) || clientPort < 1 || clientPort > 65535))
  throw new Error('STORYBOOK_HMR_CLIENT_PORT must be a valid port');
if (protocol && protocol !== 'ws' && protocol !== 'wss') throw new Error('STORYBOOK_HMR_PROTOCOL must be ws or wss');
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  features: { sidebarOnboardingChecklist: false },
  staticDirs: [{ from: '../src/client/fonts', to: '/fonts' }],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes', '@storybook/addon-vitest'],
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    builder: {
      name: '@storybook/builder-vite',
      options: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) },
    },
  },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? []),
      tailwindcss(),
      {
        name: 'storybook-scope-reference-recorder-css',
        enforce: 'pre',
        load(id) {
          if (id.split('?')[0] === fileURLToPath(new URL('../examples/recorder-shadcn/src/style.css', import.meta.url)))
            return readFileSync(new URL('./recorder-custom.css', import.meta.url), 'utf8');
        },
      },
    ];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        '@': fileURLToPath(new URL('../src/client', import.meta.url)),
        '@hazem3500/replays/recorder/kit': fileURLToPath(new URL('../src/recorder/kit/index.ts', import.meta.url)),
        '@hazem3500/replays/recorder/react': fileURLToPath(new URL('../src/recorder/react/index.tsx', import.meta.url)),
        '@hazem3500/replays/recorder/ui': fileURLToPath(new URL('../src/recorder/ui/index.ts', import.meta.url)),
        '@hazem3500/replays/recorder/testing': fileURLToPath(new URL('../src/recorder/testing/index.ts', import.meta.url)),
        '@hazem3500/replays/recorder': fileURLToPath(new URL('../src/recorder/index.ts', import.meta.url)),
      },
    };
    const previousHmr = typeof viteConfig.server?.hmr === 'object' ? viteConfig.server.hmr : {};
    viteConfig.server = {
      ...viteConfig.server,
      ...(process.env.STORYBOOK_REPLAYS_PROXY
        ? {
            proxy: {
              ...viteConfig.server?.proxy,
              '/api': {
                target: process.env.STORYBOOK_REPLAYS_PROXY.startsWith('http')
                  ? process.env.STORYBOOK_REPLAYS_PROXY
                  : 'http://127.0.0.1:3000',
                changeOrigin: true,
              },
            },
          }
        : {}),
      ...(allowedHosts?.length ? { allowedHosts } : {}),
      ...(clientPort !== undefined || protocol
        ? {
            hmr: {
              ...previousHmr,
              ...(clientPort !== undefined ? { clientPort } : {}),
              ...(protocol ? { protocol: protocol as 'ws' | 'wss' } : {}),
            },
          }
        : {}),
    };
    return viteConfig;
  },
};
export default config;
