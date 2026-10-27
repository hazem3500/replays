import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { assertReplayBundle, type ReplayBundle } from '../../shared/replay.ts';
import type { ReplayController } from '../player.ts';
import { replayQuery } from '../queries.ts';
import { appBase, indexReturnHref } from '../route.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { Topbar } from '../Topbar.tsx';
import { Settings2Icon, Maximize2Icon, Minimize2Icon, LayoutGridIcon } from 'lucide-react';
import { IconButton } from '@/components/icon-button.tsx';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { ComparisonCoordinator, type ComparisonSide } from './coordinator.ts';
import { ComparisonAlignment, ComparisonTransport } from './ComparisonTransport.tsx';
import { EvidencePanel } from './EvidencePanels.tsx';
import { comparisonErrors, comparisonReplayId, evidenceSuggestion, SIDE_LABELS, type ComparisonError } from './model.ts';
import {
  defaultLayout,
  LAYOUTS,
  LAYOUT_LABELS,
  movePanel,
  PANEL_LABELS,
  PANEL_SIZES,
  parsePreferences,
  type ComparisonLayout,
  type LayoutPreference,
} from './preferences.ts';
import { ReplayStage, SideClock } from './ReplayStage.tsx';
import { ScenarioAlignment } from './ScenarioAlignment.tsx';
import { ComparisonLoading } from './ComparisonLoading.tsx';

export interface ComparisonWorkspaceProps {
  beforeId: string;
  afterId: string;
  /** Optional route integration. Called only after an explicit source change in this workspace. */
  onSelectionChange?(selection: { beforeId: string; afterId: string }): void;
}

/** Mount below the app's existing QueryClientProvider and ThemeContext. Original timelines only in this beta. */
export function ComparisonWorkspace(props: ComparisonWorkspaceProps) {
  const [coordinator, setCoordinator] = useState<ComparisonCoordinator>();
  useEffect(() => {
    // Construct in the effect so StrictMode's setup/cleanup rehearsal gets a fresh live coordinator.
    const next = new ComparisonCoordinator();
    // oxlint-disable-next-line react/set-state-in-effect -- Publish the owned external clock after acquiring its StrictMode-safe lifetime.
    setCoordinator(next);
    return () => next.dispose();
  }, []);
  return coordinator ? <ComparisonSession {...props} coordinator={coordinator} /> : <ComparisonLoading />;
}

function revealSide(side: ComparisonSide) {
  document.getElementById(`comparison-source-${side}`)?.scrollIntoView({ block: 'nearest' });
}

function sourceId(value: string) {
  try {
    return { id: comparisonReplayId(value, window.location.origin, appBase()), error: '' };
  } catch (error) {
    return { id: '', error: error instanceof Error ? error.message : 'Invalid replay ID.' };
  }
}

function validatedBundle(value: ReplayBundle | undefined) {
  if (!value) return { bundle: undefined, error: '' };
  try {
    assertReplayBundle(value);
    if (![value.meta.viewport?.width, value.meta.viewport?.height].every((dimension) => Number.isFinite(dimension) && dimension! > 0))
      throw new Error('The recording has no valid viewport.');
    return { bundle: value, error: '' };
  } catch (error) {
    return { bundle: undefined, error: error instanceof Error ? error.message : 'Invalid recording.' };
  }
}

