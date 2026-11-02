# Replays Storybook

Storybook is the app’s UI laboratory: token foundations, real Base UI controls, reusable patterns, and complete application workspaces. App code stays under `src/`; fixtures, API doubles and presentation wrappers stay under `stories/`.

## Run it on Boat

All installs, builds, typechecks, browser tests and servers run on the task’s own Boat VM. Use your real thread id; do not reuse another thread’s live preview.

```sh
oz-boat exec --session t3:YOUR_THREAD -- pnpm install --frozen-lockfile
oz-boat exec --session t3:YOUR_THREAD -- pnpm build:storybook
oz-boat exec --session t3:YOUR_THREAD -- pnpm typecheck:storybook
oz-boat exec --session t3:YOUR_THREAD -- env CHROME_PATH=/usr/bin/google-chrome pnpm test:storybook
```

The Vitest config uses `CHROME_PATH` when set, or Playwright’s existing browser installation otherwise. It runs one worker at 1280×800 and does not install browsers. The application’s unit-test configuration is separate.

Start the dev server on Boat with:

```sh
STORYBOOK_ALLOWED_HOSTS=.on.boat.dev \
STORYBOOK_HMR_CLIENT_PORT=443 \
STORYBOOK_HMR_PROTOCOL=wss \
pnpm storybook --host 0.0.0.0
```

Run `oz-boat host --session t3:YOUR_THREAD 6006` for a private preview URL. Stop the box when finished. `STORYBOOK_ALLOWED_HOSTS` accepts comma-separated hosts/suffixes and populates both Storybook core and Vite. HMR env vars are optional; omitted values retain the previous defaults. Invalid HMR ports/protocols fail early.

## Browse and inspect

- **Introduction** explains the lab and recorder workflow.
- **Foundations** reads colour, type, radius, shadow and motion token names from the app’s real CSS and displays their resolved values. Icons use the real animated-icon inventory. The app does not yet have shared spacing custom properties; that gap is shown explicitly.
- **Components** covers buttons, fields, switches, select, slider, progress, badges, keyboard hints, separators, tabs, collapsible, pressable, dialogs, popovers, menus, drawers and tooltips.
- **Patterns** covers feedback, source context, plugin boundaries and permission prompts.
- **App / Index** covers first-run, API loading/error, populated library, search, active-filter chips, feed/grid, suite stacks, poster loading/ready/none, dense and long-content states.
- **App / Viewer** covers the real player/workspace and all diagnostic tabs: console, network, waterfall, performance and context, including empty/dense tracks and the progressive panel loader. Workspace fixtures open at the end of the capture (`t=999`) so the diagnostics are visible immediately; scrub backwards to inspect their arrival.
- **App / Comparison** covers loading, failure, empty diagnostics, paired recordings and narrow viewports.
- **App / Editor** covers desktop/mobile, loading, empty and populated edit lists, all timeline tracks, cursor controls, save-in-flight and save-failure interactions.
- **App / Settings** covers settings dialogs and credential loading, empty, ready, error, unavailable and sign-in states.
- **App / Recorder** retains the UI-state fixtures and adds a real recording playground.

The toolbar supplies light/dark `data-theme`, app/canvas/raised backgrounds and 320/390/768/1280px viewports. Inter Variable is served locally. Component canvases have consistent padding and constrained widths; application stories keep their real fullscreen layout. The manager has matching light/dark Replays branding. Autodocs render stories in isolated iframes so page-level providers, global listeners and API doubles do not overlap.

## Layout and accessibility contract

Section and component stories inherit `layout: 'padded'`. The canvas uses the app's Tailwind `--spacing` unit: eight units on desktop, four on phones, with a constrained content width. Use `fullscreen` only when rendering a real application shell. The Index feed, grid, suite, dense, long-title and pending variants render `ReplayIndex` itself, including its header, toolbar and responsive `--gutter` (32px desktop, 16px phone). Viewer, Comparison and Editor use their own real shells; isolated topbars, transport, scrubbers, timelines, cursor panels, filters, posters and Settings sections use padded canvases.

Axe violations fail the Vitest browser suite across all stories. Index plays wait for API loading to settle and assert a nonzero gutter, the real topbar and an inset poster. The filter interaction waits for its enter animation to finish before axe reads text contrast. Foundations use one main landmark, slider thumbs have accessible names, and the recorder receipt groups its embedded Viewer without nesting a main landmark in another region.

