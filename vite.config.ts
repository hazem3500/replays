import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { PRODUCT_NAME } from './src/shared/brand.ts';
import { normalizeBasePath } from './src/server/base-path.ts';

/** The public base in dev (src/server/base-path.ts): '' at a domain's root, else e.g. `/replays`. */
const devBase = normalizeBasePath(process.env.BASE_PATH);

/**
 * index.html carries `<meta name="app-base" content="">`; the server fills it per request (base-path.ts withBase),
 * the dev server here, so the client and index.html's inline scripts know where the app lives.
 */
function appBaseMeta(): Plugin {
  return {
    name: 'app-base-meta',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html
        .replace('<meta name="app-base" content="" />', `<meta name="app-base" content="${devBase || '/'}" />`)
        .replaceAll('__PRODUCT_NAME__', PRODUCT_NAME)
        .replaceAll('__PRODUCT_LOGO__', ''),
  };
}

/**
 * Vite's build drops `blocking="render"` from the entry script; put it back on index.html's. The app's first
 * render is then the first frame, so a page transition's incoming snapshot is the app (index.html, main.tsx).
 */
function renderBlockingEntry(): Plugin {
  return {
    name: 'render-blocking-entry',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, context) =>
        context.filename.endsWith('index.html')
          ? html.replace(
              /<script type="module"(?![^>]*blocking=)([^>]*src="[^"]*\/main-[^"]*\.js")/,
              '<script type="module" blocking="render"$1',
            )
          : html,
    },
  };
}

/*
 * One build for every base: built asset URLs are relative (`./assets/…`; chunks preload each other relative to
 * themselves), and the server makes index.html's absolute for wherever the app lives (BASE_PATH, read at
 * runtime), so the same image runs at a domain's root or under a prefix. The dev server needs an absolute base.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : `${devBase}/`,
  plugins: [react(), tailwindcss(), renderBlockingEntry(), appBaseMeta()],
  // shadcn/ui convention: "@/components/ui/…" resolves inside the client.
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // render.html is the internal page the server-side video render loads (src/server/renderer.ts).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        render: fileURLToPath(new URL('./render.html', import.meta.url)),
      },
      // React in its own long-cached chunk: it changes far less often than the app, and the index chunk stays
      // under the 500 kB warning. Both load in parallel on first paint, so there is no extra round trip.
      output: { codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } },
    },
  },
}));
