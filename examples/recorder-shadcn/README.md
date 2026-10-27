# A recorder UI owned by your app

Run `pnpm build:recorder` at the repository root, then `pnpm exec vite examples/recorder-shadcn` on your Boat box. The example uses the repository's React and Tailwind dependencies. In a separate app, install Replays and React 18+ and copy `src/` into your shadcn setup.

The copy-owned components under `components/ui/` follow shadcn's Tailwind conventions. Dialog uses the recorder kit's focus trap and focus return; replace these shells with your app's shadcn components. Toast is an inline Sonner-style surface, avoiding a global toaster. There is no import of the default recorder UI.

Provide `/api/recording-token` and `/api/recordings` in your host backend (or replace `upload`). Authentication, prompts like “Record the problem?”, endpoint policy, and completion links belong to the host. `RecorderProvider` connects deferred prompts to the core; `RecorderRegion` keeps the UI out of capture. Stop uses `useStopAttestation`. Privacy copy comes from the prompt's capture facts.

`test/contract.test.tsx` shows how to run the UI contract over this React implementation; the active equivalent lives in `src/recorder/react.test.tsx`. The `RecorderCustom` Storybook stories demonstrate fixed recording time, 30/10-second warnings, progress, success, failure, and phone width.
