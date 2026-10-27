import type { ComparisonCoordinator } from './coordinator.ts';

export interface ScrubbablePlayer {
  beginScrub(): void;
  endScrub(): void;
}

/** The coordinator retains transport ownership; existing controllers throttle the expensive rrweb render. */
export class ComparisonScrub {
  private active = false;
  private resume = false;
  private players: ScrubbablePlayer[] = [];
  private readonly coordinator: ComparisonCoordinator;
  private readonly getPlayers: () => ScrubbablePlayer[];

  constructor(coordinator: ComparisonCoordinator, getPlayers: () => ScrubbablePlayer[]) {
    this.coordinator = coordinator;
    this.getPlayers = getPlayers;
  }

  begin() {
    if (this.active) return;
    this.active = true;
    this.resume = this.coordinator.getSnapshot().status === 'playing';
    // Pause BEFORE beginScrub so individual controllers cannot resume themselves independently.
    this.coordinator.pause();
    this.players = this.getPlayers();
    for (const player of this.players) player.beginScrub();
  }

  finish(resume = true) {
    if (!this.active) return;
    this.active = false;
    for (const player of this.players) player.endScrub();
    this.players = [];
    if (resume && this.resume) this.coordinator.play();
    this.resume = false;
  }
}
