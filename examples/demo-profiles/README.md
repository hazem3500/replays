# Demo profile tabs

This config adds Triage, Design reviews and Walkthroughs tabs to the local preview. It uses the generated six-replay demo seed so the tabs are backed by the same data used elsewhere in the repo.

Generate the seed and its standalone walkthrough replay once, then start the preview from the repository root:

```sh
node --experimental-strip-types --no-warnings scripts/demo-seed.mjs
node examples/demo-profiles/prepare-seed.mjs
SAMPLE_DIR=demo-seed-output/sample DATA_DIR=demo-seed-output/data REPLAYS_CONFIG=examples/demo-profiles/replays.config.ts pnpm dev
```

Open <http://localhost:3000>. The API endpoints are available at `/api/config` and `/api/replays`.

The plugin infers Triage from console errors or failed requests, Design reviews from suite runs or titles/tags mentioning review or design, and Walkthroughs from error-free replays with steps. Triage is tried first, then Design reviews, then Walkthroughs, as the profile rules can overlap. The seed helper clones the signup replay into a standalone walkthrough without a `suiteRun`, so the preview has items in all three tabs while retaining the original seed and suites.

Triage captures redacted request and response bodies (`capture: { network: 'bodies' }`); Walkthroughs capture headers only. The seed follows suit: its replays carry synthetic, redacted bodies in the Network tab (the checkout's 422 `coupon_expired` response, the order, a search page cut at 64 KiB), while the walkthrough clone and the long team session are headers-only and show "Not captured".
