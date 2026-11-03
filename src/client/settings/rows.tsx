import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { strings } from './strings.ts';

export function SettingsGroup({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" {...(title ? { 'aria-labelledby': id } : {})}>
      {title ? (
        <h3 id={id} className="settings-group-title">
          {title}
        </h3>
      ) : null}
      <div className="settings-rows">{children}</div>
      {footer ? <div className="settings-group-footer">{footer}</div> : null}
    </section>
  );
}

/** Label and one-line description on the left, the control on the right. */
export function SettingsRow({
  label,
  description,
  control,
  labelId,
  htmlFor,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  labelId?: string;
  htmlFor?: string;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <Label className="settings-row-label" {...(labelId ? { id: labelId } : {})} {...(htmlFor ? { htmlFor } : {})}>
          {label}
        </Label>
        {description ? <span className="settings-row-description">{description}</span> : null}
      </div>
      {control ? <div className="settings-row-control">{control}</div> : null}
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="settings-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="visually-hidden"> {strings.newTab}</span>
      <AnimatedIcon name="arrow-up-right" className="settings-link-arrow" />
    </a>
  );
}

const ARROW_STEPS: Partial<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** A small radio group drawn as a segmented control: arrow keys move the choice, one tab stop. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  labelledBy: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = ARROW_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  }
  return (
    <div ref={group} className="settings-segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
