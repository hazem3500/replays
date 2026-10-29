import {
  CheckIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  HashIcon,
  ListChecksIcon,
  type LucideIcon,
  TagIcon,
  XIcon,
} from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { type ReactElement, type ReactNode, useContext, useId, useLayoutEffect, useRef, useState } from 'react';

import type { ReplayContext, ReplaySourceRef } from '../../shared/context.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { FieldSchema } from '../config.ts';
import { formatRelative } from '../format.ts';
import { sourceLook } from '../source-looks.ts';
import { type FieldRow, type FieldValue, fieldGroups, httpsHref, type Signal, type SignalState } from './context-fields.ts';
import { ViewerContext } from './context.ts';
import { Empty } from './Empty.tsx';
import { SourceIcon } from '@/components/brand-icon.tsx';
import { CopyButton } from '@/components/copy-button.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Badge } from '@/components/ui/badge.tsx';

import './context-panel.css';

/*
 * The Context tab: a properties panel for the opt-in replay context (see README "Capture a replay").
 * A summary line (app, environment, snapshot age), the source links that explain why the replay exists, then
 * App / Test groups of label–value rows and one group for the deployment's own `fields`, rendered from the
 * configured JSON Schema (context-fields.ts). Groups and rows with no data are omitted.
 */

type ContextBundle = Pick<ReplayBundle, 'meta' | 'context'>;

function absoluteTime(iso: string) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : iso;
}

/** Raises a toast through the viewer when one is mounted (the panel also renders standalone in tests). */
function useNotify() {
  return useContext(ViewerContext)?.notify;
}

export function ContextPanel({
  bundle,
  schema,
  sections,
}: {
  bundle: ContextBundle;
  schema?: FieldSchema | undefined;
  /** Blocks client plugins add to the tab (registerContextSection), drawn after the built-in groups. */
  sections?: ReactNode;
}) {
  const context = bundle.context;
  if (!context) {
    return (
      <div className="table-scroll" data-testid="context-empty">
        <Empty title="No context was captured">
          Pass --context-file to the capture CLI to attach the build, test and sources behind a run.
        </Empty>
        {sections ? <div className="ctx-inner ctx-plugin-sections">{sections}</div> : null}
      </div>
    );
  }
  return (
    <div data-testid="context-panel" className="table-scroll ctx">
      <div className="ctx-inner">
        <Summary context={context} />
        {context.sources?.length ? <Sources sources={context.sources} /> : null}
        <Groups context={context} schema={schema} />
        {sections}
      </div>
    </div>
  );
}

