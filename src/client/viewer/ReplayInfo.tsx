import { AnimatedIcon } from '@/components/animated-icon.tsx';
import {
  BotIcon,
  CalendarIcon,
  GlobeIcon,
  HashIcon,
  HourglassIcon,
  LayersIcon,
  LinkIcon,
  type LucideIcon,
  MonitorIcon,
  UploadIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';

import { CopyButton } from '@/components/copy-button.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';

import { formatClock, type ReplayBundle } from '../../shared/replay.ts';
import { formatRelative } from '../format.ts';
import { useViewer } from './context.ts';
import { retentionLabel, retentionQuery } from './keep.ts';

/** The review suite a run belongs to, for the details popover. */
export interface SuiteDetails {
  title: string;
  href: string;
  /** What the suite is about (a pull request, a ticket), when it names one. */
  subject?: { provider: string; url: string; label: string };
}

function splitUrl(url: string) {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}${parsed.hash}` };
  } catch {
    return { host: url, path: '' };
  }
}

/** "Today, 5:14 PM", "Yesterday, 9:02 AM" or "Oct 10, 4:54 PM". */
function friendlyDate(iso: string, now = new Date()) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return `Today, ${time}`;
  if (today - day === 86_400_000) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })}, ${time}`;
}

/**
 * One details row: a fixed label column (icon + label), the value right beside it, and an optional action (copy)
 * at the row's right edge, shown on row hover or keyboard navigation (always on touch).
 */
function Detail({
  icon: Icon,
  label,
  children,
  action,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="info-detail">
      <dt>
        <Icon aria-hidden="true" />
        {label}
      </dt>
      <dd {...(testId ? { 'data-testid': testId } : {})}>
        <span className="info-value">{children}</span>
        {action ? <span className="info-action">{action}</span> : null}
      </dd>
    </div>
  );
}

/** "Expires in N days", "Kept by …" or "Doesn't expire" (src/shared/retention.ts); nothing until it loads. */
function RetentionDetail({ id }: { id: string }) {
  const { data: retention } = useQuery(retentionQuery(id));
  if (!retention) return null;
  const title = retention.kept
    ? `Kept ${new Date(retention.kept.at).toLocaleString()}`
    : retention.expiresAt
      ? new Date(retention.expiresAt).toLocaleString()
      : undefined;
  return (
    <Detail icon={HourglassIcon} label="Retention" testId="replay-retention">
      <span {...(title ? { title } : {})}>{retentionLabel(retention)}</span>
    </Detail>
  );
}

/**
 * ⓘ in the topbar: a Get Info–style panel, 360 px. Header: the replay's title and what kind of run it is; the
 * recorded URL as a compact row with copy and open; one row of three stats (duration, steps, requests); then
 * label–value details in three quiet groups (Captured · Viewport | Replay ID | Suite · Subject).
 * Errors are not shown here. Phones get the same content in a bottom sheet.
 */
