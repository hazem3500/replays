import { ChevronDownIcon, RotateCcwIcon } from 'lucide-react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/utils.ts';

import type { ViewInfo } from '../../shared/views.ts';

const STRINGS = {
  group: 'View',
  trigger: (label: string) => `View: ${label}`,
  reset: 'Reset this view',
  resetDetail: 'Forget its panel sizes and tab',
};

export interface ViewChoice {
  views: readonly ViewInfo[];
  current: string;
  onSelect: (id: string) => void;
  /** Forget the open view's remembered settings. */
  onReset: () => void;
}

function ViewItems({ views, current, onSelect, onReset }: ViewChoice) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{STRINGS.group}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(next) => onSelect(String(next))}>
          {views.map((view) => (
            <DropdownMenuRadioItem key={view.id} value={view.id} data-testid={`view-${view.id}`}>
              {view.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onReset} data-testid="view-reset">
        <RotateCcwIcon aria-hidden="true" />
        <span className="flex flex-col">
          {STRINGS.reset}
          <span className="text-[var(--text-tertiary)]">{STRINGS.resetDetail}</span>
        </span>
      </DropdownMenuItem>
    </>
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

/** View choices inside the top bar's More menu, keeping the bar's room for the title. */
export function ViewMenuItems(choice: ViewChoice) {
  return <ViewItems {...choice} />;
}
