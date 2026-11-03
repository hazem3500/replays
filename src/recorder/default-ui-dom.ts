import { icon } from './default-ui-icons.ts';

/** A new element with `props` assigned and `children` appended. */
export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};

/** An http(s) URL resolved against the page, or undefined for any other scheme. */
export const safeHref = (value: string): string | undefined => {
  try {
    const url = new URL(value, document.baseURI);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return;
  }
};

/** A new-tab link to `href` when it is a safe http(s) URL, marked with an outward arrow. */
export const link = (label: string, href: string, className = ''): HTMLAnchorElement | undefined => {
  const safe = safeHref(href);
  return safe ? element('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', className }, [label, icon('open')]) : undefined;
};
