import { describe, expect, it, vi } from 'vitest';

import type { PlayerState, PlayHold } from '../src/client/playback/types.ts';
import { type IntentPlayer, PlayIntent } from '../src/client/suite/play-intent.ts';

/** A player shaped like the controller's play path: holds route a press to the intent, else it plays. */
function fakePlayer(initial: Partial<PlayerState> = {}) {
  let hold: PlayHold | undefined;
  const state: PlayerState = { status: 'paused', speed: 1, skipInactive: false, ...initial };
  const player: IntentPlayer & { press(): void; hold(): PlayHold | undefined } = {
    getState: () => state,
    play: vi.fn<() => void>(() => {
      if (hold) {
        hold.request();
        state.starting = true;
        return;
      }
      state.status = 'playing';
    }),
    setPlayHold: (next) => {
      hold = next;
    },
    press: () => player.play(),
    hold: () => hold,
  };
  return player;
}

describe('PlayIntent', () => {
  it('remembers a play press made on the run being left and starts the new run when its viewer is up', () => {
    const intent = new PlayIntent();
    const old = fakePlayer();
    intent.attach('a', old);
    intent.switching('b');
    old.press();
    expect(intent.getWanted()).toBe('b');
    expect(old.getState().status).toBe('paused');
    intent.settled();
    expect(intent.take('b')).toBe(true);
    expect(intent.take('b')).toBe(false);
  });

  it('carries "was playing" across a switch', () => {
    const intent = new PlayIntent();
    intent.attach('a', fakePlayer({ status: 'playing' }));
    intent.switching('b');
    expect(intent.getWanted()).toBe('b');
  });

  it('does not carry a paused run', () => {
    const intent = new PlayIntent();
    intent.attach('a', fakePlayer());
    intent.switching('b');
    expect(intent.getWanted()).toBeUndefined();
  });

  it('gives a fast switch A to B to C to the last run only', () => {
    const intent = new PlayIntent();
    const a = fakePlayer({ status: 'playing' });
    intent.attach('a', a);
    intent.switching('b');
    intent.switching('c');
    expect(intent.getWanted()).toBe('c');
    expect(intent.take('b')).toBe(false);
    expect(intent.take('a')).toBe(false);
    intent.settled();
    expect(intent.take('c')).toBe(true);
  });

  it('keeps a press made on the loading stand-in until that run takes it', () => {
    const intent = new PlayIntent();
    intent.request('b');
    const seen = vi.fn<() => void>();
    intent.subscribe(seen);
    expect(intent.getWanted()).toBe('b');
    expect(intent.take('a')).toBe(false);
    expect(intent.take('b')).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(intent.getWanted()).toBeUndefined();
  });

  it('cancels when pause is pressed while play is held', () => {
    const intent = new PlayIntent();
    const old = fakePlayer();
    intent.attach('a', old);
    intent.switching('b');
    old.press();
    old.hold()?.cancel();
    expect(intent.getWanted()).toBeUndefined();
  });

  it('plays at once when a switch lands back on the run still on screen', () => {
    const intent = new PlayIntent();
    const a = fakePlayer({ status: 'playing' });
    intent.attach('a', a);
    intent.switching('b');
    intent.switching('a');
    intent.settled();
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(intent.getWanted()).toBeUndefined();
  });

  it('gives the outgoing player its play button back once the switch settles', () => {
    const intent = new PlayIntent();
    const old = fakePlayer();
    intent.attach('a', old);
    intent.switching('b');
    expect(old.hold()).toBeDefined();
    intent.settled();
    expect(old.hold()).toBeUndefined();
  });

  it('detaches a viewer that leaves without touching a newer one', () => {
    const intent = new PlayIntent();
    const first = fakePlayer({ status: 'playing' });
    const detachFirst = intent.attach('a', first);
    const second = fakePlayer();
    intent.attach('b', second);
    detachFirst();
    intent.switching('c');
    expect(second.hold()).toBeDefined();
  });
});
