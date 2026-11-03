// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCompositorHero } from '../src/client/transitions/compositor-hero.ts';
import { pictureOpacity, preparePictureClip, restorePictureClips } from '../src/client/transitions/picture-clip.ts';

function scene() {
  const stack = document.createElement('span');
  stack.className = 'shuffle-window';
  const poster = document.createElement('span');
  poster.className = 'poster';
  stack.append(poster);
  const viewer = document.createElement('div');
  viewer.className = 'ct-picture';
  viewer.style.cssText = '--frame-x:0px;--frame-y:0px;--frame-w:800px;--frame-h:400px';
  document.body.append(stack, viewer);
  vi.spyOn(stack, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 220));
  vi.spyOn(poster, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 400, 200));
  vi.spyOn(viewer, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 60, 800, 400));
  return { stack, viewer };
}

function variable(side: string, property: string, name = 'vt-page-hero') {
  const content = document.querySelector(`style[data-page-hero-canvas="${name}"]`)?.textContent;
  if (!content) throw new Error('Missing hero canvas registration');
  // why: Happy DOM drops native view-transition selectors; its real declaration parser still validates the emitted geometry.
  const declaration = document.createElement('span').style;
  declaration.cssText = content.slice(content.indexOf('{') + 1, content.lastIndexOf('}'));
  return Number.parseFloat(declaration.getPropertyValue(`--page-hero-${side}-${property}`));
}

function cleanup() {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  for (const sheet of document.querySelectorAll('style[data-page-hero-canvas]')) sheet.remove();
  restorePictureClips();
  Reflect.deleteProperty(document, 'getAnimations');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

describe('compositor hero depth opacity', () => {
  afterEach(cleanup);

  it('returns each sheet to its own depth alpha without baking it into captured pixels', () => {
    const first = scene();
    const second = scene();
    first.stack.style.setProperty('opacity', '0.55', 'important');
    second.stack.style.opacity = '0';
    const poster = first.stack.querySelector<HTMLElement>('.poster');
    if (!poster) throw new Error('Missing poster');
    poster.style.opacity = '0.85';
    preparePictureClip(first.viewer);
    preparePictureClip(second.viewer);
    const chrome = createCompositorHero(first.viewer, 'vt-page-sheet-chrome');
    const firefox = createCompositorHero(second.viewer, 'vt-page-sheet-firefox');
    preparePictureClip(first.stack);
    preparePictureClip(second.stack);
    chrome.capture(first.stack);
    firefox.capture(second.stack);
    expect(first.stack.style.opacity).toBe('1');
    expect(second.stack.style.opacity).toBe('1');
    expect(poster.style.opacity).toBe('0.85');
    class GeometryEffect {
      frames: Keyframe[] = [{ transform: 'none' }, { transform: 'none' }];
      readonly pseudoElement: string;
      constructor(name: string) {
        this.pseudoElement = `::view-transition-group(${name})`;
      }
      getKeyframes() {
        return this.frames;
      }
      setKeyframes(frames: Keyframe[]) {
        this.frames = frames;
      }
    }
    vi.stubGlobal('KeyframeEffect', GeometryEffect);
    const chromeEffect = new GeometryEffect('vt-page-sheet-chrome');
    const firefoxEffect = new GeometryEffect('vt-page-sheet-firefox');
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [chromeEffect, firefoxEffect].map((effect) => ({ playState: 'running', effect })),
    });
    chrome.prepare();
    firefox.prepare();
    expect(chromeEffect.frames.map((frame) => frame.opacity)).toEqual([1, 0.55]);
    expect(firefoxEffect.frames.map((frame) => frame.opacity)).toEqual([1, 0]);
    restorePictureClips();
    chrome.clear();
    firefox.clear();
    expect(first.stack.style.opacity).toBe('0.55');
    expect(first.stack.style.getPropertyPriority('opacity')).toBe('important');
    expect(second.stack.style.opacity).toBe('0');
    expect(pictureOpacity(second.stack)).toBe(0);
  });
});

