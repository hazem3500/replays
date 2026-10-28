# Extension points

> Building a whole distribution (config file, plugins, browser entries, hooks)? Start with [extension-api.md](extension-api.md);
> this page describes the individual interfaces it builds on.

Everything here is a typed interface exported from `src/index.ts` (the library entry) and exercised by unit tests.
Plugins are plain ES modules, loaded at start, so no build step is needed. `AUTH_MODE=plugin` below is the single-purpose form; `definePlugin` ([extension-api.md](extension-api.md)) carries auth together with everything else.

## Auth adapters

```ts
interface AuthAdapter {
  readonly name: string;
  authenticate(request: IncomingMessage): Promise<Identity | undefined> | Identity | undefined;
  handle?(request, response, context: { base: string; publicOrigin?: string }): Promise<boolean> | boolean; // own routes (sign-in, callback)
  loginUrl?(request, context): string | undefined;   // where a browser without an identity is sent
  readonly routes?: readonly string[];                // paths `handle` serves without an identity
}
interface Identity { id: string; email?: string; name?: string }
```

- `authenticate` runs for every request except the health check. Returning `undefined` means "not signed in": the
  server answers `401` (when the adapter has a `loginUrl`) or `403`.
- `id` is what "kept by" records and logs show. Never put secrets in it.
- State-changing requests from a browser are additionally required to be same-origin by the server (`Sec-Fetch-Site`),
  whatever the adapter does.