function ComparisonSession({
  beforeId,
  afterId,
  onSelectionChange,
  coordinator,
}: ComparisonWorkspaceProps & { coordinator: ComparisonCoordinator }) {
  const [sources, setSources] = useState({ a: beforeId, b: afterId });
  const [incoming, setIncoming] = useState({ beforeId, afterId });
  if (incoming.beforeId !== beforeId || incoming.afterId !== afterId) {
    setIncoming({ beforeId, afterId });
    setSources({ a: beforeId, b: afterId });
  }
  const aId = sourceId(sources.a);
  const bId = sourceId(sources.b);
  const aQuery = useQuery({ ...replayQuery(aId.id), enabled: Boolean(aId.id) });
  const bQuery = useQuery({ ...replayQuery(bId.id), enabled: Boolean(bId.id) });
  const a = useMemo(() => validatedBundle(aQuery.data), [aQuery.data]);
  const b = useMemo(() => validatedBundle(bQuery.data), [bQuery.data]);
  const bundles = useMemo(() => ({ ...(a.bundle ? { a: a.bundle } : {}), ...(b.bundle ? { b: b.bundle } : {}) }), [a.bundle, b.bundle]);
  const players = useRef<Partial<Record<ComparisonSide, ReplayController>>>({});
  const register = useCallback((side: ComparisonSide, player: ReplayController | undefined) => {
    if (player) players.current[side] = player;
    else delete players.current[side];
  }, []);
  const getPlayers = useCallback(() => Object.values(players.current), []);
  const offsetA = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().offsetA);
  const offsetB = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().offsetB);
  const errors = useMemo(() => comparisonErrors(bundles, offsetB, offsetA), [bundles, offsetB, offsetA]);
  const [selectedError, setSelectedError] = useState<string>();
  const storageKey = `replays-comparison-layouts-v1:${appBase() || '/'}`;
  const [preferences, setPreferences] = useState(() => parsePreferences(readStorage(storageKey)));
  const [layout, setLayout] = useState<ComparisonLayout>('performance');
  const preference = preferences[layout];
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<ComparisonSide>();
  const inspector = useRef<HTMLElement>(null);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (inspector.current) inspector.current.scrollTop = 0;
    document.querySelector<HTMLButtonElement>('.cmp-replay .topbar-more')?.focus();
  }, []);
  useEffect(() => {
    if (!spotlight && !settingsOpen) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (settingsOpen) closeSettings();
      else setSpotlight(undefined);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [spotlight, settingsOpen, closeSettings]);
  const [activePanel, setActivePanel] = useState('performance');
  const inspectorItems = [
    ...(Math.max(a.bundle?.steps.length ?? 0, b.bundle?.steps.length ?? 0) > 0 ? [{ id: 'steps', label: 'Steps' }] : []),
    { id: 'console', label: 'Console' },
    { id: 'network', label: 'Network' },
    { id: 'performance', label: 'Performance' },
    { id: 'context', label: 'Context' },
    { id: 'errors', label: 'Errors' },
  ];
  const panelKey = activePanel === 'steps' ? 'journey' : activePanel === 'context' ? 'context' : activePanel;

  const customize = (value: LayoutPreference) => {
    const next = { ...preferences, [layout]: value };
    setPreferences(next);
    writeStorage(storageKey, JSON.stringify({ version: 1, layouts: next }));
  };
  const selectError = (error: ComparisonError) => {
    const duration = coordinator.getSnapshot().duration;
    if (error.sharedAt < 0 || error.sharedAt > duration) return;
    coordinator.seek(error.sharedAt);
    revealSide(error.side);
    setSelectedError(error.id);
    setActivePanel('errors');
    if (!preference.panels.find((panel) => panel.id === 'errors')?.visible)
      customize({ ...preference, panels: preference.panels.map((panel) => (panel.id === 'errors' ? { ...panel, visible: true } : panel)) });
  };
  const replace = (side: ComparisonSide, id: string) => {
    // A replacement needs fresh scenario confirmation; preserve player mounts, reset the shared alignment.
    coordinator.resetAlignment();
    for (const player of getPlayers()) player.endScrub();
    const next = { ...sources, [side]: id };
    setSources(next);
    setSelectedError(undefined);
    onSelectionChange?.({ beforeId: next.a, afterId: next.b });
  };
  const sourceViews = [
    { side: 'a' as const, id: aId, query: aQuery, data: a },
    { side: 'b' as const, id: bId, query: bQuery, data: b },
  ];
  return (
    <main
      className="cmp-workspace cmp-replay"
      data-comparison-version="replay-integrated"
      data-layout={layout}
      data-canvas-size={preference.canvas}
    >
      <Topbar
        title={a.bundle?.meta.title ?? 'Compare recordings'}
        prefix="Compare"
        compact={mobile}
        backHref={indexReturnHref()}
        alwaysMenu
        menuItems={[
          {
            label: 'Gallery view',
            icon: <LayoutGridIcon aria-hidden="true" />,
            disabled: !spotlight,
            onSelect: () => setSpotlight(undefined),
          },
          {
            label: 'Comparison settings',
            icon: <Settings2Icon aria-hidden="true" />,
            onSelect: () => {
              setSettingsOpen((value) => !value);
              if (inspector.current) inspector.current.scrollTop = 0;
            },
          },
        ]}
      />
      <div className="cmp-stages" data-spotlight={spotlight}>
        {sourceViews.map(({ side, id, query, data }) => {
          const error =
            id.error || data.error || (query.error instanceof Error ? query.error.message : query.error ? 'Recording failed to load.' : '');
          return (
            <section
              key={side}
              id={`comparison-source-${side}`}
              className="cmp-side"
              data-spotlit={spotlight === side || undefined}
              aria-label={SIDE_LABELS[side]}
            >
              <header>
                <h2>{SIDE_LABELS[side]}</h2>
                <span className="cmp-recording-title">{data.bundle?.meta.title || id.id || 'Choose a recording'}</span>
                <IconButton
                  label={spotlight === side ? 'Return to gallery' : `Expand ${side === 'a' ? 'Before' : 'After'} recording`}
                  className="cmp-expand"
                  onClick={() => setSpotlight(spotlight === side ? undefined : side)}
                >
                  {spotlight === side ? <Minimize2Icon aria-hidden="true" /> : <Maximize2Icon aria-hidden="true" />}
                </IconButton>
              </header>
              {error ? (
                <div className="cmp-load-state" role="alert">
                  <p>{error}</p>
                  {id.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        void query.refetch();
                      }}
                    >
                      Retry {side.toUpperCase()} recording
                    </button>
                  ) : null}
                </div>
              ) : query.isPending ? (
                <div className="cmp-load-state" role="status">
                  Loading {SIDE_LABELS[side]}…<p>The other recording remains available.</p>
                </div>
              ) : data.bundle ? (
                <ReplayStage
                  key={id.id}
                  bundle={data.bundle}
                  side={side}
                  coordinator={coordinator}
                  register={register}
                  captions={layout === 'walkthrough'}
                />
              ) : null}
              <SideClock coordinator={coordinator} side={side} />
            </section>
          );
        })}
      </div>
      <ComparisonTransport coordinator={coordinator} getPlayers={getPlayers} />
      <section ref={inspector} className="inspector cmp-inspector">
        <div className="inspector-tabs">
          <Tabs value={activePanel} onValueChange={setActivePanel} className="inspector-navigation" data-layout="direct">
            <TabsList
              variant="line"
              activateOnFocus
              aria-label="Comparison panels"
              className="inspector-tablist"
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
              }}
            >
              {inspectorItems.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="inspector-tab" data-testid={`${item.id}-tab`}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {settingsOpen ? (
          <section className="cmp-settings" aria-label="Comparison settings">
            <div className="cmp-settings-heading">
              <h2>Comparison settings</h2>
              <button type="button" onClick={closeSettings}>
                Done
              </button>
            </div>
            <ScenarioAlignment key={`${sources.a}:${sources.b}`} bundles={bundles} coordinator={coordinator} />
            <ComparisonAlignment coordinator={coordinator} errors={errors} onError={selectError} />
            <p className="cmp-semantics">
              Original timelines: saved cuts, speed ranges and editor effects/captions are not applied. Step captions use recorded labels.
              Duration is never stretched. Synchronization is best effort, with bounded drift correction.
            </p>
            <div className="cmp-layout-toolbar">
              <label>
                Task layout{' '}
                <select
                  value={layout}
                  onChange={(event) => {
                    const next = event.target.value as ComparisonLayout;
                    setLayout(next);
                    setActivePanel(
                      next === 'walkthrough' ? 'steps' : next === 'design' ? 'context' : next === 'debugging' ? 'errors' : 'performance',
                    );
                  }}
                >
                  {LAYOUTS.map((id) => (
                    <option key={id} value={id}>
                      {LAYOUT_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>
              <p>{evidenceSuggestion(bundles)}</p>
            </div>
            <SourcePicker key={`a:${sources.a}`} side="a" value={sources.a} onSelect={(next) => replace('a', next)} />
            <SourcePicker key={`b:${sources.b}`} side="b" value={sources.b} onSelect={(next) => replace('b', next)} />
            <details className="cmp-customize">
              <summary>Customize {LAYOUT_LABELS[layout].toLowerCase()} layout</summary>
              <p>Visibility, order and size are saved for this task layout in this browser.</p>
              <label>
                Canvas size{' '}
                <select
                  value={preference.canvas}
                  onChange={(event) => customize({ ...preference, canvas: event.target.value as LayoutPreference['canvas'] })}
                >
                  {PANEL_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cmp-panel-controls">
                {preference.panels.map((panel, index) => (
                  <fieldset key={panel.id}>
                    <legend>{PANEL_LABELS[panel.id]}</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={panel.visible}
                        onChange={(event) =>
                          customize({
                            ...preference,
                            panels: preference.panels.map((item) =>
                              item.id === panel.id ? { ...item, visible: event.target.checked } : item,
                            ),
                          })
                        }
                      />
                      Show
                    </label>
                    <label>
                      Size
                      <select
                        aria-label={`${PANEL_LABELS[panel.id]} size`}
                        value={panel.size}
                        onChange={(event) =>
                          customize({
                            ...preference,
                            panels: preference.panels.map((item) =>
                              item.id === panel.id ? { ...item, size: event.target.value as typeof item.size } : item,
                            ),
                          })
                        }
                      >
                        {PANEL_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${PANEL_LABELS[panel.id]} earlier`}
                      onClick={() => customize(movePanel(preference, panel.id, -1))}
                    >
                      ↑ Earlier
                    </button>
                    <button
                      type="button"
                      disabled={index === preference.panels.length - 1}
                      aria-label={`Move ${PANEL_LABELS[panel.id]} later`}
                      onClick={() => customize(movePanel(preference, panel.id, 1))}
                    >
                      ↓ Later
                    </button>
                  </fieldset>
                ))}
              </div>
              <button type="button" onClick={() => customize(defaultLayout(layout))}>
                Reset {LAYOUT_LABELS[layout].toLowerCase()} layout
              </button>
            </details>
          </section>
        ) : null}
        {activePanel === 'context' ? (
          <section role="tabpanel" id="context-panel" aria-labelledby="context-tab" className="cmp-context">
            {sourceViews.map(({ side, data }) => (
              <section key={side}>
                <h2>{SIDE_LABELS[side]}</h2>
                <dl>
                  <dt>Recording</dt>
                  <dd>{data.bundle?.meta.title ?? 'Not loaded'}</dd>
                  <dt>Page</dt>
                  <dd>{data.bundle?.meta.url ?? 'Not recorded'}</dd>
                  <dt>Application</dt>
                  <dd>{data.bundle?.context?.app?.name ?? 'Not recorded'}</dd>
                </dl>
              </section>
            ))}
          </section>
        ) : null}
        <div className="cmp-panels">
          {preference.panels
            .filter((panel) => panel.id === panelKey)
            .map((panel) => (
              <ComparisonEvidence
                key={panel.id}
                panel={panel.id}
                size={panel.size}
                bundles={bundles}
                offsetB={offsetB}
                offsetA={offsetA}
                coordinator={coordinator}
                errors={errors}
                selectedError={selectedError}
                onError={selectError}
                reveal={revealSide}
              />
            ))}
        </div>
      </section>
    </main>
  );
}

function ComparisonEvidence({ size, ...props }: Parameters<typeof EvidencePanel>[0] & { size: string }) {
  return (
    <section
      role="tabpanel"
      id={`${props.panel === 'journey' ? 'steps' : props.panel}-panel`}
      aria-label={PANEL_LABELS[props.panel]}
      className="cmp-panel"
      data-panel={props.panel}
      data-size={size}
      aria-labelledby={`comparison-panel-${props.panel}`}
    >
      <h2 id={`comparison-panel-${props.panel}`}>{PANEL_LABELS[props.panel]}</h2>
      {/* The overflow region needs focus so keyboard users can scroll its evidence. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="cmp-panel-body" role="region" aria-label={`${PANEL_LABELS[props.panel]} evidence`} tabIndex={0}>
        <EvidencePanel {...props} />
      </div>
    </section>
  );
}

function SourcePicker({ side, value, onSelect }: { side: ComparisonSide; value: string; onSelect(id: string): void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  return (
    <form
      className="cmp-source-picker"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = sourceId(draft);
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        onSelect(parsed.id);
        setError('');
      }}
    >
      <label htmlFor={`comparison-id-${side}`}>Replay ID or workspace URL</label>
      <div>
        <input
          id={`comparison-id-${side}`}
          value={draft}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `comparison-id-error-${side}` : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Change {side.toUpperCase()}</button>
      </div>
      {error ? (
        <p id={`comparison-id-error-${side}`} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
