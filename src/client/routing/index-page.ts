import { lazyPage } from './lazy-page.tsx';

/** Shared by the index loader and retained view, so SSR can render it before flushing the shell. */
export const indexPage = lazyPage(
  () => import('../ReplayIndex.tsx'),
  (module) => module.ReplayIndex,
);
