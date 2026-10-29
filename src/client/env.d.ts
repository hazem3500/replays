declare module '*.css';

interface ImportMetaEnv {
  /** True in the TanStack Start build (vite.start.config.ts), where the root route renders the whole document. */
  readonly REPLAYS_START?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