describe('compositor hero crop and corners', () => {
  afterEach(cleanup);

  it('captures square rear pixels while preserving translated media crops and unrelated descendants', () => {
    const sheet = document.createElement('span');
    sheet.className = 'card-back';
    sheet.style.cssText = 'border-radius:16px;overflow:hidden;clip-path:inset(-30px 0 0)';
    sheet.innerHTML =
      '<span class="poster back-poster" style="border-radius:inherit;overflow:hidden;contain:paint"><img style="border-radius:8px;transform:translateY(-12%)"></span><span class="page-content" style="border-radius:6px"></span>';
    document.body.append(sheet);
    const poster = sheet.querySelector<HTMLElement>('.poster');
    const image = sheet.querySelector('img');
    const content = sheet.querySelector<HTMLElement>('.page-content');
    preparePictureClip(sheet);
    expect(poster?.style.borderRadius).toBe('0px');
    expect(poster?.style.overflow).toBe('hidden');
    expect(poster?.style.contain).toBe('paint');
    expect(image?.style.borderRadius).toBe('0px');
    expect(image?.style.transform).toBe('translateY(-12%)');
    expect(sheet.style.overflow).toBe('hidden');
    expect(sheet.style.clipPath).toBe('inset(-30px 0 0)');
    expect(content?.style.borderRadius).toBe('6px');
    restorePictureClips();
    expect(sheet.style.borderRadius).toBe('16px');
    expect(poster?.style.borderRadius).toBe('inherit');
    expect(poster?.style.overflow).toBe('hidden');
    expect(image?.style.borderRadius).toBe('8px');
  });

  it('animates true rounded corners in the geometry track even when capture corners are square', () => {
    const { stack, viewer } = scene();
    const poster = stack.querySelector<HTMLElement>('.poster');
    if (!poster) throw new Error('Missing poster');
    poster.style.cssText = 'border-radius:12px 8px 0px 0px;overflow:hidden;clip-path:inset(0 round 12px);contain:paint';
    preparePictureClip(poster);
    preparePictureClip(viewer);
    expect(poster.style.borderRadius).toBe('0px');
    expect(poster.style.overflow).toBe('hidden');
    expect(poster.style.contain).toBe('paint');
    expect(poster.style.clipPath).not.toContain('round');
    const hero = createCompositorHero(poster);
    hero.capture(viewer);
    class GeometryEffect {
      pseudoElement = '::view-transition-group(vt-page-hero)';
      frames: Keyframe[] = [{ transform: 'none' }, { transform: 'none' }];
      getKeyframes() {
        return this.frames;
      }
      setKeyframes(frames: Keyframe[]) {
        this.frames = frames;
      }
    }
    vi.stubGlobal('KeyframeEffect', GeometryEffect);
    const effect = new GeometryEffect();
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => [{ playState: 'running', effect }] });
    hero.prepare();
    expect(effect.frames[0]?.borderTopLeftRadius).toBe('24px 24px');
    expect(effect.frames[0]?.borderTopRightRadius).toBe('16px 16px');
    expect(effect.frames[1]?.borderTopLeftRadius).toBe('0px 0px');
    restorePictureClips();
    expect(poster.style.borderRadius).toBe('12px 8px 0px 0px');
    expect(poster.style.clipPath).toBe('inset(0 round 12px)');
    expect(poster.style.contain).toBe('paint');
    hero.clear();
  });
});

describe('compositor hero front registration', () => {
  afterEach(cleanup);

  it('preserves rear headroom while aligning the opening flat snapshot with the stack front', () => {
    const { stack, viewer } = scene();
    const hero = createCompositorHero(stack);
    expect(hero.capture(viewer)).toBe(true);
    expect(variable('old', 'y')).toBe(0);
    expect(variable('old', 'height')).toBeCloseTo(440);
    expect(variable('new', 'y')).toBeCloseTo(40);
    expect(variable('new', 'height')).toBeCloseTo(400);
    expect(variable('old', 'y') + (variable('old', 'height') * 20) / 220).toBeCloseTo(variable('new', 'y'));
    hero.clear();
    expect(document.querySelector('style[data-page-hero-canvas]')).toBeNull();
  });

  it('keeps separately named sheet canvases independent during capture and cleanup', () => {
    const { stack, viewer } = scene();
    const chrome = createCompositorHero(stack, 'vt-page-sheet-chrome');
    const firefox = createCompositorHero(viewer, 'vt-page-sheet-firefox');
    chrome.capture(viewer);
    firefox.capture(stack);
    expect(variable('new', 'y', 'vt-page-sheet-chrome')).toBeCloseTo(40);
    expect(variable('new', 'y', 'vt-page-sheet-firefox')).toBe(0);
    chrome.clear();
    expect(variable('old', 'y', 'vt-page-sheet-firefox')).toBeCloseTo(40);
    firefox.clear();
    expect(document.querySelector('style[data-page-hero-canvas]')).toBeNull();
  });

  it('keeps the latest canvas registration when a superseded transition clears', () => {
    const { stack, viewer } = scene();
    const opening = createCompositorHero(stack);
    opening.capture(viewer);
    const back = createCompositorHero(viewer);
    back.capture(stack);
    opening.clear();
    expect(variable('old', 'y')).toBeCloseTo(40);
    expect(variable('new', 'y')).toBe(0);
    back.clear();
    expect(document.querySelector('style[data-page-hero-canvas]')).toBeNull();
  });

  it('registers a scaled letterboxed player using fractional CSS dimensions rather than rounded client dimensions', () => {
    const { stack, viewer } = scene();
    viewer.style.cssText = 'width:400.25px;height:240.125px;--frame-x:0px;--frame-y:20.0125px;--frame-w:400.25px;--frame-h:200.1px';
    vi.spyOn(viewer, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 20, 800.5, 480.25));
    const hero = createCompositorHero(stack);
    expect(hero.capture(viewer)).toBe(true);
    expect(variable('old', 'width')).toBeCloseTo(800.5);
    expect(variable('new', 'width')).toBeCloseTo(800.5);
    expect(variable('old', 'y') + (variable('old', 'height') * 20) / 220).toBeCloseTo(variable('new', 'y') + 40.025);
    expect(variable('new', 'height')).toBeCloseTo(480.25);
    hero.clear();
  });

  it('registers Back with viewer letterboxing and retains the complete destination stack', () => {
    const { stack, viewer } = scene();
    viewer.style.setProperty('--frame-y', '40px');
    vi.spyOn(viewer, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 20, 800, 480));
    const hero = createCompositorHero(viewer);
    expect(hero.capture(stack)).toBe(true);
    expect(variable('old', 'height')).toBeCloseTo(480);
    expect(variable('new', 'height')).toBeCloseTo(440);
    expect(variable('old', 'y') + 40).toBeCloseTo(variable('new', 'y') + (variable('new', 'height') * 20) / 220);
    hero.clear();
  });
});
