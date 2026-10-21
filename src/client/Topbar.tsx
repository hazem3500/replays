import { type ReactNode, useRef, useState } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { AnimatedText } from '@/components/animated-text.tsx';

import { Hint, IconButton } from '@/components/icon-button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Tooltip, TooltipContent, TooltipTrigger, useCanHover } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/utils.ts';

import { indexReturnHref } from './route.ts';
import { productName } from './config.ts';
import { ThemeSwitch, useThemeControls } from './theme.tsx';

/**
 * The quiet header shared by every page. Left: a back arrow to all replays and
 * ONE title (truncating, with the full text in a tooltip when cut), then a
 * single status chip. Right: icon actions, the theme switch and, when it earns
 * its place, a "More" menu.
 *
 * Identity is ambient, as in a devtool: no logo tile, no breadcrumb trail; the
 * back arrow and the document title say where you are.
 */
export function Topbar({
  title,
  titleId,
  prefix,
  status,
  actions,
  menu,
  menuItems = [],
  menuFooter,
  alwaysMenu = false,
  backHref,
  backLabel = 'All replays',
  compact = false,
  root,
  titleMenu,
  titleFrom,
}: {
  /** The page's h1. Omit on the index, where the product's name is the page itself. */
  title?: string;
  titleId?: string;
  /** Muted text before the title inside the h1, e.g. "Run 2 of 2" on phones. */
  prefix?: string;
  /** One quiet chip beside the title (run status, error count, "Imported"). */
  status?: ReactNode;
  /** Icon buttons before the "More" menu. */
  actions?: ReactNode;
  /** Secondary actions: a "More" menu when there are two or more, else one icon button. */
  menuItems?: TopbarMenuItem[];
  /** Menu content after the items (client plugins' settings); always gets the "More" menu. */
  menuFooter?: ReactNode;
  /** A "More" menu even for one item, so an item (Keyboard shortcuts) stays put while others come and go. */
  alwaysMenu?: boolean;
  /** Extra menu content above the items (the phone's run picker); always gets the "More" menu. */
  menu?: ReactNode;
  /** Where the back arrow goes; defaults to the index with its last filters. */
  backHref?: string;
  /** The back arrow's name (tooltip and label); defaults to "All replays". */
  backLabel?: string;
  /** Phones: 40 px targets. */
  compact?: boolean;
  /** The index only: its own bar title, in place of the default product-name h1 (the index renders its h1 below). */
  root?: ReactNode;
  /** Phones: the title itself opens this menu (the suite's run switcher), so the h1 doubles as the picker. */
  titleMenu?: ReactNode;
  /** The title this bar replaces (switching suite runs remounts the page): it morphs from that one. */
  titleFrom?: string;
}) {
  return (
    <header className={cn('topbar app-topbar', compact && 'topbar-compact')}>
      {title === undefined && root ? (
        root
      ) : title === undefined ? (
        // The index is the root itself: its h1 is the product's name.
        <h1 className="topbar-title topbar-root">
          <span className="topbar-title-text">{productName()}</span>
        </h1>
      ) : (
        <>
          <Hint label={backLabel} side="bottom" align="start">
            <a
              href={backHref ?? indexReturnHref()}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'topbar-back [&_svg:not([class*=size-])]:size-4')}
              aria-label={backLabel}
            >
              <AnimatedIcon name="chevron-left" />
            </a>
          </Hint>
          {titleMenu ? (
            <TopbarTitleMenu
              title={title}
              menu={titleMenu}
              {...(titleFrom ? { from: titleFrom } : {})}
              {...(prefix ? { prefix } : {})}
              {...(titleId ? { id: titleId } : {})}
            />
          ) : (
            <TopbarTitle
              title={title}
              {...(titleFrom ? { from: titleFrom } : {})}
              {...(prefix ? { prefix } : {})}
              {...(titleId ? { id: titleId } : {})}
            />
          )}
          {status ? <div className="topbar-status">{status}</div> : null}
        </>
      )}
      <div className="topbar-actions">
        {actions}
        {/* Phones: the theme is a "More" item, so the bar keeps room for the title at 360 px. */}
        {compact ? null : <ThemeSwitch />}
        <MoreMenu items={menuItems} extra={menu} footer={menuFooter} theme={compact} always={alwaysMenu} />
      </div>
    </header>
  );
}

