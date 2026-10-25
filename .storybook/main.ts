import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  core: {
    disableTelemetry: true,
    builder: { name: '@storybook/builder-vite', options: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } },
  },
  async viteFinal(viteConfig) {
    // Avoid inheriting the application's HTML transforms, multi-page inputs and server proxy.
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    viteConfig.resolve = { ...viteConfig.resolve, alias: { '@': fileURLToPath(new URL('../src/client', import.meta.url)) } };
    return viteConfig;
  },
};
export default config;
