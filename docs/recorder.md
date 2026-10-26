# In-page recorder

`@hazem3500/replays/recorder` is a browser-only, framework-free entry. It never imports the server, CLI, React, or Node modules. The separate browser build emits one `dist/lib/recorder.mjs`, with only the lazy `rrweb` dependency external. Declarations live at `dist/types/recorder/index.d.ts`. `pnpm build:recorder` builds both; `build:cli` includes this step for packing.

```ts
import { createRecorder, createDefaultUi } from '@hazem3500/replays/recorder';

const recorder = createRecorder({
  app: { name: 'My app' },
  upload: async (report, { signal }) => {
    // Provide the host's endpoint/authentication. Never expose an internal
    // replay URL to customer browsers. Throw on failed uploads.
    const response = await fetch('/api/recordings', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!response.ok) throw new Error('Upload failed');
    const { id, reference } = await response.json();
    return { replayId: id, reference };
  },
  ui: createDefaultUi({
    completion: {
      message: 'Recording sent',
      actions: [{ id: 'link', kind: 'copy', label: 'Copy link', value: result => result.url ?? '' }],
    },
  }),
});
// Call from the user's Record action. Consent and review are on by default.
await recorder.request();
// On host unmount:
recorder.destroy();
```

No capture starts before consent. Inputs and text are masked by default; URL credentials, sensitive query values, console output and allowed network headers are redacted. Hosts must add chat widgets or other private surfaces to `privacy.blockSelector`. The `[data-recorder-block]` attribute always excludes an element. Network capture records request metadata, not request/response bodies. Failed uploads retain their payload for retry, and discard/destroy abort pending prompts and uploads.

## Appearance and composition

The default is Replays dark styling. Colors inherit `--surface-raised`, `--surface-hover`, `--surface-pressed`, `--text`, `--text-secondary`, `--line`, `--line-strong`, `--accent`, `--sans`, and `--radius`. Override with the typed `theme` object (background, foreground, secondary, border, borderStrong, hover, pressed, primary, primaryForeground, danger, font, radius), CSS `--recorder-<key>`, or explicit `theme: 'light' | 'dark'`. Copy is replaceable through `messages`.

The same floating surface transitions recording → sending → complete/error, with a stable tabular timer and neutral Stop icon. Animation is disabled for reduced motion. It stays hidden during review; the modal retains consent/review semantics. `dismiss()` cleans up the persistent floating surface when using the UI directly; `recorder.destroy()` does that for the guided flow.

Completion defaults to **Recording sent** and one quiet Copy link action when the transport supplied a safe HTTP(S) `url`. Without a URL it shows only the message; copying an internal reference is an explicit host option. Internal IDs are not displayed in the message. An icon dismisses the surface. There is no automatic dismissal while the user may be reading or interacting.

`completion.message` accepts a string or `(receipt) => string`. `completion.actions` accepts `{id,label,kind:'copy',value?}`, `{id,label,kind:'link',href}`, or `{id,label,kind:'custom',onAction}`; values/hrefs can be receipt functions, and actions can opt into `primary`. Set `actions: []` for message-only completion. Links must resolve to HTTP(S).

For complete control, `completion.render(container, {result,copy,retry,dismiss})` renders the completion body and may return cleanup. Cleanup runs on transition/dismiss. `copy` defaults to the receipt URL, reference, or replay ID and reports feedback inline. A custom renderer owns its body accessibility, while the shared live region announces the completion message once. `retry` is available for composition; successful completion has no pending upload to retry.

For entirely custom prompts and indicators, supply a `RecorderUi`. Keep explicit consent, a visible recording indicator/Stop control, upload confirmation, and disposal behavior. The generic entry includes no Crisp transport or product-specific endpoint. Product adapters should own those integrations and can reuse `gzip`, `buildReplayBundle`, `IssueUploadError`, and report types.

## Internal capture policy

`privacy.sanitize` defaults to `true`. An internal host may explicitly set `false` to preserve page text and ordinary form values. Password and hidden input values, authentication/cookie/token headers, URL credentials and sensitive query parameters remain protected. Request and response bodies are never captured. This option adds no production-user toggle. Product adapters may enforce stricter support policies regardless of caller options. A custom/default UI supplied by the host must use `privacyMode: 'visible'` and accurate consent copy for opt-out capture; `createRecorder` does this automatically when it creates its own default UI.

Status changes and timer digits use native browser animations, with no React or motion dependency. Unchanged glyphs stay stable; reduced-motion preferences and browsers without animation support get immediate text updates.
