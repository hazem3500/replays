# Malleability: the viewer you can reshape, and that an agent can reshape with you

> **Status: beta, off by default.** `REPLAYS_BETA_MALLEABLE=true` (or `{ "beta": { "malleable": true } }`, or
> `{ "malleable": { "enabled": true } }` in the config file) turns it on. With the flag off there is no UI, every `/api/malleable/*` route and the sandbox page answer `404`, no WebMCP tool
> is registered and none of this code is requested by the browser. The plugin file format and the tool names may change before 1.0
> ([api-stability.md](api-stability.md)).

The idea: a replay viewer is read by people who each want something slightly different (a tab grouping failed requests by
endpoint, a comment template for bug reports, a CSV export of the network log). Waiting for the maintainers, or forking, is the
cliff. This design gives the viewer a slope instead: rearrange, then save, then author small things, then let an agent author them,
all inside the running app, all reversible, none of it able to reach beyond what the person allowed.

Contents: [sources](#sources) · [principles → design](#principles--design) · [the slope](#the-slope-use--configure--compose--extend--modify) ·
[how it works](#how-it-works) · [what it builds on](#what-it-builds-on-pr-2s-extension-points) · [the agent bridge](#the-agent-bridge) ·
[data as the stable core](#data-as-the-stable-core) · [the host's policy](#the-hosts-policy) · [upgrades](#upgrades) · [threat model](#security-and-threat-model) · [worked examples](#worked-examples) ·
[gaps](#gaps-and-what-is-not-built) · [trying it](#trying-it)

## Sources

What each one contributed, and how far I could check it. "Verified" means I read the primary page while designing this; the
dates are of the reading (2026-10-16).

| Source | What I took from it |
| --- | --- |
| Ink & Switch, [Malleable software: Restoring user agency in a world of locked-down apps](https://www.inkandswitch.com/essay/malleable-software/) | The goal as a bar: *"a software ecosystem where anyone can adapt their tools to their needs with minimal friction"*. The **gentle slope from user to creator** (each step up should need only a small step more skill, after MacLean et al.), **sharing data between tools** (when each app manages its own data, a new tool adds friction), and **tools, not apps**. These became the slope below, the [stable formats](#data-as-the-stable-core) and the choice to ship small composable tabs/actions rather than one big "scripting" feature. |
| Simon Willison, [Malleable software](https://simonwillison.net/2025/Jun/11/malleable-software) (2025-06-11) | Two cautions I designed against. Plugin systems only allow changes "in specific authorized ways", so there is a user who is stuck when no hook exists (see [gaps](#gaps-and-what-is-not-built): what the plugin API still cannot reach). AI code generation alone does not remove the barriers to malleability, such as tweaking existing tools and making tools work together, so the agent here is a *collaborator on a working copy the person can edit*, not a generator that ships. |
| Powermove: [site](https://trypowermove.com/), [source and README](https://github.com/iterative-computer/powermove), [desktop README](https://github.com/iterative-computer/powermove/blob/main/apps/desktop/README.md) (the "inspired by" reference) | Verified from these primary pages: extensions are a manifest plus sources in a user folder, hot-loaded into the running editor, written against the *same* API the built-in panels use, listed in a Mods panel with an on/off switch, auto-disabled with a "fix it / turn off" prompt when they error; the agent works through *"a typed, undoable tool layer that can inspect, render, and transactionally edit the live project"* and a run-scoped local MCP bridge, stages changes in an isolated workspace, keeps the previous live version for recovery. I took the hot-load loop, the on/off switch, the "agent works through typed tools on live state" shape and "the previous version is always recoverable" (here: version history and revert). |
| [WebMCP](https://webmachinelearning.github.io/webmcp/) ([repository](https://github.com/webmachinelearning/webmcp)), a Web Machine Learning Community Group Draft Community Group Report (the copy I read is dated 15 October 2026; "not a W3C Standard nor on the W3C Standards Track") | The in-page tool surface: `document.modelContext.registerTool({ name, description, inputSchema, execute, annotations })`, `signal` to unregister, and the annotations `readOnlyHint`, `untrustedContentHint` and `consequentialHint`. The explainers still mention `navigator.modelContext` in earlier drafts; the current IDL I read puts `modelContext` on `document`. Native registration and calls were verified on 25 October 2026 in Chromium 151.0.7922.108 with `--enable-features=WebMCP`, using the actual Agent-Native browser client. The [implementation-status page](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) documents browser trials and flags; support is still experimental. The dedicated integration spec tests native and stand-in paths separately; ordinary unflagged tests can still use the stand-in. |
| [Model Context Protocol, stdio transport (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | The out-of-page door: newline-delimited JSON-RPC on stdin/stdout, nothing else on stdout, logs on stderr. `replays mcp` implements `initialize`, `ping`, `tools/list` and `tools/call` by hand (no SDK dependency). Streamable HTTP is not implemented. |

### Powermove: what is verified and what is not

The brief's description came from a third-party listing ([ProductCool](https://www.productcool.com/product/powermove-2)). Checked
against Powermove's own pages:

| Claim | Status |
| --- | --- |
| An editor for macOS on Apple silicon | **Verified** (site download, README requirements). |
| Coding agents (Claude Code, Codex) write code that changes the *running* editor | **Verified** (README: ask an agent to add or fork panels, effects and workflows, then load them into the running app; mods are hot-loaded by the renderer kernel). |
| New panels, effects, workflows | **Verified** for panels, effects, shaders, themes, commands (site and desktop README list the registries). "Workflows" is the README's word; the site's examples are motion tracking and audio-reactive visuals. |
| Agents *inspect live app state* | **Partly verified.** The README says the agent's tools inspect, render and edit the live *project* (and the desktop README lists project state, panel layout and frame rendering on a run-scoped MCP bridge). It does not say agents can read arbitrary UI state. |
| Every AI-generated change is undoable | **Verified as stated** by the README ("Every change can be undone", typed undoable edit boundary). How undo is implemented, and whether it covers a mod's own side effects, is not stated: unverified. |
| Free and open source under **GPL-3.0** | **Contradicted.** README and site footer say **AGPL-3.0-or-later**. (I did not open the LICENSE file itself.) |
| An engine "GPU-accelerated … for Apple Silicon" | Per third-party listing, unverified (not checked against the source). |
| Mods are sandboxed / have a permission model | **Not stated** by the primary pages (the desktop README says the renderer is context-isolated and that *generated JavaScript* can run in an opaque-origin host without network; it does not say mods do). Treat as unknown. This is the largest difference by design: Powermove is a single-user desktop app, replays is a multi-user web server, so here sandbox and consent are the default rather than an afterthought. |

## Principles → design

| Principle | Concrete design here | Where |
| --- | --- | --- |
| **Gentle slope** (Ink & Switch) | Five rungs, each a small step from the last, in the same place: [use → configure → compose → extend → modify](#the-slope-use--configure--compose--extend--modify). Starting a plugin is "New plugin" with a working template, not a toolchain. | `src/client/malleable/Workshop.tsx`, `src/shared/malleable.ts` (`starterPlugin`) |
| **Modify the running thing** (Powermove) | A plugin hot-loads into the open viewer the moment it is edited (350 ms after the last key); the same path loads what an agent installs. The registry swaps a plugin's registrations in one step so a selected tab stays selected. | `src/client/malleable/manager.ts`, `ViewerRegistry.replacePlugin` in `src/client/plugins/registry.ts` |
| **Same API for built-ins and user code** (Powermove) | User plugins register through the *same* `ViewerRegistry` as PR #2's browser plugins (`registerInspectorTab`, `registerViewerAction`, `registerViewerPanel`): they appear in the same tab row and More menu. The malleable server half is a built-in `definePlugin` like `comments`. | `src/client/plugins/registry.ts`, `src/server/malleable-plugin.ts` |
| **Data is the stable core, tools come and go** (Ink & Switch) | Replays, comments, edits, and now plugins themselves are plain JSON documented by JSON Schemas; plugins read a *copy* of the replay and write only through the same comments API the UI uses. | [`docs/formats/`](formats/), `test/formats.test.ts` |
| **Tools, not apps** (Ink & Switch) | The unit is one small thing (a tab, an action) in one file, shareable alone; no plugin owns the app. | `examples/malleable/*.replays-plugin.json` |
| **Beyond authorized hooks** (Willison) | The viewer's plugin surface is deliberately small and honest about what it cannot reach; the path past it is "open an issue / extend the registry", not a hidden eval. See [gaps](#gaps-and-what-is-not-built). | this document |
| **AI as a collaborator on a reversible working copy** (Powermove, Willison) | The agent installs a *draft*; the person sees it live, edits it, discards it, or keeps it through a dialog that shows the diff and the permissions. The agent has no save tool. | `src/shared/malleable-tools.ts`, `KeepDialog.tsx` |
| **Safety is the default, not a mode** | Sandboxed frame, CSP, capability broker, consent for every write, consent tokens bound to content. See the [threat model](#security-and-threat-model). | `src/shared/sandbox-runtime.ts`, `src/client/malleable/broker.ts`, `src/server/malleable-store.ts` |

## The slope: use → configure → compose → extend → modify

| Rung | What a person does | Status |
| --- | --- | --- |
| **1. Use** | Open a replay. | Exists. |
| **2. Configure** | Rearrange and save: switch plugins on or off per device (the Workshop's "Switch off on this device"); theme tokens and branding by config (`theme`, `name`, [extending.md](extending.md#theming-and-branding)); collapse/resize the inspector (already remembered locally). **Not built:** saved *views* (a named layout of panels and tabs) and saved *filters* for the replay list. Design: both are tiny JSON documents of the same kind as plugins (`replays-view/1`: tab order, selected tab, inspector height, the list's query string), stored with the same history store (`UserPluginStore` generalises to "named documents with versions") and shareable as files. They need no code execution, which is why they come before it on the slope. | Partly built; rest designed. |
| **3. Compose** | Import a plugin file someone shared, or start from a template, and combine small things: a tab, a comment template, an export. Each is one file; they do not know about each other, they share the data. | **Built:** import/export of `*.replays-plugin.json`, workshop list. |
| **4. Extend** | Write a small plugin in the Workshop's source view: it hot-reloads, shows what it printed and which errors it threw, and is saved only when approved. Authoring touches one function, `replays.tab(id, (el, ctx) => …)`. | **Built:** tabs, side panels, actions; [capabilities](#the-sandbox-and-the-capability-api). |
| **5. Modify** | Ask an agent: "add a tab that groups failed requests by endpoint", or "comment on every console error". It reads the live state, writes the plugin, installs it live; the person keeps, tweaks or discards it. Past the plugin API: change the viewer itself (a fork of this repository, or a new built-in *feature*, `src/client/plugins/features.tsx`, which is code in the repository, not user code). | **Built:** the agent bridge. Modifying core UI remains a source change. |

No rung needs a build step, a restart or the maintainers. The step from 3 to 4 is "press the *Source* tab"; the step from 4 to 5 is
"press *Connect an agent*". A person who stops at any rung keeps everything below it.

## How it works

```
 viewer page (React)                                   sandboxed frame (one per tab/panel/running action)
 ───────────────────────────────────────────────       ──────────────────────────────────────────────────
 PluginManager  ── registers contributions ──►          <iframe sandbox="allow-scripts">  (opaque origin)
   │  (src/client/malleable/manager.ts)                   loads /_malleable/sandbox.html  (CSP header: nothing loads or sends)
   │            ViewerRegistry (PR #2 browser plugins)    runs the plugin source as an inline script
   │                                                       exposes only  replays.tab / .panel / .action  and  ctx
   ▼
 broker.ts ◄──────── MessagePort: { method, params } ─── ctx.replay (a copy), ctx.seek, ctx.comments.add, ctx.download …
   1. declared in the manifest?  2. write capability → ask the person  3. validate, then act through the app's own APIs
```

### Plugins

A plugin is two things, as one file (`docs/formats/user-plugin.schema.json`):

- a **manifest**: `id`, `name`, `permissions` (which capabilities it uses) and `contributes` (`tabs`, `panels`, `actions`, each `{ id, label }`);
- a **source**: JavaScript that calls `replays.tab(id, (el, ctx) => …)`, `replays.panel(…)` or `replays.action(id, async (ctx) => …)`.

The manager (`src/client/malleable/manager.ts`) holds the *working copy* of every plugin in this tab: the saved ones (loaded from
the server at start-up) and drafts (new, imported, or installed by an agent). It keeps the viewer registry in step with them. A
change to a plugin calls `ViewerRegistry.replacePlugin` (added by this work, additive): one swap, one re-render. That is the hot
reload. Each tab, panel or action run starts its own frame, so a plugin crash or infinite loop is contained to its frame, and an
action's frame is removed when the action ends. Anything a plugin prints or throws is kept per plugin and shown in the
Workshop ("Output"), and an agent reads the same through `get_plugin_diagnostics`, which makes "write, check, repair" a loop.

### The sandbox and the capability API

The frame is `sandbox="allow-scripts"` **without** `allow-same-origin`: an opaque origin, so no access to the viewer's DOM, cookies,
`localStorage` or IndexedDB; no popups, no forms, no top navigation. It loads `/_malleable/sandbox.html`, which the server serves
with a CSP header (`SANDBOX_CSP`, `src/shared/sandbox-runtime.ts`): `default-src 'none'`, `connect-src 'none'`, `img-src 'none'`,
`frame-src 'none'`, `form-action 'none'`, `script-src 'unsafe-inline'` (the plugin source is appended as an inline script; **no
eval**). The viewer page itself, when the flag is on, carries `frame-src 'self' blob: data:`, so a plugin that navigates its own
frame to an outside URL (smuggling data in the URL) is refused by the browser, and the viewer also removes a frame that
navigates. The CSP is a header, not a `<meta>`, so plugin code cannot remove it.

What a plugin can use is a short list, declared in the manifest:

| Capability | Tier | What `ctx` gets |
| --- | --- | --- |
| `replay:read` | read-only | `ctx.replay`: a *copy* of `{ meta, steps, console, network, performance?, context? }`. rrweb events are not included. |
| `playback:seek` | read-only | `ctx.seek(ms)` |
| `comments:read` | read-only | `ctx.comments.list()` |
| `notify` | read-only | `ctx.notify(text)` (a toast) |
| `comments:write` | **write** | `ctx.comments.add({ body, at? })`, in the person's name |
| `export:download` | **write** | `ctx.download(name, mime, text)` (≤ 2 MB) |

Always available: `ctx.theme`, `ctx.getTime()`, `ctx.onTime(fn)`, and the viewer's colour tokens as CSS variables in the frame.
Calls go over a `MessagePort`; `broker.ts` is the only code that acts on them. A capability that is not declared is refused
whatever the code does (`permission-denied`). A **write** capability also needs the person's yes, in a prompt that names the
plugin, says what will happen and shows the text verbatim ("Deny", "Allow this once", "Allow until I reload"). Nothing is
remembered across a reload, and a grant lapses if the plugin's source changes (so an agent cannot get a yes for one program and
swap in another). Inputs are validated and size-limited in the broker.

### Storage, versions, approval

Saved plugins live on the same storage interface as everything else (`src/server/storage/`, so any driver), one object per plugin:
`_malleable/u/<hash of identity>/<id>.json` for a person's own, `_malleable/w/<id>.json` for the workspace's. The object is the
plugin's whole **history** (`docs/formats/user-plugin-history.schema.json`): every approved version with its note, author, time,
manifest, source and a sha256. Nothing is rewritten:

- **Versioned.** A save appends a version; a save from a stale tab is a `409` naming the current version (storage-level `ifVersion`
  as well, so replicas cannot lose each other's saves). The last 100 versions are kept.
- **Diffable.** The Workshop's *History* pane diffs any version against the working copy (`src/shared/line-diff.ts`), and the keep
  dialog diffs the working copy against the last saved version.
- **Revertable.** *Revert to vN* loads that version's content as the working copy and opens the keep dialog; approving appends it
  as a new version ("Revert to v1"), so a revert is itself in the history and can be reverted.
- **Shareable as files.** *Export file* (optionally with versions) and *Import* use `*.replays-plugin.json`. An imported file is a
  draft; the importer approves it like anything else.
- **Per user or workspace.** The person chooses on first save ("Only me" / "Everyone in this workspace"). User plugins are private
  (the key is derived from the identity; the list and read routes only look under the caller's key). Workspace plugins load for
  everyone signed in; see [the residual risk](#residual-risks).

**Nothing persists without explicit approval.** The server refuses `PUT`/`DELETE` on a plugin without a one-use **approval token**
(`POST /api/malleable/approvals`) that is bound to the person, the action and the *exact manifest and source* they were shown (a
sha256 of them), and expires in two minutes. The viewer asks for a token only from the keep dialog's *Approve & save* button
(`manager.saveApproved`). Consequences, all tested: a token for one source cannot save another; a token is spent by use or by a
failed attempt; another person cannot use it; an agent on the bridge has no route to the approvals endpoint at all (see below).

## What it builds on (PR #2's extension points)

| PR #2 extension point | Used for | Path |
| --- | --- | --- |
| `definePlugin` + `PluginApi.onRequest` (pre-auth and post-auth phases) | The malleable server half is a built-in plugin named `malleable` (reserved like `comments`): post-auth routes for plugins, approvals and the bridge's page side; **pre-auth** for the sandbox page (static, no data) and the agent's bearer-token call. | `src/server/malleable-plugin.ts`, `src/server/app.ts` |
| Built-in-plugin pattern (`comments`) and `GET /api/config` `plugins` | Same shape: loaded only when its flag is on, so "off" means absent (no routes, no UI). `GET /api/config` shows `beta.malleable` and lists `malleable` when loaded. | `src/server/app.ts`, `src/server/comments-plugin.ts` |
| Config keys, `beta` flags, env-over-file precedence | `beta.malleable` / `REPLAYS_BETA_MALLEABLE` next to `beta.editor`. | `src/server/beta.ts`, `src/server/config.ts` |
| Browser plugin API (`ViewerRegistry`, inspector tabs / actions / panels) | User plugins register through it, so they look like any other plugin. Extended with `replacePlugin`/`removePlugin` and a quiet registration mode (additive; existing plugins are unaffected). | `src/client/plugins/registry.ts` |
| `ViewerPluginContext` (`replay`, `getTime`, `onTime`, `seek`, `notify`) | The base of the sandbox's `ctx`, but *marshalled* over a port rather than handed over: user code never holds a reference to the page. | `src/client/plugins/PluginUi.tsx`, `src/client/malleable/sandbox.ts` |
| Storage interface (`ObjectStorage`, `ifVersion`, `createOnly`) | The plugin history objects, with optimistic concurrency. | `src/server/malleable-store.ts` |
| `Identity` from the auth adapter | The user scope key and the "by" on each version; the bridge token is tied to it. | `src/server/auth/types.ts` |
| `startServer` | Creates and closes the bridge hub so open streams do not hold the server up. | `src/server/start.ts` |

What it deliberately does **not** use: `api.client({ script })`, which loads a *server-supplied* ES module into the page with full
privileges. That is right for a deployment's own code and wrong for user code, hence a separate, sandboxed path. The React feature
registry (`features.tsx`) is also not for user code; it is for code in this repository.

## The agent bridge

Two doors to the same tools: **in the page** (WebMCP) and **outside it** (an MCP server). The tool list is one array
(`src/shared/malleable-tools.ts`); both doors call the same handlers (`src/client/malleable/tools.ts`).

| Tool | What it does | `readOnlyHint` |
| --- | --- | --- |
| `get_app_state` | Route, open replay (id, title, counts incl. failed requests and console errors), playhead, selected tab, plugin tab keys, plugins with saved/unsaved state | yes |
| `get_replay_data` | One part of the replay (`meta`, `steps`, `console`, `network`, `performance`, `context`), paged; marked `untrustedContentHint` | yes |
| `get_comments` | The comments, `untrustedContentHint` | yes |
| `get_plugin_api` | The manifest, `replays.*` and `ctx` reference the agent writes against, plus this deployment's theme tokens, [policy](#the-hosts-policy), versions and the surfaces in the viewer (by surface id), so what it writes fits the distribution | yes |
| `list_plugins`, `get_plugin` | Plugins and their saved versions | yes |
| `get_plugin_diagnostics` | What a plugin printed and threw since its last load (`untrustedContentHint`) | yes |
| `install_plugin_draft` | Validate and hot-load a draft (same id = reload). `consequentialHint` | no |
| `remove_plugin_draft`, `open_tab`, `seek` | Unload a draft, bring a tab forward, move the playhead | no |
| `request_keep` | Open the approval dialog for a plugin. The person decides. `consequentialHint` | no |

There is **no** tool that saves, deletes, grants a permission or approves anything, and a test asserts that none is ever added by
name (`test/malleable.test.ts`). The agent's worst case is a draft in a sandbox that can read the replay the person already has
open, and a dialog the person may close.

### In-page (WebMCP)

On load (flag on), `installWebMcp()` (`src/client/malleable/webmcp.ts`) registers every tool with `document.modelContext`, falling
back to `navigator.modelContext` if that is where a browser exposes it. Where neither exists, it installs a small stand-in with the
same shape (`registerTool`, `getTools`, `executeTool`, `ontoolchange`), flagged `polyfill: true`, so the tools and handlers are
identical on every browser and a native implementation takes over without changes. The stand-in is not a full implementation of
the draft (no cross-origin `exposedTo`, native descriptor identity or full schema validation; `executeTool` accepts object or JSON-string arguments and returns JSON as a string). The workshop's *Agent* pane says which one is
active. An in-browser agent works in the person's own session: it can only do what the handlers do.

### Out of the page (MCP server)

```
agent ──stdio JSON-RPC──► replays mcp ──HTTPS + bearer──► replays server ──SSE──► the viewer tab
                           (src/mcp/)                      bridge hub              (answers with the same handlers)
```

1. The person clicks **Connect an agent** in the Workshop's *Agent* pane. The tab asks the server for a **bridge token**
   (`rb_…`, random, in memory, tied to the person, 8 h at most, ≤ 4 per person) and opens an event stream for it.
2. The pane shows the token and the command: `REPLAYS_URL=… REPLAYS_BRIDGE_TOKEN=rb_… replays mcp`. The agent's configuration
   runs that command (stdio).
3. A `tools/call` becomes `POST /api/malleable/bridge/call` with `Authorization: Bearer rb_…`; the hub forwards it to *that* tab and
   returns the tab's answer (30 s timeout, ≤ 16 in flight).
4. **Disconnect**, closing the tab, or expiry revokes the token. The pane lists every call the agent made.

The token is not a session: it opens the one call route and nothing else (tested against `/api/replays`, `/api/me` and the plugin
routes), so an agent holding it cannot call the approvals endpoint, save, or read anything the tab does not hand it. The server never
sees the agent's model or key; no component here calls an LLM.

## Data as the stable core

Everything a tool or plugin may rely on is a documented JSON document with a JSON Schema in [`docs/formats/`](formats/):

| Format | Schema | Where it lives | Notes |
| --- | --- | --- | --- |
| Replay bundle | [`replay.schema.json`](formats/replay.schema.json) | `<id>/replay.json`, `POST /api/replays` | rrweb events plus steps, console, network, performance, context |
| Context block | [`context.schema.json`](formats/context.schema.json) | `replay.context` | runner-supplied metadata |
| Comments | [`comments.schema.json`](formats/comments.schema.json) | `<id>/comments.json` | times on the *source* timeline |
| Edits (beta editor) | [`edits.schema.json`](formats/edits.schema.json) | `<id>/edits.json` | non-destructive; original timeline |
| Plugin manifest / file | [`plugin-manifest.schema.json`](formats/plugin-manifest.schema.json), [`user-plugin.schema.json`](formats/user-plugin.schema.json) | `*.replays-plugin.json` | shareable |
| Plugin history | [`user-plugin-history.schema.json`](formats/user-plugin-history.schema.json) | `_malleable/…` | every approved version |

`test/formats.test.ts` validates the sample replays, comments and edit lists in the shapes the app writes, the shipped example
plugins and a history written by the real store against these schemas, so the schemas cannot drift from the code unnoticed. Plugins
get a *copy* of the replay and no way to rewrite it; their only writes are comments (through the same API and rate limits as the UI)
and a download. Formats are versioned (`version`, `format`); changes are additive, or bump the version and keep reading the old one
([api-stability.md](api-stability.md)). The schemas describe the shape; the server still enforces sizes and the privacy pass.

## The host's policy

A deployment that turns user plugins on may narrow them, in the config file (no environment variables; `MalleableConfig` from
`@hazem3500/replays/config`, validated by `parseMalleablePolicy` in `src/shared/malleable-policy.ts`):

```ts
malleable: {
  enabled: true,                                                          // = beta.malleable
  scopes: ['user'],                                                       // where plugins may be kept (default: both)
  capabilities: { 'comments:write': 'ask', 'export:download': 'deny' },   // allow | ask | deny per capability
  lockedSurfaces: ['inspector:context'],                                  // user plugins cannot replace or hide these
},
distribution: { name: 'acme-replays', version: '2.3.0' },                 // what this deployment is (see Upgrades)
```

**The host can only narrow.** With no block, both scopes are on, the read-only capabilities are `allow` and the write ones `ask`
(what the sections above describe). A read-only capability may be set to `ask` (the person is prompted, like for a write) or `deny`;
a write capability (`comments:write`, `export:download`) may be `ask` or `deny`, and `allow` is refused **at start** with an error that
says why: a write always shows the person what it is about to do. Unknown keys, capabilities, scopes and malformed surface ids stop
the server too. **Backward compatibility:** `beta.malleable` and `REPLAYS_BETA_MALLEABLE` keep working unchanged; `malleable.enabled`
is the same switch in the new block. If the file sets both and they disagree the server does not start; the environment variable
still wins over both. A `malleable` block without `enabled` sets the policy and leaves the feature off.

| Where | What the policy does |
| --- | --- |
| Server (`src/server/malleable-plugin.ts`) | Refuses (`403`, "not kept: …") to mint an approval for, or to store, a plugin whose manifest declares a denied capability or whose scope is turned off. A turned-off scope is not listed, so its plugins do not load; they stay in storage untouched and come back when the scope is turned on. |
| Broker (`src/client/malleable/broker.ts`) | A denied capability fails with `permission-denied: this server does not allow …` and never prompts; `ask` on a read-only one prompts. `replay:read` is checked before the frame gets its copy. Until the policy has loaded, calls wait; if it cannot be read, writes are denied. Plugins already kept that declare a capability the host later denied still load: that capability just fails. |
| Workshop | "This server's rules for plugins" lists the scopes, every capability's rule, the locked surfaces and the versions. The keep dialog marks a denied capability, offers only the allowed scopes and disables *Approve* with the reason. |
| `GET /api/config` | `malleable` (the resolved policy, only when the feature is on), `core` and `distribution`. |
| Agents | `get_plugin_api` returns the policy, so an agent leaves denied capabilities out. |

**Surfaces and `lockedSurfaces`.** A surface id names something in the viewer: a built-in inspector tab `inspector:<tab>`
(`console`, `network`, `performance`, `context`) and a host plugin's contributions `inspector:<plugin>:<tab>`,
`panel:<plugin>:<id>` and `action:<plugin>:<id>`. What user plugins can do today: **add** tabs, panels and actions under their own
name, and nothing else. The manifest has no `replaces` or `hides` field (unknown fields are refused), the registry keeps every
registration in its owner's namespace, and a user plugin registers as `user:<id>` (keys `plugin:user:<id>:<contribution>`). Host
plugin names cannot contain `:`, so a user plugin can neither collide with a host plugin nor remove one's registrations; before this
change a user plugin `x` registered as `user-x` and could have taken over the registrations of a host plugin named `user-x`. So
`lockedSurfaces` has nothing to refuse yet: it is validated, exposed and shown, and `assertMayOverride(policy, surface)` is the check
any future override path (a `replaces`, a "hide this tab", reordering) must call. A user plugin's own surfaces cannot be locked.

## Upgrades

The upgrade contract for user plugins, adapted from Powermove's: a host upgrade never disables, deletes or rewrites a person's
plugins; it may point out the ones to look at.

- **`targets`.** Every kept version's manifest records the versions it was kept under, `targets: { core, distribution? }`: `core` is
  this package's version, `distribution` the config's `distribution` as `name@version`. The server writes it on save from its own
  values (a client's `targets` is replaced), so it is the truth about where a version was approved. It is additive in
  [`plugin-manifest.schema.json`](formats/plugin-manifest.schema.json); the workshop's working copy leaves it out, so it is never a
  "change" to keep.
- **Load health.** The viewer records, per (core, distribution) pair and per saved plugin version (by its sha256), whether it loaded:
  registered fine, or failed (registration threw, or the frame reported an error). It lives in this browser's `localStorage`
  (`replays-malleable-health`, the last six pairs); `src/client/malleable/health.ts`. Drafts and unsaved changes are not recorded.
- **The notice.** A saved plugin that failed under the current versions, when the versions changed since it was kept (its `targets`
  differ) or since it last loaded fine in this browser, is listed in the workshop under **Review plugins**, with a link to open it and
  its output. It stays on and unchanged; *Dismiss* hides the notice for those failures until a new version or another upgrade. A plugin
  that is broken under the versions it was kept under gets no notice: that is a bug, shown in its output as before.

## Security and threat model

**Assets.** The replay content (it can hold whatever the recorded page showed: the privacy pass redacts known secrets but not
everything), the person's identity and session, the workspace's other people, and the integrity of the viewer's UI.

**Actors.** (a) the person; (b) an author of a plugin (the person, a colleague, an agent, a file from the internet) who must be
treated as hostile; (c) an agent; (d) a recorded page or a commenter whose text ends up in front of an agent (prompt injection);
(e) another signed-in user of the same workspace.

**Trust boundaries.** The viewer page is trusted. A plugin frame is not. The agent is not (it may be steered by replay content).
The server trusts the auth adapter's identity and the approval token.

| Threat | Mitigation | Evidence |
| --- | --- | --- |
| Plugin sends data out (fetch, XHR, WebSocket, EventSource, image/beacon, form post, popup, navigation) | Opaque-origin sandbox; CSP header `default-src 'none'` and friends; sandbox flags without popups/forms/top-navigation; viewer page `frame-src 'self' blob: data:` against self-navigation; frame removed if it navigates | e2e `sandbox: no network, no page access…` runs a plugin that tries each of these against a canary server and asserts the canary received **nothing** |
| Plugin reads the viewer's DOM, cookies, storage, credentials | Opaque origin (no `allow-same-origin`); no capability exposes them; the replay is passed as a copy | same test: `window.parent.document`, `top.document.cookie`, `document.cookie`, `localStorage`, `indexedDB` all throw |
| Plugin runs code it was not given (`eval`) | CSP has no `unsafe-eval` | same test |
| Plugin uses a capability it did not declare | Broker refuses (`permission-denied`) before anything else | same test (comments, download, seek) |
| Plugin writes (comments, downloads) without the person knowing | Write capabilities ask each time, with the exact content; nothing remembered across reloads; grant lapses when the source changes; Deny means nothing is written | e2e `writes need the person's yes…` checks the API after Deny and after Allow |
| Something persists without consent (a plugin, a version, a deletion) | Approval token bound to person + action + exact content, single use, 2 min; the viewer mints one only from the keep dialog | `test/malleable.test.ts` (no token, forged, swapped content, reused, other user) and e2e `nothing is stored without approval…` |
| Agent saves or approves | No such tool; the bridge token opens one route only; approvals and saves need the person's session | `test/malleable.test.ts`, e2e agent test |
| Agent reads another person's tab | Token tied to the person who paired it; only they can attach the stream or answer | `test/malleable.test.ts` |
| Prompt injection through replay content (URLs, console text, comments) steering the agent | Tools carry `untrustedContentHint`; the MCP server's instructions say so; the agent's powers are bounded as above, so even a steered agent can only install a sandboxed draft and ask | design; not testable without a model |
| Stale tab overwrites a newer version | `baseVersion` check (409) plus storage `ifVersion` | `test/malleable.test.ts` |
| A user plugin of one person is read by another | Per-identity keys; list and read routes look only under the caller's key | `test/malleable.test.ts` |
| The host wants less than the defaults (no workspace plugins, no downloads) | `malleable` policy: refused by the server on keep, by the broker on use, shown before approval; widening (`allow` for a write) stops the server at start | `test/malleable-policy.test.ts`, e2e `malleable-policy.spec.ts` |
| A user plugin takes over a host plugin's surfaces | User plugins register as `user:<id>`; host names have no `:`; the registry refuses any other owner name | `test/malleable-policy.test.ts` |
| Flag off still exposes something | Absent plugin: 404s, no CSP header, no meta, no tools, code never requested | e2e `malleable-flag-off.spec.ts`, `test/malleable.test.ts` |

### Residual risks

- **A plugin can burn CPU or memory in its frame** (a loop, a huge DOM). It is contained to the frame, removed on navigation or when
  its tab closes, and actions stop after 60 s, but a tight loop can still slow the tab until the frame is closed (a sandboxed
  opaque-origin frame is usually out-of-process, which is not guaranteed). A worker-based runner with a hard kill is the next step.
- **Workshop writes are not role-gated.** `Identity` has no roles, so with `AUTH_MODE=none` or any adapter that admits many people,
  anyone who can open the viewer can save a **workspace** plugin that then loads for everyone. It still runs sandboxed with only the
  permissions its manifest declares, and any write asks the *viewer* first, but a malicious workspace plugin can try to talk someone
  into a "wants to add a comment in your name" prompt. Keep the workspace scope for trusted deployments, or give the auth adapter a
  role and gate `scope: workspace` on it (a small change in `malleable-plugin.ts`), or turn the workspace scope off with
  `malleable.scopes: ['user']`. The prompt names the plugin and shows the text.
- **Read access is real access.** A plugin with `replay:read` sees the replay's console and network text, so a malicious plugin can
  *display* it misleadingly, though it cannot send it anywhere. The URL privacy pass still applies to what is stored; it is not a
  data-loss-prevention system.
- **Side channels** (timing, resource-usage fingerprinting between frames, Spectre-class leaks) are out of scope; the isolation is the
  browser's.
- **Browser bugs.** The boundary is the browser's sandbox and CSP. A browser that mishandles `sandbox` or CSP defeats it.
- **A compromised viewer page** (XSS) can mint approvals. That is the page being the trust root; the existing app-wide protections
  (same-origin checks, sanitising) apply.
- **The bridge token travels in a command line / environment** on the person's machine. It is short-lived and tab-bound but visible to
  other local processes of that user; Disconnect revokes it.
- **No audit log beyond server logs** (`malleable: user plugin <id> saved as version N by <name>`) and each version's author/time.

## Worked examples

All four plugin files are in [`examples/malleable/`](../examples/malleable/) and load through *Import*. The first is the end-to-end demo.

### 1. "Add a tab that groups failed requests by endpoint" (agent-built)

*Screenshots: [`editor-desktop.png`](screenshots/malleable/editor-desktop.png), [`agent-tab-desktop.png`](screenshots/malleable/agent-tab-desktop.png), [`keep-dialog-desktop.png`](screenshots/malleable/keep-dialog-desktop.png), [`agent-flow.webm`](screenshots/malleable/agent-flow.webm).*

1. The person opens a replay and **Plugin workshop → Agent → Connect an agent**, and gives the agent the command shown.
2. The agent calls `get_app_state` (sees 6 failed requests), `get_plugin_api`, and `get_replay_data { part: "network" }` (sees
   `GET /api/coupons/SPRING10` → 404, `POST /api/orders` → 500 …).
3. It writes the plugin ([`failed-by-endpoint.replays-plugin.json`](../examples/malleable/failed-by-endpoint.replays-plugin.json)):
   permissions `replay:read` and `playback:seek`, one tab, a source that normalises ids in paths (`/coupons/SPRING10` →
   `/coupons/:id`), groups by `METHOD path`, and renders a table with a button per group that seeks to its first failure.
4. `install_plugin_draft` loads it: a **Failed** tab appears next to Console and Network. `get_plugin_diagnostics` shows no
   errors. `open_tab` brings it forward.
5. The agent calls `request_keep`. The keep dialog opens: *Written by an agent*, what it can do, the full source. The person edits
   the title in the Workshop, then approves: version 1 is stored and the tab is there on the next visit, with no agent connected.

Covered by the e2e test `an agent, through the MCP server, builds "failed requests by endpoint"; the person keeps it`, which uses a
**scripted agent** (`e2e/fake-agent.ts`): a real MCP client that starts `replays mcp` over stdio and speaks JSON-RPC to it, with a fixed
function standing in for the model. No LLM and no API key are involved anywhere in CI.

### 2. "Auto-comment every console error" (permission prompt)

[`comment-every-console-error.replays-plugin.json`](../examples/malleable/comment-every-console-error.replays-plugin.json): an action
with `replay:read` and `comments:write`. Choosing it from the **More** menu runs it; the first `ctx.comments.add` stops at a prompt
(*"Comment every console error" wants to add a comment at 7.2 s, in your name* + the text; screenshot
[`permission-prompt-desktop.png`](screenshots/malleable/permission-prompt-desktop.png)). **Deny** writes nothing; **Allow until I
reload** lets the rest through. Triggering it automatically on every replay open is a [gap](#gaps-and-what-is-not-built): it is
deliberately a click, not a background job.

### 3. A comment template

[`bug-report-comment.replays-plugin.json`](../examples/malleable/bug-report-comment.replays-plugin.json): one action that, at the
playhead, composes a comment from the current step, console errors within two seconds, and "Expected / Actual" lines. Author it by
editing the source in the Workshop; it hot-reloads on each keystroke. Tested together with example 4.

### 4. An export format

[`network-csv.replays-plugin.json`](../examples/malleable/network-csv.replays-plugin.json): an action with `replay:read` and
`export:download` that turns the network log into a CSV and offers it. The download prompt says the file name and size and previews the
start of the file; a "no" downloads nothing.

### 5. Share, tweak, revert

Export a plugin (*Share → Export file*), send it; a colleague imports it (a draft; they approve it themselves), changes a line, keeps
it as version 2 with a note, finds the change was wrong, opens *History*, diffs version 1 against the working copy and *Revert to v1…*;
approving appends v3 with v1's content. Covered by the e2e tests for versions/revert and for the file round trip.

## Gaps and what is not built

- **Saved views and filters** (rung 2) are designed above and not built; today the "configure" rung is switching plugins off per
  device, theming and the remembered inspector layout.
- **Marker types on the seek bar, comment *templates as a first-class UI*, export *formats* in the Download menu**: possible today
  only as actions (examples 3 and 4). Contribution points for the seek bar (`contributes.markers`) and for the export menu would be
  new registry kinds in `ViewerRegistry` plus broker methods (`ctx.markers.set`).
- **Automatic triggers** (run on replay open, on a new comment) and background plugins: not built; every run is a person's click or an
  open tab.
- **No plugin-to-plugin sharing of state** and no storage for a plugin's own settings; a plugin is stateless between loads. A small
  `ctx.settings` (stored per plugin, per person, in the same versioned store) is the obvious next capability.
- **Workspace scope has no roles** (see [residual risks](#residual-risks)); no review step for a plugin another person wrote beyond the
  keep dialog the *author* sees. A "new workspace plugin from X" banner on first load is the natural addition.
- **Frame cost.** A frame per open tab/panel; a shared worker would be cheaper and killable. Not needed at this scale.
- **Streamable HTTP MCP transport**, MCP resources/prompts and authenticated remote agents are not implemented (stdio only, one tab per token).
- **WebMCP remains experimental.** Native registration/calls and the real Agent-Native client are covered by [the optional host integration](../examples/agent-native/README.md); cross-browser and external-agent-product compatibility are not conformance claims. See [the evaluated adoption design](agent-native-adoption.md).
- **Core UI modification** (changing the header, the player) is not a plugin surface; the registry only has tabs, panels and actions,
  the "authorised ways" Willison warns about. Widening it is a deliberate, versioned act (`PLUGIN_API_VERSION`).
- **Source editor** is a textarea (no syntax highlighting or type hints); the `get_plugin_api` text is the reference.
- **Plugin tests**: no harness for plugin authors to run a plugin against a fixture replay outside the browser. A `replays plugin check` that
  loads a file in Playwright and prints its output is straightforward on the pieces here.

## Trying it

```sh
REPLAYS_BETA_MALLEABLE=true pnpm dev            # the viewer; open a replay → More → Plugin workshop
# Agent tab → Connect an agent → copy the command, e.g. in an MCP client config:
#   command: replays   args: ["mcp"]   env: { REPLAYS_URL, REPLAYS_BRIDGE_TOKEN }
pnpm test:e2e                                     # includes e2e/malleable*.spec.ts (scripted agent, no LLM)
pnpm shots:malleable                              # regenerates docs/screenshots/malleable/
```