/** One plugin block in the Context tab: the same heading as a built-in group, the plugin's DOM below it. */
export function ContextSection({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section className="ctx-section ctx-plugin-section" aria-labelledby={heading} data-testid={testId}>
      <h2 id={heading} className="ctx-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Summary({ context }: { context: ReplayContext }) {
  const environment = context.app?.environment;
  return (
    // One calm line: the app, its environment as a small neutral badge; the snapshot's age on the right (the
    // exact time in its tooltip and title).
    <div className="ctx-summary">
      {context.app?.name ? <span className="ctx-product">{context.app.name}</span> : null}
      {environment ? (
        <Badge variant="outline" className="ctx-env" data-env={environment}>
          {environment}
        </Badge>
      ) : null}
      <Hint label={`Snapshot taken ${absoluteTime(context.capturedAt)}`}>
        <span className="ctx-asof" title={absoluteTime(context.capturedAt)}>
          Snapshot <time dateTime={context.capturedAt}>{formatRelative(context.capturedAt, undefined, 'narrow')}</time>
        </span>
      </Hint>
    </div>
  );
}

/* ---------- Sources ---------- */

/** The row's text: its label, else its reference, else the URL's host. */
function sourceLabel(source: ReplaySourceRef) {
  if (source.label) return source.label;
  if (source.ref) return source.ref;
  return httpsHref(source.url) ? new URL(source.url).host : source.provider;
}

function SourceRow({ source }: { source: ReplaySourceRef }) {
  const href = httpsHref(source.url);
  return (
    <li className="ctx-source" data-icon-host="">
      <SourceIcon provider={source.provider} className="ctx-source-icon" />
      {href ? (
        <a className="ctx-source-link" href={href} target="_blank" rel="noopener noreferrer">
          {sourceLabel(source)}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      ) : (
        <span className="ctx-source-link">{sourceLabel(source)}</span>
      )}
      <SourceMeta source={source} />
      {href ? <AnimatedIcon name="arrow-up-right" className="ctx-source-arrow" /> : null}
    </li>
  );
}

/** What the source is (the provider's noun, else its id), then its attributes' values; the keys are in the tooltip. */
function SourceMeta({ source }: { source: ReplaySourceRef }) {
  const what = sourceLook(source.provider)?.noun ?? source.provider;
  const attrs = Object.entries(source.attrs ?? {});
  const text = [what, ...attrs.map(([, value]) => String(value))].join(' · ');
  return (
    <span className="ctx-source-meta" title={attrs.length ? attrs.map(([key, value]) => `${key}: ${value}`).join('\n') : undefined}>
      {text}
    </span>
  );
}

function Sources({ sources }: { sources: ReplaySourceRef[] }) {
  const heading = useId();
  return (
    <section className="ctx-section ctx-sources" aria-labelledby={heading}>
      <h2 id={heading} className="ctx-heading">
        Sources
      </h2>
      <ul className="ctx-source-list">
        {sources.map((source, index) => (
          <SourceRow key={`${source.provider}-${index}`} source={source} />
        ))}
      </ul>
    </section>
  );
}

/* ---------- Groups and rows ---------- */

interface Row {
  key: string;
  label: string;
  icon: LucideIcon;
  value: ReactNode;
}

function Groups({ context, schema }: { context: ReplayContext; schema: FieldSchema | undefined }) {
  const { app, test, fields } = context;

  const build: Row[] = [];
  if (app?.version) build.push({ key: 'version', label: 'Version', icon: TagIcon, value: <Text value={app.version} /> });
  if (app?.commit)
    build.push({
      key: 'commit',
      label: 'Commit',
      icon: GitCommitHorizontalIcon,
      value: (
        <>
          <Text value={app.commit.slice(0, 7)} full={app.commit} mono />
          <Actions>
            <Copy value={app.commit} what="commit SHA" />
          </Actions>
        </>
      ),
    });
  if (app?.origin)
    build.push({
      key: 'origin',
      label: 'App origin',
      icon: GlobeIcon,
      value: (
        <>
          <Text value={app.origin} mono />
          {httpsHref(app.origin) ? (
            <Actions>
              <OpenLink href={app.origin} label="Open app origin" />
            </Actions>
          ) : null}
        </>
      ),
    });

  const testRows: Row[] = [];
  if (test?.suite) testRows.push({ key: 'suite', label: 'Suite', icon: FlaskConicalIcon, value: <Text value={test.suite} /> });
  if (test?.case) testRows.push({ key: 'case', label: 'Case', icon: ListChecksIcon, value: <Text value={test.case} /> });
  if (test?.runId)
    testRows.push({
      key: 'run',
      label: 'Run ID',
      icon: HashIcon,
      value: (
        <>
          <Text value={test.runId} mono />
          <Actions>
            <Copy value={test.runId} what="run ID" />
          </Actions>
        </>
      ),
    });

  const custom = fields ? fieldGroups(fields, schema) : [];
  const groups = [
    { title: 'Build', rows: build },
    { title: 'Test', rows: testRows },
  ].filter((group) => group.rows.length > 0);
  if (!groups.length && !custom.length) return null;
  return (
    <div className="ctx-groups">
      {groups.map((group) => (
        <Group key={group.title} title={group.title} rows={group.rows} />
      ))}
      {custom.map((group) => (
        <Fields
          key={group.title ?? ''}
          title={group.title ?? (schema?.title || 'Details')}
          rows={group.rows}
          testId={group.title === undefined ? 'context-fields' : `context-group:${group.title}`}
        />
      ))}
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  const heading = useId();
  return (
    <section className="ctx-section ctx-group" aria-labelledby={heading}>
      <h2 id={heading} className="ctx-heading">
        {title}
      </h2>
      <dl className="ctx-rows">
        {rows.map(({ key, label, icon: Icon, value }) => (
          <div key={key} className="ctx-row">
            <dt>
              <Icon aria-hidden="true" />
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- The deployment's own fields ---------- */

function Fields({ title, rows, testId }: { title: string; rows: FieldRow[]; testId: string }) {
  const heading = useId();
  return (
    <section className="ctx-section ctx-group ctx-fields" aria-labelledby={heading} data-testid={testId}>
      <h2 id={heading} className="ctx-heading">
        {title}
      </h2>
      <FieldList rows={rows} />
    </section>
  );
}

/** Label–value rows; nested objects and lists of objects indent as lists of their own. */
function FieldList({ rows, nested = false }: { rows: FieldRow[]; nested?: boolean }) {
  return (
    <dl className="ctx-rows" data-nested={nested || undefined}>
      {rows.map((row) => (
        <div key={row.key} className="ctx-row" data-block={row.value.kind === 'rows' || undefined}>
          <dt>
            {row.help ? (
              <Hint label={row.help} side="top" align="start">
                <span className="ctx-label" data-help="">
                  {row.label}
                </span>
              </Hint>
            ) : (
              <span className="ctx-label">{row.label}</span>
            )}
          </dt>
          <dd>
            <FieldValueView value={row.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldValueView({ value }: { value: FieldValue }): ReactElement {
  switch (value.kind) {
    case 'empty':
      return <span className="ctx-value ctx-muted">Empty</span>;
    case 'text':
      return <Text value={value.text} />;
    case 'boolean':
      return (
        <span className="ctx-bool" data-value={value.value}>
          {value.value ? <CheckIcon aria-hidden="true" /> : null}
          {value.text}
        </span>
      );
    case 'link':
      return (
        <a className="ctx-link" href={value.href} target="_blank" rel="noopener noreferrer">
          <span className="ctx-value">{value.text}</span>
          <AnimatedIcon name="arrow-up-right" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      );
    case 'chips':
      return (
        <ul className="ctx-chips">
          {value.items.map((item, index) => (
            <li key={`${item}-${index}`} className="ctx-chip">
              <code>{item}</code>
            </li>
          ))}
        </ul>
      );
    case 'signals':
      return <Signals items={value.items} />;
    case 'rows':
      return <FieldList rows={value.rows} nested />;
  }
}

const SIGNAL_LABEL: Record<SignalState, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  unknown: 'Unknown: not supplied or not loaded',
};

const SIGNAL_ICON: Record<SignalState, LucideIcon> = {
  enabled: CheckIcon,
  disabled: XIcon,
  unknown: CircleHelpIcon,
};

/**
 * Tri-state flags (`x-replays-widget: "signals"`): a check for enabled, a cross on muted text for disabled, and for
 * unknown a question mark on a dashed outline, so "we don't know" never reads as "off".
 */
function Signals({ items }: { items: Signal[] }) {
  return (
    <ul className="ctx-chips" data-widget="signals">
      {items.map(({ key, state, label }, index) => {
        const Icon = SIGNAL_ICON[state];
        const name = label ?? key;
        return (
          <Hint key={`${key}-${index}`} label={`${name}: ${SIGNAL_LABEL[state]}`}>
            <li className="ctx-chip ctx-signal" data-state={state} data-testid="context-signal">
              <Icon aria-hidden="true" />
              <code>{name}</code>
              <span className="visually-hidden">: {state}</span>
            </li>
          </Hint>
        );
      })}
    </ul>
  );
}

/** A value that truncates to one line; the tooltip (with the full value) only exists while it is cut off. */
function Text({ value, full = value, mono = false }: { value: string; full?: string; mono?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setCut(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <Hint label={full} disabled={!cut && full === value} side="top" align="start">
      <span ref={ref} className="ctx-value" data-mono={mono || undefined}>
        {value}
      </span>
    </Hint>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <span className="ctx-actions">{children}</span>;
}

function Copy({ value, what }: { value: string; what: string }) {
  const notify = useNotify();
  return (
    <CopyButton
      value={value}
      label={`Copy ${what}`}
      className="ctx-action"
      onCopied={(copied) => notify?.(copied ? `Copied ${what}` : `Could not copy the ${what}`)}
    />
  );
}

/** A compact ↗ icon link (new tab) with a tooltip; `label` is the accessible name, `hint` the visible tooltip. */
function OpenLink({ href, label, hint = label }: { href: string; label: string; hint?: string }): ReactElement {
  return (
    <Hint label={hint}>
      <a className="ctx-action ctx-open" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>
        <AnimatedIcon name="arrow-up-right" />
      </a>
    </Hint>
  );
}
