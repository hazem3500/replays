import { Clock3Icon, LayersIcon, LinkIcon, ListOrderedIcon } from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconSwap } from '@/components/icon-swap.tsx';
import { AnimatedText } from '@/components/animated-text.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/utils.ts';

import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { copyText } from '../clipboard.ts';
import { useFlash } from '../hooks/use-flash.ts';
import { useLongPress } from '../hooks/use-long-press.ts';
import { stepPermalink, timePermalink } from '../permalink.ts';
import { type Playback, usePlayer } from '../player.ts';
import { resolveSlot } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { editHref } from '../routing/links.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { notify as showToast } from '../toast.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';
import { useViewer } from './context.ts';
import { activeStepIndex } from './Transport.tsx';

const STRINGS = {
  edit: 'Edit replay',
  editWithEdits: 'Edit replay (has edits)',
  editHint: 'Edit replay · Trim, cut and add effects',
  editHintWithEdits: 'Edit replay · This replay has edits',
  copyLink: 'Copy link',
  copied: 'Copied',
  moreHint: 'Right-click for more',
  touchHint: 'Press and hold for a link to this moment or step',
  failed: 'Could not copy the link',
  link: 'Link',
  linkAt: (clock: string) => `Link at ${clock}`,
  copyAt: (clock: string) => `Copy link at ${clock}`,
  copyAtNow: 'Copy link at this moment',
  linkToStep: (step: number) => `Link to step ${step}`,
  copyToStep: (step: number, label: string) => `Copy link to step ${step} · ${label}`,
  copyToCurrentStep: 'Copy link to this step',
  suiteLink: 'Suite link',
  copySuite: 'Copy suite link',
};

/** How long a finger rests on "Copy link" before its menu opens. */
const LONG_PRESS_MS = 450;
/** Set once the copy-link menu has been opened by any route; then the touch hint stops. */
const LONG_PRESS_HINT_KEY = 'replays-copy-menu-found';

export function EditButton({ id, hasEdits = false }: { id: string; hasEdits?: boolean }) {
  return (
    <Hint label={hasEdits ? STRINGS.editHintWithEdits : STRINGS.editHint} side="bottom" align="end">
      <a
        href={editHref(id)}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'edit-entry text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4',
        )}
        aria-label={hasEdits ? STRINGS.editWithEdits : STRINGS.edit}
        data-testid="edit-replay"
        data-has-edits={hasEdits || undefined}
      >
        <AnimatedIcon name="pencil" />
      </a>
    </Hint>
  );
}

/** The page's link without a moment: no ?t=, no #step-n (a suite run keeps its /s/…/r/… path). */
function plainLink() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function copy(href: string, what: string, hint?: string) {
  return copyText(href).then((ok) => {
    showToast(ok ? `${what} copied` : STRINGS.failed, undefined, ok ? hint : undefined);
    return ok;
  });
}

/** Where the playhead is: its time, and the step it is in (if any). */
function moment(player: Playback, steps: readonly ReplayStep[]) {
  const time = player.getTime();
  const stepIndex = activeStepIndex(steps, time, player.duration);
  return { time, stepIndex, step: steps[stepIndex] };
}

/**
 * Phones: the copy-link menu's choices as top-bar menu items. Labels name the moment generically ("this moment") because
 * the menu is built before it opens; each item reads the playhead when chosen.
 */
export function copyLinkItems(player: Playback, steps: readonly ReplayStep[], suiteHref: string | undefined): TopbarMenuItem[] {
  return [
    {
      label: STRINGS.copyLink,
      icon: <LinkIcon aria-hidden="true" />,
      onSelect: () => void copy(plainLink(), STRINGS.link),
      testId: 'copy-link',
    },
    {
      label: STRINGS.copyAtNow,
      icon: <Clock3Icon aria-hidden="true" />,
      onSelect: () => {
        const { time } = moment(player, steps);
        void copy(timePermalink(location.href, time), STRINGS.linkAt(formatClock(time)));
      },
    },
    ...(steps.length > 0
      ? [
          {
            label: STRINGS.copyToCurrentStep,
            icon: <ListOrderedIcon aria-hidden="true" />,
            onSelect: () => {
              const { stepIndex } = moment(player, steps);
              void copy(stepPermalink(location.href, stepIndex), STRINGS.linkToStep(stepIndex + 1));
            },
          },
        ]
      : []),
    ...(suiteHref
      ? [
          {
            label: STRINGS.copySuite,
            icon: <LayersIcon aria-hidden="true" />,
            onSelect: () => void copy(new URL(suiteHref, location.href).toString(), STRINGS.suiteLink),
          },
        ]
      : []),
  ];
}