The visual and axe matrix under `.review-artifacts/storybook/layout-a11y/` checks the hosted Boat build at 1280×800 and 390×800 in both themes. The visual audit script uses the existing shared CDP browser and the same installed axe runtime; it installs no browser. Full axe coverage uses the Boat browser-test matrix below. Archived “Before” loading screenshots are historical images with descriptive alternative text; their pixels are intentionally preserved, while their live replacements remain subject to axe. Automated axe checks complement keyboard and visual review; no failing axe rule is intentionally suppressed.

Run the strict browser suite in each viewport/theme combination on Boat:

```sh
STORYBOOK_TEST_WIDTH=1280 VITE_STORYBOOK_TEST_THEME=dark CHROME_PATH=/usr/bin/google-chrome pnpm test:storybook
STORYBOOK_TEST_WIDTH=1280 VITE_STORYBOOK_TEST_THEME=light CHROME_PATH=/usr/bin/google-chrome pnpm test:storybook
STORYBOOK_TEST_WIDTH=390 VITE_STORYBOOK_TEST_THEME=dark CHROME_PATH=/usr/bin/google-chrome pnpm test:storybook
STORYBOOK_TEST_WIDTH=390 VITE_STORYBOOK_TEST_THEME=light CHROME_PATH=/usr/bin/google-chrome pnpm test:storybook
```

The test theme override also asserts the root `data-theme` after every story. These env vars are for verification; omit them for the normal toolbar behavior. Stories with an explicitly chosen phone/tablet viewport retain that intentional viewport variant.

## Test the recorder end to end

Open **App / Recorder / Playground (end-to-end) / Manual** to operate the flow yourself. This is a small fictional Pinecone checkout, also used behind the recorder UI-state stories.

1. Select **Record** and accept consent.
2. Fill in Customer name, Account password and Delivery instructions. Select **Save delivery**.
3. In **Simulate problems**, trigger a console error and fetch the failed checkout. The small activity log confirms the simulated failure.
4. Select **Stop** in the real recorder indicator, add an optional review note, then **Send recording**.
5. Mock mode shows a receipt and embeds the app’s real Viewer. Watch the DOM you just recorded and inspect the captured diagnostics.

The playground calls the production `createRecorder`, passes a real `createDefaultUi`, and deliberately does not override `loadRrweb`. Recording therefore uses real rrweb, console instrumentation and fetch instrumentation. Only the controlled `/api/storybook-checkout-failure` response is a story-level HTTP 500 double. The Record/consent/indicator/review/upload flow is real.

Controls:

| Arg                  | Meaning                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadMode`         | `mock` keeps the upload in memory; `server` POSTs to your server.                                                                                  |
| `serverUrl`          | API base URL; defaults to `/api`.                                                                                                                  |
| `consent` / `review` | Toggle the two production prompts. Turning both off exercises one-click recording.                                                                 |
| `privacy`            | `masked` is the normal private recording; `visible` includes ordinary page text/input values. Passwords stay masked in both. Use fictional values. |
| `theme`              | Recorder UI light/dark scheme. The Light story also sets the app toolbar theme.                                                                    |
| `maxDuration`        | Recording limit in milliseconds; production clamps it to 5 seconds–10 minutes.                                                                     |

**Guided**, **One click**, **Visible content**, **Light** and **Mobile** run a play function automatically. The function starts the real recorder, uses the form, triggers both diagnostics, stops, reviews and uploads. It checks the receipt, event count, gzip round trip, password masking, ordinary-input masking in masked mode, visible input in visible mode, the console error, failed request and review note. Remount a story to start again. The Manual story has no autoplay.

The gzip bundle is retained in an in-memory WeakMap for these assertions, not written to storage. A separate clone goes into the Viewer so playback cannot mutate the uploaded test evidence. Recorder state stories intentionally still use a stub controller: they freeze a particular UI state without beginning a recording. Their host page now matches the real playground.

### Upload to a real server

Start your Replays server on port 3000 on the same Boat VM, then start Storybook with `STORYBOOK_REPLAYS_PROXY=1` (or a full backend URL). This adds a dev-only `/api` proxy to `http://127.0.0.1:3000`; it is disabled when the env var is absent.

