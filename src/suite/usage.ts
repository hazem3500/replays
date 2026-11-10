import { PRODUCT_SLUG } from '../shared/brand.ts';

export const SUITE_USAGE = `usage: ${PRODUCT_SLUG} suite <command> [options]

Review suites group the recordings of one review: a suite has runs, each run has a status and one replay.

  suite create --id <id> --title <text> [--profile <id>] [--source <p:ref>] [--person <role:email>]... [--summary <text|@file>]
                           register a suite (the same suite again is fine); prints <server>/s/<id>
  suite list [--mine] [--limit <n>]        the newest suites; --mine keeps those you are named on
  suite show <id>          the suite's runs with status, replay link, duration and summary
  suite summary <id> <text|@file>          set the suite's summary (plain text, at most 4000 characters)
  suite run add <suite> --run <id> --title <text> [--status running] [--summary <text|@file>]
  suite run set <suite> <run> [--status passed|failed] [--summary <text|@file>]
  suite run summary <suite> <run> <text|@file>
  suite record --plan <file> [--upload] [--only <run>]... [--dry-run] [--output <dir>]
                           record every run of a plan and finish each run: see below

Run lifecycle: running, then passed or failed. A finished run keeps its status and cannot be changed
(register a new run id instead); a suite's title, source and profile are fixed once it exists.

suite record reads a plan (docs/formats/suite-plan.schema.json, example in sample/suite-plan.json) with the suite's
id, title, profile, source, people and summary plus runs { id, title, url, steps, viewport?, expect?, summary? }.
Per run it registers the run as running, records it with the capture steps, uploads the replay to the run and marks it
passed, or failed when the recording throws, a step fails or an expectation (noConsoleErrors, noFailedRequests,
maxDurationMs) does not hold. A failed run does not stop the next one. Without --upload nothing is sent: the
recordings are kept under --output (default replays-suites/<suite>/<run>) and the plan is checked end to end.
A recording whose upload failed stays on disk and its run stays running; finish it with
  ${PRODUCT_SLUG} suite record --plan <file> --upload --only <run>
which uploads the kept recording (--rerecord discards it and captures again).

Options for record: --upload  --only <run> (repeatable)  --dry-run  --output <dir>  --rerecord  --driver <name>
  --video  --headed  --network <mode>  --config <file>  --context-file <file>  --step-pause <ms>  --tag <tag>
  --no-performance
Connection options (all commands): --server <name>  --upload-url <url>  --header-file <file>
Every command accepts --json: one object on stdout, {"success":true,...}; failures are {"success":false,"error","hint"} on stderr.`;
