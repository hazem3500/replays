# Client routing

The viewer's pages are TanStack Router file routes. The shape is the one TanStack Start expects, so a later move to
server rendering adds a server entry rather than another rewrite.

## Routes

| File (`src/client/routes/`) | Address | Page |
| --- | --- | --- |
| `__root.tsx` | every page | Theme, tooltips, toasts, and the kept index (`routing/KeptIndex.tsx`) beside the page's outlet. Validates `?settings=` |
| `index.tsx` | `/` | The index. Its search schema names the filters, sort and view; `x-*` plugin filters pass through |
| `r.$id.tsx` | `/r/<id>…` | Shared by playback and edit mode: validates `t` and `original`, and the compare keys (`with`, `layout`, `focus`) with `compare/compare-search.ts`, and starts the bundle and saved edits |
| `r.$id.index.tsx` | `/r/<id>` | Playback, or the comparison when `?with=` names other recordings (`pages/ReplayPage.tsx`) |
| `r.$id.edit.tsx` | `/r/<id>/edit` | Edit mode; without edit capability it is not found |
| `s.$suiteId.tsx` | `/s/<suite>…` | The suite workspace (`pages/SuitePage.tsx`), mounted across run switches |
| `s.$suiteId.index.tsx`, `s.$suiteId.r.$replayId.tsx` | `/s/<suite>`, `/s/<suite>/r/<id>` | The landing run is picked by the workspace; a named run starts its data |
| `p.$plugin.$.tsx` | `/p/<plugin>/<path>` | A plugin's page (`api.registerPluginPage`), see [extension-api.md](../extension-api.md#plugin-pages) |

Any other address renders the not-found page. The router plugin in `vite.config.ts` generates
`src/client/route-tree.gen.ts`; it is committed so typechecking and tests need no build.

## Router and context

`src/client/router.tsx` exports `getRouter()` and `createAppRouter({ queryClient, deployment, history? })`. The router
context is `{ queryClient, deployment }`: `deployment.ts` reads the base path and name from index.html's `<meta>` tags in
the browser, and a server render would pass the request's. Loaders, `beforeLoad` and search schemas never touch the DOM.
`setupRouterSsrQueryIntegration` provides the Query client to the tree.

- **Base path.** One build serves every base, chosen per host at runtime, so the router gets a `rewrite` built from
  `deployment.base` instead of `basepath` (which Start fixes at build time). `/replays/r/x` is `/r/x` to the routes.
- **Search params.** `routing/search.ts` keeps query strings as plain text (`?errors=1`, `?t=12.5`, `?with=a,b`), the
  form the CLI and agents print. Schemas in `src/shared/schemas/search.ts` (zod/mini) name
  and type the keys, and `compareSearchParams` (`compare/compare-search.ts`) cleans the compare keys the way the viewer
  reads them; keys a schema does not name pass through.
- **Loaders** start requests and code chunks and never wait, so the first render stays synchronous (`main.tsx`).
  Transport stays in `queries.ts` and the DB collections; pages read it with Query hooks.

## Navigation

- `routing/navigate.ts` routes plain left clicks on links to other pages through the router (a link to the page on
  screen stays a normal load, as before), and gives code with an href `navigate`, `setPageUrl` and `setSearch`. Every
  address change, including a viewer's `?t=` and a comparison's layout, goes through the router.
- `routing/links.ts` builds public hrefs (base included) and remembers the index's last filters for "All replays".
  `routing/index-return.ts` makes that link step back in history when the page was opened from the same list.
- `routing/KeptIndex.tsx` mounts the index the first time `/` shows and keeps it hidden in an `Activity` behind
  viewer pages, so Back finds the same list, scroll and card.
- The router owns history and scroll restoration. `transitions/page-motion.ts` overrides the router's
  `startViewTransition`: index ↔ viewer changes crossfade (`html[data-page-transition]`), a page change waits up to
  80 ms for cached data and loaded code, reduced motion and a back swipe the browser animated get none, and focus moves
  to the player (or back to the card you came from). `transitions/swap.ts` crossfades a suite's run switch in place.

## TanStack Start

`vite.start.config.ts` builds the same routes with TanStack Start into `dist/start`. `src/client/start/` holds its
entries: `router.tsx` (`getRouter()`, per request on the server with the request's deployment and a fresh Query cache,
once in the browser), `client.tsx` (hydration) and `server.ts` (the server entry; asset URLs get the request's base).
Our server calls that entry for page requests (`src/server/pages/start.ts`; `REPLAYS_SSR=0` serves the stamped index.html): it passes the request's
deployment and an in-process API call through `src/shared/page-context.ts`, and adds index.html's head to the streamed
document. The root route renders the document under Start (`import.meta.env.REPLAYS_START`). The index is rendered
on the server: its loader fills the Query cache through `api/request.ts` (in process on the server), `ReplayIndex`
starts from those lists, and `page-meta.ts` gives server code the request's `app-*` metas and cookies. The viewer,
suite, editor and plugin routes are `ssr: false`. Values only the browser knows (saved preferences, the platform, media
queries) render as the server did during hydration (`useHydrated`, `useSyncExternalStore` server snapshots), then switch.

