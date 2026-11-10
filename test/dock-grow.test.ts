import { describe, expect, it } from 'vitest';

import { growTarget } from '../src/client/hooks/dock-grow.ts';

const base = { content: 320, chrome: 48, current: 336, room: 600, viewport: 800, userSized: false };

describe('growTarget', () => {
  it('grows a short panel to what the tab needs', () => {
    expect(growTarget(base)).toBe(368);
  });
  it('never shrinks a panel that is already tall enough', () => {
    expect(growTarget({ ...base, current: 420 })).toBeUndefined();
  });
  it('caps at 60 % of the window', () => {
    expect(growTarget({ ...base, content: 900 })).toBe(480);
  });
  it('is held back by the room the player can give up', () => {
    expect(growTarget({ ...base, room: 350 })).toBe(350);
  });
  it('does nothing on a short window', () => {
    expect(growTarget({ ...base, viewport: 600 })).toBeUndefined();
  });
  it('stops once the person sized the panel', () => {
    expect(growTarget({ ...base, userSized: true })).toBeUndefined();
  });
});