Choose **Server upload**, leave `serverUrl=/api`, then record and send. The transport POSTs the actual gzip bundle to `/api/replays`, checks the returned id and links to `/r/<id>`. For a same-origin proxy, the link must be opened on the actual Replays app origin (the Storybook host itself does not serve replay routes). For a direct absolute API URL the link uses that server’s origin. Cross-origin use requires server CORS/auth support. Same-origin authenticated deployments use the browser session cookie. The generic replay-upload API stores the bundle; review notes remain in the local story receipt because this endpoint has no report-note contract.

Server mode is deliberately excluded from automated upload tests. Changing a control or opening a story never creates a server replay; a person must select Record and confirm the real flow. The automated stories always use mock upload.

## Addons and version policy

`storybook` and every `@storybook/*` dependency are pinned to **10.6.4**, npm’s `latest` stable tag checked on 2026-10-27. The official upgrader (`pnpm exec storybook upgrade --yes`) found no required automigrations and its doctor health check passed.

| Addon                        | Why it earns a dependency                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@storybook/addon-docs`      | Autodocs, controls documentation and authored MDX guides.                                                                                       |
| `@storybook/addon-a11y`      | Axe checks in the canvas and browser tests. Violations fail every browser story (`a11y.test: error`); no blanket todo or rule suppressions. |
| `@storybook/addon-themes`    | One toolbar changes the real app’s root `data-theme`, including portal content.                                                                 |
| `@storybook/addon-vitest`    | Render and play-function tests in a real browser, with sidebar test feedback.                                                                   |
| `@vitest/browser-playwright` | Browser provider, pinned to the app’s Vitest version (5.0.5).                                                                                   |

Backgrounds, viewport, controls, actions, measure and outline are built into Storybook 10. Installing the older essentials/backgrounds/viewport/measure/outline addons would duplicate core functionality or add obsolete packages. `storybook/test` is the current bundled assertion/interaction API; no legacy `@storybook/test`, separate interactions addon, Jest runner or Storyshots dependency is needed. No Chromatic account dependency was added. MSW is useful for broader apps, but the small, scoped fetch double here avoids a worker file and covers all current API calls; image-ready stories replace only their own image URL with a checked-in SVG fixture.

Official references: [upgrade guidance](https://storybook.js.org/docs/releases/upgrading), [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide), [Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon), [release channels](https://storybook.js.org/docs/releases).

## Fixture conventions and remaining seams

`stories/fixtures/replays.ts` validates the six demo-seed JSON snapshots against the real `ReplayBundle` contract and exports typed empty/dense/feed/suite factories. Keep identities unique and feed dates descending. `api.ts` installs the story’s fetch response map before mount and restores fetch, URL state and touched storage afterwards. Unknown API routes return 404 rather than reaching a real service. Recorder server mode explicitly opts out of that API double. Do not put mock branches into app components.

The remaining isolation seams belong to the app design owner:

- Replay-page fetch errors are private branches of `ReplayPage` in `App.tsx`; export a small `ReplayLoadError` view taking message/retry/back-link props to render the real error independently. The ready Inspector takes a complete bundle and has no per-tab fetch-error state; its real progressive loading shell is already covered instead of inventing a fake tab error.
- Editor conflict/load-failure views are private branches of the routed app/editor. A small exported conflict view, or explicit loaded/error state on a page wrapper, would make conflict variants independent. Save failure/in-flight states are already exercised through the actual API interaction.
- Direct-entry editor property-panel stories would benefit from an optional `initialSelection` prop on `Editor` (or an exported presentational EffectInspector). The existing real timeline tracks open zoom/blur/speed/caption/highlight properties interactively; private editor helpers are not duplicated here.
- Shared spacing tokens do not exist yet. Introduce them in the design system before the Foundations page can display a real common scale.
- Card, Label and Textarea primitives do not exist in `src/client/components/ui` at this revision. The Pinecone host uses small story-only semantic wrappers and the existing app Input/Button plus CSS tokens. Promote those wrappers only when the design owner wants shared primitives.
- Browser OS fullscreen, downloadable video encoding and deployment-specific sign-in redirects need application/server integration tests; the component stories cover their controls and loading surfaces.

Guided orchestration is available through `createGuidedRecorder` under `recorder/ui`; this playground uses `createRecorder` plus the synchronous `createDefaultUi` export from that UI entrypoint explicitly. Do not modify the separately owned `stories/recorder-custom/` reference stories.

No CI workflow file is changed in this scope. The measured static build is about 10–15 seconds on Boat, so adding `pnpm build:storybook` to the existing build job is inexpensive once the PR owner includes that workflow edit. Browser stories take around 40 seconds with one worker and existing Chrome.