/** The h1; the full title shows in a tooltip only when the line is cut. */
function TopbarTitle({ title, from, prefix, id }: { title: string; from?: string; prefix?: string; id?: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const canHover = useCanHover();
  return (
    <h1 id={id} className="topbar-title">
      {prefix ? <span className="topbar-prefix">{prefix}</span> : null}
      <Tooltip
        disabled={!canHover}
        open={open}
        onOpenChange={(next) => {
          const element = text.current;
          setOpen(next && Boolean(element && element.scrollWidth > element.clientWidth));
        }}
      >
        <TooltipTrigger render={<span ref={text} className="topbar-title-text" />}>
          <AnimatedText text={title} from={from} />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {title}
        </TooltipContent>
      </Tooltip>
    </h1>
  );
}

/**
 * Phones: the h1 is a menu trigger ("Run 1/2 · Desktop: login ⌄") that opens the run switcher; the full title
 * is in the menu's label, since a phone has no hover tooltip for the cut line.
 */
function TopbarTitleMenu({
  title,
  from,
  prefix,
  id,
  menu,
}: {
  title: string;
  from?: string;
  prefix?: string;
  id?: string;
  menu: ReactNode;
}) {
  return (
    <h1 id={id} className="topbar-title topbar-title-menu">
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className="topbar-title-trigger" data-testid="title-menu" />}>
          {prefix ? (
            <span className="topbar-prefix">
              {/* "Run 1 of 2" reads as "1/2" on the bar; assistive tech still hears the words. */}
              <span aria-hidden="true">{prefix.replace(/^Run (\d+) of (\d+)$/, '$1/$2')}</span>
              <span className="visually-hidden">{prefix}</span>
            </span>
          ) : null}
          <AnimatedText className="topbar-title-text" text={title} from={from} />
          <AnimatedIcon name="chevron-down" className="topbar-title-chevron" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-auto min-w-64 max-w-[calc(100vw-16px)]">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
}

/** A secondary action for the topbar: a "More" menu item, or an icon button when it is the only one. */
export interface TopbarMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Shown as a <Kbd>/shortcut hint, e.g. "?". */
  shortcut?: string;
  ariaKeyshortcuts?: string;
  /** A link item (a download) instead of an action. */
  href?: string;
  /** With `href`: the file name to save as. */
  download?: string;
  /** Muted trailing text (a file size). */
  detail?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * A menu has to earn its place: with two or more secondary actions (or the phone's run picker) they share
 * one "More" menu; a lone action is just an icon button with a tooltip; none, nothing.
 */
function MoreMenu({
  items,
  extra,
  footer,
  theme = false,
  always = false,
}: {
  items: TopbarMenuItem[];
  extra?: ReactNode;
  footer?: ReactNode;
  theme?: boolean;
  always?: boolean;
}) {
  const [only] = items;
  if (!extra && !footer && !theme && !always && items.length === 1 && only && !only.href) {
    return (
      <IconButton
        label={only.label}
        tooltipSide="bottom"
        tooltipAlign="end"
        onClick={only.onSelect}
        {...(only.shortcut ? { shortcut: only.shortcut } : {})}
        {...(only.ariaKeyshortcuts ? { 'aria-keyshortcuts': only.ariaKeyshortcuts } : {})}
      >
        {only.icon}
      </IconButton>
    );
  }
  if (!extra && !footer && !theme && items.length === 0) return null;
  return (
    <DropdownMenu>
      <Hint label="More" side="bottom" align="end">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="topbar-more text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4"
              aria-label="More actions"
            />
          }
        >
          <AnimatedIcon name="ellipsis" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-56">
        {extra}
        {extra && items.length ? <DropdownMenuSeparator /> : null}
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onClick={item.onSelect}
            {...(item.disabled ? { disabled: true } : {})}
            {...(item.href
              ? {
                  // Base UI renders the item's children into this link.
                  // oxlint-disable-next-line jsx-a11y/anchor-has-content
                  render: <a href={item.href} {...(item.download ? { download: item.download } : {})} />,
                }
              : {})}
            {...(item.testId ? { 'data-testid': item.testId } : {})}
            {...(item.ariaKeyshortcuts ? { 'aria-keyshortcuts': item.ariaKeyshortcuts } : {})}
          >
            {item.icon}
            {item.label}
            {item.shortcut ? <DropdownMenuShortcut data-keys="">{item.shortcut}</DropdownMenuShortcut> : null}
            {item.detail ? <DropdownMenuShortcut className="tracking-normal tabular-nums">{item.detail}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ))}
        {footer}
        {theme ? (
          <>
            {extra || items.length ? <DropdownMenuSeparator /> : null}
            <ThemeMenuItem />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones: the theme switch as a "More" item; the menu stays open so the flip shows behind it. */
function ThemeMenuItem() {
  const { theme, switchTheme } = useThemeControls();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <DropdownMenuItem closeOnClick={false} data-testid="theme-menu-item" onClick={switchTheme}>
      <AnimatedIcon name={next === 'light' ? 'sun' : 'moon'} />
      {next === 'light' ? 'Light theme' : 'Dark theme'}
    </DropdownMenuItem>
  );
}

/** The topbar's one quiet status chip, for explicit outcomes only (a suite run's status): hairline pill, status dot. */
export function TopbarChip({ children, ...props }: { children: ReactNode; 'data-testid'?: string }) {
  return (
    <Badge
      variant="outline"
      className="topbar-chip h-5 gap-[5px] border-[var(--line-strong)] bg-transparent px-[7px] text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] tabular-nums dark:bg-transparent"
      {...props}
    >
      {children}
    </Badge>
  );
}
