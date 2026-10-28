import { LayoutGridIcon, LayoutPanelLeftIcon, RectangleHorizontalIcon } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';

import { Hint } from '@/components/icon-button.tsx';
import type { CompareLayout } from './search.ts';

const LAYOUT_STRINGS = {
  group: 'Layout',
  single: 'Single',
  grid: 'Grid',
  spotlight: 'Spotlight',
  hints: {
    single: 'Single: one recording at a time',
    grid: 'Grid: every recording at once',
    spotlight: 'Spotlight: one large, the rest beside it',
  },
} as const;

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

const LAYOUTS: readonly CompareLayout[] = ['single', 'grid', 'spotlight'];
const ICONS = { single: RectangleHorizontalIcon, grid: LayoutGridIcon, spotlight: LayoutPanelLeftIcon } as const;

/** Single · Grid · Spotlight in the viewer's top bar: one radio group, icons with their names as hints, a gliding thumb. */
export function LayoutSwitch({
  value,
  onChange,
  phone,
}: {
  value: CompareLayout;
  onChange: (layout: CompareLayout) => void;
  phone: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  // why: a phone shows one tile at a time either way; its choice is one recording or swiping through them all.
  const options = phone ? LAYOUTS.filter((layout) => layout !== 'spotlight') : LAYOUTS;
  const shown = phone && value === 'spotlight' ? 'grid' : value;
  const index = options.indexOf(shown);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = ARROW_STEPS[event.key] ?? 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-layout="${next}"]`)?.focus());
  };

  return (
    <div
      ref={group}
      className="layout-switch"
      role="radiogroup"
      aria-label={LAYOUT_STRINGS.group}
      data-testid="layout-switch"
      data-index={index}
    >
      <span className="layout-switch-thumb" aria-hidden="true" />
      {options.map((option) => {
        const Icon = ICONS[option];
        return (
          <Hint key={option} label={LAYOUT_STRINGS.hints[option]} side="bottom">
            <button
              type="button"
              role="radio"
              data-layout={option}
              aria-checked={option === shown}
              aria-label={LAYOUT_STRINGS[option]}
              tabIndex={option === shown ? 0 : -1}
              onClick={() => onChange(option)}
              onKeyDown={onKeyDown}
            >
              <Icon aria-hidden="true" />
            </button>
          </Hint>
        );
      })}
    </div>
  );
}
