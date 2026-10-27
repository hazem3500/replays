---
name: comment-pass
description: Review Replays comments in one owned area and tag reasons or delete narration.
---

Read AGENTS.md and docs/ownership.md. Perform a comment pass only in the requested, unreserved area, after planned splits. Read surrounding logic before classifying a comment.

Delete narration of what readable code already says. Rename or extract confusing code where that removes the need for explanation. Preserve a real reason or invariant with why: or invariant:. Keep declaration TSDoc that explains a contract; remove trivial name restatements. Preserve license headers and necessary tool directives; lint disables require -- why:.

Do not mechanically add tags to every comment. Keep behavior unchanged and avoid sweeping formatting. Run the comment/lint reports available in package.json on the session's Boat, compare per-file baseline counts and lower cleaned entries. Never raise a baseline to conceal new debt. Review that browser quirks, security intent and runtime constraints remain understandable.
