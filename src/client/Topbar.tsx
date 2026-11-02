import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { TitleMorph } from '@/components/title-morph.tsx';
import { TopbarIdentity } from '@/components/topbar-identity.tsx';

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

import { indexReturnHref } from './routing/links.ts';
import { productName } from './config.ts';
import { useHasKeyboard } from './hooks/use-has-keyboard.ts';
import { ThemeSwitch, useThemeControls } from './theme.tsx';
import { SettingsButton } from './settings/Settings.tsx';
import { AccountMenu, accountMenuItems, useSignedIn } from './account/AccountMenu.tsx';

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
  menuSettings,
  menuTail,
  alwaysMenu = false,
  backHref,
  backLabel = 'All replays',
  compact = false,
  root,
  titleMenu,
  titleFrom,
  phoneMenu,
  appearanceInMenu = false,
  menuAnchor,
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
  /** View choices beside appearance, after recording actions. */
  menuSettings?: ReactNode;
  /** A final, separated action such as resetting the panel arrangement. */
  menuTail?: ReactNode;
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
  /** The title this bar replaces, so a remounted run can fade its title and status in together. */
  titleFrom?: string;
  /** Phones (the index): one sheet in place of the theme switch and "More"; Settings stays mounted for its dialog. */
  phoneMenu?: ReactNode;
  /** Viewer tools keep appearance with the other secondary actions at every width. */
  appearanceInMenu?: boolean;
  /** Anchors a secondary panel opened from More. */
  menuAnchor?: RefObject<HTMLButtonElement | null>;
}) {
  const account = useSignedIn();
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
          <TopbarIdentity title={title} from={titleFrom}>
            {titleMenu ? (
              <TopbarTitleMenu title={title} menu={titleMenu} {...(prefix ? { prefix } : {})} {...(titleId ? { id: titleId } : {})} />
            ) : (
              <TopbarTitle title={title} {...(prefix ? { prefix } : {})} {...(titleId ? { id: titleId } : {})} />
            )}
            {status ? <div className="topbar-status">{status}</div> : null}
          </TopbarIdentity>
        </>
      )}
      <div className="topbar-actions">
        {actions}
        {/* Phones: the theme is a "More" item, so the bar keeps room for the title at 360 px. */}
        {compact || phoneMenu || appearanceInMenu ? null : <ThemeSwitch />}
        {title === undefined ? <SettingsButton /> : null}
        {account && !compact ? <AccountMenu account={account} /> : null}
        {phoneMenu ?? (
          <MoreMenu
            items={compact ? [...menuItems, ...accountMenuItems(account)] : menuItems}
            extra={menu}
            footer={menuFooter}
            settings={menuSettings}
            tail={menuTail}
            theme={compact || appearanceInMenu}
            always={alwaysMenu}
            triggerRef={menuAnchor}
          />
        )}
      </div>
    </header>
  );
}

/** The h1; the full title shows in a tooltip only when the line is cut. */
function TopbarTitle({ title, prefix, id }: { title: string; prefix?: string; id?: string }) {
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
          <TitleMorph text={title} />
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
function TopbarTitleMenu({ title, prefix, id, menu }: { title: string; prefix?: string; id?: string; menu: ReactNode }) {
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
          <span className="topbar-title-text">
            <TitleMorph text={title} />
          </span>
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
  /** Less frequent utilities follow the view and appearance settings. */
  section?: 'after-settings';
}

/**
 * A menu has to earn its place: with two or more secondary actions (or the phone's run picker) they share
 * one "More" menu; a lone action is just an icon button with a tooltip; none, nothing.
 */
export function MoreMenu({
  items,
  extra,
  footer,
  theme = false,
  always = false,
  triggerRef,
  settings,
  tail,
}: {
  items: TopbarMenuItem[];
  extra?: ReactNode;
  footer?: ReactNode;
  settings?: ReactNode;
  tail?: ReactNode;
  theme?: boolean;
  always?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  const [only] = items;
  if (!extra && !footer && !settings && !tail && !theme && !always && items.length === 1 && only && !only.href) {
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
  if (!extra && !footer && !settings && !tail && !theme && items.length === 0) return null;
  return (
    <DropdownMenu>
      <Hint label="More" side="bottom" align="end">
        <DropdownMenuTrigger
          render={
            <Button
              ref={triggerRef}
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
        <MoreItems items={items.filter((item) => item.section !== 'after-settings')} />
        {settings || theme ? <DropdownMenuSeparator /> : null}
        {settings}
        {theme ? <ThemeMenuItem /> : null}
        <MoreItems items={items.filter((item) => item.section === 'after-settings')} />
        {footer}
        {tail ? (
          <>
            <DropdownMenuSeparator />
            {tail}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreItems({ items }: { items: TopbarMenuItem[] }) {
  const hasKeyboard = useHasKeyboard();
  return (
    <>
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
          {item.shortcut && hasKeyboard ? <DropdownMenuShortcut data-keys="">{item.shortcut}</DropdownMenuShortcut> : null}
          {item.detail ? <DropdownMenuShortcut className="tracking-normal tabular-nums">{item.detail}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

const THEME_STRINGS = { theme: 'Theme', dark: 'Dark', light: 'Light' };

/**
 * Phones: the theme as a "More" row, its label and the current state, like the index sheet's (IndexPhoneMenu.tsx).
 * A tap flips it in place: the menu stays open so the new theme shows behind it.
 */
function ThemeMenuItem() {
  const { theme, switchTheme } = useThemeControls();
  return (
    <DropdownMenuItem closeOnClick={false} data-testid="theme-menu-item" onClick={switchTheme}>
      <AnimatedIcon name={theme === 'dark' ? 'moon' : 'sun'} />
      {THEME_STRINGS.theme}
      <DropdownMenuShortcut className="tracking-normal">{theme === 'dark' ? THEME_STRINGS.dark : THEME_STRINGS.light}</DropdownMenuShortcut>
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
