/* The elements a transition names: an in-place run swap pairs the player frame with itself. */

const named = new Set<HTMLElement>();

export function name(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLElement)) return;
  element.style.viewTransitionName = value;
  named.add(element);
}

export function unnameAll() {
  for (const element of named) element.style.viewTransitionName = '';
  named.clear();
}

export function onScreen(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}

export interface CardMatch {
  card: HTMLElement;
  link: HTMLAnchorElement;
  poster: Element | undefined;
}

/** The index card that stands for a page: the clicked link's card, else the first visible link to it. */
export function cardFor(opens: (link: HTMLAnchorElement) => boolean, clicked?: HTMLAnchorElement | null): CardMatch | undefined {
  let link = clicked?.isConnected && clicked.closest('.feed-item') && opens(clicked) ? clicked : undefined;
  link ??= [...document.querySelectorAll<HTMLAnchorElement>('.index-shell a.row-target, a.row-target')].find(
    (candidate) => opens(candidate) && onScreen(candidate),
  );
  const card = link?.closest<HTMLElement>('.feed-item');
  if (!link || !card) return undefined;
  const poster = card.querySelector('.stack-front > .poster') ?? card.querySelector(':scope > .poster');
  return { card, link, poster: poster && onScreen(poster) ? poster : undefined };
}
