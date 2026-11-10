# In-page recorder

The host app owns prompts such as “Record the problem?”. `@hazem3500/replays/recorder` supplies capture and state without mounting UI. Nothing is loaded or recorded until consent and `start()`. The default UI is optional.

| Entry | API |
| --- | --- |
| `/recorder` | `createRecorder`, `createDeferredUi`, `createRecorderStore`, selectors, timer/format helpers, `defaultRecorderMessages`, `resolveRecorderMessages`, `createRecorderFormat`, privacy props and selector builder, upload utilities |
| `/recorder/kit` | `createAnnouncer`, `focusReturn`, `trapFocus`, `markRecorderUi`, `mountRecorderRoot`, privacy helpers and chat-widget presets |
| `/recorder/ui` | `createGuidedRecorder`, `createDefaultUi`, step kit, `composeUi`, messages, formatting, themes and completion options |
| `/recorder/react` | Optional React 18+ provider and hooks; core never imports React |
| `/recorder/testing` | DOM contract suite, fake rrweb/transport, shadow-DOM query helper; Node test runner only |

## Host context and confirmed actions

`RecorderOptions.context` accepts `RecorderHostContext` or a synchronous getter returning it. It is copied once at recording start, not at stop or upload. It permits `app` facts compatible with `ReplayContext.app` and up to 40 allowlisted scalar `fields`, with a 16 KiB total limit. Strings are bounded and redacted. Invalid context or a throwing getter omits context with a generic warning and keeps the recording. Masked recordings omit host context without calling the getter. The bundle carries `context`, so transports that send only the bundle retain it; ingest still decides what is allowed.

`recorder.annotateStep({ label: 'Created task' })` returns whether a confirmed host action was added. It does not load or start recording, refuses inactive or masked capture, redacts and caps the label, and shares the 500-step cap. Call only after the application confirms success. Automatic form submission labels describe a request, not a successful mutation.

## Diagnostic capture

`capture.performance` and `capture.debugging` are independent opt-in booleans. `choices.diagnostics: true` offers combinable Performance and Debugging toggles capped by those capture options. Performance retains supported observer timings, bounded foreground frame-pacing estimates, Long Animation Frames (Chromium) with their heaviest scripts, and interactions with an input delay, processing and presentation breakdown; these are not CPU profiles. Script sources are origin and path only, and an interaction's target keeps its name only where the privacy mode shows text (see [replay format](formats/README.md)). Debugging permits bounded redacted Error stacks only in visible recordings. Privacy settings remain authoritative.

## Built-in flow

```ts
import { createGuidedRecorder } from '@hazem3500/replays/recorder/ui';
const recorder = createGuidedRecorder({
  upload: async (report, { signal, onProgress }) => {
    const response = await fetch('/api/recordings', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!response.ok) throw new Error('Upload failed');
    const { id, reference } = await response.json();
    return { replayId: id, reference };
  },
  ui: { messages: { consentTitle: 'Record the problem?' } },
});
// From a user click. Consent and review are enabled by default.
await recorder.request();
// On host unmount:
recorder.destroy();
```

`createRecorder({ upload, ui: createDefaultUi(...) })` remains supported. Import the synchronous UI factory from `/recorder/ui`. The deprecated `/recorder` factory is a lazy facade for a two-minor, at-least-90-day window beginning with this release; it mounts on the next microtask/module load, so direct DOM queries should await the UI render. It keeps default UI out of the core's static imports. The former implicit default (`createRecorder({upload}).request()`) requires migration to `createGuidedRecorder`: without a UI, `request()` throws a clear error, and `start()` is headless.

## Own the UI

```ts
import { createRecorder, createDeferredUi, createRecorderStore } from '@hazem3500/replays/recorder';
const deferred = createDeferredUi();
const recorder = createRecorder({ upload, ui: deferred.ui });
const store = createRecorderStore(recorder);
const off = deferred.pending.subscribe(() => {
  const prompt = deferred.pending.get();
  // Render your consent/review/indicator surface from prompt.kind.
  // Consent copy must reflect prompt.privacy, including reviewRequired.
});
// UI buttons call store.actions.accept(), decline(), stop(), send(note), discard().
// Or recorder.respond({consent:true}) / recorder.respond({upload:true,note}).
```

The imperative `RecorderUi` contract also works in any framework: consent returns a boolean, indicator returns cleanup, review returns `{confirmed,note?}`. Honor each prompt's `AbortSignal`. Render the chrome inside `[data-recorder-ui]` / `recorderUiProps`; it must never appear in the captured page. Register the visible Stop element using `ctx.attestStop(element)` or `recorder.attestStop(element)`, and dispose the returned registration on unmount. The core attaches its own Stop click listener. Hidden, disconnected, inert or transparent controls do not provide evidence of a usable Stop action.

