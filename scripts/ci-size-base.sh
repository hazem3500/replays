#!/usr/bin/env bash
# Measure the bundle sizes of a base commit (normally main) for the size ratchet in CI.
# Turborepo caches the result by SIZE_BASE_SHA and the head's measuring scripts, so main's own CI run
# warms it and every pull request on that base replays it instead of building main again.
set -euo pipefail
: "${SIZE_BASE_SHA:?Set SIZE_BASE_SHA to the base commit to measure}"
git cat-file -e "${SIZE_BASE_SHA}^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$SIZE_BASE_SHA"
base="$(mktemp -d)/main"
mkdir -p "$base" .review-artifacts/quality
git archive "$SIZE_BASE_SHA" | tar -x -C "$base"
(
  cd "$base"
  pnpm install --frozen-lockfile --prefer-offline
  pnpm exec vp build --manifest
  pnpm build:cli
)
# why: same esbuild options on the base's sources, only to add chunk-membership metadata for stable names.
REPLAYS_BUILD_ROOT="$base" node scripts/build-lib.mjs
node scripts/quality-size.mjs --measure --root "$base" --output .review-artifacts/quality/main-bundle-sizes.json
cp "$base/budgets/bundle.json" .review-artifacts/quality/main-budgets.json
printf 'Size baseline measured on %s\n' "$SIZE_BASE_SHA"
