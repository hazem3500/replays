// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'replays-ribbon-collapsed';

async function load() {
  vi.resetModules();
  return import('../src/client/viewer/ribbon-collapse.ts');
}

describe('the time ribbon collapse choice', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts expanded until the person collapses it', async () => {
    const { ribbonCollapsed } = await load();
    expect(ribbonCollapsed()).toBe(false);
  });

  it('remembers the choice for every replay', async () => {
    const first = await load();
    first.setRibbonCollapsed(true);
    expect(localStorage.getItem(KEY)).toBe('1');
    const second = await load();
    expect(second.ribbonCollapsed()).toBe(true);
    second.toggleRibbonCollapsed();
    expect(localStorage.getItem(KEY)).toBe('0');
    expect((await load()).ribbonCollapsed()).toBe(false);
  });

  it('tells subscribers once per change', async () => {
    const { setRibbonCollapsed, toggleRibbonCollapsed, subscribe } = await load();
    const listener = vi.fn<() => void>();
    const stop = subscribe(listener);
    setRibbonCollapsed(true);
    setRibbonCollapsed(true);
    toggleRibbonCollapsed();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    toggleRibbonCollapsed();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the choice for this page when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { ribbonCollapsed, setRibbonCollapsed } = await load();
    expect(ribbonCollapsed()).toBe(false);
    setRibbonCollapsed(true);
    expect(ribbonCollapsed()).toBe(true);
  });
});
