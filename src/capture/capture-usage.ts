export const CAPTURE_USAGE = `Usage: replays capture --url <https-url> --output <dir> [options]
       replays capture --url <https-url> --headed --manual [--output <dir>] [options]

  --url <url>              page to open (https, or http on localhost)
  --output <dir>           empty directory for replay.json (and session.mp4)
  --steps <json|@file>     closed list of steps: click, hover, type, fill, press, wait, scroll, goto, shot
                           a selector acts on its first visible match; test one with replays probe
                           wait: {"kind":"wait","ms":500}, or until a selector reaches a state:
                           {"kind":"wait","selector":"#done","state":"visible|attached|hidden","timeout":15000}
                           (state defaults to visible, timeout to 15000 ms, at most 300000)
                           scroll: {"kind":"scroll","direction":"down","pixels":720}, or
                           {"kind":"scroll","selector":"#pricing"} to bring it into view
                           shot: {"kind":"shot","name":"after-save"} saves <output>/shots/after-save.png (a
                           lowercase name, unique in the run) and is listed under "shots" in the --json result
  --state <file>           Playwright storage state (cookies, local storage) to start signed in; the same file
                           works with --driver agent-browser. replays probe --state reads it too
  --hide <selector>        hide matching elements from the first frame, in the replay and in shots (a cookie
                           banner, a chat widget); repeatable. An invalid selector stops the capture
  --privacy <mode>         what the recording shows, the recorder's own modes: inputs-masked (default: typed
                           values hidden, page text shown), visible (typed values too; passwords and hidden
                           inputs stay masked), text-masked, interface-visible (text only where the page marks
                           data-replay-public, media blocked), masked (all text, inputs and media hidden).
                           A profile that masks text refuses a mode that shows it. A server keeps visible
                           values only for a host that allows them
  --step-pause <ms>        hold after non-wait actions, 0..10000 (config.capture.stepPauseMs, else 0);
                           --step-delay is the same flag
  --type-delay <ms>        pause between the characters of a type step, 0..1000 (default 80)
  --shot-delay <ms>        hold after a shot step, 0..10000 (default: the step pause)
  --compress-waits         play an unlabelled {"kind":"wait","ms":n} over 5 s as 2 s in the replay, captioned
                           "Waited n s, sped up here"; label a wait to keep it whole. Not with --video
  --title <text>           title shown in the viewer (default: the host name)
  --id <id>                replay id (default: <host>-<timestamp>-<random>)
  --driver <name>          playwright (default) or agent-browser
  --viewport <WxH>         default 1440x900
  --video                  also write session.mp4 (playwright driver needs ffmpeg)
  --tag <tag>              label for filtering; repeatable
  --profile <id>           why it was recorded: one of the server's profiles (GET /api/config lists them);
                           its capture defaults apply under the flags here. --purpose is its deprecated name
  --network <mode>         headers (default), off, or bodies: also keep request and response bodies (JSON,
                           text and form data only, cut at 64 KiB, secrets redacted)
  --performance            record for performance: marks the replay performance-focused (on by default, unmarked)
  --no-performance         leave out paint, long-task and interaction timings
  --person <spec>          someone related to it, role:email[:handle=value] (reviewer:ada@example.com); repeatable
  --source <p:ref>         link to the thing under test, e.g. github:owner/repo#12; repeatable
  --context-file <file>    JSON { app?, test?, sources?, fields? } from your test runner
  --context-schema <file>  JSON Schema that context.fields must satisfy (same file as the server's)
  --suite-id <id> --run-id <id>   attach the replay to a suite run
  --upload-url <url>       POST the finished replay to <server>/api/replays
  --upload                 upload to the saved default server
  --login                  explicitly start sign-in before upload
  --server <name>          use a saved server name with --upload
  --header-file <file>     JSON object of headers for the upload (e.g. Authorization)
  --headed                 show the browser window (playwright driver)
  --manual                 record what you do yourself in the headed browser instead of running steps; it
                           stops when you close the window or page, press Enter in the terminal, or send
                           SIGINT/SIGTERM (a second SIGINT aborts). Needs --headed, cannot use --steps.
                           Steps come from your clicks, form submits and page changes. Without a terminal
                           on stdin it never waits for Enter. --output defaults to ./<id>
  --max-duration <time>    with --manual, stop after this long: 90, 90s or 2m (default 3m, at most 10m)
  --json                   print the result as JSON, with no colour or spinner (the default when not at a terminal)
  --config <file>          replays.config.* whose redaction rules apply (default: REPLAYS_CONFIG, else
                           replays.config.* in the working directory)`;
