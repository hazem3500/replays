import type { animateView } from 'motion';

import { createCompositorHero } from './compositor-hero.ts';
import { fanLag } from './fan-out.ts';
import { heroLayers, heroSpring } from './hero-spring.ts';
import { cardPictures, namePicture, viewerPictures } from './shared-elements.ts';

function recordingName(id: string) {
  return `vt-page-sheet-${Array.from(id, (character) => character.codePointAt(0)?.toString(16) ?? '0').join('-')}`;
}

function fadeUnmatched(names: Set<string>) {
  for (const animation of document.getAnimations()) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    const { effect } = animation;
    if (!(effect instanceof KeyframeEffect) || !names.has(effect.pseudoElement ?? '')) continue;
    if (!effect.getKeyframes().some((frame) => 'opacity' in frame)) continue;
    effect.setKeyframes({ opacity: [1, 0] });
    effect.updateTiming({ duration: 120, delay: 0, easing: 'ease-out' });
  }
}

/** A recording keeps one shared identity from its precise library depth to its own comparison tile. */
export function createRecordingTransition(card: HTMLElement | undefined, returning: boolean) {
  const library = cardPictures(card, !returning);
  const ids = [...library.keys()];
  const sources = returning ? viewerPictures(ids) : library;
  const layers = [...sources].map(([id, element]) => {
    const name = recordingName(id);
    namePicture(element, name);
    return { id, name, hero: createCompositorHero(element, name, 100 - ids.indexOf(id)) };
  });
  const paired = new Set<string>();
  return {
    active: layers.length > 0,
    ids: [...sources.keys()],
    capture() {
      const destinations = returning ? cardPictures(card) : viewerPictures([...sources.keys()]);
      for (const layer of layers) {
        const element = destinations.get(layer.id);
        if (!element) continue;
        namePicture(element, layer.name);
        if (layer.hero.capture(element)) paired.add(layer.name);
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
      const flights = layers.flatMap((layer) =>
        paired.has(layer.name) ? [layer.hero.flight()].filter((flight) => flight !== undefined) : [],
      );
      const shape = { lag: fanLag(flights, returning), returning };
      const unmatched = new Set<string>();
      for (const layer of layers) {
        if (paired.has(layer.name)) layer.hero.prepare(shape);
        else unmatched.add(`::view-transition-old(${layer.name})`);
      }
      fadeUnmatched(unmatched);
    },
    clear() {
      for (const layer of layers) layer.hero.clear();
    },
  };
}
