export const EDIT_USAGE = `Usage: replays edit <id|viewer-link> <command> [options]

Edit a replay on the server from the terminal: everything the web editor saves (cuts, speed-ups, zooms, blur and remove
boxes, captions, highlights, step names, trim, cursor), without a browser. Edits are non-destructive and stored beside the
replay; undo any of them by removing it. <id|viewer-link> is a replay id (saved server, see \`replays connect\`) or a viewer
link such as https://replays.example.com/r/<id>.

Look and round-trip
  show [--json]                 the edit list, numbered per kind, and the numbered step list (number, time, label)
  pull [-o edits.json]          the stored edit list (to stdout without -o)
  push <edits.json> [--force] [--dry-run]
                                replace the whole list; validated first, with a diff of what changes. Refused when the
                                server's list moved on since the file was pulled, unless --force

Change one thing (each reads, changes and saves safely; a concurrent edit by someone else is retried once)
  rename <step> "<name>"        rename a step; <step> is its number (7 or #7) or its start time (12.3s)
  rename <step> --reset         back to the automatic label
  cut --from 10s --to 18s [--label text]       skip a stretch
  cut rm <n>                    remove cut <n> of \`show\`
  cut waits [--min 2s]          cut the recorded waits (as the editor's "Remove waits"); --min skips shorter ones
  speed --from 20s --to 40s --rate 4           play a stretch faster (1 to 16; ranges must not overlap)
  speed rm <n>
  zoom --from 3s --to 6s [--rect x,y,w,h | --scale 2 --at x,y]    zoom in (scale 1.1 to 3; --rect fits the box)
  zoom rm <n>
  blur --from 3s --to 6s --rect x,y,w,h        blur a box of the page for a stretch
  remove --from 3s --to 6s --rect x,y,w,h      hide a box with a solid block (a blur you cannot see through)
  blur rm <n>  |  remove rm <n>                 the same list: numbers are those of "blur or remove regions" in \`show\`
  caption add --from 3s --to 6s "text"         a caption (at most 160 characters; captions take turns)
  caption edit <n> [--from t] [--to t] ["text"]
  caption rm <n>
  highlight add --at 14.9s ["label"]           a playback mark (not drawn into videos); --from/--to makes a period
  highlight rm <n>
  trim --from 1s --to end       keep only this stretch;  trim --reset  keeps everything
  cursor [--size 1.5] [--motion m] [--appearance a] [--color c] [--click-effect e] [--visible true|false] [--reset]
  undo                          not available: the server keeps no edit history (pull before a big change to keep a copy)

Export
  export [--speed 2] [--captions] [--full] [-o out.mp4] [--force] [--timeout 10m]
                                render the edited video on the server and download it, with progress.
                                --speed is one of 0.25 0.5 1 1.5 2 4 8; --full plays idle gaps instead of skipping them

Values
  times     12.3s  1:02.5  1500ms  1m30s  start  end        (a bare number is refused: it could be seconds or ms)
  --rect    x,y,w,h as fractions of the recorded frame; each value is 0.25, 25% or 320px (recorded viewport pixels)
  selector-based regions are not part of the edits format; use --rect

Options (every command)
  --json                print one JSON object ({"success":true,...}); no colour or progress
  --server <name>       a saved server name        --header-file <file>   JSON object of headers (host credentials)
Every command prints what changed and the viewer link (<server>/r/<id>). Saving needs the editor enabled on the server
(REPLAYS_BETA_EDITOR). Anyone who can open the replay may edit it, except renaming steps: that needs your sign-in email to
match one of the replay's people, or the admin role. Exit codes: 0 success, 1 failure, 2 usage error, 3 sign-in required, 4 sign-in refused.`;
