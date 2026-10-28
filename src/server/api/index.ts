import type { RouteDefinition } from '../http/route.ts';
import { replayMetaRoutes } from './replay-meta.ts';
import { replayRoutes } from './replays.ts';
import type { ApiServices } from './services.ts';
import { sessionRoutes } from './session.ts';
import { suiteRoutes } from './suites.ts';
import { uploadRoutes } from './uploads.ts';

export type { ApiServices } from './services.ts';

/** The core API's routes, behind authentication (app.ts runs the auth and hook phases first). */
export function coreRoutes(services: ApiServices): RouteDefinition[] {
  return [
    ...sessionRoutes(services),
    ...replayRoutes(services),
    ...replayMetaRoutes(services),
    ...uploadRoutes(services),
    ...suiteRoutes(services),
  ];
}
