import type { ReplayBundle } from '../../shared/replay.ts';
import { ReplayController } from '../player.ts';
import { SharedClock } from './clock.ts';
import { SharedPlayer } from './shared-player.ts';
import { type CompareTile, isLoaded } from './tiles.ts';

/**
 * The recordings of one comparison: a controller per recording (made once, so a tile that moves between layouts
 * keeps its player), the shared clock that drives them, and the viewer's player scoped to the focused one.
 */
export class CompareSession {
  readonly clock = new SharedClock();
  readonly player: SharedPlayer;
  private readonly controllers = new Map<string, { bundle: ReplayBundle; controller: ReplayController }>();

  /** invariant: at least one tile has loaded (the viewer waits for that before it compares). */
  constructor(tiles: readonly CompareTile[], focus: string) {
    const ready = tiles.filter(isLoaded);
    const first = ready.find((tile) => tile.id === focus) ?? ready[0];
    if (!first) throw new Error('A comparison needs a loaded recording');
    for (const tile of ready) this.clock.add(tile.id, this.controller(tile));
    this.player = new SharedPlayer(this.clock, this.controller(first));
  }

  /** The recording's player, the same one for as long as its bundle is. */
  controller(tile: { id: string; bundle: ReplayBundle }) {
    const known = this.controllers.get(tile.id);
    if (known?.bundle === tile.bundle) return known.controller;
    const controller = new ReplayController(tile.bundle);
    this.controllers.set(tile.id, { bundle: tile.bundle, controller });
    return controller;
  }

  /** The stage gained or lost recordings: the clock follows, and players already on stage carry on. */
  sync(tiles: readonly CompareTile[]) {
    const ids = new Set(tiles.map((tile) => tile.id));
    for (const id of this.controllers.keys()) {
      if (ids.has(id)) continue;
      this.clock.remove(id);
      this.controllers.delete(id);
    }
    for (const tile of tiles.filter(isLoaded)) this.clock.add(tile.id, this.controller(tile));
  }

  /** The viewer's chrome follows the focused recording once it has loaded. */
  focus(id: string) {
    const known = this.controllers.get(id);
    if (known) this.player.focus(known.controller);
  }
}
