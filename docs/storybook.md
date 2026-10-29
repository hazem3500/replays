# Storybook

Storybook renders the real components from `src/` with the app's tokens, fonts and providers. Run it on your own Boat box:

```sh
pnpm storybook             # dev server on :6006
pnpm build:storybook       # static build into storybook-static/
pnpm typecheck:storybook
```

## Layout

| Path | What lives there |
| --- | --- |
| `.storybook/main.ts` | Addons (docs, accessibility), static fonts and brand assets, source aliases for the recorder subpaths, the `msw/vite` worker |
| `.storybook/preview.tsx` | Theme toolbar (`data-theme` on `<html>`), viewports, backgrounds, sidebar order, per-story network handlers |
| `.storybook/manager.ts`, `theme.ts` | Branding: the app's mark and tokens for the Storybook UI, following the theme toolbar |
| `stories/foundations/`, `components/` | Tokens and Base UI primitives |
| `stories/recorder/` | Default UI surfaces and the end to end record and upload flow ([recorder.md](recorder.md#iterate-in-storybook)) |
| `stories/extensions/` | Plugin mounts, the permission prompt and the extension overview page |
| `stories/app/` | Settings and stable viewer states |
| `stories/mocks/` | The Mock Service Worker setup and `/api` handler builders |

## Writing a story

- Render the real component. Put fixtures in the story file or next to it; never add a story-only branch to `src/`.
- Network: declare handlers in `parameters.network.handlers` (builders in `stories/mocks/api.ts`). Each story replaces
  every handler, and an `/api` request without one fails with 501.
- States: cover loading, empty, error and populated where the component has them. Pin `globals.theme` or
  `globals.viewport` (`phone`, `narrow`, `tablet`, `desktop`) for stories that only make sense in one.
- Behaviour: assert it in `play` with `storybook/test` and accessible queries. Popups from Base UI animate; wait with
  `opened()` or `settled()` from `stories/play.ts` before asserting colours or closing.
- Effects go in a story-local `hooks/` directory, as in `src/client/hooks/`.
- Accessibility: every story runs axe with `a11y.test: 'error'`. A known product issue may set `'todo'` on the affected
  story with a comment naming the rule; fix the component rather than widening it.

## Running play functions

The repository does not wire a story test runner yet. The proposed setup is `@storybook/addon-vitest` with
`@vitest/browser-playwright` and a `test:storybook` script, run in the Storybook CI job.
