// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupText, updateText } from './text-motion.ts';

const target = () => {
  const node = document.createElement('span');
  document.body.append(node);
  return node;
};
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const animations: Animation[] = [];
const animate = vi.fn<() => Animation>(() => {
  const animation = Object.assign(new EventTarget(), { cancel: vi.fn<() => void>() }) as unknown as Animation;
  animations.push(animation);
  return animation;
});
beforeEach(() => {
  animations.length = 0;
  animate.mockClear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn<() => { matches: boolean }>(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  document.body.replaceChildren();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native recorder text motion', () => {
  it('renders synchronously, keeps shared glyph identity and animates only changed timer digits', () => {
    const node = target();
    node.style.fontVariantNumeric = 'tabular-nums';
    node.style.width = '5ch';
    updateText(node, '0:09');
    expect(node.textContent).toBe('0:09');
    expect(animate).not.toHaveBeenCalled();
    const [zero, colon] = [...node.querySelectorAll('[aria-hidden=true]')];
    updateText(node, '0:10');
    expect(node.textContent).toBe('0:10');
    expect(node.querySelectorAll('[aria-hidden=true]')[0]).toBe(zero);
    expect(node.querySelectorAll('[aria-hidden=true]')[1]).toBe(colon);
    expect(animate).toHaveBeenCalledTimes(2); // why: changed digits stay in their timer columns.
    expect(node.querySelectorAll('[aria-hidden=true]')).toHaveLength(4);
    expect(node.getAttribute('aria-label')).toBe('0:10');
    expect([...node.querySelectorAll('[data-recorder-word] > span')].every((glyph) => glyph.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
    expect(node.style.width).toBe('5ch');
    expect(node.style.fontVariantNumeric).toBe('tabular-nums');
    cleanupText(node);
  });

  it('preserves shared status glyphs and cancels old motion on rapid updates', () => {
    const node = target();
    updateText(node, 'Recording');
    const first = node.querySelector('[aria-hidden=true]');
    updateText(node, 'Recorded');
    expect(node.querySelector('[aria-hidden=true]')).toBe(first);
    expect(animate).toHaveBeenCalled();
    const pending = [...animations];
    updateText(node, 'Recording sent');
    expect(pending.every((animation) => vi.mocked(animation.cancel).mock.calls.length === 1)).toBe(true);
    expect(node.textContent).toBe('Recording sent');
    const calls = animate.mock.calls.length;
    updateText(node, 'Recording sent');
    expect(animate).toHaveBeenCalledTimes(calls);
    cleanupText(node);
  });

  it('updates as plain text for reduced motion, including a preference change during animation', () => {
    const node = target();
    updateText(node, 'Sending');
    updateText(node, 'Sent');
    const pending = [...animations];
    vi.stubGlobal(
      'matchMedia',
      vi.fn<() => { matches: boolean }>(() => ({ matches: true })),
    );
    updateText(node, 'Sent');
    expect(node.textContent).toBe('Sent');
    expect(node.children).toHaveLength(0);
    expect(pending.every((animation) => vi.mocked(animation.cancel).mock.calls.length === 1)).toBe(true);
    const calls = animate.mock.calls.length;
    updateText(node, 'Complete');
    expect(node.textContent).toBe('Complete');
    expect(animate).toHaveBeenCalledTimes(calls);
    cleanupText(node);
  });

  it('falls back synchronously without the Web Animations API', () => {
    const node = target();
    Object.defineProperty(node, 'animate', { configurable: true, value: undefined });
    updateText(node, 'Sending');
    updateText(node, 'Sent');
    expect(node.textContent).toBe('Sent');
    expect(node.children).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
    cleanupText(node);
  });

  it('releases active animations and restores host accessibility attributes on cleanup', () => {
    const node = target();
    node.setAttribute('aria-label', 'Original');
    updateText(node, 'Sending');
    updateText(node, 'Sent');
    const pending = [...animations];
    cleanupText(node);
    cleanupText(node);
    expect(node.textContent).toBe('Sent');
    expect(node.children).toHaveLength(0);
    expect(node.getAttribute('aria-label')).toBe('Original');
    expect(pending.every((animation) => vi.mocked(animation.cancel).mock.calls.length === 1)).toBe(true);
  });

  it('groups whole words so recording labels cannot wrap between individual glyphs', () => {
    const node = target();
    updateText(node, 'Recording sent');
    const words = [...node.querySelectorAll<HTMLElement>('[data-recorder-word]')];
    expect(words.map((word) => word.textContent)).toEqual(['Recording', 'sent']);
    expect(words.every((word) => word.style.display === 'inline-block' && word.style.whiteSpace === 'nowrap')).toBe(true);
    const recordingGlyph = words[0]?.querySelector('[aria-hidden=true]');
    updateText(node, 'Recording saved');
    expect(node.querySelector('[aria-hidden=true]')).toBe(recordingGlyph);
    expect(node.textContent).toBe('Recording saved');
    expect([...node.querySelectorAll('[data-recorder-word]')].map((word) => word.textContent)).toEqual(['Recording', 'saved']);
    cleanupText(node);
  });

  it('keeps emoji graphemes intact and bounds work for long custom messages', () => {
    const node = target();
    updateText(node, '👍🏽 Done');
    expect(node.querySelector('[aria-hidden=true]')?.textContent).toBe('👍🏽');
    const long = 'x'.repeat(200);
    updateText(node, long);
    const first = node.querySelector('[aria-hidden=true]');
    updateText(node, `${long}!`);
    expect(node.querySelector('[aria-hidden=true]')).toBe(first);
    expect(node.textContent).toBe(`${long}!`);
    cleanupText(node);
  });
});