First-party plugin: `@hazem3500/replays/plugins/iap` for Google Cloud's Identity-Aware Proxy (domains and service accounts; see
[extension-api.md](extension-api.md#first-party-plugins)).

Built in: `none`, `header` (trusted proxy; refuses requests from peers outside `AUTH_TRUSTED_PROXIES`), `oidc`
(authorization code + PKCE; discovery, JWKS, nonce/state checks, HMAC-signed HttpOnly session cookie; bearer tokens
for machine uploads; `AUTH_ALLOW` allow-list).

### A plugin

```js
// my-auth.mjs: AUTH_MODE=plugin AUTH_PLUGIN=./my-auth.mjs
export default function myAuth(env) {
  return {
    name: 'shared-secret',
    authenticate(request) {
      return request.headers['x-team-key'] === env.TEAM_KEY ? { id: 'team' } : undefined;
    },
  };
}
```

The module's default export may be async. `examples/auth-signed-header/plugin.mjs` is a complete, self-contained
example (verifies a signed JWT forwarded by an identity-aware proxy); its test lives in `test/auth-plugin.test.ts`.

A proxy that signs a header needs only `verifyJwt` from `@hazem3500/replays/server`: it checks the signature against a JWKS
(`RS256`/`ES256`; `jwksUrl` is cached hourly and refetched at most once a minute for an unknown `kid`, or pass `jwks`), the exact
issuer, the audience, `exp`, `nbf` and `iat` with `leewaySec` (default 30), and `iat` presence with `requireIat`. It resolves to the
claims or `undefined`:

```js
import { verifyJwt } from '@hazem3500/replays/server';
const claims = await verifyJwt({ token, jwksUrl: 'https://proxy.example.com/jwks', issuer: 'https://proxy.example.com',
  audience: 'replays', algorithms: ['ES256'], requireIat: true });
```

Run `describeAuthAdapter` from `@hazem3500/replays/server/testing` against your adapter ([extension-api.md](extension-api.md#testing-a-plugin)).

## Context metadata schema

`context.fields` is a free-form JSON object that you describe with a JSON Schema (2020-12; Ajv with string formats):

```json
{
  "type": "object",
  "properties": {
    "plan": { "type": "string", "title": "Plan", "enum": ["free", "trial", "pro"] },
    "adminUrl": { "type": "string", "title": "Admin console", "format": "uri" },
    "featureFlags": {
      "type": "object",
      "title": "Feature flags",
      "properties": { "newCheckout": { "type": "boolean", "title": "New checkout" } }
    }
  },
  "required": ["plan"]
}
```

Set `CONTEXT_SCHEMA_FILE` on the server (and pass the same file to `replays capture --context-schema` to fail
before the browser starts). Uploads violating it get `400 context.fields.plan must be equal to one of the allowed
values`. The viewer renders the Context tab from the schema: `title` as the label, `description` as help text,
property order, booleans as Yes/No, scalar arrays as chips, nested objects as indented lists, `format: "uri"` as a link
(`https:` only). Limits independent of the schema: 16 KB per context, depth 6, 100 keys per object.

Three viewer hints (ignored by validation) shape the tab further:

```json
{
  "type": "object",
  "properties": {
    "plan": { "type": "string", "title": "Plan", "x-replays-group": "Account", "x-replays-order": -1 },
    "flags": {
      "type": "array",
      "title": "Beta flags",
      "x-replays-group": "Account",
      "x-replays-widget": "signals",
      "items": {
        "type": "object",
        "required": ["key", "state"],
        "properties": { "key": { "type": "string" }, "state": { "enum": ["enabled", "disabled", "unknown"] }, "label": { "type": "string" } }
      }
    }
  }
}
```

- `x-replays-widget: "signals"` on an array of `{ key, state, label? }` draws tri-state chips: a check for `enabled`, a cross on muted
  text for `disabled`, and a question mark on a dashed outline for `unknown` (not supplied or not loaded), so a flag nobody reported
  never reads as switched off. The state is in each chip's tooltip and accessible name. An array that does not fit falls back to the
  plain rendering.
- `x-replays-group: "Account"` on a top-level property puts it in its own group, headed by that name; properties without one stay
  in the default group (titled by the schema's `title`, else "Details"). Groups come in the order of their first property.
- `x-replays-order` sorts properties (lower first, default 0; ties keep schema order), at any depth.

A client plugin can also add its own block to the tab with `registerContextSection` ([extension-api.md](extension-api.md#browser-entries-inspector-tabs-actions-panels-timeline-tracks-context-sections-settings)).

## Source-link providers

A source is `{ provider, ref }` and the server stores the resolved `https` link:

| Provider | Reference | Link |
| --- | --- | --- |
| `github` | `owner/repo#12`, `owner/repo@<sha>` | `https://github.com/owner/repo/issues/12` (GitHub redirects pull requests), `…/commit/<sha>` |
| `gitlab` | `group/project#12`, `group/sub/project!34` | `…/-/issues/12`, `…/-/merge_requests/34` |
| `url` | an `https://` URL | itself |
| your own | any `ref` matching `pattern` | `template` with `{ref}` URL-encoded in |

Self-managed hosts: `GITHUB_HOST`, `GITLAB_HOST`. Custom providers go in the config file's `sourceProviders`
(`{ "id": "jira", "template": "https://jira.example.com/browse/{ref}", "pattern": "^[A-Z]+-\\d+$" }`) or, from code,
`new SourceProviders().register({ id, label, resolve(ref) { … } })`. Templates are validated at start: they must
produce an `https` URL.

A provider can say how its sources look and keep a few facts about them:

```ts
api.sourceProvider({
  id: 'chat',
  label: 'Chat',
  noun: 'Chat thread',                          // "thread C123/p456, Chat thread (opens in a new tab)"
  icon: 'data:image/svg+xml;base64,PHN2ZyB4…',   // or an https URL
  resolve: (ref) => ({ url: `https://chat.example.com/${ref}`, label: ref, attrs: { channel: ref.split('/')[0], replies: 3 } }),
});
```

- `icon` is shown on the topbar's source chip, in the Context tab's Sources and on the index row. It must be a
  `data:image/svg+xml` URL or an https URL (checked at start; at most 8 KB) and is always drawn as an `<img>`, never inlined as
  markup, so an SVG cannot run script. Without one the viewer draws the provider's `mark`.
- `mark` names one of the viewer's built-in monochrome marks, drawn in the text colour so it follows the theme: `github`,
  `gitlab`, `slack`, `linear`, `jira`, `notion` or `link` (the default). The built-in providers carry theirs, and a
  config-file provider whose id is a mark's name (`"id": "jira"`) gets that mark without saying so.
- `noun` is short text naming what a source is; it joins the chip's and index link's accessible names and leads the source's line in
  the Context tab.
- `attrs` returned by `resolve` are kept on the stored source (`context.sources[].attrs`: at most 8 entries, keys like
  `[A-Za-z][\w-]*`, values short text or finite numbers; anything else is dropped) and, capped to 4 entries of 80 characters, on the
  index summary's `sources`. The Context tab lists their values after the noun; client plugins read them from
  `ctx.replay.context.sources`. A producer that sends an already resolved source (with a `url`) may send `attrs` too.
- Config-file providers accept `icon`, `mark` and `noun` as well: `{ "id": "tickets", "template": "…", "noun": "Jira issue", "mark": "jira" }`.

## Storage

```ts
interface ObjectStorage {
  readonly kind: 'fs' | 's3' | 'memory' | (string & {});   // the built-ins, or your backend's own name ('gcs')
  readonly description: string;
  readonly listCacheMs?: number;                          // reuse one listing for this long (S3: 5000); absent = list every time
  stat(key): Promise<ObjectInfo | undefined>;
  read(key): Promise<Buffer | undefined>;
  stream(key, range?): Promise<Readable>;
  write(key, body, options?: { createOnly?, ifVersion?, contentType?, cacheControl? }): Promise<ObjectInfo>;
  upload(key, localPath, options?): Promise<ObjectInfo>;
  delete(key): Promise<boolean>;
  deletePrefix(prefix): Promise<number>;
  list(options?: { prefix?, glob? }): Promise<ObjectInfo[]>;
}
```

`createOnly` and `ifVersion` make uploads race-free (an id can only be created once; suite registration is a
compare-and-swap). Keys are `<id>/replay.json`, `<id>/meta.json`, `<id>/keep.json`, `_suites/<id>.json`, plus media.

- `FsStorage`: a directory; atomic writes by rename. The default.
- `S3Storage`: any S3-compatible service (AWS, MinIO, Cloudflare R2, …); SigV4 signing implemented over `fetch`, no
  SDK. `STORAGE=s3 S3_BUCKET=… S3_ENDPOINT=… S3_FORCE_PATH_STYLE=1 AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…`.
  The bucket needs no public access, and the app is the only deleter, so do not add a lifecycle rule that races with
  "keep".
- `GcsStorage` (first-party plugin `@hazem3500/replays/plugins/gcs`, `STORAGE=gcs`): a Cloud Storage bucket over the JSON API, no SDK;
  `GCS_BUCKET`, `GCS_PREFIX`, credentials from the metadata server or `GOOGLE_OAUTH_ACCESS_TOKEN`, `STORAGE_EMULATOR_HOST` for an
  emulator. See [extension-api.md](extension-api.md#first-party-plugins).
- Another backend: implement the interface and register it with `api.storage` in a plugin (see [extension-api.md](extension-api.md)),
  or pass it to `new ReplayStore(storage, sampleDir, retention)`. Throw the exported `ObjectExistsError` (a `createOnly` write over an
  existing key) and `PreconditionFailedError` (an `ifVersion` write over a newer version), and `NotFoundError` from `stream`; the
  store and the comments tell a conflict from a failure with `instanceof`. Check keys with `assertKey` and match `glob` with
  `globToRegExp` (both exported from `/server`). Set `listCacheMs` when a listing is a few remote API pages. Then run the same
  contract the built-ins pass: `describeObjectStorage(name, factory, { describe, it })` from `@hazem3500/replays/server/testing`
  ([extension-api.md](extension-api.md#testing-a-plugin)). (`storageFromEnv` only knows `fs` and `s3`.)

## Redaction rules

The sanitiser's defaults (credential headers, sensitive query values, URL credentials, typed input, no bodies; see the
[privacy model](../README.md#privacy-model)) are always on. A deployment adds its own rules, from the config file or a plugin:

```ts
api.redaction({
  headers: [/^x-acme-session$/i],        // dropped, next to the built-in secret headers
  queryParams: ['invite_token'],         // [redacted] in every URL, fragments included
  jsonKeys: ['ssn', /card_?number/i],    // console arguments, and form or JSON bodies a HAR keeps
  text: [{ pattern: /\bACME-\d{6}\b/g, replace: '[ticket]' }],
  maskSelectors: ['[data-private]'],     // text masked in the DOM snapshot at capture
});
```

```json
{
  "redaction": {
    "headers": ["/^x-acme-session$/i"],
    "queryParams": ["invite_token"],
    "jsonKeys": ["ssn", "/card_?number/i"],
    "text": [{ "pattern": "/\\bACME-\\d{6}\\b/g", "replace": "[ticket]" }],
    "maskSelectors": ["[data-private]"]
  }
}
```

- **Names** (`headers`, `queryParams`, `jsonKeys`): a string is an exact, case-insensitive name; a `RegExp` (or, in JSON, a
  `"/.../flags"` string) is tested against the name.
- **`text`**: each match becomes `replace` (default `[redacted]`). Applies to DOM text and attribute values, console messages,
  step labels, the title, network URLs and header values. Not to `context` (structured and schema-checked: adapt it in a context
  adapter or `beforeUpload`). A pattern may not match the empty string, and `replace` may not match its own pattern.
- **`jsonKeys`**: the value of a matching key (a string, number, object or array) becomes `"[redacted]"` wherever JSON appears in a
  console message, nested or not. Request and response bodies are never stored, so there is nothing else to cover; a HAR's form
  parameters with a matching name are redacted by `sanitizeHar`.
- **`maskSelectors`**: passed to the recorder as rrweb `maskTextSelector`, so the text never leaves the page (every non-space
  character becomes `*`). An invalid selector fails the capture. The server's pass cannot run CSS on a serialised recording; it
  checks each selector's last compound part (tag, `#id`, `.class`, `[attr]`, `[attr=value]` and the other attribute operators;
  pseudo-classes ignored) against snapshots, added nodes and text changes. That masks the same text or more, never less.

**Where they apply.** The capture CLI reads the deployment's config (`--config <file>`, else `REPLAYS_CONFIG`, else
`replays.config.*` in the working directory), imports its plugins and runs their `setup` to collect `api.redaction` rules; it uses
nothing else from the config. A config that does not load fails the capture. `RecorderSession.start(cdp, { redaction })` takes rules
directly. The server applies the config's and every plugin's rules in its privacy pass on `POST /api/replays` and
`POST /api/replays/import`, so a bundle from an older producer, or one captured without the config, is cleaned too.

**They only add.** Rules from several plugins and the config file are concatenated. The default pass runs first and again after the
rules, so a text rule cannot bring back what the defaults removed (the stored bundle is always one the default pass leaves unchanged;
`test/sanitize.test.ts` checks this against rule sets that try). There is no key to switch a default off, and unknown keys are refused.

**Rules are trusted config.** Their regular expressions run over every captured string, so they come only from the host's config
file and plugins, never from an upload, a request or a sandboxed user plugin. Each pattern is capped at 200 characters and each list at
100 entries, and every rule is validated at start (`PluginError` `invalid-registration`, or a config error naming the key). The cap
does not make a pathological pattern safe: avoid nested quantifiers such as `(a+)+`.

## Theming and branding

Every colour is a CSS custom property. A deployment overrides the documented subset per colour scheme, without a
rebuild:

```json
{
  "name": "Acme Replays",
  "logoUrl": "https://example.com/logo.svg",
  "theme": {
    "dark": { "accent": "#7aa2ff", "accent-contrast": "#0b1020" },
    "light": { "accent": "#2f55d4", "accent-contrast": "#ffffff" }
  }
}
```

Tokens: `accent`, `accent-soft`, `accent-contrast`, `page`, `surface`, `surface-raised`, `surface-hover`,
`surface-pressed`, `canvas`, `text`, `text-secondary`, `text-tertiary`, `line`, `line-strong`, `danger`,
`danger-soft`, `warning`, `success`, `ring` (keyboard ring), `sans`, `mono`, `radius`. Values must be plain CSS values
(no `url()`, braces, semicolons or comments). The server injects them as a `<style id="brand-tokens">` block; keep
text/background pairs at WCAG AA (`test/contrast.test.ts` shows how the default palette is checked). The browser chrome
colour (`<meta name="theme-color">`) follows `page` per scheme; give `page` as a plain colour (hex, `rgb()`, `oklch()`), not
`var()`. `replays build-static` stamps the same into a CDN-hosted `index.html` ([operations](operations.md#static-viewer-on-a-cdn)).

The built-in mark (timeline segments and a playhead, `src/client/components/brand-mark-geometry.ts`) is the header logo
and, in a heavier four-segment cut, the favicon, with a home-screen icon and web manifest in `public/assets/brand`
(`node --experimental-strip-types scripts/build-icons.mjs` regenerates them). `logoUrl` replaces the mark in the header and
as the tab icon, and drops the built-in home-screen icon and manifest; a custom `name` alone drops only the manifest, which
carries the built-in name.

## Capture drivers

```ts
interface CaptureDriver {
  readonly name: string;
  launch(options: { viewport; harPath; videoPath? }): Promise<CdpLike>; // browser on about:blank + a CDP connection to the page
  open(url): Promise<void>;
  step(step: RawStep): Promise<void>;
  wait(ms): Promise<void>;
  finish(): Promise<void>;   // write the HAR (and video)
  close(): Promise<void>;
}
```

The recorder itself (`RecorderSession`) only needs a `CdpLike { send, on, off }`, which a Playwright `CDPSession`
satisfies, so a driver is mostly "launch a browser and run the steps". Pass yours to `capture(args, driver)`.

### Capture pacing

`capture(args, driver)` accepts optional `stepPauseMs` (0–10000 milliseconds). It waits after each
non-wait scripted action; `wait` steps keep their own duration. The default remains 0 to preserve existing
capture timing. The CLI also reads `capture.stepPauseMs` from `--config` / `REPLAYS_CONFIG` /
`replays.config.*`; an explicit `--step-pause` overrides it. A host wanting a readable demonstration pace
can use the public config entry:

```ts
import { defineConfig } from '@hazem3500/replays/config';

export default defineConfig({ capture: { stepPauseMs: 1200 } });
```

Both built-in drivers type at 80ms per character; `fill` stays immediate. Custom drivers continue to own
how they implement `type`. Automatic labels derive readable names from selectors (text, accessibility
attributes, test IDs), never from typed values. Explicit labels remain the producer's responsibility.
Unlabelled waits execute but are omitted from the step rail; label a wait to make it a visible step.
These options do not alter capture or upload sanitization.

Playback and MP4 export share speeds 0.25×, 0.5×, 1×, 1.5×, 2×, 4× and 8×. Skip inactive detects gaps
longer than 4000ms, keeps 800ms at each end and fast-forwards the middle at 16×. Captions hold the
preceding label through legacy unlabelled waits and repeated actions, while their number follows the
active rail step. Exports use the same caption selection and time mapping.
