'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils.ts';

const pressableVariants = cva(
  "group/pressable inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium whitespace-nowrap press-settle outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-muted',
      },
      size: {
        default: 'h-[24px] min-w-[24px] px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        sm: "h-[24px] min-w-[24px] rounded-[min(var(--radius-md),8px)] px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: 'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface PressableProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof pressableVariants> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** A button with a pressed state (`aria-pressed`, `data-pressed`): clicking asks for the opposite state. */
function Pressable({ className, variant = 'default', size = 'default', pressed, onPressedChange, onClick, ...props }: PressableProps) {
  return (
    <button
      type="button"
      data-slot="pressable"
      aria-pressed={pressed}
      {...(pressed ? { 'data-pressed': '' } : {})}
      className={cn(pressableVariants({ variant, size, className }))}
      {...props}
      onClick={(event) => {
        // A tooltip trigger or a menu may hand this button its own handler: run it, then ask for the opposite state.
        onClick?.(event);
        if (!event.defaultPrevented) onPressedChange(!pressed);
      }}
    />
  );
}

export { Pressable, pressableVariants };
