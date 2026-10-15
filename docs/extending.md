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

Built in: `none`, `header` (trusted proxy; refuses requests from peers outside `AUTH_TRUSTED_PROXIES`), `oidc`
(authorization code + PKCE; discovery, JWKS, nonce/state checks, HMAC-signed HttpOnly session cookie; bearer tokens
for machine uploads; `AUTH_ALLOW` allow-list).

### A plugin

```js
// my-auth.mjs — AUTH_MODE=plugin AUTH_PLUGIN=./my-auth.mjs
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

## Storage

```ts
interface ObjectStorage {
  readonly kind: 'fs' | 's3' | 'memory';
  readonly description: string;
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
- Another backend: implement the interface and pass it to `new ReplayStore(storage, sampleDir, retention)`; run
  `test/storage.test.ts`'s contract against it. (`storageFromEnv` only knows `fs` and `s3`; register yours with `api.storage` in a plugin, see
  [extension-api.md](extension-api.md).)

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
text/background pairs at WCAG AA (`test/contrast.test.ts` shows how the default palette is checked).

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
