import { defineConfig } from 'vite-plus';
// Deliberately isolated from the application's HTML entry points and proxy.
export default defineConfig({
  optimizeDeps: {
    include: ['zod', '@tanstack/query-db-collection', '@tanstack/react-db', '@tanstack/react-table', '@tanstack/react-virtual'],
  },
});