function CopyLinkMenu({
  anchor,
  open,
  onOpenChange,
  suiteHref,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange: (open: boolean, reason: string) => void;
  suiteHref: string | undefined;
}) {
  const player = usePlayer();
  const { steps } = useViewer();
  const { time, stepIndex, step } = moment(player, steps);
  return (
    <DropdownMenu open={open} onOpenChange={(next, details) => onOpenChange(next, details.reason)}>
      <DropdownMenuContent anchor={anchor} align="end" className="w-auto min-w-56" aria-label={STRINGS.copyLink}>
        <DropdownMenuItem onClick={() => void copy(plainLink(), STRINGS.link)}>{STRINGS.copyLink}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copy(timePermalink(location.href, time), STRINGS.linkAt(formatClock(time)))}>
          {STRINGS.copyAt(formatClock(time))}
        </DropdownMenuItem>
        {step ? (
          <DropdownMenuItem onClick={() => void copy(stepPermalink(location.href, stepIndex), STRINGS.linkToStep(stepIndex + 1))}>
            <span className="min-w-0 truncate">{STRINGS.copyToStep(stepIndex + 1, step.label)}</span>
          </DropdownMenuItem>
        ) : null}
        {suiteHref ? (
          <DropdownMenuItem onClick={() => void copy(new URL(suiteHref, location.href).toString(), STRINGS.suiteLink)}>
            {STRINGS.copySuite}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Copy link: a click copies the plain link (no time, no step; a suite run keeps its /s/…/r/… path). Right-click, a long
 * press, or the context-menu key (Shift+F10) open a small menu anchored to the button: the plain link, the link at the
 * playhead, the link to the current step and, in a suite, the suite. Each copies and says what.
 */
export function CopyLinkButton({ suiteHref }: { suiteHref?: string | undefined }) {
  const [copied, flash] = useFlash(1400);
  const [menuOpen, setMenuOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    setMenuOpen(true);
    writeStorage(LONG_PRESS_HINT_KEY, '1');
  };
  const press = useLongPress(openMenu, LONG_PRESS_MS);
  return (
    <>
      <IconButton
        ref={button}
        label={STRINGS.copyLink}
        hint={
          <>
            <AnimatedText text={copied ? STRINGS.copied : STRINGS.copyLink} />
            <span className="hint-secondary">{STRINGS.moreHint}</span>
          </>
        }
        tooltipSide="bottom"
        tooltipAlign="end"
        className="copy-link"
        data-testid="copy-link"
        aria-haspopup="menu"
        onClick={(event) => {
          if (press.endsLongPress()) {
            event.preventDefault();
            return;
          }
          const native = event.nativeEvent;
          // why: touch has no right-click or tooltip; until the menu has been found once, the toast says how to get it.
          const touch = 'pointerType' in native && native.pointerType === 'touch';
          void copy(plainLink(), STRINGS.link, touch && !readStorage(LONG_PRESS_HINT_KEY) ? STRINGS.touchHint : undefined).then(
            (ok) => ok && flash(),
          );
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          // why: Android also fires contextmenu on a long press; the press timer has usually opened the menu already.
          if (!menuOpen) openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            openMenu();
          }
        }}
        {...press.handlers}
      >
        <IconSwap state={copied ? 'b' : 'a'}>
          <AnimatedIcon name="link" className="icon-a" />
          <AnimatedIcon name="check" className="icon-b" trigger="state" play={copied ? 'copied' : false} />
        </IconSwap>
      </IconButton>
      <CopyLinkMenu
        anchor={button}
        open={menuOpen}
        suiteHref={suiteHref}
        onOpenChange={(next, reason) => {
          // why: lifting the finger that long-pressed lands outside the new menu; that is not a dismissal.
          if (!next && press.holding() && reason === 'outside-press') return;
          setMenuOpen(next);
        }}
      />
    </>
  );
}

export const ACTIONS_SLOT = 'viewer.actions';

/** The top bar's built-in actions, in their default order: the view switcher, compare, edit, details, copy link, download. */
export type CoreAction = 'core:view' | 'core:compare' | 'core:edit' | 'core:info' | 'core:link' | 'core:download';
const CORE_ACTIONS: readonly (readonly [CoreAction, number])[] = [
  ['core:view', 40],
  ['core:compare', 50],
  ['core:edit', 100],
  ['core:info', 200],
  ['core:link', 300],
  ['core:download', 400],
];

/** Secondary actions keep their slot's host visibility and ordering when rendered in More. */
export function actionMenuItems(actions: Partial<Record<CoreAction, TopbarMenuItem[]>>): TopbarMenuItem[] {
  const builtins: SlotDescriptor<undefined, TopbarMenuItem[]>[] = CORE_ACTIONS.flatMap(([id, order]) =>
    actions[id] ? [{ id, order, render: () => actions[id]! }] : [],
  );
  return resolveSlot(ACTIONS_SLOT, builtins, undefined)
    .filter((descriptor) => descriptor.id.startsWith('core:'))
    .flatMap((descriptor) => descriptor.render(undefined));
}

/**
 * The top bar's actions as `viewer.actions` items: hosts may reorder or hide the built-ins (`configureSlot`). Plugin bar
 * actions keep their own renderer and follow the built-ins.
 */
export function ActionsBar({ actions, plugins }: { actions: Partial<Record<CoreAction, ReactNode>>; plugins?: ReactNode }) {
  const builtins: SlotDescriptor<undefined, ReactNode>[] = CORE_ACTIONS.flatMap(([id, order]) =>
    actions[id] ? [{ id, order, render: () => actions[id] }] : [],
  );
  return (
    <span className="viewer-actions" data-slot={ACTIONS_SLOT}>
      {resolveSlot(ACTIONS_SLOT, builtins, undefined)
        .filter((descriptor) => descriptor.id.startsWith('core:'))
        .map((descriptor) => (
          <span key={descriptor.id} className="viewer-action" data-slot-item={descriptor.id}>
            {descriptor.render(undefined)}
          </span>
        ))}
      {plugins}
    </span>
  );
}
