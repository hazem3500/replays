import type { animateView } from 'motion';

import { createCompositorHero, type Picture, standIn } from './compositor-hero.ts';
import { fanLag } from './fan-out.ts';
import { heroLayers, heroSpring } from './hero-spring.ts';
import { cardPictures, namePicture, viewerPictures } from './shared-elements.ts';

function recordingName(id: string) {
  return `vt-page-sheet-${Array.from(id, (character) => character.codePointAt(0)?.toString(16) ?? '0').join('-')}`;
}

/** Replaces the opacity of every running snapshot layer named in `names` (`::view-transition-old(…)` and the like). */
function setLayerOpacity(names: Set<string>, opacity: number[], duration: number) {
  for (const animation of document.getAnimations()) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    const { effect } = animation;
    if (!(effect instanceof KeyframeEffect) || !names.has(effect.pseudoElement ?? '')) continue;
    if (!effect.getKeyframes().some((frame) => 'opacity' in frame)) continue;
    effect.setKeyframes({ opacity });
    effect.updateTiming({ duration, delay: 0, easing: 'ease-out' });
  }
}

/** The spring a paired picture's flight runs on, as the browser holds it once Motion has retimed it. */
function springTiming(names: readonly string[]): EffectTiming | undefined {
  const groups = new Set(names.map((name) => `::view-transition-group(${name})`));
  for (const animation of document.getAnimations()) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    const { effect } = animation;
    if (!(effect instanceof KeyframeEffect) || !groups.has(effect.pseudoElement ?? '')) continue;
    return effect.getTiming();
  }
  return undefined;
}

/** The deepest sheet the stack shows: the last of a card's pictures, which run front to back. */
const deepest = (pictures: Map<string, Element>) => [...pictures.values()].at(-1);

/**
 * A recording keeps one shared identity from its precise library depth to its own comparison tile.
 * invariant: a run past the sheets a stack shows (suite-stack.ts) still flies, from under the deepest shown sheet: it
 * leaves that sheet's box unseen beneath the stack and returns into it fading out, on the same spring as the rest.
 */
export function createRecordingTransition(card: HTMLElement | undefined, returning: boolean) {
  const library = cardPictures(card, !returning);
  const ids = [...library.keys()];
  const sources = returning ? viewerPictures(ids) : library;
  const layers = [...sources].map(([id, element]) => {
    const name = recordingName(id);
    namePicture(element, name);
    return { id, name, hero: createCompositorHero(element, name, 100 - ids.indexOf(id)) };
  });
  const extras: typeof layers = [];
  const addExtra = (id: string, element: Element | undefined, from?: Picture) => {
    const name = recordingName(id);
    namePicture(element, name);
    const layer = { id, name, hero: createCompositorHero(element, name, 100 - ids.length - extras.length, from) };
    extras.push(layer);
    return layer;
  };
  if (returning && layers.length) for (const [id, element] of viewerPictures()) if (!sources.has(id)) addExtra(id, element);
  const slot = returning || !layers.length ? undefined : standIn(deepest(library));
  const paired = new Set<string>();
  return {
    active: layers.length > 0,
    ids: [...sources.keys()],
    capture() {
      const destinations = returning ? cardPictures(card) : viewerPictures();
      for (const layer of layers) {
        const element = destinations.get(layer.id);
        if (!element) continue;
        namePicture(element, layer.name);
        if (layer.hero.capture(element)) paired.add(layer.name);
      }
      if (returning) {
        const spot = standIn(deepest(destinations));
        for (const layer of extras) if (spot && layer.hero.capture(undefined, spot)) paired.add(layer.name);
      } else if (slot) {
        for (const [id, element] of destinations) {
          if (sources.has(id)) continue;
          const layer = addExtra(id, undefined, slot);
          namePicture(element, layer.name);
          if (layer.hero.capture(element)) paired.add(layer.name);
        }
      }
      return paired.size > 0;
    },
    configure(view: ReturnType<typeof animateView>) {
      const fade = heroLayers(returning);
      view
        .add('[style*="view-transition-name: vt-page-sheet-"]')
        .group(false)
        .crop(true)
        .layout(heroSpring(returning))
        .old(fade.source.keyframes, fade.source.options)
        .new(fade.destination.keyframes, fade.destination.options)
        .exit({ opacity: [1, 0] }, { duration: 0.12 });
    },
    prepare() {
      const flying = [...layers, ...extras].filter((layer) => paired.has(layer.name));
      const flights = flying.flatMap((layer) => [layer.hero.flight()].filter((flight) => flight !== undefined));
      const shape = { lag: fanLag(flights, returning), returning };
      const unmatched = new Set<string>();
      for (const layer of layers) {
        if (paired.has(layer.name)) layer.hero.prepare(shape);
        else unmatched.add(`::view-transition-old(${layer.name})`);
      }
      setLayerOpacity(unmatched, [1, 0], 120);
      // why: an extra is in one snapshot only; its group's opacity carries the whole fade, so its picture stays opaque.
      const timing = springTiming(layers.filter((layer) => paired.has(layer.name)).map((layer) => layer.name));
      const opaque = new Set<string>();
      for (const layer of extras) {
        if (!paired.has(layer.name) || !timing) continue;
        layer.hero.prepare(shape, timing);
        opaque.add(`::view-transition-${returning ? 'old' : 'new'}(${layer.name})`);
      }
      setLayerOpacity(opaque, [1, 1], 120);
    },
    clear() {
      for (const layer of [...layers, ...extras]) layer.hero.clear();
    },
  };
}
