import { useEffect, useState } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { IconButton, type IconButtonProps } from '@/components/icon-button.tsx';
import { cn } from '@/lib/utils.ts';

import { copyText } from '../clipboard.ts';

/**
 * Small icon button that copies `value`; the copy glyph swaps to a check for a
 * moment (crossfade + scale, see `.icon-swap`) and `onCopied` can raise a toast.
 */
export function CopyButton({
  value,
  label,
  onCopied,
  className,
  ...props
}: { value: string; label: string; onCopied?: (copied: boolean) => void } & Omit<IconButtonProps, 'label' | 'children' | 'onClick'>) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      size="icon-sm"
      label={label}
      className={cn('copy-button [&_svg]:size-3.5!', className)}
      onClick={() =>
        void copyText(value).then((ok) => {
          setCopied(ok);
          onCopied?.(ok);
        })
      }
      {...props}
    >
      <span className="icon-swap" data-state={copied ? 'b' : 'a'} aria-hidden="true">
        <AnimatedIcon name="copy" className="icon-a" />
        <AnimatedIcon name="check" className="icon-b" trigger="state" play={copied ? 'copied' : false} />
      </span>
    </IconButton>
  );
}
