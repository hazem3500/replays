import { defineConfig } from '../../src/config/index.ts';

export default defineConfig({
  retentionDays: 30,
  purposes: [
    {
      id: 'triage',
      label: 'Triage',
      order: 0,
      retentionDays: 90,
      viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' },
      poster: 'first-error',
    },
    {
      id: 'design-review',
      label: 'Design reviews',
      order: 1,
      retentionDays: 90,
      viewer: { openAt: 'start', inspector: 'collapsed' },
      poster: 'middle-step',
    },
    {
      id: 'walkthrough',
      label: 'Walkthroughs',
      order: 2,
      retentionDays: 0,
      viewer: { openAt: 'start', captions: true, inspector: 'collapsed' },
      poster: 'last-step',
    },
  ],
  plugins: ['./plugin.ts'],
});
