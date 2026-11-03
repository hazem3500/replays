import type { ComponentProps, ReactNode } from 'react';

import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * The building blocks every inspector panel shares, so zoom, speed, blur, caption, highlight, cut and trim read as
 * one family: a section is a label with its live value on the right, the control under it and at most one quiet
 * line of help. Sections are separated by hairlines on a 16 px rhythm (inspector.css).
 */
export function InspectorSection({
  label,
  labelId,
  value,
  hint,
  hintId,
  children,
}: {
  label: ReactNode;
  /** Names the control (`aria-labelledby`) when it is not a native input inside a `<label>`. */
  labelId?: string;
  /** The current value as text, right-aligned on the label row ("1.8×", "2.0 s"). */
  value?: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <span className="inspector-label" id={labelId}>
          {label}
        </span>
        {value === undefined ? null : (
          <span className="inspector-value" aria-hidden="true">
            {value}
          </span>
        )}
      </div>
      {children}
      {hint ? (
        <p className="inspector-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </section>
  );
}

/** The panel's closing actions, after the last section. */
export function InspectorFooter({ children }: { children: ReactNode }) {
  return <div className="inspector-footer">{children}</div>;
}

/**
 * A footer action: full width, icon first. `danger` removes the object (red, never filled, so it is not the panel's
 * loudest thing); `neutral` resets or restores; `primary` is the one thing the panel is for (cutting a range).
 */
export function InspectorAction({
  tone = 'neutral',
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & { tone?: 'danger' | 'neutral' | 'primary'; icon: AnimatedIconName }) {
  return (
    <Button
      variant={tone === 'primary' ? 'secondary' : 'ghost'}
      size="lg"
      className={cn('inspector-action gap-2 px-2.5', tone === 'primary' ? 'justify-center' : 'justify-start')}
      data-tone={tone}
      {...props}
    >
      <AnimatedIcon name={icon} size={14} />
      {children}
    </Button>
  );
}
