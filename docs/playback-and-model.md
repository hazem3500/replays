# Own the playback interface

The browser playback service and portable models work independently of the hosted Replays application. You supply
the recording, DOM element and controls. No application router, API client, query cache, authentication provider or
React provider is required.

## A framework independent player

```ts
import { assertReplayBundle } from '@hazem3500/replays/model';
import { createReplayPlayback } from '@hazem3500/replays/viewer/playback';
import '@hazem3500/replays/viewer/playback/style.css';

const bundle: unknown = await readRecording();
assertReplayBundle(bundle);

const playback = createReplayPlayback(bundle);
const unmount = playback.mount(recordedPageElement);
const unsubscribe = playback.subscribe(() => {
  const { time, duration, state } = playback.getSnapshot();
  updateMyControls({ time, duration, playing: state.status === 'playing' });
});

playButton.addEventListener('click', playback.actions.playPause);
seekInput.addEventListener('input', () => playback.actions.seek(seekInput.valueAsNumber));
playback.actions.setSpeed(1.5);
playback.actions.setSkipInactive(false);

// Another recording replaces the mounted page and resets its timeline and effects.
playback.load(nextBundle);

// When the host leaves the player:
unsubscribe();
unmount();
playback.destroy();
```

Times and durations are milliseconds. Constructing a service and changing its playhead do not mount a DOM tree.
Playback starts after `mount(element)`. Each instance has its own clock, subscriptions, settings and DOM ownership.
`getSnapshot()` returns the same immutable snapshot object until an observed change; `subscribe()` returns an
unsubscribe function. Its phase is `empty`, `ready` or `destroyed`.

`load(bundle, { effects })` validates the bundle before replacing a current recording. Invalid input throws and leaves
the current recording untouched. A successful replacement resets time and effects and follows an existing mount.
The host owns the bundle and must treat it as immutable while loaded. `mount` returns a cleanup for that mount;
calling a cleanup from an earlier mount cannot remove the newer one.

`destroy()` releases subscriptions, the mounted page and animation work. It is idempotent and terminal: the final
snapshot stays readable with the bundle reference cleared, but further loads, mounts, subscriptions and actions throw. Hosts should unsubscribe their
UI observers during teardown. The service never fetches data or writes browser storage.

`ReplayController` is the lower level engine used by both the application and this service. It exposes separate
time, state and viewport stores for consumers that need independent subscriptions, plus `mount`, `seek`, playback,
scrubbing, effect and target-outline controls. Its `mount` cleanup owns the renderer lifecycle. This is the same
rrweb, cursor and effects implementation as the application, rather than a second player.

The playback entry is for browser bundlers. Import `/viewer/playback/style.css` once to include the replay rendering styles. It contains no React, router
or application data imports. The React primitives in `/viewer/react` require React 19 or newer and are optional consumers of this engine.

## Portable data and privacy contracts

`@hazem3500/replays/model` is a browser and server safe entry with no DOM, React or Node dependency. It exports the
bundle, step, console, network, performance and context types; `assertReplayBundle`, context validation and summary
formatting; edit validation, `applyEdits`, edit timelines and playback effects; and additive redaction contracts and
helpers.

```ts
import {
  applyEdits, assertReplayEdits, compileRedaction, redactText,
} from '@hazem3500/replays/model';

assertReplayEdits(edits, bundle.meta.duration);
const edited = applyEdits(bundle, edits);
const playback = createReplayPlayback(edited.bundle, { effects: edited.effects });

const rules = compileRedaction({ text: [{ pattern: 'private-project' }] });
const safeLabel = redactText('Open private-project', rules);
```

Applying edits does not mutate the source bundle. Redaction helpers operate on the supplied values; validation is
not sanitization and these helpers do not replace recorder privacy settings or the server's ingest privacy pass.
Request and response body capture remains explicit opt-in under the existing capture contract.

## Diagnostics without a framework

`@hazem3500/replays/viewer/diagnostics` exposes the same pure derivation used by the React inspector. It has no
DOM, React, rrweb, router or application state dependency, so a host can run it in a browser, worker or server:

```ts
import { buildNetworkRows, buildPerformance, buildWaterfall, collectErrors } from '@hazem3500/replays/viewer/diagnostics';
import { editTimeline } from '@hazem3500/replays/model';

const timeline = editTimeline(edits, bundle.meta.duration);
const requests = buildNetworkRows(bundle, timeline);
const performance = buildPerformance(bundle, timeline);
const spans = buildWaterfall(bundle, timeline);
const errors = collectErrors(bundle);
```

The first three builders accept an optional edit timeline with the original source bundle: they clip/split visible
spans while preserving measured source durations. Do not pass an already edited bundle together with that source
timeline. Without a timeline, positions follow the supplied bundle's own clock. `collectErrors` uses the supplied
bundle's clock; use the bundle returned by `applyEdits` when an edited error list is wanted. Builders neither fetch nor
mutate data. Missing performance capture remains missing, and a largest paint candidate is not a final Web Vitals score.

