import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import babel from '@rolldown/plugin-babel';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

/* why: the TanStack Start build: the same routes (src/client/routes) as the SPA build in vite.config.ts, rendered on
 * the server by our node:http server through dist/start/server/server.js (src/server/pages/start.ts), hydrated by
 * dist/start/client. One build serves every base: asset URLs are relative here, and the server entry prefixes them
 * with the request's base (src/client/start/server.ts).
 */
export default defineConfig({
  base: './',
  define: { 'import.meta.env.REPLAYS_START': 'true' },
  plugins: [
    tanstackStart({
      srcDirectory: 'src/client',
      router: {
        entry: './start/router.tsx',
        routesDirectory: './routes',
        generatedRouteTree: './route-tree.gen.ts',
        addExtensions: true,
        quoteStyle: 'single',
        semicolons: true,
      },
      client: { entry: './start/client.tsx' },
      server: { entry: './start/server.ts' },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  environments: {
    client: { build: { outDir: 'dist/start/client', emptyOutDir: true, manifest: true } },
    ssr: { build: { outDir: 'dist/start/server', emptyOutDir: true } },
  },
});