export function ReplayInfoButton({
  bundle,
  suite,
  sheet = false,
  title,
}: {
  bundle: ReplayBundle;
  suite?: SuiteDetails | undefined;
  /** Phones: a bottom sheet (swipe down to close) headed by the full title, which the bar has to cut. */
  sheet?: boolean;
  title?: string;
}) {
  const { notify } = useViewer();
  const { meta } = bundle;
  const human = meta.source === 'human';
  const { host, path } = splitUrl(meta.url);
  const copied = (what: string) => (ok: boolean) => notify(ok ? `${what} copied` : 'Could not copy');
  const trigger = useRef<HTMLButtonElement>(null);
  const openedByPointer = useRef(false);
  const details = (
    <>
      {/* Who and why first: the replay's title (the sheet shows it as its own heading), then what kind of run. */}
      <header className="info-head">
        {sheet ? null : <p className="info-title">{title ?? meta.title}</p>}
        <p className="info-source" data-testid="session-source">
          {human ? <UploadIcon aria-hidden="true" /> : <BotIcon aria-hidden="true" />}
          {human ? 'Imported rrweb' : 'Agent run'}
        </p>
      </header>
      <div className="info-where">
        <GlobeIcon aria-hidden="true" />
        <span className="info-url" title={meta.url}>
          <span className="info-host">{host}</span>
          {path && path !== '/' ? <span className="info-path">{path}</span> : null}
        </span>
        <span className="info-actions">
          <CopyButton value={meta.url} label="Copy URL" tooltipSide="bottom" onCopied={copied('URL')} />
          <Hint label="Open in a new tab" side="bottom">
            <a
              href={meta.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open URL in a new tab"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                'info-open text-[var(--text-secondary)] hover:text-foreground [&_svg]:size-3.5!',
              )}
            >
              <AnimatedIcon name="arrow-up-right" />
            </a>
          </Hint>
        </span>
      </div>
      {/* One compact line of figures: "0:09.0 · 11 steps · 5 requests". */}
      <p className="info-stats">
        <span>
          <span className="info-figure">{formatClock(meta.duration)}</span>
        </span>
        {human ? null : (
          <>
            <span>
              <span className="info-figure">{bundle.steps.length}</span> {bundle.steps.length === 1 ? 'step' : 'steps'}
            </span>
            <span>
              <span className="info-figure">{bundle.network.length}</span> {bundle.network.length === 1 ? 'request' : 'requests'}
            </span>
          </>
        )}
      </p>
      <div className="info-details">
        <dl className="info-group">
          <Detail icon={CalendarIcon} label="Captured">
            <time dateTime={meta.capturedAt} title={meta.capturedAt}>
              {friendlyDate(meta.capturedAt)}
            </time>{' '}
            <span className="info-muted">· {formatRelative(meta.capturedAt, undefined, 'narrow')}</span>
          </Detail>
          <Detail icon={MonitorIcon} label="Viewport">
            <span className="info-mono">
              {meta.viewport.width}
              {' × '}
              {meta.viewport.height}
            </span>
          </Detail>
          <RetentionDetail id={meta.id} />
        </dl>
        <dl className="info-group">
          <Detail
            icon={HashIcon}
            label="Replay ID"
            action={<CopyButton value={meta.id} label="Copy replay ID" tooltipSide="bottom" onCopied={copied('Replay ID')} />}
          >
            <code className="info-mono" title={meta.id}>
              {meta.id}
            </code>
          </Detail>
        </dl>
        {suite ? (
          <dl className="info-group">
            <Detail icon={LayersIcon} label="Suite">
              <a href={suite.href} title={suite.title}>
                {suite.title}
              </a>
            </Detail>
            {suite.subject ? (
              <Detail icon={LinkIcon} label={suite.subject.provider}>
                <a href={suite.subject.url} target="_blank" rel="noopener noreferrer" className="info-external">
                  {suite.subject.label}
                  <AnimatedIcon name="arrow-up-right" />
                </a>
              </Detail>
            ) : null}
          </dl>
        ) : null}
      </div>
    </>
  );
  if (sheet) {
    return (
      <Drawer>
        <DrawerTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Replay details"
              className="topbar-info text-[var(--text-secondary)] hover:text-foreground data-[popup-open]:text-foreground [&_svg:not([class*=size-])]:size-4"
            />
          }
        >
          <AnimatedIcon name="info" />
        </DrawerTrigger>
        <DrawerContent className="replay-info replay-info-sheet px-0" data-testid="replay-info">
          <DrawerTitle className="info-sheet-title">{title ?? meta.title}</DrawerTitle>
          {details}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover
      onOpenChange={(open) => {
        // Closing hands the keyboard back to ⓘ (keyboard users continue from there). Opened with a pointer, that is not
        // shown as a ring (focusVisible: false); opened from the keyboard, it is.
        if (open || !openedByPointer.current) return;
        requestAnimationFrame(() => trigger.current?.focus({ focusVisible: false } as FocusOptions));
      }}
    >
      <Hint label="Replay details" side="bottom" align="end">
        <PopoverTrigger
          render={
            <Button
              ref={trigger}
              onPointerDown={() => {
                openedByPointer.current = true;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openedByPointer.current = false;
              }}
              variant="ghost"
              size="icon"
              aria-label="Replay details"
              className="topbar-info text-[var(--text-secondary)] hover:text-foreground data-[popup-open]:text-foreground [&_svg:not([class*=size-])]:size-4"
            />
          }
        >
          <AnimatedIcon name="info" />
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="end"
        // Short screens (phone landscape): never taller than the space below the bar; the details scroll.
        className="replay-info max-h-(--available-height) w-[min(360px,92vw)] gap-0 overflow-y-auto overscroll-contain p-0"
        data-testid="replay-info"
        finalFocus={() => !openedByPointer.current}
      >
        <PopoverTitle className="visually-hidden">Replay details</PopoverTitle>
        {details}
      </PopoverContent>
    </Popover>
  );
}
