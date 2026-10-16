import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * A plain modal for the workshop and its prompts. Not the app's Dialog: these must be able to open on top of each other
 * (a permission prompt while the workshop is open) without fighting over focus traps.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  testId,
  role = 'dialog',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
  role?: 'dialog' | 'alertdialog';
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current;
    target?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a click on the dim area closes; Escape does the same for the keyboard
    <div
      className="mall-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- role is dynamic (dialog | alertdialog); Escape closes */}
      <div
        ref={box}
        className={wide ? 'mall-modal mall-modal-wide' : 'mall-modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id={titleId} className="mall-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
