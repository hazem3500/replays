# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

- Suites: a run can carry focus markers that point the reviewer at the requests, console messages or performance moments that matter, each with an optional note. The viewer accents those rows, counts them on the tab, adds a Focus filter and marks them on the seek bar. Set them with `suite run add/set --focus 'network:POST /api/v9/timer # starts the timer'` (`--focus none` clears them) or `focus` on a plan run.
- Viewer: searching the Network tab highlights the matching text in each request, and a shortened path keeps the part that matches instead of hiding it behind an ellipsis. In a suite, the Network and Console search and filters now stay when you switch runs, and switching runs no longer replays the inspector's and transport's opening animations, so the page stays still. When runs are compared side by side, every tile shows its own step caption, sized to its tile.
- Suites: a run whose recorder was killed no longer shows as running forever; after 30 minutes without an update or a recording it shows as partial. The stored run is unchanged, so a late update from the recorder is still accepted. Set `STALE_RUN_MINUTES` (or `staleRunMinutes` in the config; 0 turns it off) to change the time.
- Capture: uploads are gzipped, so large replays upload about 25 times smaller. An older server that refuses gzip gets one plain retry.
- Capture: a goto step to the page that is already open no longer reloads it, so replays don't open on a blank reload.
- CLI: `suite create --baseline` and `suite run add/set --group --target --measure` group runs without a plan file, and `suite show` lists runs by group and target with the baseline and each measured time.
- Capture: you can now record the Playwright page your test already drives, so mocked responses and test data show up in the replay. `RecorderSession.start(cdp, { joinCurrentPage: true })` joins the open page, `session.step(...)` marks each action, and `buildAgentBundle(...)` builds the bundle `capture()` builds. The `./capture` entry no longer loads server packages.
- Capture: a recording now plays until the capture stopped, not until the page last changed. A page that sits still after its last steps no longer cuts those steps off the end of the replay.
- Viewer: a suite run with a summary now says what it checked right above its recording: the first two lines show, and Show more opens the rest. The suite's review summary in the sidebar is easier to read: a card with larger, darker text and six lines before Show more. Leading labels such as "Checked:" or "Good enough:" in either summary are bold.
- Viewer: suite and run summaries now render a safe Markdown subset (lists, numbered lists, subheadings, bold, italic, code, code blocks, quotes, http(s) links). Bare URLs are shortened (`o/r#12`), `Result: Pass|Fail|Partial (note)` shows as a status badge, and the Context tab's "This run" leads with the `Checked:` line and ends with a divider. Summaries stay plain text on the wire and are never HTML.
- Viewer: a run's player no longer waits forever on a page transition the browser never finishes. After 3 s it mounts anyway, so a switched run cannot stay stuck on a black stage and a spinning play button.
- Viewer: on a phone, a suite run's top bar no longer piles its items on top of each other. The run switcher keeps its position and arrow, and "Edited 8 min ago" shortens to fit instead of running over the status dot.
- Viewer: switching runs in a suite while a replay plays, or in quick succession, no longer leaves the new run stuck with a spinning play button and an empty player. The player now stops waiting on a run-switch crossfade that never finishes.
- Viewer: the steps panel now starts collapsed, and your choice to open it is remembered per view. The play button's spinner stays round while a replay starts.
- Viewer: the Performance tab no longer contradicts itself. A paint that was not recorded shows nothing when the other paint was (no more "Recording started after the largest paint" beside a recorded First paint), and "No long tasks were reported" no longer appears while the table lists long tasks. The long-task table's During column names the step without the page's host ("Open /reports" instead of "Open https://host/reports"). Suite run rows say what the first error was: hover "1 error" for "Console error: ..." or "Failed request: GET ... 500". Replay summaries gain `firstError` (summary version 11).

