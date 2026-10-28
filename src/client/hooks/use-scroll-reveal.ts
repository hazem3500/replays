import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

/** Reveal a little before the item's edge shows, so its first visible frame is already part of the entrance. */
const REVEAL_MARGIN = '0px 0px 32px 0px';

/**
 * Items scrolled into view, once each: the elements under `container` matching `selector` that come into the
 * viewport (or within REVEAL_MARGIN below it) after the list appeared are passed to `onReveal`, those arriving
 * together in visual order. Elements are told apart by their `data-entry-id`, so an item a virtualized list
 * unmounts and mounts again is still the same item; each is reported at most once per `identity` (a new list:
 * another view, filter, sort or search result starts over). Elements mounted later are watched as they appear.
 * What is on screen when the list (or its identity) appears is never reported: the list's own entrance covers it.
 */
export function useScrollReveal(
  container: RefObject<HTMLElement | null>,
  selector: string,
  identity: string,
  onReveal: (elements: HTMLElement[]) => void,
) {
  const callback = useRef(onReveal);
  useLayoutEffect(() => {
    callback.current = onReveal;
  });
  const seen = useRef({ identity: '', keys: new Set<string>() });

  useEffect(() => {
    const root = container.current;
    if (!root || typeof IntersectionObserver !== 'function') return;
    if (seen.current.identity !== identity) seen.current = { identity, keys: new Set() };
    const known = seen.current.keys;
    const keyOf = (element: Element) => (element instanceof HTMLElement ? (element.dataset.entryId ?? '') : '');
    let initial = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const arriving = entries
          .filter((entry) => entry.isIntersecting && !known.has(keyOf(entry.target)))
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
        for (const entry of arriving) {
          known.add(keyOf(entry.target));
          observer.unobserve(entry.target);
        }
        // why: the first report is what is already on screen; the list's own entrance covers it.
        const elements = arriving.map((entry) => entry.target).filter((target) => target instanceof HTMLElement);
        if (!initial && elements.length > 0) callback.current(elements);
        initial = false;
      },
      { rootMargin: REVEAL_MARGIN },
    );
    const watch = (element: Element) => {
      if (!known.has(keyOf(element))) observer.observe(element);
    };
    for (const element of root.querySelectorAll(selector)) watch(element);
    const mounts = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selector)) watch(node);
          for (const element of node.querySelectorAll(selector)) watch(element);
        }
    });
    mounts.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mounts.disconnect();
    };
  }, [container, selector, identity]);
}
