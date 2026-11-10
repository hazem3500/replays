const NS = 'http://www.w3.org/2000/svg';

/** Lucide-geometry glyphs (24 unit grid, round caps) drawn in `currentColor`. */
const PATHS = {
  check: ['M20 6 9 17l-5-5'],
  alert: ['M12 8v4', 'M12 16h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  lock: ['M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  open: ['M7 17 17 7', 'M7 7h10v10'],
  shield: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z',
  ],
} as const;

export type RecorderIcon = keyof typeof PATHS;

/** A decorative inline icon; the control that holds it carries the accessible name. */
export function icon(name: RecorderIcon, className = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name} ${className}`.trim());
  for (const d of PATHS[name]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
