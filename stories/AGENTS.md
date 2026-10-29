# Stories

Read the root guide. The Storybook lane owns `stories/` and `.storybook/`.

- Follow adjacent CSF stories. Cover meaningful empty, loading, error and populated states independently.
- Test UI behavior with `play` and `storybook/test`, using accessible locators and assertions. No snapshot-only tests.
- Keep stories browser-only and deterministic. Mock the network with MSW handlers in `parameters.network.handlers` (`mocks/`); never require a live server.
- Put effects in a story-local `hooks/` directory. See [docs/storybook.md](../docs/storybook.md) for layout, themes, viewports and play helpers.
- Reuse real public component APIs and Base UI primitives. Do not export private helpers solely for stories/tests.
- Storybook's tsconfig uses Bundler resolution because it is Vite-only; the root uses NodeNext for runtime source.
- App React Compiler configuration is in `vite.config.ts`; Storybook compiler parity must be measured before changing this lane.
- Run `pnpm typecheck:storybook` and `pnpm build:storybook` on your own Boat. Inspect package scripts for the current interaction-test runner.
