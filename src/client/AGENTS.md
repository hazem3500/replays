# Client

Read the root guide. `main.tsx` mounts `App.tsx`; `navigation.ts`/`route.ts` currently own URL transitions; `queries.ts` owns shared Query transport. The Router/DB/Start workstreams own their replacements.

- Effects belong in `src/client/hooks/` only. New components derive state or use named subscription/setup hooks. No manual memo; React Compiler handles app memoization.
- Read external state with a subscribed snapshot, not imperative getters during render.
- Compose focused views from descriptor slots; public extension contracts are in `plugins/api.ts`, mounting/registration in `plugins/registry.ts`.
- UI primitives live in `components/ui/`, with Base UI handling focus and keyboard behavior. Reuse theme tokens; do not build another dialog/menu primitive stack.
- Keep presentational components independent of data stores and routing. Prefer children or slots over forwarding many unrelated props.
- New browser code imports client/shared only. `upload/prepare.ts` has a known capture dependency; do not copy it.
- Design lead owns editor/viewer/index/settings and top-level screens; loading-state work owns skeletons; extension work owns `plugins/`. Check `docs/ownership.md` first.
- Logic tests go in `test/`; component states in `stories/`. All checks and browser execution run on your own Boat.