`createRecorderStore` exposes stable actions and selector subscriptions with an optional equality function. Selectors: `selectView`, `selectCanRequest`, `selectSummary`, `selectReceipt`, `selectError`, `selectUploadProgress`. `createRecordingTimer` ticks on elapsed whole seconds while recording, exposes elapsed/remaining milliseconds and labels, fraction, warnings at 30 seconds (`soon`) and 10 seconds (`final`), plus a size warning at 80%. Dispose timer stores you create. `recordingTimer` is the pure equivalent; both take `format: { elapsed }` for their labels. `formatDuration` and localized `formatDurationLong` are independent helpers. `selectError(state, messages)` words failures with the `failed` and `startFailed` messages: `store.select((state) => selectError(state, messages))`.

`upload` is a transport function or plain HTTP options. `upload: { url, headers?, body?, timeoutMs?, credentials? }` (or `createHttpUpload(options)`) posts the report to any endpoint:

- `headers` is an object, or a function called once per upload (for short-lived credentials such as an upload token or app key).
- `body(report)` builds a custom body. The default is the report as JSON, gzipped with `Content-Encoding: gzip` when the browser has `CompressionStream`.
- `credentials` defaults to `'omit'`, so no cookies are sent.

The response `{ id, reference?, replayUrl? }` (or the core `{ id, url }`) becomes `{ replayId, reference, url }`. Failures are `IssueUploadError`s with the HTTP `status` (`0` without a response). `retryable` is true for network errors, timeouts, 408, 429 and 5xx, and `retryAfterMs` is set from `Retry-After`. An abort by the caller rejects with the abort itself.

Uploads receive `{signal,onProgress}`. Report `{loaded,total?}` when your transport can measure bytes; the core publishes progress at most four times per second. `createTokenUpload` uses XHR progress in browsers and fetch otherwise (or when a custom fetch is supplied). Missing progress means indeterminate, never a fabricated percentage. `retryUpload()` / `store.actions.retry()` sends the identical reviewed report and note. Discard/destroy abort uploads and prompts and erase the retained recording.

For React:

```tsx
import { RecorderProvider, RecorderRegion, useRecorderPrompt, useRecorderActions,
  useRecorderState, useRecordingTimer, useStopAttestation } from '@hazem3500/replays/recorder/react';
// <RecorderProvider options={{upload}}><YourApp /></RecorderProvider>
// useRecorderPrompt() gives the deferred consent/review context.
// <button ref={useStopAttestation()} onClick={actions.stop}>Stop</button>
```

The provider owns and destroys instances created from `options`, tolerates StrictMode replay, and leaves a supplied `recorder` alive. If the supplied recorder uses `createDeferredUi`, also pass `deferred={deferred}` so prompt hooks can observe it. `useRecorderState(selector,isEqual)` uses `useSyncExternalStore`; `useRecorderActions`, `useRecorder`, `useAnnouncer`, and `RecorderRegion` complete the adapter. No DOM is accessed during server rendering. See `examples/recorder-shadcn` and the interactive `RecorderCustom` stories for a copy-owned reference UI.

## Guarantees and migration

