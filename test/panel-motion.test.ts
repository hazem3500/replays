// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { animatePanelLayout, cancelPanelMotion } from '../src/client/lib/panel-motion.ts';

describe('panel layout motion handoff', () => {
  let panel: HTMLDivElement;
  beforeEach(() => {
    panel = document.createElement('div');
    panel.style.gridTemplateColumns = '200px 0px 800px';
    document.body.append(panel);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => {
    cancelPanelMotion(panel);
    panel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('cancels a queued fold without restoring stale geometry over the direct resize', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    animatePanelLayout(panel, 'columns');
    panel.style.gridTemplateColumns = '48px 0px 952px';
    cancelPanelMotion(panel);
    expect(cancel).toHaveBeenCalledWith(17);
    expect(panel.style.gridTemplateColumns).toBe('48px 0px 952px');
    expect(panel.hasAttribute('data-panel-sizing')).toBe(false);
  });

  it('does not schedule layout motion under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    animatePanelLayout(panel, 'columns');
    expect(frame).not.toHaveBeenCalled();
    expect(panel.style.gridTemplateColumns).toBe('200px 0px 800px');
  });
});