Use `NetworkRow`, `RequestName`, `RequestType`, `PerformanceModel`, `PerformanceSignal`, `RowTiming`, `WaterfallRow`,
`WaterfallSegment` and `ReplayError` from the same entry for host-rendered lists, charts and details. Rendering and
selection belong to the host; feed a selected row's `at` into your playback instance's seek action.

## Optional React composition

`/viewer/react` supplies an independent provider and unstyled, accessible controls. Each provider has its own
playback instance; alternatively pass an externally owned `Playback` as the provider's `playback` prop. The stage,
transport, steps and inspector can live anywhere beneath that provider, including your own panels and portals.

```tsx
import {
  ReplayProvider, ReplayStage, ReplayTransport, ReplaySteps, ReplayInspector,
} from '@hazem3500/replays/viewer/react';
import '@hazem3500/replays/viewer/react/style.css';

function MyReplay({ bundle }) {
  return (
    <ReplayProvider bundle={bundle}>
      <ReplayStage />
      <ReplayTransport>
        {({ playback, state }) => (
          <button onClick={playback.playPause}>
            {state.status === 'playing' ? 'Pause' : 'Play'}
          </button>
        )}
      </ReplayTransport>
      <ReplaySteps />
      <ReplayInspector>
        {({ console: messages }) => <pre>{messages.map((message) => message.message).join('\n')}</pre>}
      </ReplayInspector>
    </ReplayProvider>
  );
}
```

`useReplay`, `useReplayTime`, `useReplayState`, `useReplayViewport`, `useReplaySteps` and `useReplayInspector` also
support building the entire interface from your own components. The stage CSS only supplies replay geometry; it
does not import the application's theme, reset or layout. Diagnostic models do not depend on the application's
tabs, API or query client.

The provider's optional `playback` prop accepts the lower level `ReplayController` or a compatible `Playback`.
It does not accept the `createReplayPlayback` service, which owns its own loading, mounts and destruction. Both use
the same engine, but the lifecycle contracts are deliberately separate. For an externally controlled React player:

```tsx
import { useState } from 'react';
import { ReplayController } from '@hazem3500/replays/viewer/playback';

function ControlledRecording({ bundle }) {
  const [controller] = useState(() => new ReplayController(bundle));
  return (
    <ReplayProvider bundle={bundle} playback={controller}>
      <ReplayStage />
      <ReplayTransport />
    </ReplayProvider>
  );
}
```

Keep that controller paired with the same recording; remount `ControlledRecording` with a new recording key when
replacing the bundle. `ReplayStage` releases its renderer on unmount. The provider does not reset or pause an
externally supplied controller merely because its own children change. An explicit `effects` override temporarily replaces
its current effects and restores that baseline when removed, when controllers change, or when the provider unmounts.

The [composed viewer example](../examples/composed-viewer/) demonstrates two independently loaded React players
and a separate framework independent page using only the published entries.

After building the package and example, run its real browser consumer checks from the repository root with
`pnpm exec playwright test -c examples/composed-viewer/playwright.config.ts`. They exercise mounting, replacement,
cleanup ownership and local file loading against the published browser bundle, including an actual rrweb iframe.


## Choose the integration boundary

| Host need | Public entry | Host responsibility |
| --- | --- | --- |
| Validate, redact and edit portable recordings | `/model` | Supply immutable data and choose privacy policy |
| Own DOM controls without React | `/viewer/playback` and its `/style.css` | Mount, size, subscribe and destroy the player |
| Own diagnostic tables/charts anywhere | `/viewer/diagnostics` | Render models and coordinate selection with playback |
| Compose a React player | `/viewer/react` and its `/style.css` | Supply React 19, recording data and host layout |
| Record without the default UI | `/recorder` | Supply the consent/review UI adapter and upload transport |
| Compose consent, indicator, review and result UI | `/recorder/ui`, `/recorder/kit` | Choose UI pieces, messages and lifecycle ownership |
| Build recorder UI in React | `/recorder/react` | Supply the provider and render state/prompts; see [recorder guide](recorder.md) |
| Host the full application or replace storage/auth | `/server`, `/plugin`, `/config` | Provide deployment, authorization and storage configuration |
| Add or replace full application surfaces | `/viewer` | Register trusted slot contributions; see [extension API](extension-api.md) |

These are reusable contracts; the application's screens, router, data collections and themed internal components
remain private. Public React controls are unstyled and can be replaced by render props or hooks. The application
extension API is separate from an independent player and needs the full application's host runtime. Editor command
contracts remain beta. Nothing in these entries grants upload or recording access: the host must provide an
actual authorized transport, and the recorder retains its consent and privacy rules.

`pnpm test:pack` checks installed tarball imports and browser-bundles each composition, including explicit renderer
CSS and recorder UI's Motion dependency. Its headless graphs reject React/router dependencies and default UI motion.
The browser example checks actual rrweb rendering and replacement; these checks complement the source unit tests.
