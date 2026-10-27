# Ownership map

One maintainer: @hazem3500. These workstream reservations prevent concurrent agents from changing the same surface; they are coordination notes, not GitHub review teams. Confirm current ownership with the integrator before editing a reserved area.

| Area | Guide | Relevant project skill | Current workstream |
| --- | --- | --- | --- |
| `src/shared/`, `docs/formats/` | [Root](../AGENTS.md) | write-a-test | Contracts; coordinate schema changes |
| `src/server/app.ts` | [Server](../src/server/AGENTS.md) | run-checks-on-boat | Start integration |
| Other server modules | [Server](../src/server/AGENTS.md) | write-a-test | Security/storage fixes; coordinate touched modules |
| `src/client/editor/`, `viewer/`, `index/`, `settings/`, top-level screens | [Client](../src/client/AGENTS.md) | split-a-god-file | Design lead |
| Skeletons/loading surfaces | [Client](../src/client/AGENTS.md) | write-a-test | Loading states |
| `src/client/navigation.ts`, `route.ts` | [Client](../src/client/AGENTS.md) | run-checks-on-boat | Router migration |
| Client data layer | [Client](../src/client/AGENTS.md) | write-a-test | TanStack DB migration |
| `src/recorder/` | [Recorder](../src/recorder/AGENTS.md) | run-checks-on-boat | Recorder kit |
| `src/plugin/`, `src/client/plugins/`, extension docs | [Host](../src/plugin/AGENTS.md), [browser](../src/client/plugins/AGENTS.md) | write-a-test | Extension platform |
| `stories/`, `.storybook/` | [Stories](../stories/AGENTS.md) | run-checks-on-boat | Storybook |
| knip, boundaries, packaging, bundle budget, lefthook | [Root](../AGENTS.md) | add-a-dependency | Quality tooling |
| Agent guides, skills, lint ratchets and custom rules | [Root](../AGENTS.md) | comment-pass, ship-a-pr | Guardrails |

Project skills live in `.claude/skills/`. CODEOWNERS maps review responsibility to Hazem; it does not transfer a reserved implementation lane.
