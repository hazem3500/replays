import type { Listener, PlayerState, PlayHold } from '../playback/types.ts';

/** What the intent needs from the player on screen (a `ReplayController` is one). */
export interface IntentPlayer {
  getState(): PlayerState;
  play(): void;
  setPlayHold(hold: PlayHold | undefined): void;
}

/**
 * Whether the suite's next run should start playing once it is ready, so a play press during a run switch is never
 * lost: it is kept for the run being switched to and consumed by that run's viewer (`take`), however long its data
 * and frame take. A switch carries the intent along (the run on screen was playing, or play was already asked for),
 * and the latest switch wins: a fast A, B, C never starts A or B because only C holds the intent.
 */
export class PlayIntent {
  private wanted: string | undefined;
  private target: string | undefined;
  private screen: { run: string; player: IntentPlayer } | undefined;
  private readonly listeners = new Set<Listener>();

  /** The run that will start playing when ready, for the loading stand-in's play button. */
  readonly getWanted = () => this.wanted;

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The viewer of `run` is on screen; returns the detach for when it goes. */
  attach(run: string, player: IntentPlayer) {
    this.screen = { run, player };
    return () => {
      if (this.screen?.player !== player) return;
      player.setPlayHold(undefined);
      this.screen = undefined;
    };
  }

  /**
   * A switch to `to` begins. Playing (or asked to play) carries over to `to`; until the switch settles, the player
   * still on screen hands any play press to `to` instead of starting a run that is about to leave.
   */
  switching(to: string) {
    const shown = this.screen?.player.getState();
    const carry = this.wanted !== undefined || Boolean(shown?.status === 'playing' || shown?.starting);
    this.target = to;
    this.set(carry ? to : undefined);
    if (this.screen && this.screen.run !== to) {
      this.screen.player.setPlayHold({ request: () => this.set(this.target), cancel: () => this.set(undefined) });
    }
  }

  /** The switch landed (its run is the selected one); the outgoing player gets its play button back. */
  settled() {
    this.target = undefined;
    const shown = this.screen;
    if (!shown) return;
    shown.player.setPlayHold(undefined);
    if (this.wanted === shown.run) {
      this.set(undefined);
      shown.player.play();
    }
  }

  /** Play was pressed with no viewer to take it (the loading stand-in): it starts when `run`'s viewer is up. */
  request(run: string) {
    this.set(run);
  }

  cancel() {
    this.set(undefined);
  }

  /** True once, for the viewer of the run that was waiting to play; false for any other run. */
  take(run: string) {
    if (this.wanted !== run) return false;
    this.set(undefined);
    return true;
  }

  private set(run: string | undefined) {
    if (this.wanted === run) return;
    this.wanted = run;
    for (const listener of this.listeners) listener();
  }
}
