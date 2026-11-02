# Navigation motion

## Source comparison

The requested commit `3c065d8a401d39624b4dc20479ac2663711adbd9` is not in the current Toolkit checkout's object database, and Toolkit `HEAD` does not track `src/client/navigation.ts`. I read those files from the replays repository at that commit and compared them with this checkout. The matrix records that committed snapshot; it does not independently verify Toolkit's deployed bundle.

| Motion | Committed baseline | Current implementation |
| --- | --- | --- |
| Feed card hover, poster fan, and list glides | Present in `src/client/index/feed.css` | Preserved; this change does not touch feed styles or pointer behavior |
| Icon hover/state motion | Present in the animated icon components and shared styles | Preserved |
| Panel, inspector, and suite run motion | Present; suite run swaps already use named frame/panel layers | Preserved |
| Index ↔ viewer page crossfade | Present for supported View Transitions | Preserved as the fallback when a safe frame pair is unavailable |
| Card poster → replay | Deliberately absent; a no-expand comment records the earlier broken morph workaround | A decoded, compatible poster pairs to the real player frame; on a cold route it can pair to the decoded same-poster skeleton until the player replaces it |
| Replay → originating card on All replays / Back | Absent | The visible player frame pairs back to the same decoded card poster after playback as long as that source card remains in the kept index and aspect checks pass |
| Step/edit caption label change | Toolkit uses `AnimatedText`, a whole-label blur crossfade; not Calligraph | Browser-rendered Viewer and saved Edit captions use Calligraph in a stable host; video frame export keeps its deterministic renderer |
| Settings theme action | Theme switching is owned by the topbar; no additional theme surface is needed | Removed the duplicate Appearance tab; Settings opens directly to CLI and agent guidance |

The unchanged feed and component files are not evidence that the protected deployment has the same behavior. Live deployment parity remains unverified.

## Shared-frame eligibility

`src/client/navigation.ts` measures the visible poster box, checks the decoded image's intrinsic aspect, and compares both with the replay viewport from the list summary (or the image dimensions when metadata is absent). Every comparison must stay within 16%. That admits the common 16:10 card crop to 16:9 recording frame; portrait, square, letter-fallback, unloaded, offscreen, and active-video cards use the page crossfade.

The decode gate records successful `HTMLImageElement.decode()` results from completed poster loads or pointer/keyboard intent. `complete` alone is insufficient for an async-decoding image. Navigation never waits for decoding; a resource that is not yet in that successful-decode cache keeps the page fallback. A decoded opening still is recorded in the same cache. The outgoing hero snapshot stays opaque under the incoming one; both use `object-fit: cover` as their measured rectangles interpolate, preserving picture proportions through the small admitted crop change.

Opening names the card poster before the View Transition captures the old page. Inside the update callback it clears that name, commits the route, then names the mounted `.player-frame` if the opening cover or replay content is present. On a cold route, it can name `.sk-frame` only when its poster image has already decoded; the skeleton image matches the source art, then the normal skeleton-to-player handoff proceeds. The moving snapshots crossfade their contents, so a card crop does not stretch to stand in for a different replay frame. If no compatible decoded destination exists, the route uses the page fade.

All replays and browser Back use the kept index's originating link, including when that card was initially scrolled out of view. Scroll restoration happens as part of the route update before the destination poster is measured. The reverse hero can use the active player frame after the opening cover has faded, then crossfades its captured content into the card poster while the group follows both measured rectangles. It falls back if the index remounted without that source card, the poster is absent/undecoded, or either aspect comparison is unsafe. Touch/pointer navigation leaves focus in place; a fresh keyboard intent restores focus to the originating link.

The route commit retains its existing 80 ms preparation budget. No image decode or network request is awaited for motion. `ViewTransition.skipTransition()` and the route sequence guard handle superseding navigation; names and page-transition attributes are cleared by the transition's existing completion path. Reduced motion and browsers without the API use the existing non-morph path.

A skipped update callback checks its route generation before clearing shared names, so an old callback cannot strip a newer trip's source name. Starting another route also cancels any outstanding keyboard handoff observer. Caption overlays keep a persistent host through label changes and empty intervals. Normal motion uses Calligraph; reduced motion renders immediate plain text inside that same host, avoiding the library's character layout animations. Final accessible text belongs to the overlay's single `aria-label`; visual characters are hidden from accessibility APIs. Export rendering does not import this component.

## Verification limits

Earlier rendered checks are recorded in `design-plans/polish/hill-climb-owner.md` and `.review-artifacts/hillclimb/round-2026-10-26/`. They predate the Sol handoff and exercise the local wrapper, not the protected deployed site. The Sol changes have static review only: build, typecheck, tests and phone/desktop/reduced-motion browser checks are blocked by the assigned Boat's vendor-admission hold. Exact receipts, source manifest and pending acceptance checks are in `.review-artifacts/hillclimb/sol-handoff-2026-10-26/`. No no-black-flash, no-stretch, visual-quality or deployed-parity sign-off is claimed for these bytes.
