# In-page recorder

The host app owns prompts such as “Record the problem?”. `@hazem3500/replays/recorder` supplies capture and state without mounting UI. Nothing is loaded or recorded until consent and `start()`. The default UI is optional.

| Entry | API |
| --- | --- |
| `/recorder` | `createRecorder`, `createDeferredUi`, `createRecorderStore`, selectors, timer/format helpers, privacy props and selector builder, upload utilities |
| `/recorder/kit` | `createAnnouncer`, `focusReturn`, `trapFocus`, `markRecorderUi`, `mountRecorderRoot`, privacy helpers and chat-widget presets |
| `/recorder/ui` | `createGuidedRecorder`, `createDefaultUi`, step kit, `composeUi`, copy, themes and completion options |
| `/recorder/react` | Optional React 18+ provider and hooks; core never imports React |
| `/recorder/testing` | DOM contract suite, fake rrweb/transport, shadow-DOM query helper; Node test runner only |

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

`createRecorderStore` exposes stable actions and selector subscriptions with an optional equality function. Selectors: `selectView`, `selectCanRequest`, `selectSummary`, `selectReceipt`, `selectError`, `selectUploadProgress`. `createRecordingTimer` ticks on elapsed whole seconds while recording, exposes elapsed/remaining milliseconds and labels, fraction, warnings at 30 seconds (`soon`) and 10 seconds (`final`), plus a size warning at 80%. Dispose timer stores you create. `recordingTimer` is the pure equivalent; `formatDuration` and localized `formatDurationLong` are independent helpers.

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

The core checks user activation at start/upload, passes capture facts to every consent renderer, and checks for a registered visible Stop after a one-second grace period and every two seconds afterward. The facts describe text, ordinary inputs, media, console, network, the duration cap and whether review is required. Passwords, hidden inputs, credential URLs and auth headers stay protected. Request and response bodies are never captured.

During the two-minor / 90-day migration window, activation and Stop checks warn once per condition. Set `strictInvariants:true` now to enforce them. With strict enforcement, a missing Stop ends capture with `no-indicator` and discards it; it can never upload. `page-hidden` always discards. No capture occurs without explicit `consent:true`, no upload without `confirmed:true` and a retained reviewed recording. Those flags remain for compatibility: the evidence checks supplement them, and cannot establish the semantic truth of consent copy. Browsers lacking the activation API log once and skip that check.

Both prompts are enabled by default. `prompts.consent:false` makes the host's Record click the decision point; `prompts.review:false` sends when the user clicks Stop. Capture caps remain enforced. `privacy.sanitize:false` is a host policy decision that permits visible page text and ordinary inputs; render the supplied facts accurately. `blockSelector({presets:['crisp','intercom','zendesk'], selectors:['[data-private]']})` validates selectors; invalid or empty selectors throw. Without a DOM, identifier/preset-only construction works and raw selector validation fails clearly.

Use generic `{source:'host',reason:'crisp'}` triggers and `setReportContext({metadata:{...}})` for integrations. `source:'crisp'` and the `crisp` report field are deprecated compatibility aliases for the same two-minor / 90-day window. Product adapters own support copy, endpoints and external IDs.

## Compose the built-in steps

```ts
import { createRecorder } from '@hazem3500/replays/recorder';
import { composeUi, recordingIndicator, reviewDialog, resultToast } from '@hazem3500/replays/recorder/ui';
const recorder = createRecorder({upload, ui: composeUi(
  recordingIndicator(), reviewDialog(), resultToast(), {requestConsent: myModal},
)});
```

Later renderers win; `composeUi` validates all three required methods and calls every part’s dismiss cleanup. Each step mounts independently; the full default UI shares a floating surface across recording, sending and completion. Dialogs trap focus, inert siblings, return focus and cancel on Escape/abort. Copy and theme overrides remain available through `DefaultUiOptions`. Success says “Recording sent”; failure says “Couldn't send recording” with one Retry, an optional host link and dismiss. Technical error messages are hidden; an explicit `userMessage` is a host override. Copy feedback (`copied`, `copyFailed`, `copyLink`) and time warnings are configurable messages.

Theme tokens: background, foreground, secondary, border, borderStrong, hover, pressed, primary, primaryForeground, danger, font, radius. Use `theme:'light'|'dark'`, a typed object or `--recorder-*` CSS variables. Completion supports message, copy/link/custom actions and `render(container,{result,copy,retry,dismiss})` returning cleanup. URLs are restricted to HTTP(S); internal IDs are not shown by default.

## Verify your UI

```ts
import { testRecorderUi } from '@hazem3500/replays/recorder/testing';
testRecorderUi('our recorder', () => createOurUi(), {describe,it});
```

Run with a DOM environment. Standard controls use `data-recorder-action="consent-accept|consent-decline|stop|send|discard|retry|dismiss"` and `data-recorder-field="note"`. Optional selector overrides and `render(flush)` support framework adapters. The suite checks consent, privacy-copy differences, focus, abort, attestation, review/note, retry, dismissal and the complete strict recording flow. This repository runs it for default UI, composed steps and the React example, plus a deliberately broken UI whose contract failure is asserted.

`pnpm build:recorder` emits split ESM entries, shared chunks, declarations and a metafile. The build verifies that the core's static graph has no default UI, styles or React. Run recorder tests using `vitest.recorder.config.ts`; all repository builds and checks run on Boat.
