/* invariant: Viewer.tsx still imports this name while #105 (compare in viewer) rewrites it; the views PR moves
   Viewer to replayProfile and deletes this file. */
export { replayProfile as replayPurpose } from './profiles.ts';
