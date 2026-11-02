import { LayoutGridIcon, LayoutPanelLeftIcon, RectangleHorizontalIcon } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useRef } from 'react';

import { Hint } from '@/components/icon-button.tsx';

import type { MeetingLayout } from './view-state.ts';
import './layout-switch.css';

export const LAYOUT_STRINGS = {
  group: 'Layout',
  single: 'Single',
  grid: 'Grid',
  spotlight: 'Spotlight',
  hints: {
    single: 'One recording with its diagnostics',
    grid: 'Every recording at once',
    spotlight: 'One large, the rest in a strip',
  },
} as const;

const ICONS = { single: RectangleHorizontalIcon, grid: LayoutGridIcon, spotlight: LayoutPanelLeftIcon } as const;

/**
 * Single · Grid · Spotlight as one radio group with a thumb that glides to the choice. The suite sidebar and the
 * comparison top bar both draw this, so the choice reads and behaves the same wherever it appears.
 */
export function LayoutSwitch({
  value,
  options,
  onChange,
  onIntent,
  compact = false,
  vertical = false,
}: {
  value: MeetingLayout;
  options: readonly MeetingLayout[];
  onChange(layout: MeetingLayout): void;
  /** Pointer or focus on an option, before a choice: time to load what it needs. */
  onIntent?(layout: MeetingLayout): void;
  /** Icons only, with the names as hints. */
  compact?: boolean;
  vertical?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const index = options.indexOf(value);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(Math.max(0, index) + step + options.length) % options.length];
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
      data-compact={compact || undefined}
      data-vertical={vertical || undefined}
      data-testid="layout-switch"
      style={{ '--count': options.length, '--index': Math.max(0, index) } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="layout-switch-thumb" aria-hidden="true" data-hidden={index < 0 || undefined} />
      {options.map((option) => {
        const Icon = ICONS[option];
        const button = (
          <button
            type="button"
            role="radio"
            data-layout={option}
            aria-checked={option === value}
            aria-label={LAYOUT_STRINGS[option]}
            tabIndex={option === value || (index < 0 && option === options[0]) ? 0 : -1}
            onClick={() => onChange(option)}
            onPointerEnter={() => onIntent?.(option)}
            onFocus={() => onIntent?.(option)}
          >
            <Icon aria-hidden="true" />
            {compact ? null : <span>{LAYOUT_STRINGS[option]}</span>}
          </button>
        );
        return (
          <Hint key={option} label={compact ? LAYOUT_STRINGS[option] : LAYOUT_STRINGS.hints[option]} side={vertical ? 'right' : 'bottom'}>
            {button}
          </Hint>
        );
      })}
    </div>
  );
}
