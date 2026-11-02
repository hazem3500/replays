import { ChevronDownIcon, ChevronLeftIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/utils.ts';

import type { ViewInfo } from '../../shared/views.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';

const STRINGS = {
  group: 'View',
  trigger: (label: string) => `View: ${label}`,
  reset: 'Reset view',
};

export interface ViewChoice {
  views: readonly ViewInfo[];
  current: string;
  onSelect: (id: string) => void;
  /** Forget the open view's remembered settings. */
  onReset: () => void;
}

function ViewItems({ views, current, onSelect, onReset, showReset = true }: ViewChoice & { showReset?: boolean }) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{STRINGS.group}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(next) => onSelect(String(next))}>
          {views.map((view) => (
            <DropdownMenuRadioItem closeOnClick key={view.id} value={view.id} data-testid={`view-${view.id}`}>
              {view.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      {showReset ? (
        <>
          <DropdownMenuSeparator />
          <ResetViewItem onReset={onReset} />
        </>
      ) : null}
    </>
  );
}

/** Comparison keeps its context and resets only the remembered panel arrangement. */
export function ResetViewItem({ onReset }: { onReset: () => void }) {
  return (
    <DropdownMenuItem onClick={onReset} data-testid="view-reset">
      <RotateCcwIcon aria-hidden="true" />
      {STRINGS.reset}
    </DropdownMenuItem>
  );
}

/**
 * "View: Debug" in the viewer's top bar: every view in switcher order, a check on the open one, and "Reset this view".
 * `V` steps through the views without opening it.
 */
export function ViewSwitcher(choice: ViewChoice) {
  const label = choice.views.find((view) => view.id === choice.current)?.label ?? choice.current;
  const [open, setOpen] = useState(false);
  const close = (then: () => void) => {
    setOpen(false);
    then();
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'view-switcher text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4',
            )}
            data-testid="view-switcher"
            data-view={choice.current}
            aria-label={STRINGS.trigger(label)}
            aria-keyshortcuts="V"
          />
        }
      >
        {STRINGS.trigger(label)}
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-56">
        <ViewItems {...choice} onSelect={(id) => close(() => choice.onSelect(id))} onReset={() => close(choice.onReset)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** View choices are one secondary row in More, with a back action in the phone sheet. */
export function ViewMenuItems({ showReset = true, ...choice }: ViewChoice & { showReset?: boolean }) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(MOBILE_QUERY);
  const label = choice.views.find((view) => view.id === choice.current)?.label ?? choice.current;
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger aria-label={STRINGS.trigger(label)} data-testid="view-submenu-trigger">
        {STRINGS.group}
        <span className="ml-auto text-[var(--text-tertiary)]" aria-hidden="true">
          {label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-48" sideOffset={4} data-testid="view-submenu">
        {phone ? (
          <>
            <DropdownMenuItem closeOnClick={false} onClick={() => setOpen(false)}>
              <ChevronLeftIcon aria-hidden="true" />
              Back to actions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ViewItems {...choice} showReset={showReset} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
