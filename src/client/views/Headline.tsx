import { ChevronLeftIcon, ChevronRightIcon, MessageSquarePlusIcon } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useContext } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import { formatClock } from '../../shared/replay.ts';
import { plural } from '../plural.ts';
import type { Cleanup, ViewerPluginContext } from '../plugins/api.ts';
import { activeFeatures, useFeatureBadges } from '../plugins/features.tsx';
import { PluginContexts, PluginMount, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { shortcutLabel } from '../shortcuts.ts';
import { type InspectorTab, useViewer } from '../viewer/context.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the headline's styles load with its own lazy chunk, only for views that show one.
import './headline.css';

export const HEADLINE_SLOT = 'viewer.headline';

const STRINGS = {
  region: 'Summary',
  errors: (count: number) => plural(count, 'error'),
  failed: (count: number) => plural(count, 'failed request'),
  firstAt: (clock: string) => `first at ${clock}`,
  noErrors: 'No errors in this replay',
  previous: 'Previous error',
  next: 'Next error',
  comments: (count: number) => plural(count, 'comment'),
  noComments: 'No comments yet',
  comment: 'Comment here',
};

/** What a `viewer.headline` item's `when` sees. */
export interface HeadlineSlotContext {
  /** The open view's id. */
  view: string;
  replay: Readonly<ReplayBundle>;
}

/** What a plugin's `viewer.headline` item renders to: a tile it draws into its own box. */
export interface HeadlineTile {
  /** The tile's accessible name, and the label of its error line if it throws. */
  label: string;
  mount: (container: HTMLElement, context: ViewerPluginContext) => Cleanup;
}

export interface HeadlineProps {
  /** The view's `headline` ids, in its order. */
  ids: readonly string[];
  view: string;
  bundle: ReplayBundle;
  openTab: (tab: InspectorTab) => void;
  /** Starts a comment at the playhead (the comments feature's `M`). */
  onComment: () => void;
  /** Comparing: one chip per recording, drawn by the comparison. */
  compareSummary?: ReactNode;
}

function IssuesTile() {
  const { errors, goToNextError, goToPreviousError } = useViewer();
  const failed = errors.filter((error) => error.kind === 'network').length;
  const first = errors[0];
  return (
    <div className="headline-tile" data-testid="headline-issues">
      <span className="headline-text">
        {first
          ? [STRINGS.errors(errors.length - failed), failed ? STRINGS.failed(failed) : '', STRINGS.firstAt(formatClock(first.at))]
              .filter(Boolean)
              .join(' · ')
          : STRINGS.noErrors}
      </span>
      {first ? (
        <span className="headline-actions">
          <button type="button" className="headline-button" onClick={goToPreviousError} aria-keyshortcuts="Shift+E">
            <ChevronLeftIcon aria-hidden="true" />
            {STRINGS.previous}
          </button>
          <button type="button" className="headline-button" onClick={goToNextError} aria-keyshortcuts="E">
            {STRINGS.next}
            <ChevronRightIcon aria-hidden="true" />
            <kbd>{shortcutLabel('next-error')}</kbd>
          </button>
        </span>
      ) : null}
    </div>
  );
}

function CommentsTile({ onComment }: Pick<HeadlineProps, 'onComment'>) {
  const count = useFeatureBadges().comments ?? 0;
  return (
    <div className="headline-tile" data-testid="headline-comments">
      <span className="headline-text">{count ? STRINGS.comments(count) : STRINGS.noComments}</span>
      <span className="headline-actions">
        <button type="button" className="headline-button" onClick={onComment} aria-keyshortcuts="M">
          <MessageSquarePlusIcon aria-hidden="true" />
          {STRINGS.comment}
          <kbd>{shortcutLabel('add-comment')}</kbd>
        </button>
      </span>
    </div>
  );
}

// why: the vitals model is only fetched by views that show the vitals tile.
const VitalsTile = lazy(() => import('./VitalsTile.tsx').then((module) => ({ default: module.VitalsTile })));

const commentsOn = () => activeFeatures().some((feature) => feature.id === 'comments');

type HeadlineDescriptor = SlotDescriptor<HeadlineSlotContext, HeadlineTile | null>;

const CORE_TILES: readonly HeadlineDescriptor[] = [
  { id: 'core:compare-summary', order: 100, render: () => null },
  { id: 'core:issues', order: 200, render: () => null },
  { id: 'core:vitals', order: 300, render: () => null },
  { id: 'core:comments', order: 400, when: commentsOn, render: () => null },
];

function CoreTile({ id, props }: { id: string; props: HeadlineProps }) {
  if (id === 'core:issues') return <IssuesTile />;
  if (id === 'core:comments') return <CommentsTile onComment={props.onComment} />;
  if (id === 'core:vitals')
    return (
      <Suspense fallback={null}>
        <VitalsTile bundle={props.bundle} onOpen={() => props.openTab('performance')} />
      </Suspense>
    );
  return props.compareSummary ? <div className="headline-tile headline-compare">{props.compareSummary}</div> : null;
}

const drawn = new WeakMap<HeadlineDescriptor, { key: string; tile: HeadlineTile | null }>();

/** The plugin's tile, rendered again only for another view or replay, so a re-render never redraws its box. */
function pluginTile(descriptor: HeadlineDescriptor, context: HeadlineSlotContext) {
  const key = `${context.view}:${context.replay.meta.id}`;
  const cached = drawn.get(descriptor);
  if (cached?.key === key) return cached.tile;
  const tile = descriptor.render(context);
  drawn.set(descriptor, { key, tile });
  return tile;
}

/** `plugin:acme:budget` → `acme`; a user plugin's id keeps its `user:` prefix. */
function ownerOf(id: string) {
  return id.split(':').slice(1, -1).join(':');
}

/**
 * The view's headline: a strip of tiles between the top bar and the stage (`viewer.headline` items the view lists, in
 * the slot's order). Nothing when the view lists none or none applies.
 */
export function ViewHeadline(props: HeadlineProps) {
  usePluginSnapshot();
  const contextFor = useContext(PluginContexts);
  const slotContext: HeadlineSlotContext = { view: props.view, replay: props.bundle };
  const items = resolveSlot(HEADLINE_SLOT, CORE_TILES, slotContext).filter((item) => props.ids.includes(item.id));
  const tiles = items.flatMap((item) => {
    if (item.id.startsWith('core:'))
      return item.id === 'core:compare-summary' && !props.compareSummary ? [] : [<CoreTile key={item.id} id={item.id} props={props} />];
    const tile = contextFor ? pluginTile(item, slotContext) : null;
    if (!contextFor || !tile) return [];
    return [
      <PluginMount
        key={item.id}
        render={tile.mount}
        context={contextFor(ownerOf(item.id))}
        label={tile.label}
        slot={HEADLINE_SLOT}
        itemId={item.id}
        className="plugin-mount headline-tile"
      />,
    ];
  });
  if (!tiles.length) return null;
  return (
    <section className="view-headline" aria-label={STRINGS.region} data-slot={HEADLINE_SLOT} data-testid="view-headline">
      {tiles}
    </section>
  );
}