The core checks user activation at start/upload, passes capture facts to every consent renderer, and checks for a registered visible Stop after a one-second grace period and every two seconds afterward. The facts describe text, ordinary inputs, media, console, network, the duration cap and whether review is required. Passwords, hidden inputs, credential URLs and auth headers stay protected. Request and response bodies are read only with `capture.network: 'bodies'` ([Capture and network bodies](#capture-and-network-bodies)); the facts then carry `captures.networkBodies: true` and the default consent copy says so.

During the two-minor / 90-day migration window, activation and Stop checks warn once per condition. Set `strictInvariants:true` now to enforce them. With strict enforcement, a missing Stop ends capture with `no-indicator` and discards it; it can never upload. `page-hidden` always discards. No capture occurs without explicit `consent:true`, no upload without `confirmed:true` and a retained reviewed recording. Those flags remain for compatibility: the evidence checks supplement them, and cannot establish the semantic truth of consent copy. Browsers lacking the activation API log once and skip that check.

Both prompts are enabled by default. `prompts.consent:false` makes the host's Record click the decision point; `prompts.review:false` sends when the user clicks Stop. Capture caps remain enforced. `privacy.sanitize:false` is a host policy decision that permits visible page text and ordinary inputs; render the supplied facts accurately. `blockSelector({presets:['crisp','intercom','zendesk'], selectors:['[data-private]']})` validates selectors; invalid or empty selectors throw. Without a DOM, identifier/preset-only construction works and raw selector validation fails clearly.

Use generic `{source:'host',reason:'crisp'}` triggers and `setReportContext({metadata:{...}})` for integrations. `source:'crisp'` and the `crisp` report field are deprecated compatibility aliases for the same two-minor / 90-day window. Product adapters own support copy, endpoints and external IDs.

## Capture and network bodies

`capture` says what a recording keeps beyond the page. It has the shape of a profile's `capture` block, so a host can pass `profile.capture` from `GET /api/config` as is; it sits beside `messages` (copy) and `privacy` (masking) and, like a profile, only tightens privacy.

```ts
const recorder = createGuidedRecorder({
  upload,
  capture: { network: 'bodies', bodies: { maxBytes: 16_384 } },
  ui: { messages: { consentTitle: 'Record the problem?' } },
});
```

| Key | Default | Effect |
| --- | --- | --- |
| `network` | `'headers'` | `'off'`, `'headers'` (method, URL, status, timing, allow-listed headers) or `'bodies'` (also request and response bodies). `privacy.captureNetwork: false` wins |
| `bodies` | 64 KiB of JSON, `*+json`, `text/*` and form data | `{ maxBytes?, contentTypes? }`, only with `network: 'bodies'`; each can only narrow the defaults |
| `console` | `['warn', 'error']` | Console levels when `privacy.consoleLevels` is not set |
| `privacy` | none | `{ maskAllText: true, blockMedia: true }` masks more than `privacy` does; `true` is the only accepted value |

`performance`, `sampling`, `video`, `stepPauseMs`, `viewport` and `runs` belong to the capture CLI and are ignored. An invalid block, or one that widens a default, throws from `createRecorder`.

With `network: 'bodies'` the recorder loads a separate chunk at `start()` and wraps fetch and XHR under the same rules as `replays capture --network bodies` (see [network bodies](extension-api.md#network-bodies)):

- Only JSON, `*+json`, `text/*` and form bodies are read. Server-sent events, `ReadableStream` request bodies, `FormData`, `Blob`, `ArrayBuffer` and other binary bodies are recorded as `{ omitted: 'content-type' }` or `{ omitted: 'unavailable' }`, never read.
- A fetch response is cloned and read in the background, so the page gets its response at once and unread. Reading stops after `maxBytes`, and every read still open (a long poll, a slow stream) is cancelled when recording stops. XHR text is taken from memory, never measured past the cap.
- Each body is cut on a character boundary with `truncated: true`, then redacted before it leaves the page: secret fields at any depth, secret form fields, `Bearer`/`Basic` credentials, JWTs, Luhn-valid card numbers and, while page text is masked, e-mail addresses. The ingest endpoint redacts it again with the deployment's `redaction` rules.
- Kept text counts toward `maxBytes`, so a recording with large bodies stops with `max-size` like one with many events. A failed read leaves `{ omitted: 'unavailable' }`; it never reaches the page.

Every bundle carries `meta.captured` (`{ console, network, performance: false, video: false }`), so the viewer says "Not captured" instead of showing an empty body. A recording made with `privacy.sanitize: false` adds `inputs: 'visible'`. That is only a claim: the server masks every input again unless the host sets `privacy.keepVisibleInputs` and a signed-in staff session uploads it to `POST /api/replays` ([visible inputs for staff recordings](extending.md#visible-inputs-for-staff-recordings)); passwords and hidden inputs stay masked either way. A customer recording made through the [customer options step](#options-step-for-customers) adds `choice: { by: 'customer', mode, inputs, text, bodies }`: the picked mode and what it captured. If the body chunk cannot load, recording continues with headers only and `meta.captured.network` says `'headers'`.

## Options step for internal hosts

An internal host (staff on staging, a design review) can let people choose how much a recording shows and why it was made, right before each recording. It is off unless the host passes `choices`. A customer-facing host can offer the same step with `choices.by: 'customer'` ([options step for customers](#options-step-for-customers)).

```ts
const recorder = createGuidedRecorder({
  upload,
  // The most any recording may show. Every mode is capped by this.
  privacy: { sanitize: false, blockMedia: false },
  choices: {
    privacy: ['visible', 'inputs-masked', 'interface-visible', 'masked'],
    profiles: ['triage', { id: 'design-review', label: 'Design review' }, 'walkthrough'],
    defaults: { privacy: 'inputs-masked', profile: 'triage' },
  },
});
await recorder.request(); // From the host's Record click.
```

`request()` then shows the pill where the recording pill sits, before the consent dialog (or instead of it with `prompts.consent: false`). It has the recording pill's controls and nothing else: **Record**, a quiet options button and close. The options and close icons are the viewer's own animated icons (the sliders' knobs slide, the cross turns once) and stay still under reduced motion. The options button's tooltip names the current choice ("Fully masked · Triage"), and a small dot marks a choice that differs from `defaults`. It opens one small menu above the pill (a full-width sheet on phones) that scrolls when long:

- **Profile**: the profiles the host passes, each with its optional description as a quiet line under it.
- **Privacy**: Visible, Inputs hidden, Your data hidden and Fully masked, least to most strict (plus Text masked when `choices.privacy` still lists `text-masked`), each with one quiet line from what that mode actually records once the host's cap applies ("Records text and inputs", "Records page text, hides what you type", "Hides text and inputs", "Shows only the app's menus and labels", "Hides everything"). Only modes the host allows are listed, those in `choices.privacy` that its `privacy` cap permits; the rest are not shown at all, not disabled. With only one mode left there is nothing to pick, so the Privacy group is dropped.
- **Network**: with `choices.networkBodies: true`, one checkbox, "Include network request and response content", off until picked. It is shown only when the host's `capture.network` is `'bodies'`; on, the recording keeps bodies under the usual limits and redaction, off, it keeps headers only.

Each line is tied to its item with `aria-describedby`. Check marks show the current choices. It is a menu button with radio items: arrow keys, Home and End move across the groups and skip disabled options, Enter, Space or a click chooses and closes, Escape and Tab close it, and a press outside closes it. Escape with the menu closed, or close, records nothing. The consent prompt describes the chosen mode.

Profiles belong to the deployment (the config's `profiles`, or plugins), and the ingest endpoint refuses an id it does not define. `GET /api/config` lists them as `profiles: [{ id, label, ... }]`, which `choices.profiles` takes as is; add a `description` where a one-line hint helps:

```ts
const { profiles } = await (await fetch(`${replaysOrigin}/api/config`, { credentials: 'include' })).json();
const hints: Record<string, string> = { triage: 'A bug to reproduce and fix', support: 'A customer issue for the support team' };
const recorder = createGuidedRecorder({
  upload,
  privacy: { sanitize: false, blockMedia: false },
  choices: {
    privacy: ['visible', 'inputs-masked', 'interface-visible', 'masked'],
    profiles: profiles.map(({ id, label }) => ({ id, label, description: hints[id] })),
  },
});
```

| Mode | Page text | Typed values | Media | Core settings before the cap |
| --- | --- | --- | --- | --- |
| `visible` | Recorded | Recorded, passwords and hidden inputs masked | Recorded | `sanitize: false`, `maskAllText: false`, `blockMedia: false` |
| `inputs-masked` (Inputs hidden) | Recorded | Masked | Recorded | `sanitize: true`, `maskAllText: false`, `blockMedia: false` |
| `text-masked` (older; still accepted) | Masked | Masked | Recorded | `sanitize: true`, `maskAllText: true`, `blockMedia: false` |
| `interface-visible` (Your data hidden) | Masked, except [public product text](#public-product-text) | Masked | Blocked | `sanitize: true`, `maskAllText: true`, `blockMedia: true`, `unmaskTextSelector: '[data-replay-public]'` |
| `masked` (Fully masked) | Masked, public text too | Masked | Blocked | `sanitize: true`, `maskAllText: true`, `blockMedia: true` |

`replays capture --privacy <mode>` applies the same five modes to a scripted or manual capture, with no host cap: the mode is exactly what the table says, and a profile that masks all text refuses a mode that shows text. `visible` declares `meta.captured.inputs: 'visible'`, with no `choice`, so a server keeps the typed values only under its `keepVisibleInputs` rule.

The core enforces the cap, not the UI:

- Each setting is the stricter of the mode and the host's own `privacy` (and `capture.privacy`). A mode never shows more than the host allows; modes the cap makes identical are offered once, under the stricter name. With `privacy: { sanitize: false }` (media blocked), `visible` records text and typed values but no media, `inputs-masked` records text but no media, and `text-masked` becomes `masked`. Inputs hidden needs the host to allow page text (`maskAllText: false`, or `sanitize: false`); with the default privacy it becomes `masked`. A stored or passed `text-masked` choice stays valid when the host lists it and is otherwise reduced to the strictest offered mode, never to a looser one.
- A staff host whose `privacy` hides text, inputs and media and whose `capture` reads no body (the defaults) never shows the step unless it lists `interface-visible`, and any choice it receives changes nothing.
- Passwords, hidden inputs, credential URLs, sensitive query parameters and headers outside `allowedHeaders` stay protected in every mode, `visible` included. `maskTextSelector`, `unmaskTextSelector`, `blockSelector`, console and network settings stay as the host set them.
- A choice applies to that recording only. The chosen profile becomes the bundle's `meta.profile`, which the ingest endpoint checks against the deployment's profiles. Profile ids are lower-case letters, digits and `-`; an invalid one fails the start of a recording.

| `choices` key | Default | Effect |
| --- | --- | --- |
| `privacy` | none | Modes to offer, from `visible`, `inputs-masked`, `interface-visible`, `masked` and the older `text-masked`. Without it the recording uses `privacy` as is |
| `profiles` | none | Profile ids, or `{ id, label?, description? }` (the shape of `GET /api/config`'s `profiles`); the label defaults to the id in words |
| `defaults` | most masked mode, first profile | The first choice until the user makes one |
| `remember` | `true` | Keep the last choice for this origin in `localStorage`. Blocked or unreadable storage falls back to `defaults`. Always off for customers |
| `by` | `'staff'` | `'customer'` turns on the [customer rules](#options-step-for-customers) |
| `networkBodies` | `false` | Offer "Include network request and response content", capped by `capture` |

The step shows when at least two modes or two profiles remain after the cap. Its code and styles are separate chunks that load only for a host that passes `choices`, so customer pages carry none of it. A recording started without a choice (no options UI, or `start()` without `choice`) uses `defaults`, so it is never less masked than the host asked for. A host that renders its own UI implements `chooseOptions({ trigger, offer, signal })` on its `RecorderUi`: `offer` lists the capped modes with their `facts`, the profiles, the `initial` choice and the host's `defaults`; resolve with `{ privacy?, profile?, networkBodies? }`, or `undefined` to cancel. `offer.by` says who picks; `offer.networkBodies` is `{ allowed }` when the host offers the body option. `start({ consent: true, choice })` takes the same choice and caps it the same way. `createDeferredUi` and the React adapter do not render the step yet; their recordings use `defaults`.

## Options step for customers

A customer-facing host passes `choices: { by: 'customer' }`, so the person filing the report decides how much the recording shows. The host's `privacy` and `capture` still cap every mode, exactly as for staff:

```ts
const recorder = createGuidedRecorder({
  upload,
  app: { name: 'Acme' },
  // The most a customer may pick. Customers start in Your data hidden whatever this allows.
  privacy: { sanitize: false, maskAllText: false, blockMedia: false },
  capture: { network: 'bodies' },
  choices: { by: 'customer', privacy: ['text-masked', 'visible'], networkBodies: true },
});
```

- The menu lists **Your data hidden** (`interface-visible`) first, then **Fully masked** (`masked`), then each looser mode the host lists and allows, in that order. Customers see only modes they can pick; nothing is shown disabled. Your data hidden and Fully masked are always offered, even with the default `privacy`.
- **Your data hidden** is pre-selected on every recording. Nothing is remembered: no `localStorage`, no per-origin memory, and `defaults` cannot change the mode or turn bodies on.
- A looser mode (Text masked, Inputs hidden, Visible) or network content needs the customer's own pick in that recording's options step. `start({ consent: true, choice })` reduces a looser choice to the default, and keeps `masked` when asked.
- The body option is off on every recording and capped by `capture` like a staff option.
- Passwords and hidden fields are masked in every mode, and credential URLs and auth headers are always redacted.
- The only text selector a customer recorder accepts is the public marker: `privacy.unmaskTextSelector` must be absent or `'[data-replay-public]'`, and any other value fails the start of a recording.
- The consent notice and the review dialog say what the chosen mode records. For Your data hidden: "Your entries, names and typed text are hidden; Acme's menus and labels stay visible." The product name is `app.name` ("the app's" without one); override the whole line with the `consentPrivacy` and `reviewPrivacy` messages.
- The bundle records the pick in `meta.captured.choice` (`{ by: 'customer', mode, inputs, text, bodies }`). That is only a claim: the server keeps typed values and bodies only for a host with `privacy.keepCustomerChoices` ([customer choices on upload](extending.md#customer-choices-on-upload)), and masks them otherwise.

### Public product text

Put `data-replay-public` on static product interface whose text should stay readable in Your data hidden: navigation (Reports, Projects), day names, hour labels, buttons and menus. `publicProps` from the recorder entry spreads it in React (`<nav {...publicProps}>`).

```html
<nav data-replay-public><a href="/reports">Reports</a><a href="/projects">Projects</a></nav>
```

Mark only text your product ships, never user content: entry descriptions, project, client, tag and member names, e-mail addresses, durations, amounts and anything typed stay masked unless you mark them, so leave them unmarked even inside a marked region (put the marker on the labels, not on the list that holds them). The marker never reaches form fields: inputs, textareas, selects and their options, datalists and `contenteditable` regions stay masked inside a marked subtree, and so do passwords and hidden fields. Fully masked ignores the marker and hides every text. The server applies no extra rule to marked text; its redaction is unchanged.

## Compose the built-in steps

```ts
import { createRecorder } from '@hazem3500/replays/recorder';
import { composeUi, recordingIndicator, reviewDialog, resultToast } from '@hazem3500/replays/recorder/ui';
const recorder = createRecorder({upload, ui: composeUi(
  recordingIndicator(), reviewDialog(), resultToast(), {requestConsent: myModal},
)});
```

Later renderers win; `composeUi` validates all three required methods and calls every part’s dismiss cleanup. Each step mounts independently; the full default UI shares a floating surface across recording, sending and completion. Dialogs trap focus, inert siblings, return focus and cancel on Escape/abort. Copy, formatting and theme overrides are available through `DefaultUiOptions` (see [Messages and formatting](#messages-and-formatting)). The floating pill keeps one geometry through every phase: a live dot, label and tabular timer beside a round Stop control while recording (the timer turns red in the final 10 seconds), then sending, then the result. Success says “Recording sent” and, when the receipt has an HTTP(S) URL, offers **Open** (the primary action, a new tab with `rel="noopener noreferrer"`) and **Copy link**; Copy link confirms with “Copied” and returns to its label after two seconds. Failure says “Couldn't send recording” with a primary Retry, an optional host link and dismiss. Technical error messages are hidden; an explicit `userMessage` is a host override.

Upload errors may provide `action: { label, pendingLabel?, run({signal}): Promise<void> }`. The default UI starts recovery only on a user click, disables duplicate clicks while pending and retries the retained report once after successful resolution. Dismissal, recorder destruction or a replacement surface aborts the signal and prevents late retry. Hosts must cancel their listeners and waits on abort. Rejection keeps Retry and the action available; only a string `userMessage` on the rejection replaces the visible guidance, never its raw `message`. Labels and guidance are host-localized. `pendingMessage` replaces the message, with a spinner, while the action runs, and `failedLabel` is the button's label after a failed run (for example "Open sign-in again"). With `replacesRetry: true` the default UI shows the action without Retry, since it retries by itself once it succeeds. The default UI shows `link` beside the action; link-only errors and custom UIs remain compatible.

Theme tokens: background, foreground, secondary, border, borderStrong, hover, pressed, primary, primaryForeground, danger, font, radius. Use `theme:'light'|'dark'`, a typed object or `--recorder-*` CSS variables. Completion supports message, copy/link/custom actions and `render(container,{result,copy,retry,dismiss})` returning cleanup. Passing `actions` replaces the Open and Copy link defaults entirely: `[{ id: 'copy-link', kind: 'copy', label: 'Copy link' }]` keeps a customer-facing host copy-only, and `[]` leaves the message alone. A `primary: true` action, link or button, takes the filled style. URLs are restricted to HTTP(S); internal IDs are not shown by default.

## Messages and formatting

`messages` replaces any user-visible string of the default UI and the step kit, including accessible names, tooltips and live announcements; `selectError` uses the same `failed` and `startFailed` keys. `RecorderMessages` has every key required, so typing a full translation as `RecorderMessages` fails to compile when a key is missing. `defaultRecorderMessages` is the English copy, and `resolveRecorderMessages(overrides)` returns it with overrides applied, for hosts that render their own UI.

Static keys are strings. Data-bearing keys are functions of typed params, so your i18n library can pluralise and reorder. They also accept a template string with `{param}` placeholders for number and string params: overrides written before functions existed, such as `consentBody: 'Up to {minutes} minutes.'` or `sent: 'Saved {reference}'`, keep working. `DEFAULT_MESSAGES` is a deprecated alias of `defaultRecorderMessages`; `openReplay` was never rendered and is ignored.

| Key | Params | Where | Default |
| --- | --- | --- | --- |
| `consentTitle` | | Consent heading | Record this tab? |
| `consentBody` | `minutes: number`, `maxDurationMs: number`, `limit: string` | Consent time limit; `limit` is `format.duration(maxDurationMs)` | Up to 3 minutes. Stop whenever you like. |
| `consentPrivacy` | `mode: 'masked' \| 'visible'`, `privacy?: PrivacyFacts` (with `product`, the host's `app.name`) | Consent privacy notice, from the capture facts | Page text, inputs and media are hidden. You review it before it is sent. |
| `consentAccept` | | Consent accept button | Start recording |
| `consentDecline` | | Consent decline button | Not now |
| `recording` | | Indicator label, its accessible name and the start announcement | Recording |
| `stop` | | Stop button name and tooltip | Stop |
| `warningSoon` | `seconds: number` (30) | Announced once near the limit | 30 seconds left |
| `warningFinal` | `seconds: number` (10) | Announced once near the limit | 10 seconds left |
| `reviewTitle` | | Review heading | Send recording? |
| `reviewBody` | `summary: RecordingSummary`, `duration: string`, `size: string` | Review summary; `duration` and `size` come from `format` | You recorded 1 minute 13 seconds. |
| `reviewPrivacy` | `privacy: PrivacyFacts` | Review privacy notice: what the recording captured | Page text, inputs and media are hidden. |
| `noteLabel` | | Review note label | Add a note (optional) |
| `send` | | Review send button | Send recording |
| `discard` | | Review discard button | Discard |
| `uploading` | | Sending status and announcement | Sending |
| `sent` | `reference: string`, `receipt: IssueReportReceipt` | Success message; `reference` falls back to the replay id | Recording sent |
| `failed` | `error: RecorderMessageError`, `canRetry: boolean` | Upload failure message, unless the error has a `userMessage` | Couldn't send recording |
| `startFailed` | `error: RecorderMessageError` | `selectError` start failure, unless the error has a `userMessage` | Couldn't start recording |
| `retry` | | Retry button | Retry |
| `openLink` | | Default primary action that opens a receipt URL in a new tab | Open |
| `copyLink` | | Default copy action for a receipt URL | Copy link |
| `copied` | | Copy action after a successful copy, announced | Copied |
| `copyFailed` | | Copy action after a failed copy, announced | Couldn't copy |
| `close` | | Dismiss button name and tooltip | Close |
| `optionsTitle` | | Options step, options button and menu name; the step's announcement | Recording options |
| `optionsSummary` | `privacy?: string`, `profile?: string` (display names) | Options button tooltip | Fully masked · Triage |
| `privacyLabel` | | Privacy group heading in the options menu | Privacy |
| `profileLabel` | | Profile group heading in the options menu | Profile |
| `privacyUnavailable` | | Deprecated, no longer shown: the options menu hides modes the host does not allow. Still accepted so existing catalogs type-check | Not allowed here |
| `privacyMode` | `mode: RecorderPrivacyMode` | A mode's name | Visible, Inputs hidden, Text masked, Your data hidden, Fully masked |
| `privacyHint` | `mode: RecorderPrivacyMode`, `privacy: PrivacyFacts` | One quiet line under a mode, from what it records | Records text and inputs; Hides text and inputs; Shows only the app's menus and labels; Hides everything |
| `networkLabel` | | Network group heading in the options menu | Network |
| `networkBodies` | | The body option in the options menu | Include network request and response content |
| `record` | | Options step button that starts the recording | Record |

Labels you pass yourself (completion `message` and `actions`, an error's `userMessage` and `link.label`) are already yours and are shown as given.

`locale` (BCP 47, default `en`) drives the Intl-based `format` defaults; `format` replaces any of them. The same hooks are available as `createRecorderFormat(locale, overrides)`.

| Hook | Used for | Default |
| --- | --- | --- |
| `elapsed(ms)` | Running indicator clock | `m:ss` with `locale` digits |
| `duration(ms)` | `limit` and `duration` params | `formatDurationLong(ms, locale)`, e.g. 1 minute 13 seconds |
| `bytes(bytes)` | `size` param | Intl byte, kilobyte, megabyte or gigabyte units (base 1000), e.g. 1.5 MB |

```ts
import { createGuidedRecorder, type RecorderMessages } from '@hazem3500/replays/recorder/ui';
const messages: Partial<RecorderMessages> = {
  consentTitle: t('recorder.consentTitle'),
  consentBody: ({ minutes }) => t('recorder.consentBody', { count: minutes }),
  reviewBody: ({ duration, size }) => t('recorder.reviewBody', { duration, size }),
  sent: ({ reference }) => t('recorder.sent', { reference }),
};
const recorder = createGuidedRecorder({ upload, ui: { messages, locale: i18n.language } });
```

Type the object as `RecorderMessages` instead of `Partial<RecorderMessages>` to require a translation for every key.

## Verify your UI

```ts
import { testRecorderUi } from '@hazem3500/replays/recorder/testing';
testRecorderUi('our recorder', () => createOurUi(), {describe,it});
```

Run with a DOM environment. Standard controls use `data-recorder-action="consent-accept|consent-decline|stop|send|discard|retry|dismiss"` and `data-recorder-field="note"`. Optional selector overrides and `render(flush)` support framework adapters. The suite checks consent, privacy-copy differences, focus, abort, attestation, review/note, retry, dismissal and the complete strict recording flow. This repository runs it for default UI, composed steps and the React example, plus a deliberately broken UI whose contract failure is asserted.

`pnpm build:recorder` emits split ESM entries, shared chunks, declarations and a metafile. The build verifies that the core's static graph has no default UI, styles or React. Run recorder tests using `vitest.recorder.config.ts`; all repository builds and checks run on Boat.

## Iterate in Storybook

`pnpm storybook` (on Boat) opens the recorder under **Recorder** in the sidebar:

- **Default UI**: each `createDefaultUi()` surface on its own (the options step closed, with its menu open, capped by the host, consent, recording, sending, sent, failed), in both themes and at phone width. Edit `src/recorder/default-ui.ts` or `messages.ts` and the story reloads with your change.
- **Custom UI (kit)**: the `examples/recorder-shadcn` React UI on `@hazem3500/replays/recorder/react`, including warnings and upload progress.
- **End to end**: the production `createRecorder()` and default UI on a demo checkout page. rrweb loads through its real dynamic import and the upload leaves the page through the real transport. A Mock Service Worker ([msw](https://mswjs.io), served by `msw/vite`) answers as the ingest endpoint, so nothing in the recorder is stubbed.

End to end has an inspector beside the page. It shows the live recorder state, the history of states it went through, upload progress when the transport reports it, and every upload the endpoint received: its encoding, size on the wire, event count, console entries, requests and note. The **Next upload** buttons choose how the endpoint answers: Accept, Hold (the upload stays pending until **Release held upload**) or Return 503 (retryable). Use **Playground** to record by hand; the other stories play a flow and assert the outcome:

| Story | Flow and assertions |
| --- | --- |
| Record And Upload | Consent, type into the page, a failing request and a console error, stop, add a note, send. The endpoint receives a gzipped report whose bundle has the events, the failed request, the console error and the note, and never the typed name or password. |
| Review | Stops at the review dialog. |
| Uploading | The endpoint holds the upload, so the default UI stays on "Sending…". |
| Token Upload | Posts with `createTokenUpload` (XHR); the endpoint sees the bearer token. |
| Upload Fails Then Retries | The endpoint returns 503, the UI shows "Couldn't send recording" and Retry; Retry succeeds once the endpoint accepts. |
| Light Phone | Record And Upload in the light theme at 390 px. |

Two limits: the recorder has no paused or stopping state (`stop()` moves straight to review), and a service worker answers before Chromium emits XHR upload progress events, so End to end shows the indeterminate sending state. The kit stories show the progress surface. The upload endpoint lives in `stories/recorder/upload-endpoint.ts`; add a mode there to try another server response.

## Interaction steps

Browser recordings include clicks on controls, form submissions and same-document navigation alongside recording start and stop. With default masking, labels stay generic, such as “Clicked button” and “Requested form submission”. Control text appears only when the existing text privacy policy allows it: a control is named by its aria-label, aria-labelledby, label, placeholder, title, text, an inner icon's name or its `name` attribute, and a text field is “Focused” by that name; masked or blocked descendants and editable values are excluded. Labels pass the recorder's text redactor and length limit. Steps retain neither DOM selectors nor destination URLs, and query strings in readable URL labels are removed. A navigation is named by the last readable segment of its path (“Opened Tasks”), never the full URL.

A click that causes a navigation within a second is one step (“Opened “Projects””), and a form submission caused by a click on its submit button adds no step of its own. Generated steps carry `auto: true`; the viewer tidies the same patterns in recordings made before that (`src/shared/step-names.ts`) and never rewrites a step a person labelled.

The recorder excludes its own UI and blocked elements, groups repeated actions on the same control within 350 milliseconds, and keeps at most 500 interaction steps per session. Form steps describe the submission event, not whether the server accepted it. Navigation covers History API route changes, popstate and hashchange while this page remains recording. Stopping, discarding or destroying the recorder removes the listeners and restores its History API hooks. These markers use the recording clock and require no change to privacy defaults or upload permissions.

### First-party upload handoff

A browser that blocks third-party cookies never sends the Replays session with a cross-site `fetch`, even when the person is signed in. `handoffUpload({ replaysUrl, payload, signal? })` (call it from a click) opens `<replaysUrl>/upload` in a window, waits for its `ready` message, posts the bundle to the Replays origin only (`targetOrigin`, never `*`) and resolves with the receipt the page posts back. Only messages whose `event.source` is that window and whose `event.origin` is the Replays origin count. It rejects with `HandoffUploadError` (`kind`: `blocked`, `closed`, `timeout`, `too-large`, `aborted`, `rejected`). A payload over `maxChars` (default 64 MiB of JSON text) is refused before a window opens; `readyTimeoutMs` (default 3 minutes, which covers signing in) and `uploadTimeoutMs` (default 60 seconds, longer for large payloads) bound the waits, and closing the window ends the handoff.

The server serves `GET /upload` behind the usual authentication, so a person without a session signs in in that window. The page uploads same-origin to `POST /api/replays` and answers only an opener whose origin the `/api/replays` request policy lists (exact origins and host patterns), so the allowlist is configured once. It sends `ready` with `*` because it cannot know the opener's origin yet; that message carries nothing secret. If sign-in at Google drops the opener, the page asks the person to return to the app and retry; the next handoff then finds the session.
