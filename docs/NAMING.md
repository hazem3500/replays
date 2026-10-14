# Naming

"Replay Kit" is a placeholder. The product name lives in one constant (`src/shared/brand.ts`) plus `package.json`,
the README and the Dockerfile image label, so renaming is a five-minute change.

Checks run on 2026-10-14. "Likely free" for domains means no NS record and an RDAP lookup that answered 404
(not registered); it is not a reservation, and registrars can still hold premium or reserved names.

| | **tracetape** | **sessionreel** | **replaytape** |
| --- | --- | --- | --- |
| Idea | Tape of a trace: record once, replay later | A reel of a browser session | Replay, as a tape you can scrub |
| GitHub user/org | free | free | free |
| GitHub repo `<name>/<name>` | free | free | free |
| `gh search repos` | 1 related repo (`EZfan/tracetape`, 1 star, offline replay of AI-agent traces: same space, different product) | 1 unrelated-ish repo (`mandu5/sessionreel`, 0 stars, recap videos of Claude Code logs) | none |
| npm (`npm view`) | 404, free | 404, free | 404, free |
| `.dev` | likely free (no NS, RDAP 404) | likely free (no NS, RDAP 404) | likely free (no NS, RDAP 404) |
| `.io` | likely free (no NS, RDAP 404) | likely free (no NS, RDAP 404) | likely free (no NS, RDAP 404) |
| Concern | Close to an existing agent-trace project; "trace" also collides with distributed tracing vocabulary used by the optional OpenTelemetry exporter | Reads as video/recap rather than debugging | "Tape" is slightly retro, but nothing else uses it |

Also checked and rejected: `agentreel` (npm and GitHub taken, `.dev` registered), `reelkit`, `tapedeck`, `filmstrip`
(npm taken), `kinescope` (company with `.dev`/`.io`), `scrubkit` (GitHub org and `.io` taken).

Recommendation: **replaytape**, the only one with no neighbouring project at all. If the name changes, also rename
the GitHub repository (GitHub redirects the old URL), `package.json` `name`/`bin`, `src/shared/brand.ts`, the
`replay-kit-*` storage keys and cookie names (derived from `PRODUCT_SLUG`) and the Docker image label.