- Viewer: a paused replay at 0:00, and the opening still on the list, now show the frame at the first contentful paint instead of the first snapshot, which for CLI recordings was often blank or unstyled (a cookie dialog before its CSS loaded). The playhead and timeline still start at 0:00 and play starts from there. Opening stills are made again (version 2).
- Suites: a plan can group its runs for a comparison. Each run takes `group` (the flow), `target` (the build it ran against) and `measure` (a step label; the time until that step completed is the run's headline number, stored as `measureMs`), and the suite takes a `baseline` target. The runs sidebar lists a grouped suite by flow, one row per target with its sample count, median and change from the baseline, and the run view opens with a line such as "Cold open on #6879: Entries visible after 1.9 s". Comparing a run shows only the other targets of its own flow, named by target. Suites without these fields look as before. See `sample/suite-perf-plan.json`.
- Capture: CLI recordings now record frame rate, so the player and suite runs show FPS instead of n/a.
- Viewer: a suite's review summary in the runs sidebar shows its first few lines with Show more, instead of a tall block. Performance suite rows name their stats (Longest task, Blocking) and colour them against the same budgets as the Performance tab, and no longer say "FPS not recorded"; the player hides its FPS readout when frames were not recorded instead of showing n/a.
- Viewer: the Network timeline's lane names (Requests, Slow, Failed) sit in the left column beside their lanes again; they stacked above the chart because the timeline borrowed spacing that only the Performance tab defines.
- Viewer: the Performance tab's stat strip leaves out a group that has nothing measured (for example "Frame rate wasn't recorded") instead of saying so, and with Details open it gets no heading. A tab with no measurements at all still says so.
- Viewer: the inspector tabs' loading placeholders now match each tab. Console, Network, Performance, Context and Comments each draw their own layout (filter pills, timeline lanes, table columns, label and value rows, comment cards) from one shared skeleton block, and the page's loading screen opens on the tab you last used instead of identical stripes. A placeholder appears only if loading takes longer than 150 ms, and it does not shimmer under reduced motion. Empty tabs keep a quiet icon and one sentence.
- Viewer: the Performance tab puts the table first. A 32 px headline row (with Jump to on the same line) and one compact strip of stats (`First paint 10.0 s` with a rating dot, thresholds in the tooltip, missing-data notes muted at the end) replace the tall stat grid; a Details toggle, remembered, opens the grouped grid with meters, where every group name, stat and note starts on the timeline's own left edge. A collapsed timeline is one slim header row with no chart. Jump to now goes to the worst moment of the cluster the headline names. A short bottom panel grows (about 200 ms, never under reduced motion, never past 60 % of the window or on a short window) until the headline, timeline and four table rows fit, and stops for good once you drag the splitter. The `performance.vitals` slot gains `core:group:<group>` and `core:note:<group>` items.
- Viewer: the Network tab's timeline now matches the Performance tab's. Requests are a compact density lane, slow requests (amber) and failed ones (rose) get thin lanes of their own, named in the shared left gutter with the same axis, gridlines, playhead and crosshair. A hover gives the time, count and the slowest or failed request in that slice; the separate legend and hint row are gone (the hint lives in a tooltip). The collapse toggle moves to the top left, hides the chart completely, and is remembered per tab.
- Viewer: the Performance tab says why a moment was slow. An interaction's detail shows where its time went (input delay, processing, presentation, with the target and the one-line verdict) and the scripts of the long animation frame it sat in (file, function, time, full URL on hover, plus the share spent in style and layout). The Long tasks lane is drawn from long animation frames when a recording has them, and the table lists interactions beside long tasks. A recording made from a fresh page load says "Recorded from page load". Request labels (Network table and the "Around this moment" waterfall) drop the origin and query, show ids as `:id`, cut the middle instead of the end and keep the full URL in the tooltip; the waterfall's ruler labels no longer overlap and its label column can be resized (drag, arrow keys, double-click to reset; remembered).

- Index: switching tabs no longer runs a page-wide cross-fade (it lit up the header and tab labels and showed two tabs selected). The selected tab updates on the click, only the tab indicator glides, the rows swap at once, and the list returns to the top.
- Viewer: the Performance tab copes with replays that lack data. A missing stat is hidden instead of drawn as a dash with an empty meter; a group with nothing measured becomes one muted line ("Frame rate wasn’t recorded") with the reason in a tooltip, and a replay with no measurements says so once. Long tasks that land before the largest paint, or in the first two seconds before any interaction, read "Slow while loading" instead of "Slow around 0:00". The header's status and "Edited" text no longer run together. The player bar's FPS readout uses the same frame data as the tab (or hides when none is near the playhead), paint stats missing because recording started late say "Recording started after the page loaded", and the stats are a compact wrapping row beneath the timeline.
- Recorder: with Performance on, the recording now keeps what explains slowness. `performance.longFrames` holds Long Animation Frames over 50 ms (Chromium; start, duration, blocking time, render and style start, and the three longest scripts as origin and path only, function, invoker and time; at most 30 a minute and 300 in all). `performance.interactions` holds interactions grouped by Event Timing id (threshold 16 ms, at most 200) with the input delay, processing and presentation breakdown, a target described by tag and role (plus a name cut to 40 characters unless the privacy mode masks text), the step it falls in and the long frame it overlaps. Both are optional, so older bundles and viewers are unaffected and `formatVersion` stays 1; `replay.schema.json` documents them.
- Recorder: with Performance on, the options step offers "Start from a fresh page load". It saves the choice for 30 seconds, reloads, and the recorder resumes without asking again, reading paint, layout shift, long task, long animation frame and interaction entries from the browser's buffer; `meta.captured.fromLoad` marks such a recording. On by default for staff, off for customers, and `choices.fromLoad: false` opts a host out. A new `@hazem3500/replays/recorder/early` script (619 bytes, no dependencies) goes in `<head>` and starts those observers and the recorder download before the app runs; see `docs/recorder.md`.

- Connect GitHub on a server with several hosts: the flow now runs entirely on `PUBLIC_ORIGIN` (GitHub has one callback URL). From another host the account menu links to `<PUBLIC_ORIGIN>/auth/github/start?return=<current URL>`, and the callback returns to `return` only when its host is one the server serves, so a flow started on a second host no longer fails with a missing state cookie.
- Connect GitHub: an optional built-in plugin, on when `REPLAYS_GITHUB_CLIENT_ID` and `REPLAYS_GITHUB_CLIENT_SECRET` are set. A signed-in person verifies their GitHub login once from the account menu (OAuth with PKCE, no scopes, token discarded and revoked); the link is stored under `_identity/github/` and counts like a verified `api.identity` handle for avatars, `?for=me` and `/api/me`. Disconnect is in the same menu. The account menu now also shows for sign-ins without a sign-out URL when it has GitHub actions.
- Viewer: in a suite, pressing play (the button, Space or K) right after switching runs now starts the new run as soon as it is ready, with a small spinner in the play button meanwhile; a run that was playing keeps playing across a switch, and a quick A, B, C switch only starts C. Once the run on screen is loaded, the suite's other runs are preloaded at low priority (next and previous first, two at a time, skipped on data saver or a 2g link) and the viewer keeps up to five parsed runs.
- Recorder: an upload error may set `notice`, so the default UI shows a neutral lock in the muted colour instead of the red alert.
- Recorder: when an upload error's `action` rejects without a `userMessage`, the default UI puts the earlier guidance back instead of leaving the pending message up, and the pending spinner stops with the surface.
- Packaging: the viewer cache directory (`viewer-<version>-<key>`) is keyed by the copied files' content, not the size of `dist/lib/server.mjs`, so updating to a build with the same version but a changed viewer sets up a fresh copy instead of reusing the old one.

- Recorder: an upload error action may set `pendingMessage` (shown with a spinner while the action runs) and `failedLabel` (the button's label after a failed run).

- Recorder: an upload error's `action` may set `replacesRetry`, so the default UI shows that action alone (plus dismiss) instead of beside Retry.

- Packaging: installing the package for the CLI is small. `dependencies` is only `playwright-core`; `dist/cli` bundles the CLI commands (capture, import, upload, probe, edit, suite, doctor, login, status, logout, agent-guide) and needs nothing else. The server and viewer dependencies are optional `peerDependencies`. `replays serve` (and `migrate`, `mcp`, `build-static`, `plugin check`) runs from the package when those are installed beside it, and otherwise installs them once into `~/.cache/replays/viewer-<version>-<key>` (`REPLAYS_VIEWER_CACHE` overrides the location) and runs from a copy there. Programs that import `@hazem3500/replays/server` or the other library entries install the peer dependencies themselves.

- Recorder options menu: privacy modes the host does not allow (not in `choices.privacy`, or above its `privacy` cap) are no longer listed as disabled with "Not allowed here"; they are not shown. With one mode left the Privacy group is dropped, and the network-content checkbox is hidden unless `capture.network` is `'bodies'`. The `privacyUnavailable` message is deprecated and no longer shown; hosts that set it keep working.

- CLI: `replays capture` gains `--hide <selector>` (repeatable; hides matches from the first frame in the replay and in `shot` images, and rejects an invalid selector before recording), `--privacy visible|inputs-masked|text-masked|interface-visible|masked` (the recorder's own modes: `visible` also records typed values and declares `meta.captured.inputs: "visible"`; `interface-visible` and `masked` also block media; a profile that masks text refuses a mode that shows it), and pacing flags: `--type-delay <ms>` (default 80), `--shot-delay <ms>` (default the step pause), `--step-delay` (another name for `--step-pause`) and `--compress-waits` (an unlabelled fixed wait over 5 s plays as 2 s on every track, captioned "Waited n s, sped up here"; not with `--video`). `LaunchOptions.typeDelayMs` is a new optional member. Defaults are unchanged.

- CLI: `replays capture --state <file>` starts the browser from a Playwright storage state, so a flow behind a sign-in can be recorded (the same loading and checks as `probe --state`; agent-browser reads the same file shape, and now gets `AGENT_BROWSER_STATE` on its launch command only, so it no longer returns to `about:blank` on every command). `wait` steps take `{"selector","state":"visible|attached|hidden","timeout"}` next to `ms`, `scroll` steps take a `selector` to bring into view next to `direction` and `pixels`, and a new `shot` step saves `<output>/shots/<name>.png`. The result lists them under `shots` as `{name, file, label, step, at}`. `CaptureDriver.screenshot` and `LaunchOptions.state` are new optional members. The suite plan schema accepts the new steps.

- Viewer: the Performance tab answers "was this slow, where, and why?". A one-line headline leads (for example "Slow around 0:05: long tasks blocked 5 clicks", with a "Jump to 0:05" button that seeks there and lights those marks), then the stats in Loading, Responsiveness and Smoothness groups with threshold meters (the layout shift score is new, and a stat the browser could not observe shows a dash with the reason), then a swimlane timeline of interactions, long tasks, slow requests and layout shifts on the frame-rate chart's own time axis and crosshair, then the moments table. Hovering a mark and its row light each other; the rating colours are shared OKLCH tokens (`--rating-good`, `--rating-needs-work`, `--rating-poor`); Worst first and In order moved into the When and Took headers. A moment's detail now says why: the long task that blocked it, or the requests in flight, each a link. The `performance.vitals` slot items are now `core:<id>` for each stat (`fcp`, `lcp`, `interaction`, `task`, `tbt`, `median`, `slowest`, `dropped`, `shift`).

- CLI: `replays capture --headed --manual` records what a person does in a headed browser (`--output` optional, `--max-duration` caps it at up to ten minutes, default three). It stops when the window or page is closed, on Enter when stdin is a terminal, or on SIGINT/SIGTERM (a second SIGINT aborts), then saves and uploads like any capture. Steps are derived from the clicks, form submits and page changes the page showed, named by the in-app recorder's own code; no selectors or typed values are kept. `--manual` needs `--headed` and the playwright driver and cannot be combined with `--steps`.
- Network: requests keep `traceparent`, `x-trace-id`, `x-request-id` and the trace metrics of `server-timing`, store a normalized `traceId`, and show it in request details; `integrations.traceUrlTemplate` (`TRACE_URL_TEMPLATE`) makes the trace ID in request details a link. `GET /api/config` reports `integrations`.

- Recorder: first-party upload handoff for browsers that block third-party cookies. `GET /upload` serves a page that takes a bundle by `postMessage` from an origin the `/api/replays` request policy lists and uploads it same-origin; `handoffUpload()` opens it, checks origins both ways, and times out or fails when the window is closed. The default UI now shows an upload error's `link` beside its `action`.

- CLI: `replays suite` creates and runs review suites end to end: `suite create`, `suite run add|set|summary`, `suite summary`, `suite show`, `suite list [--mine]` and `suite record --plan plan.json`, which registers the suite, then for each run registers it as running, captures it with the closed step vocabulary, uploads the replay to the run and marks it passed or failed (a failed run does not stop the next; `--only <run>` retries one, `--dry-run` checks the plan). The plan format is `docs/formats/suite-plan.schema.json`, with an example in `sample/suite-plan.json`. Every command takes `--json` and the usual `--server`, `--upload-url` and `--header-file`.

- Identity resolvers (`api.identity`) can return `handles` (`{ github: 'octocat' }`): accounts the server vouches for. They match the viewer in **For me** and appear in `GET /api/me` without being linked by hand; handles a browser linked still only filter.

- CLI selectors: capture steps act on the first visible match of a selector (Playwright `.filter({ visible: true }).first()`, and the same through CDP for `agent-browser`) instead of failing on a hidden duplicate. A step that times out lists up to five candidates with tag, text and visible or hidden. New `replays probe --url <url> --selector <selector> [--json]` opens the page headless and reports every match with visibility and bounding box.

- CLI: `capture --json` reports `networkRequested` and `networkMode`, so `--network bodies` on the `agent-browser` driver (which records headers only) no longer degrades silently; the human summary has a Network line saying so. `--profile triage`, `design-review`, `walkthrough` and `support` are accepted without a declaration; only an unknown id warns, naming `replays.config.*` and the ids to use. `doctor` splits the Node check into `capture/upload` and `serve` (`needs Node 22.22+` is a warning that blocks `serve` only).

- CLI upload: a video that cannot be read or sent no longer fails the command once the replay JSON is saved. Human output reads "Replay uploaded · video skipped: <reason>" and `--json` carries `"video":{"uploaded":false,"error":"..."}`. The result also carries `url`, the viewer link (the server's own receipt `url`, else `<server>/r/<id>`), for `upload` and `capture --upload`.

- Bundles carry `meta.formatVersion` (currently 1). An upload the server rejects with 400 or 422 answers with the server's format in `x-replays-format`, and the CLI prints "This CLI writes format X; the server expects Y. Update with `replays update`, or the server needs a newer pin." A bundle from a newer format than the server reads is refused naming `replay.meta.formatVersion`.

- CLI: `replays edit <id|link>` edits a replay without a browser: `show` (numbered steps and edits), `rename`, `cut` (including `cut waits`), `speed`, `zoom`, `blur`/`remove`, `caption`, `highlight`, `trim`, `cursor`, `pull`/`push` of the whole edit list with a diff and a stale-file check, and `export` of the edited video with progress. Changes are read-modify-write with `If-Match` and one retry on a conflict, validated with the server's own validator first; every command takes `--json`. There is no `undo`: the server stores no edit history.

- Viewer: people on a replay (any role, matched by signed-in email) and admins can rename a step by double-clicking it in the Steps list (or F2 on a focused row) or the caption on the player. Names are stored in the edits sidecar as `stepNames` (see [edits.schema.json](docs/formats/edits.schema.json)) and show in the list, seek bar, captions and exports; "Reset" restores the automatic name. `PUT /api/replays/<id>/edits` answers 403 when `stepNames` change and the caller is not related to the replay.

- Request policies: an optional `originPatterns` list of anchored host patterns (such as `^https://[0-9]+-web\.pull\.example\.com$`) for trusted origins that vary by subdomain, validated at registration so none can be broad. A refused cross-origin request now answers `403` with `Vary: Origin` and a JSON body, and a listed origin can read the refusal of a method or header it may not use.

- Review suites: an optional plain-text `summary` on a suite and on each run. The suite's shows (collapsible) in the sidebar header and the run's in its Context tab. Not part of a registration's identity, so a later registration can replace it; at most 4000 characters, no HTML.

- CLI: a branded, dependency-free terminal experience (header in the Replays pink, spinners for capture and upload, aligned `status` and `doctor` blocks, aligned help, clickable replay links) that turns itself off when piped, in CI, with `NO_COLOR` or with `--json`. Added `--json` to `capture`, `upload`, `status` and `doctor`, `replays agent-guide` (markdown generated from the same command definitions as `--help`), `doctor` checks for Node, Chrome, ffmpeg and sign-in, a one-line fix hint on common failures (also a `hint` field in the JSON error), and an opt-in once-a-day update notice. Exit codes and the default JSON output are unchanged.

- Viewer: performance-focused replays (the Performance profile or view, a profile capturing performance, or a `performance` tag) open on the Performance tab, show the frame rate at the playhead in the player controls, and add a frame-rate lane to the Performance time ribbon. A replay without frame samples says "Frame timing not recorded". Suites in that mode show each run's median and slowest-second FPS, longest task and blocking time in the run list. Replay summaries gain `perf` (summary version 10); frame rates are estimates from one-second samples.

- Recorder: new **Inputs hidden** privacy mode (`inputs-masked`) records page text and media but masks typed values, and replaces Text masked in the default options menu, which now lists Visible, Inputs hidden, Your data hidden and Fully masked for staff. `text-masked` is still accepted in `choices`, stored choices, bundles and the schema; customer choices are unchanged.

- Recorder: optional per-recording host context snapshots, active-only semantic action labels and independently selectable performance/debugging diagnostics. Numeric timing capture includes bounded foreground frame samples and layout shifts; error context remains bounded and redacted. Generated lifecycle captions are hidden, and the viewer adds sortable network columns, resizable request details, full-URL tooltips and accessible caption options.

- Packaging: add an independent private capture-only staging build with an explicit CLI capability manifest, graph-derived runtime dependencies and isolated CI pack checks. The full distribution, commands and public exports are unchanged; no new package is published.

- Recorder upload errors support cancellable host recovery actions, safe localized failure guidance and one retry of the retained report after recovery. Actions take precedence over legacy links; dismissing or destroying the recorder prevents late retries.

- Editor timeline: each recorded step is a dot on the ruler, filled for an action and hollow for a wait, right over a faint divider in the clip where that step starts; the clip names each step in whole words where they fit, in the quietest text. Hovering or focusing a dot names the step, says its kind and time ("Click, 0:03.2") or how long it waits and what it follows ("Wait, 2.1 s, after Open the cart"), and what its shape means; a click seeks there. The clip folds a wait named only as a wait ("Wait for the page") into the step before it, joins waits back to back into one dim block named by its length ("Wait 1.5 s"), and keeps step names clear of cuts; captions written from the steps skip the same load waits. Each dot is 10 px inside a 24 px target, dots too close to tell apart merge, and the dots are one tab stop with arrows moving along them. Every lane block (zoom, speed, blur, captions and highlight labels) shows its leading whole words, never part of a word, an ellipsis or a fade, and nothing looks like an empty box: an effect block too short for two words is a thin bar in its lane's hue across its span and a clip step too short for its words is a slim divider, never an icon stub; the full text stays in its tooltip and accessible name. Lanes are 28 px tall, 4 px apart, so the preview keeps the height, and blocks show depth by tint alone. Each effect lane has its own quiet hue from the theme (zoom the accent, speed amber, blur rose, captions green) on its glyph and a tint of its blocks, in both themes. The ruler keeps its dots in a band of their own, clear of the time labels and ticks. The phone timeline opens with the whole recording across the screen from 0:00 at its left margin, with a playhead that moves along it; its scale seeks and scrubs (settling on a step it ends near) and shows the same dots (a tap seeks and shows the label under the dot, clear of the time). A quiet line over its lanes names the step under the playhead in whole words as you scrub, and a screen reader hears where a scrub settles. It sits on the tools with the picture centred above it, reads "0:05.8 after edits" as the desktop does, and names its tools as the desktop does: Cut and Captions on the bar, and Waits, Speed up, Trim, Highlight, Captions and Zoom in More, each with one line saying what it does or why it is unavailable. The desktop timeline grows to hold every effect lane. While the editor loads, its dock is drawn with the loaded dock's own layout (the labelled tools, "0:00.0 / total", what the edits leave, the ruler with its dots, the clip and the cached lanes), so nothing moves when it arrives. The toolbar's Cut, Waits and Highlight show their keys (C, W, M) where the bar has room. The Add menu is shorter: Zoom, Speed up, Blur and Captions, with quieter keys and one line saying what the item under the pointer does. A disabled Export is a quiet outlined button whose tooltip says why. "Show empty tracks" moved to the More menu, and the "Add at the playhead" row under the timeline is gone, since the Add menu holds the same items.

- Customer privacy choices ([docs/recorder.md](docs/recorder.md#options-step-for-customers), [docs/extending.md](docs/extending.md#customer-choices-on-upload)): `choices.by: 'customer'` gives customer recorders the options step. Every recording starts in the new **Your data hidden** mode (`interface-visible`): all page text, typed values and media are hidden except static product interface the host marks with `data-replay-public` (new `publicProps` and `PUBLIC_ATTRIBUTE`), which never reaches inputs, textareas, selects or editable regions. **Fully masked** (the `masked` mode, renamed in the menu for staff too, with the hint "Hides everything") is always offered, and looser modes the host allows need the customer's own pick; nothing is remembered. `choices.networkBodies` adds "Include network request and response content" for staff and customers, off by default and capped by `capture`. Consent and review say what the chosen mode records, naming the host's `app.name` (new message keys `reviewPrivacy`, `networkLabel`, `networkBodies`; `confirmUpload` receives `privacy`). Customer bundles carry `meta.captured.choice: { by, mode, inputs, text, bodies }`. On the server, a new file-only `privacy.keepCustomerChoices` (off by default) keeps the chosen typed values and bodies only when that claim is present and matches the bundle; otherwise a customer bundle keeps no typed value and no body. Passwords, hidden inputs, credential URLs and auth headers are redacted in every case. `sanitizeReplayBundle` takes `{ keepCustomerChoices }`. The default review dialog now shows the same privacy line for every host. Staff masking and upload rules are unchanged.

- Visible inputs for staff recordings ([docs/extending.md](docs/extending.md#visible-inputs-for-staff-recordings)): a new `privacy.keepVisibleInputs` config key (off by default, file only) lets the server keep the ordinary input values of a recording the browser recorder made with `privacy.sanitize: false`, which now says so in `meta.captured.inputs: 'visible'`. Values are kept only for a signed-in staff upload on `POST /api/replays`: plugin upload endpoints (app-key, customer or support ingest), scoped upload tokens, confined identities and `auth: none` are always fully masked, and the claim is dropped. Password and hidden inputs stay masked on the server in every case. `sanitizeReplayBundle` takes an optional third argument, `{ keepVisibleInputs }`. Without the key nothing changes.

- Viewer: the replay cursor no longer sets off before the recorded pointer did. A sweep the recording sampled now starts when the pointer left its rest and lands when it arrived, instead of starting up to a second early on the cursor's own travel time.

- Viewer: Shift and click on the download button saves the replay bundle as `<replay-id>.json` instead of rendering the video; Shift+Enter and Shift+Space do the same on the focused button, and its hint says so. A plain click is unchanged. The recorder's options menu no longer shows the "Passwords always stay hidden" note (passwords stay masked in every mode).

- Recorder options step, opt-in for internal hosts ([docs/recorder.md](docs/recorder.md#options-step-for-internal-hosts)): `choices` on `createRecorder` and `createGuidedRecorder` lets staff pick masking (`visible`, `text-masked`, `masked`) and a profile from one small menu behind a quiet options button on the Record pill, right before each recording. Profiles take the deployment's own list (`GET /api/config`'s `profiles`) with optional one-line descriptions, and each mode says in one line what it records. The options and close buttons use the viewer's animated icons, now shared from a browser-safe recorder module. The core caps every mode by the host's own `privacy`, never shows the step to a host with the default privacy, keeps passwords, hidden inputs, credential URLs and auth headers protected in every mode, and applies the choice to that recording only; the profile becomes `meta.profile`. The last choice is remembered per origin. New `RecorderUi.chooseOptions`, `start({ choice })` and message keys (`optionsTitle`, `optionsSummary`, `privacyLabel`, `profileLabel`, `privacyUnavailable`, `privacyMode`, `privacyHint`, `record`). Hosts without `choices` see no change.

- Editor: inspector panels group each setting in a soft card, with the object's remove or reset action as a labelled icon in the panel header; timeline clips are neutral with a stripe in their lane's colour, lift when selected and show a Remove bubble above them, and captions fade out at the clip's end.

- Recorder default UI: one redesigned floating pill (fully round, even weights, tabular timer, a clear red Stop control with hover, focus and press states, a calmer live dot and a red timer in the final 10 seconds), quieter consent and review dialogs, and status icons on results. A receipt URL now offers **Open** (new message key `openLink`) beside **Copy link**; hosts that pass `completion.actions` keep full control.

- Edits: speed-ups can also play at 1.5×, and captions no longer overlap (an overlapping saved list is separated on save). Older edit lists still load unchanged. The editor sets zoom with a continuous slider and its inspectors share one layout.

- Added pure network, performance, waterfall and error builders at `/viewer/diagnostics`, with packed browser-consumer checks for optional React and recorder compositions.

- Added confirmed bulk trash for readable, delete-authorized uploads with protected keeps, read-only sample preservation, bounded concurrency and count-only partial results.

- Added Data & storage settings with authoritative retention/backend information, access-filtered trash, restore and confirmed per-replay deletion through existing protected APIs.

- Adopted Motion for authored application and recorder UI animations; replaced NumberFlow and clarified the React 19 minimum.
- Added independent React playback providers, hooks, stage, transport, steps and headless diagnostics at `/viewer/react`.

- Wired host DOM contributions into network columns, performance vitals, editor actions, inspector sections, timeline lanes and settings destinations, including phone layouts, shared slot policy and validated editor commands.

- Added browser and server safe portable replay, edit and privacy models at `/model`.
- Added framework independent playback at `/viewer/playback`, reusing the existing replay engine with independently owned loading, subscriptions, mounts and cleanup.

- Added trusted browser contributions for synchronous editor tools, user-invoked export formats and conflict-checked viewer shortcuts through the shared slot policy.

- Added typed browser activity subscriptions for trusted plugins (`api.on`), with automatic reload cleanup and metadata-only payloads. No telemetry is sent by default.

- Added the v2 public theme token catalogue for motion, spacing, type, elevation and component styling through config and trusted plugin branding. Existing tokens and default appearance are retained.

### Security

- Apply canonical Node request hooks and web middleware to per-replay data-storage authorization checks, preserving individual read/delete restrictions during trash listing and bulk operations.

- Error responses no longer pass on what the server didn't decide itself. A storage provider's status
  (`GcsError`/`S3Error` 403/404/429) and a corrupt stored file are now a generic `500 internal error`, not a 4xx
  carrying the provider's or the parser's message. Storage `NotFoundError`/`ObjectExistsError`/`PreconditionFailedError`
  keep their status (404/409) but no longer name the object key. Malformed JSON request bodies are `400 body is not
  valid JSON` everywhere. `rejectUpload()` and the documented 4xx answers are unchanged.

- Add adapter-owned/configurable sign-in recovery for public CDN viewers: safe authenticated return endpoints, page-load recovery and a bounded automatic attempt with manual fallback.

### Added

- The viewer opens in a view: `?view=<id>` first, then the suite's profile, then the replay's profile, then Compare for
  two or more recordings, else Standard. **View:** in the top bar (in More on phones) switches it, and `V` / `Shift V`
  step through the views, without remounting a player. A view orders the inspector's tabs and picks the one shown
  first, can hide the inspector (Walkthrough leaves **Show details**), fold the steps rail, show step captions, fade the
  top bar while playing, limit the seek bar's built-in tracks and draw a headline: the new `viewer.headline` slot, with
  `core:issues`, `core:vitals`, `core:comments` and `core:compare-summary` built in. The dock's height and fold, the
  steps rail's fold, captions and the default tab are remembered per view (**Reset this view** forgets them); the old
  global keys are no longer read. `core:view` joins the `viewer.actions` slot, and suites accept a `profile`.
- **Recorder network bodies, opt-in** ([docs/recorder.md](docs/recorder.md#capture-and-network-bodies)): a new `capture`
  option on `createRecorder` and `createGuidedRecorder` takes a profile's capture block as is (`network: 'off' | 'headers'
  | 'bodies'`, `bodies`, `console`, stricter `privacy`). With `'bodies'` the recorder reads fetch and XHR request and
  response bodies under the capture CLI's rules: JSON, text and form only, 64 KiB with `truncated`, redacted in the page
  and again on upload. Streams, server-sent events and binary bodies are never read, and the page's own requests and
  responses are untouched. Every recorder bundle now carries `meta.captured`, consent facts gain
  `captures.networkBodies`, and the default consent copy says when request content is recorded. Bodies stay off by
  default.
- **Recorder messages and formatting** ([docs/recorder.md](docs/recorder.md#messages-and-formatting)): the recorder's
  `messages` option covers every string the default UI, the step kit and `selectError` show, including accessible names,
  tooltips, live announcements, copy-link feedback and the privacy notice. `RecorderMessages` requires every key;
  data-bearing keys (`consentBody`, `consentPrivacy`, `warningSoon`, `warningFinal`, `reviewBody`, `sent`, `failed`,
  `startFailed`) are functions of typed params for host i18n. New `defaultRecorderMessages`, `resolveRecorderMessages`,
  `RecorderMessageOverrides`, `RecorderMessageError`, a `locale` option and `format: { elapsed, duration, bytes }` hooks
  with Intl defaults (`createRecorderFormat`, `RecorderFormat`); timers take `format.elapsed` too. Existing string
  overrides keep working: a `{param}` template string is still accepted for every data-bearing key.
- The viewer's top bar actions (`core:compare`, `core:edit`, `core:info`, `core:link`, `core:download`), its Context
  tab sections (`core:summary`, `core:sources`, `core:fields`) and its seek bar tracks (`core:steps`, `core:errors`,
  `core:highlights`) are slot items: `configureSlot` can reorder or hide them like the inspector's tabs. Plugin
  context sections are placed where a host's order puts them.
- Compared recordings go by name: each tile, the inspector's "Showing" switch and the Network and Performance panels
  name a recording by what tells it apart ("Before", "Firefox", "Run 3": the parts every label shares are dropped)
  beside one colour swatch, instead of A, B, C. Vitals and request details now say how each other recording did.
- A signed-in person sees an account menu in the top bar (in More on phones): who is signed in and, when the auth
  mode has a way, **Sign out**. `GET /api/me` adds `session: { signedIn, signOutUrl? }`, and auth adapters may offer
  `signOutUrl(context)` (the OIDC adapter returns its `/auth/logout`). Nothing shows under `AUTH_MODE=none`.
- Editor cursor styles: `ReplayEdits.cursor.appearance` draws the cursor as the CUA arrow (default), a classic pointer, a
  hand, a dot, a ring or an agent pointer with a name tag, and `cursor.color` tints it with one of six token colors. The
  inspector shows each style drawn by the player's own renderer. Classic, hand, dot and ring add a click ripple or pulse
  during a press; the CUA arrow keeps its press squish. Viewer, editor preview and MP4 export draw the same glyph.
- Editor blur rethought: blurs draw a strong blur with soft edges (no grey veil), feathered outside the box so the box
  itself stays fully hidden. `ReplayBlur.style: 'redact'` draws a solid block instead. While placing a blur, a click
  covers the recorded element under the pointer. The selected box has edge and corner handles and a style label, the
  inspector picks Blur or Redact, and lane items are labelled with their style. Viewer and MP4 export draw the same.
- **Capture profiles in the CLI and network bodies** ([docs/extension-api.md](docs/extension-api.md#capture-profiles)):
  `replays capture --profile <id>` applies the profile's `capture` block under the explicit flags; new `--network
  off|headers|bodies` and `--no-performance`. Every capture writes `meta.captured`. Network bodies are opt-in: JSON, text
  and form only, cut at 64 KiB with `truncated`, and redacted (secret fields, credentials, JWTs, card numbers, email
  addresses, the deployment's rules) at capture and again in the server's privacy pass. `requestBody`, `responseBody` and
  `meta.captured` are in docs/formats/replay.schema.json.

- **Views and capture profiles** ([docs/extension-api.md](docs/extension-api.md#views)): core ships seven views (`standard`,
  `compare`, `performance`, `debug`, `walkthrough`, `review`, `support`) as data. The config key `views` and `api.view` add or
  retune them, and `GET /api/config` and `<meta name="app-views">` serve them; `ViewCatalog`/`createViewCatalog` from `/server`.
  Profiles gain `view` and a `capture` block (console levels, network `off`/`headers`/`bodies`, body limits, performance,
  sampling, CLI defaults, stricter privacy only). Core ships a built-in `performance` profile, which the index shows as a tab
  only once a replay has it.

- Expired replays: when retention removes a replay the server keeps a small record of it (title, host, dates, the
  window and profile that applied; nothing of the recording) for `RETENTION_EXPIRED_DAYS` (default 30, `0` keeps none),
  served at `GET /api/expired-replays` and documented as `docs/formats/expired-replay.schema.json`. The index shows
  "N replays expired in the last 30 days" under the feed with "Show expired" for dimmed, details-only rows, and a suite
  whose recordings are gone says when and under which window they were removed instead of "Recordings expired".

- Editor cursor motion styles: `ReplayEdits.cursor.motion` picks one of Cua Cursor Motion's six built-in styles (`signature_arc`,
  the default and previous behavior, `spring_settle`, `magnetic`, `comet_swoop`, `adaptive` or `classic`) for the viewer, editor preview
  and MP4 export. The cursor inspector shows them as a picker whose cards play each style's planned path, with a reworked layout and a
  slider primitive that positions its thumb when it sits beside the track.
- Comparing recordings is a mode of the replay viewer: the "Compare" button in the viewer's top bar adds recordings to
  `/r/<id>?with=<id>,<id>&layout=grid|spotlight&focus=<id>`, and a suite opens compared (Grid, or Spotlight on the run
  its link names). Single, Grid and Spotlight share one clock and the viewer's
  own transport, shortcuts and inspector, scoped to the focused recording; tiles glide between layouts without
  remounting their players. A suite with two or more recordings opens this way with its runs as the recordings, and
  its sidebar moves the focus. The Performance tab compares the recordings' worst paints, tasks and interactions.
  `scripts/demo-comparison-seed.mjs` adds demo suites to compare.



- Poster ThumbHash: once the server renders a replay's poster it keeps the poster's ThumbHash in the summary
  (`ReplaySummary.thumbhash`, base64, ~25 bytes; `meta.json` and `GET /api/replays`). The index paints it under each
  poster while the image loads and crossfades to the real poster, with no layout shift. Replays without one keep the
  plain placeholder. The summary is now documented as `docs/formats/replay-summary.schema.json`.

- Recorder HTTP upload: `createRecorder({ upload: { url, headers?, body?, timeoutMs?, credentials? } })` and `createHttpUpload(options)`
  from `/recorder` post gzip JSON to any endpoint and return `{ replayId, reference, url }`. `IssueUploadError` gains `retryable`
  (network errors, timeouts, 408, 429, 5xx) and `retryAfterMs` (from `Retry-After`).

- Source-provider marks: `SourceProvider.mark` names a built-in monochrome mark (`github`, `gitlab`, `slack`, `linear`,
  `jira`, `notion`, `link`); built-ins carry theirs and a config provider named like a mark gets it. Index rows show the
  mark beside the source label; on phones one icon chip opens a sheet of every source instead of linking out.
- **Custom upload endpoints** ([docs/extension-api.md](docs/extension-api.md#custom-upload-endpoints)), additive in plugin API 1:
  - `api.uploadEndpoint` gains `authenticate` (its own credentials instead of the auth adapter, identity confined to the endpoint),
    `maxBytes` (a number or per-identity function, checked against `Content-Length`, the stream and the gunzipped size),
    `rateLimit` (`{ retryAfter }` answers `429` with `Retry-After`), `normalize` and `receipt`. Paths may have 2 to 8 segments
    and any prefix (`/backoffice/api/customer-recordings`); `requestPolicy` accepts the same paths.
  - `api.normalizeUpload(hook)` normalizes every validated upload; the result is validated again and the privacy pass always
    runs after it.
  - `Identity.capabilities` (`{ routes: [{ method, path }] }`) confines an identity to exact routes, checked once right after
    authentication. `replays:upload` tokens may also post to registered upload endpoints.
  - `/plugin` exports `HttpError` (status, message, optional headers) and `tooManyRequests(seconds, message?)`.
  - `examples/app-key-ingest`: a public app-key ingest (keys with rotation, origins, limits, retention) built only from these hooks.

- `WebAuthAdapter` (`authenticateRequest`, `handleRequest`, `loginUrlFor`): auth adapters over web `Request`/`Response`, accepted
  wherever an `AuthAdapter` is (`api.auth`, `AUTH_PLUGIN`, `createApp({ auth })`, `describeAuthAdapter`); `AnyAuthAdapter` names
  either shape ([docs/extension-api.md](docs/extension-api.md#web-standard-adapters)).
- Plugin Web APIs, additive in plugin API generation 1 ([docs/extension-api.md](docs/extension-api.md#web-apis-routes-and-middleware)):
  - `api.route(...)`: web-standard handlers under `/api/plugins/<plugin>`, with `auth`, `write` and a Standard Schema `body`
  - `api.middleware(...)`: `pre-auth`/`post-auth` interceptors that return a `Response` or nothing
  - `webRequest` next to `request` in upload hooks, context adapters and `identity.resolve`
- `PATCH /api/replays/<id>/meta` renames, retags or sets the purpose of a replay; `DELETE /api/replays/<id>` deletes it softly
  (restorable with `POST /api/replays/<id>/restore` for 7 days, refused with `409` while kept). Bodies are validated against
  shared schemas (`400` with the issues). Uploaded bundles stay immutable: changes live in `<id>/overrides.json` and
  `<id>/trash.json`, and the list, summaries and retention read them.
- `createTestClient(handler)` in `@hazem3500/replays/server/testing`: a fetch-style client over a loopback port, for `createApp()`
  or any `{ fetch }` handler ([docs/extension-api.md](docs/extension-api.md#testing-a-plugin)).
- An HTTP contract suite (`test/contract/`) pins the public API's statuses, headers and bodies as explicit golden responses. Each mount of
  the app (the Node handler today, a web `fetch` handler and a CI-only TanStack Start mount later) has to match it.
- Capture pacing: optional `CaptureArgs.stepPauseMs`, config `capture.stepPauseMs`, and CLI `--step-pause`
  (0–10000ms after non-wait actions; default 0 for compatibility, set 1200 for demonstration captures).
  Built-in drivers type at 80ms/character, selector-derived labels omit typed values, and unlabelled waits
  no longer add rail steps. Full privacy masking remains unchanged.
- Shared playback/export speeds including 0.25× across render start/status/download/cancel and frame math.
  Captions hold through legacy pacing waits and repeated labels while numbering follows the active rail;
  exports redraw on number changes. Skip inactive uses a 4000ms threshold, 800ms lead and 16× speed.

- **First-party plugins** `@hazem3500/replays/plugins/iap` and `@hazem3500/replays/plugins/gcs`
  ([docs/extension-api.md](docs/extension-api.md#first-party-plugins)):
  - `iap({ audience, domains, serviceAccounts, devFallback })`: the `iap` auth adapter verifies `x-goog-iap-jwt-assertion` (ES256,
    Google's JWKS cached for an hour, issuer `https://cloud.google.com/iap`, exact audience, `iat` required, 30 s leeway) and lets in
    the listed email domains and exact service accounts; a non-service-account entry stops the server. Env: `IAP_JWT_AUDIENCE`,
    `IAP_ALLOWED_DOMAINS`, `IAP_SERVICE_ACCOUNTS`.
  - `gcs({ bucket, prefix })`: the `gcs` storage backend over the Cloud Storage JSON API with `fetch`, no SDK: create-only writes with
    `ifGenerationMatch=0`, generations as versions, resumable uploads above 8 MB, `matchGlob` listing, tokens from the metadata server
    or `GOOGLE_OAUTH_ACCESS_TOKEN`, `STORAGE_EMULATOR_HOST` / `GCS_API_ENDPOINT`. Env: `GCS_BUCKET`, `GCS_PREFIX`. It passes the storage
    contract suite against an in-process fake of the API.
- **Adapter kit** for storage and auth adapters written outside this repository:
  - `ObjectStorage.kind` is an open string (the built-ins stay `fs`, `s3`, `memory`), and a backend sets `listCacheMs` to get the store's
    listing cache (S3 sets 5000, as before).
  - `/server` exports `ObjectExistsError`, `PreconditionFailedError`, `NotFoundError`, `assertKey` and `globToRegExp`, and
    `verifyJwt({ token, jwksUrl | jwks, issuer, audience, algorithms, leewaySec, requireIat })`.
  - `@hazem3500/replays/server/testing`: `describeObjectStorage(name, factory, { describe, it })` and `describeAuthAdapter(name,
    contract, { describe, it })`, the contract suites the built-in adapters pass, plus `fakeRequest`. They assert with `node:assert`, so
    any runner works.
  - `requires` on a plugin: a semver range over the package version (`>=0.4 <0.6`, `^0.4.1`); outside it the server refuses the plugin
    at start (`PluginError` `version-range`).
  - `VIEWER_API_VERSION` (`1`, from `/viewer`): `defineViewerPlugin` stamps it, and the viewer refuses an entry of another generation
    with a console error.
- **A base path per host, a static build, and theme-color from the branding.** `hosts: { 'replays.example.com': { basePath: '/' } }`
  in the config serves one process at a different base per request `Host` (other hosts keep `basePath`), with `Vary: Host` on every
  response and `trustForwardedHost` / `TRUST_FORWARDED_HOST` for a gateway that rewrites `Host`; host names are checked at start.
  `replays build-static --out <dir> [--base /] [--config path]` copies the built viewer with base, name, logo, theme tokens, flags and
  plugin entries stamped into `index.html`, the same function the server runs per request (`renderIndexHtml`), for hosting the viewer
  on a CDN in front of the API (docs/operations.md). `<meta name="theme-color">` now follows the theme's `page` token per scheme.
  New in `@hazem3500/replays/server`: `buildStatic`, `renderIndexHtml`, `withBase`, `normalizeHosts`, `resolveSettings`.
- **Redaction rules.** A deployment adds its own rules to the sanitiser: extra `headers` to drop, `queryParams` to redact,
  `jsonKeys` whose values are redacted in console arguments, free-`text` patterns, and `maskSelectors` whose text the recorder masks
  (rrweb `maskTextSelector`). Set them with the config key `redaction` (JSON configs write regexes as `"/.../flags"` strings) or
  `api.redaction(rules)` in plugins; rules add up and can never weaken the defaults. They apply in the capture CLI, which now reads
  the deployment's config (`--config <file>`, `REPLAYS_CONFIG` or `replays.config.*` in the working directory), and again in the
  server's privacy pass on upload. New exports: `assertRedactionRules` and the `RedactionRules` types from `/plugin` and `/capture`;
  optional `redaction` arguments on `sanitizeReplayBundle`, `sanitizeHar`, `sanitizeUrl`, `networkEntries`, `normalizeConsole` and
  `RecorderSession.start`; `AppOptions.redaction`. See [docs/extending.md](docs/extending.md#redaction-rules).
- **`replays migrate`.** Copies a store into another and converts every replay on the way: `--from` / `--to` take `fs:<dir>`,
  `s3:<bucket>[/prefix]` or a storage backend a config plugin registers, `--translate` a module whose default export converts a
  raw `replay.json` (and an optional `translateSuite` for suites). Each bundle is validated with the core validator and gets the
  upload privacy pass; invalid ones are reported and nothing of their prefix is written. Sidecars (comments, edits, keep markers,
  posters, videos), suites and plugin data are copied; writes are create-only, so a second run converts nothing and an
  interrupted one resumes. `--dry-run`, `--report out.json`, and `--compare` for the list-summary diff between two stores. The
  same as `migrateStore()` and `compareStores()` from `@hazem3500/replays/server`, and a translation for the older downstream
  format in `examples/migrate/`. See [docs/operations.md](docs/operations.md#converting-stored-replays).
- **Host policy for user plugins, and the upgrade contract (beta.malleable).** A `malleable` config block lets a deployment narrow
  what sandboxed user plugins may do: `scopes` (where a plugin may be kept), `capabilities` (`allow` / `ask` / `deny` per capability;
  write capabilities can only be `ask` or `deny`, checked at start) and `lockedSurfaces`. `malleable.enabled` is accepted as the same
  switch as `beta.malleable` (both keep working; if both are set they must agree). The server refuses to keep a plugin that declares a
  denied capability or targets a disabled scope, the broker fails denied capabilities with `permission-denied`, and the workshop shows
  the policy. New `distribution: { name, version }` config key. `GET /api/config` now includes `core`, `distribution` and (with the
  feature on) `malleable`. Kept plugin versions record `manifest.targets: { core, distribution }` (additive to
  `plugin-manifest.schema.json`); the viewer records load health per (core, distribution) in localStorage and shows a quiet "Review
  plugins" notice for a plugin that fails after the versions changed, without disabling or changing anything. `get_plugin_api` now
  returns the theme tokens, the policy, the versions and the surfaces in the viewer.

- **Render pipeline hooks** ([docs/extension-api.md](docs/extension-api.md#render-pipeline-hooks)). `api.render({ posterAt?, beforeRender?,
  afterRender? })`: `posterAt(bundle, { purpose })` picks the poster's moment (the first hook in plugin order that returns a time wins,
  then the purpose's `poster` setting, which is now the built-in last step of the same chain, then the default); `beforeRender(job)`
  refuses a render (`false`; a refused export answers `{ status: 'refused', error }`) or changes a video export's `speed`, `captions` or
  `skipInactive`; `afterRender(job, { file, key, contentType, bytes })` runs after each stored video, poster, opening still and preview,
  and its errors never fail the render. Hooks see a small job object (`id`, `replayId`, `kind`, `options`, `identity?`). A poster
  taken at a non-default moment is stored as `poster.v2-<moment>.jpg`, so a changed choice is remade instead of served stale.
- **Purposes and retention rules** ([docs/extension-api.md](docs/extension-api.md#purposes-and-retention)). A deployment can say why
  replays are recorded: `purposes: [{ id, label, order?, retentionDays?, viewer?, poster? }]` in the config file, or
  `api.purpose({ …, infer? })` from a plugin (the core defines none). Uploads may carry `meta.purpose` (checked against the
  registered ids; refused when none are registered), `--purpose <id>` on `capture`, `upload` and `import`, and a picker in the
  upload dialog. Summaries gain `purpose` and `purposeInferred` (`SUMMARY_VERSION` 7, plus `suiteRun`); `GET /api/replays?purpose=`,
  `purposes` in `/api/config`, and "All · <purpose>" tabs with counts on the index. Per purpose: a retention window
  (`RETENTION_PURPOSE_<ID>_DAYS` overrides; an inferred purpose never makes a replay permanent), viewer defaults (open at the start
  or just before the first error, the panel open or folded, captions) and the poster moment (`middle-step`, `first-error`,
  `last-step`). `api.retention({ days(summary) })` adds rules that are not about purpose: the shortest window wins, `0` means no
  limit, Keep still overrides. `/server` exports `createPurposeCatalog` and `PurposeCatalog`.
- **Index slots for plugins** ([docs/extension-api.md](docs/extension-api.md#the-index-summary-fields-columns-filters-sections)):
  `api.summaryFields({ name, version?, fields(bundle) })` derives small values into `summary.ext[<plugin>]` at upload and whenever a
  summary is rebuilt (capped: 20 keys, strings cut to 200 characters, 2 KB per plugin, `SUMMARY_FIELD_LIMITS`; a failing set is logged
  and left out; stored summaries built by other sets are rebuilt). `api.indexFilter({ id, param, match })` filters `GET /api/replays`
  on the server by an `x-*` query parameter, listed in `GET /api/config` as `indexFilters`. In the browser,
  `registerIndexColumn`, `registerIndexFilter` (`switch`, `choice` or `text` in the filter menu and the phone sheet) and
  `registerIndexSection` (a block above the list, re-drawn or `update`d when the list changes, with `summaries` and `me`).
  The custom-distro example uses all five.
- **People and identity resolvers** ([docs/extension-api.md](docs/extension-api.md#people-and-identity)). `meta.people` and suite
  `people` (at most 10 `{ role, email?, name?, handles? }`, size-capped, documented in `docs/formats/replay.schema.json`), repeatable
  `--person role:email[:handle=value]` on `replays capture` and `replays import`, `?person=` on `POST /api/replays/import`, and a
  people-only suite re-registration that replaces them. `api.people({ roles, validate, handles, avatarUrl, profileUrl })` (one per
  deployment) sets role priority, refuses people with a `400` naming them, and resolves https avatar and profile links in summaries.
  `?for=me` on `GET /api/replays` and `GET /api/suites` matches the signed-in email and linked `handle.<id>=` values and returns the
  best role as `reason`; `GET /api/me` adds the people config. `api.identity({ resolve })` enriches the signed-in identity after auth
  (it cannot change `id`). The index shows an avatar stack with a person card on rows that have people, and a For me switch with
  fields for the linkable handles (kept in localStorage). `assertReplayPeople`, `parsePeopleFlags` and `personMatch` are exported from
  `/capture`.
- **Viewer slots for client plugins.** `registerViewerAction` takes `placement: 'bar'` (an icon button in the viewer header) and an
  `icon`; `registerTimelineTrack({ id, label, markers(ctx) })` draws marks or ranges under the seek bar (hover shows the label, a click
  seeks; at most `MAX_TRACK_MARKERS`, 500, per track); `registerContextSection` draws a block inside the Context tab; `registerSetting`
  adds a boolean or choice setting to the More menu, stored per person in the browser and read with the new `ctx.settings`. Context
  schemas can use `x-replays-widget: "signals"` (tri-state flags, with unknown distinct from disabled), `x-replays-group` and
  `x-replays-order`. See [docs/extension-api.md](docs/extension-api.md).
- **Source provider looks and attributes.** A source provider may declare an `icon` (a `data:image/svg+xml` or https URL, always drawn
  as an image) and a `noun`, shown on the topbar chip, in the Context tab and on index rows; `resolve` may return `attrs`, kept on the
  stored source and, capped, in the index summary (`SUMMARY_VERSION` 7: older sidecars are rebuilt). See
  [docs/extending.md](docs/extending.md#source-link-providers).
- **Host editing write policy.** `editing.enabled` / `EDITING_ENABLED` can disable new edits while preserving saved-edit
  reads, playback and video exports. Edit links and routes follow the policy; saves return `403` before precondition or body
  parsing, and `/api/config` advertises the effective capability. The beta editor flag remains the outer feature gate.

- Trusted host plugins can register exact route/method/origin request policies with credentialed CORS and validated
  preflight handling before authentication. Actual requests retain auth and get only a matching CSRF exception.
- Host-defined POST upload endpoint aliases with optional raw-body preparation reuse validation, privacy checks,
  immutable storage and all normal upload hooks. No extra endpoint or browser origin is enabled by default.
- **Malleable viewer (beta, off by default).** An in-app plugin workshop: write a tab, side panel or More-menu action in an
  editable source view and it hot-loads into the running viewer. Plugins run in a sandboxed frame (opaque origin, CSP forbidding
  every outgoing request, a capability broker; `comments:write` and `export:download` ask the person each time), are stored per user
  or workspace as a full version history (diff, revert, export/import as `*.replays-plugin.json`), and nothing is stored without an
  approval token bound to the exact content the person approved. An agent bridge exposes live state and the plugin API as WebMCP tools
  in the page (`document.modelContext`, with a stand-in where the browser has none) and through `replays mcp`, an MCP server over
  stdio; an agent can install a draft and ask the person to keep it, but cannot save. Enable with `REPLAYS_BETA_MALLEABLE=true` or
  `beta.malleable`; off means no UI, `404`s and no bridge. Also: JSON Schemas for replays, comments, edits and plugins in
  `docs/formats/`, example plugins in `examples/malleable/`, and `ViewerRegistry.replacePlugin`. See
  [docs/malleability.md](docs/malleability.md).
- **Comments.** Comment on a whole replay or pin a comment to a moment: markers on the seek bar with a hover card, a
  Comments tab that follows the playhead, threads, resolve, author-only edit and delete, emoji reactions, comment
  permalinks (`#comment-<id>` with `?t=`) and the `M` shortcut. Times are stored on the source timeline and mapped
  through saved edits when the beta editor is on; comments in trimmed or cut stretches are listed as "In removed
  section". Authors come from the auth adapter (new optional `Identity.avatarUrl`; OIDC `picture`), anonymous with
  `AUTH_MODE=none`. Stored as `<id>/comments.json` on the filesystem or S3 driver (deleted with the replay), rate
  limited and length limited. On by default; `REPLAYS_COMMENTS=false` removes the UI and the API answers 404.
- **Replay editor (beta, off by default).** Non-destructive edit mode: trim, cuts, "Remove waits", speed-ups, zoom
  regions, blur boxes and captions, stored as an edit list next to the replay and honoured by playback and video exports.
  Enable with `REPLAYS_BETA_EDITOR=true` or `beta.editor` in the config file; with the flag off there is no editor UI,
  the edits API answers 404 and the editor code is not loaded.

- **Extension surface for custom distributions** ([docs/extension-api.md](docs/extension-api.md)):
  - `replays.config.ts|mjs|js|json` with a typed `defineConfig()`; `auth`, `storage` and `plugins` keys next to the existing ones.
  - `definePlugin()` and a plugin API with registration for auth adapters, test-context adapters (merged into the context
    schema), source-link providers, storage backends, branding, base path, request / response / upload-lifecycle hooks
    (`prepareUpload`, `beforeUpload`, `afterUpload`) and browser entries; ordering (`dependsOn`, `order`), validation and
    conflict errors (`PluginError` with stable codes).
  - Browser plugin API (`defineViewerPlugin`): inspector tabs, viewer actions and a side panel drawer, loaded from the server's
    plugin entries; failures are isolated.
  - `startServer()` (the server as a function; `replays serve` uses it), `SAMPLE_DIR`.
  - Subpath exports `@hazem3500/replays/{capture,server,viewer,plugin,config}` next to the root entry; the package now ships the
    built viewer, the samples and the extension docs. Policy in [docs/api-stability.md](docs/api-stability.md), decision in
    [docs/packaging.md](docs/packaging.md).
  - Comments are now a built-in plugin (`comments`, loaded first when enabled) instead of being wired into the server and the
    viewer: the API is a request hook, the tab, seek-bar markers and `M` key a built-in viewer feature. Behaviour is
    unchanged; plugin auth adapters' identities (with `avatarUrl`) become comment authors.
  - `examples/custom-distro` (workspace package) with an end-to-end smoke in CI, and `pnpm test:pack`.
  - [docs/downstream-migration.md](docs/downstream-migration.md).

### Fixed

- Comparing recordings: every tile on the stage now plays and follows a scrub on the shared clock. Spotlight's strip and
  a phone's off-screen tiles used to update about once a second while playing and stayed frozen until a drag ended.
  During a drag each tile gets one seek per frame to the latest position (a tile that can't keep up shows its last
  frame and catches up); a tile that has ended holds its last frame.

### Removed

- The separate `/compare?before=&after=` page and its workspace, evidence panels and route.

### Changed

- The Console tab reads whole messages. Rows show two lines of the message, monospace with newlines kept, and say how
  many lines more, when a stack came with it, and how many times an identical message repeated (folded as ×N).
  Tapping, clicking or pressing Enter on a row opens it beside the list (in its place on a phone): the full text with
  logged JSON indented, the stack as frames with the throwing frame's file:line, the page, every time a folded message
  was logged, Watch from, Copy message and Copy with stack. Level chips filter and summarise like Network's, search
  opens in place, and phones get a 48 px target per row with the page under the message instead of hidden.

- Pages are served through a TanStack Start build embedded in the server
  ([docs/operations.md](docs/operations.md#server-rendered-pages-tanstack-start)): the index arrives rendered, with its
  lists in the page, so a phone shows replays without waiting for the app's JavaScript (phone index LCP 3.9 s → 1.1 s on
  the perf harness). The API, plugins and auth are unchanged; the viewer, editor, suite and plugin pages still render
  in the browser. `REPLAYS_SSR=0` serves the single-page app as before. The DOM a page starts with now comes from the
  server: browser plugin entries still load after hydration and draw only into their own mounts.

- Recorder: `RecorderMessages` keys are all required and data-bearing keys are typed as functions, so code that builds a
  full `RecorderMessages` object or reads `DEFAULT_MESSAGES.consentBody` as a string needs updating; `messages` overrides
  are unaffected. The review dialog writes the duration in words (`Duration: 1 minute 13 seconds.`), and the consent
  limit says `Up to 1 minute` rather than `Up to 1 minutes`. A start failure in `selectError` uses the new `startFailed`.
- "Keep suite and its runs" moved from the suite sidebar's pin button into the viewer's More menu at every width; the
  sidebar shows "Kept by …" while a suite is kept.

- Network's timing needs no mode: the ribbon on the seek bar's axis is always there, with one tick per request when a
  recording is sparse and request density when it is busy. The row under the pointer, or the selected one, lights its
  mark. The ribbon's playhead and the veil over what hasn't happened yet move by transform and glide when you seek,
  rows fade between upcoming and reached instead of snapping, and the list follows the playhead with a smooth scroll
  (instant for far jumps and under reduced motion). Performance's ribbon works the same way.
- The request detail shows captured network bodies (#129): JSON indented, form fields decoded, folded past 14 lines,
  with copy, a "Truncated at" note and redaction markers drawn as such. Copy as cURL sends a body that was kept whole.
  Recordings without bodies say "Not captured".
- Performance says "Performance wasn’t recorded" with the `replays capture --profile performance` command when no
  timing was observed, instead of five "Not captured" cells over "Nothing was slow".

- Dialogs share one geometry from `--dialog-*` tokens: 20 px padding (16 px on phones), the title and close button on one
  line, 13 px body copy, and actions in a right-aligned row on desktop or stacked 44 px full-width buttons on phones and
  touch. Modals keep a plain fade under reduced motion. The destructive button is a solid fill whose label clears 4.5:1.
- Player captions swap the whole line (the new text fades and rises 2 px over 160 ms) instead of morphing per
  character, and a hiding caption keeps its text and number while it fades and drops, so the box never collapses
  first. This removes the `calligraph` and `motion` dependencies.
- The replay list on phones (640 px and narrower): thumb-sized rows with a two-line title and one quiet meta line,
  Filters as quiet text with its count inside, sort as quiet text opening a bottom sheet of 48 px radio rows, and one
  header menu sheet (Upload, Settings, and a theme row) beside search instead of four icons.

- Comments tab, redesigned as a review feed: threads own the panel and the composer is docked below them as one line
  that grows while it has focus or text. Its time chip follows the playhead until you type (or press `M`), switches
  to the whole replay, and offers to move to the playhead once it has drifted. Reactions sit behind one button and
  show in the list as quiet chips their author can remove. An All / Open / Resolved filter appears once a thread is
  resolved. Anonymous mode is a short note under the composer while you write, not a banner. Seek-bar comment markers
  keep a 24 px target and merge when closer than that. `scripts/demo-comments.mjs` seeds demo comments.

- Network and Performance are rethought around "what went wrong or slow, and when". Network has one toolbar row,
  where the status chips (All, Failed, Slow, No response) are both filters and summary. A ribbon on the seek bar's
  axis shows when requests happened (drag to filter a stretch), duration bars use a log scale so 6 ms and 2.4 s both
  read, and the request detail sits beside the list with the request's step, its neighbours on its own scale and its
  headers. Performance leads with a vitals bar, then slow moments worst first, each explained by what it waited on.
  In compare mode both panels show deltas against the other recordings (`compare.peers`). The standalone Waterfall
  and its toggle are gone.
- The viewer's client router is TanStack Router: file routes in `src/client/routes/`, a router context of
  `{ queryClient, deployment }`, the base path as a runtime rewrite and plain-text search params. Plugin pages
  (`api.registerPluginPage`) are routed at `/p/<plugin>/<path>`. Older addresses are not kept: `/r/<id>?suite=<suite>`
  no longer redirects (use `/s/<suite>/r/<id>`), `/r/<id>/edit` without edit capability and any other unknown address
  show a not-found page, and `/r/` no longer opens the index.

- The replay list's empty and error states name what happened and the way back: an unreachable server retries on a
  backoff (2 s, 5 s, 10 s, then every 30 s, at once when the browser comes back online) with a countdown; a failed
  refresh keeps the list on screen under an Offline banner; an empty purpose tab offers upload; a search or filters
  that leave nothing list the active filters with Clear search, Search all replays or Clear filters.

- Settings is a fixed-size dialog with a section sidebar (a full-screen section list with Back on phones): CLI & agents,
  Keyboard, Labs, Plugins (when a plugin registers a setting) and About. The colour theme lives only in the top bar.
- Beta flags have one model shared by the server and the page (`src/shared/beta-flags.ts`): the server allows a flag
  (`REPLAYS_BETA_*` or `beta.*`, parsed as before) and each person can opt out under Settings › Labs, saved in the browser.
- The built-in mark (timeline segments and a playhead) is the favicon too, with a home-screen icon and web manifest in
  `public/assets/brand` (`scripts/build-icons.mjs`). A deployment `logoUrl` replaces the tab icon and drops the built-in
  home-screen icon and manifest. Under reduced motion the header mark still fills on click, without movement.
- User plugins register in the viewer registry as `user:<id>` (keys `plugin:user:<id>:<contribution>`) instead of `user-<id>`, so a
  user plugin can no longer collide with, replace or remove the registrations of a host plugin named `user-<something>`.
- `GET /api/config` also lists the loaded `plugins`. `src/server/main.ts` is now a thin wrapper around `startServer()`.
- The library is built with shared chunks (`dist/lib/*.mjs`); the recorder script is shipped next to it.
- The repository is a pnpm workspace (`pnpm-workspace.yaml`); the Dockerfile installs only the main package.

### Security

- Relative `srcset` / `imagesrcset` candidates and CSS `url()` values (relative ones too) are redacted like other
  URLs, and suite and run registrations go through the same privacy pass as replay uploads.

- The suite index is built from the replay list instead of three lookups per run.

### Deprecated

- Recorder `DEFAULT_MESSAGES` is an alias of `defaultRecorderMessages`, and the never-rendered `openReplay` message is
  accepted and ignored, for at least two minor releases and 90 days.
- **Purposes are now profiles.** Everything that said purpose says profile: the config key `profiles`, `api.profile`,
  `meta.profile`, `summary.profile`/`profileInferred`, `ProfileConfig`/`ProfileInfo`/`ProfileDefinition`/`ProfileInferInput`,
  `ProfileCatalog`/`createProfileCatalog`, `--profile`, `?profile=`, `RETENTION_PROFILE_<ID>_DAYS`, `x-replay-profile`,
  `profiles` in `GET /api/config`, and the index and upload copy. The old names keep working as deprecated aliases for at
  least two minor releases and 90 days and warn once at start where they are used at run time; uploads with `meta.purpose`
  are stored as `meta.profile`, and stored bundles and overrides are read as they are. `SUMMARY_VERSION` is 9, so sidecars are
  rebuilt lazily. See [API stability](docs/api-stability.md#deprecated-purpose-names) and
  [the migration steps](docs/downstream-migration.md#renaming-purposes-to-profiles).

## [0.1.0] - Unreleased

First public-shaped version, extracted and generalised from an internal debugging tool.

### Added

- Capture CLI (`replays capture`): records a page with scripted steps into one `replay.json` (rrweb events,
  agent steps, console, sanitized HAR network track, performance) with an optional MP4; Playwright driver by default,
  `agent-browser` driver optional.
- Recorder as a library (`RecorderSession`) usable from any CDP connection, including a Playwright test.
- Self-hostable server: upload API, retention, "keep" pins, suites of runs, optional server-side video export and
  list posters, optional OpenTelemetry (OTLP) tracing.
- Viewer: one transport, error markers, synced Console / Network / Performance / Context tabs, permalinks,
  keyboard shortcuts, human rrweb import, review suites.
- Extension points: auth adapters (`none`, `header`, `oidc`, plugins), a user-supplied JSON Schema for context
  fields, source-link providers (GitHub, GitLab, URL, templates), storage drivers (filesystem, S3-compatible),
  runtime theming and branding, configurable base path and retention.
- Privacy defaults on: `maskAllInputs`, header / cookie / URL-credential / query redaction, no request or
  response bodies.
- Dockerfile and `docker-compose.yml` (built locally, nothing published), GitHub Actions CI, manual release and
  Pages workflows, static landing page in `site/`.
