import './editor.css';
import './editor-frame.css';

import { Redo2Icon } from 'lucide-react';
import { type CSSProperties, useCallback, useMemo, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';

import { EMPTY_EDITS, editListOf, editTimeline, isEmptyEdits, type ReplayEdits, type StoredReplayEdits } from '../../shared/edits.ts';
import type { ReplayCaptionStyle } from '../../shared/caption-style.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { EditCaption } from '../edit-caption.tsx';
import type { LoadedEdits } from '../edits.ts';
import { useDocumentTitle } from '../hooks/use-document-title.ts';
import { useEditorKeys } from '../hooks/use-editor-keys.ts';
import { useEditorPreview } from '../hooks/use-editor-preview.ts';
import { useEditorSession } from '../hooks/use-editor-session.ts';
import { useLatest } from '../hooks/use-latest.ts';
import { useMobileEditing } from '../hooks/use-mobile-editing.ts';
import { useNote } from '../hooks/use-note.ts';
import { collectErrors } from '../issues.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { PlayerContext, ReplayController } from '../player.ts';
import { replayHref } from '../route.ts';
import { nextStepIndex, previousStepIndex } from '../timeline.ts';
import { notify } from '../toast.ts';
import { ViewerContext, type ViewerActions } from '../viewer/context.ts';
import { PlayerStage } from '../viewer/Transport.tsx';
import { type BlurPlacement, createEditorActions } from './actions.ts';
import { BlurOverlay } from './BlurOverlay.tsx';
import { EditorPreviewFrame, hintFor, MobilePlayback } from './controls.tsx';
import { CursorInspector } from './CursorInspector.tsx';
import { EditorBar, EditorDock } from './EditorDock.tsx';
import { DockSplit, initialDockCap, initialPanelCollapsed, initialPanelWidth, PanelEdgeTab, PanelSplit, rememberPanelCollapsed } from './EditorSplits.tsx';
import { EditorExport } from './EditorExport.tsx';
import { MobileEditorHeader, MobileTools } from './EditorMobile.tsx';
import { EditorTopbar, editorMenuItems } from './EditorTopbar.tsx';
import { EffectLanes } from './EffectLanes.tsx';
import { PresentationPanel } from './PresentationPanel.tsx';
import { ConflictNotice, SaveIndicator } from './SaveState.tsx';
import { canRedo, canUndo, editorReducer, type EditorShortcut, type EffectKind, initialEditorState, type Selection, waitSuggestions } from './state.ts';
import { editorStrings } from './strings.ts';
import { Timeline } from './Timeline.tsx';

const SEEK = { 'seek-back': -1000, 'seek-forward': 1000, 'seek-back-long': -5000, 'seek-forward-long': 5000, 'nudge-back': -100, 'nudge-forward': 100 } as const;

/**
 * Edit mode (`/r/<id>/edit`), in the spirit of Screen Studio: the preview in the viewer's own player frame, the
 * presentation panel beside it, and one wide timeline under them that holds every edit (Timeline.tsx). Everything is
 * direct manipulation: drag the clip's edges to trim, drag across it to select and C to cut. Playback previews the
 * result live (cuts skipped, stops at the trim end). Changes save on their own; Done returns to the viewer. Edits are
 * a non-destructive list next to the replay (src/shared/edits.ts).
 */
export function Editor({ bundle, loaded }: { bundle: ReplayBundle; loaded: LoadedEdits }) {
  const id = bundle.meta.id;
  const player = useMemo(() => new ReplayController(bundle), [bundle]);
  const duration = player.duration;
  const [state, dispatch] = useReducer(editorReducer, loaded.stored, (stored: StoredReplayEdits) => initialEditorState(editListOf(stored)));
  const [suggesting, setSuggesting] = useState(false);
  const [addedTracks, setAddedTracks] = useState<readonly EffectKind[]>([]);
  const [blurPlacement, setBlurPlacement] = useState<BlurPlacement>();
  const [note, say] = useNote();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const shell = useRef<HTMLElement>(null);
  const dock = useRef<HTMLElement>(null);
  const [dockCap, setDockCap] = useState(initialDockCap);
  const [panelWidth, setPanelWidth] = useState(initialPanelWidth);
  const [panelCollapsed, setPanelCollapsed] = useState(initialPanelCollapsed);
  const collapsePanel = (collapsed: boolean) => {
    rememberPanelCollapsed(collapsed);
    setPanelCollapsed(collapsed);
  };
  const edits = state.present;
  const selection = state.selection;
  const timeline = useMemo(() => editTimeline(edits, duration), [edits, duration]);
  const errors = useMemo(() => collectErrors(bundle), [bundle]);
  const suggestions = useMemo(() => (suggesting ? waitSuggestions(edits, bundle.steps, duration) : []), [bundle.steps, duration, edits, suggesting]);
  const live = useLatest({ state, timeline, suggestions });

  const { effects, playPause } = useEditorPreview(player, edits, timeline, bundle.events, Boolean(blurPlacement) || selection?.kind === 'blur');
  const session = useEditorSession({ id, player, loaded, state, dispatch, timeline, say });
  useDocumentTitle(editorStrings.documentTitle(bundle.meta.title));

  const change = useCallback((next: ReplayEdits, select?: Selection) => {
    dispatch({ type: 'change', edits: next, ...(select ? { select } : {}) });
  }, []);
  const actions = useMemo(
    () => createEditorActions({ player, bundle, live, change, say, setSuggesting, setBlurPlacement }),
    [bundle, change, live, player, say],
  );
  const phone = useMobileEditing({ mobile, shell, player, state, dispatch, live, change, say, actions, setBlurPlacement });

  const runShortcut = (shortcut: EditorShortcut) => {
    if (shortcut in SEEK) {
      player.seek(player.getTime() + SEEK[shortcut as keyof typeof SEEK]);
      return;
    }
    switch (shortcut) {
      case 'undo':
      case 'redo':
        return dispatch({ type: shortcut });
      case 'save':
        return void session.save();
      case 'play-pause':
        return playPause();
      case 'previous-step':
      case 'next-step': {
        const index = (shortcut === 'next-step' ? nextStepIndex : previousStepIndex)(bundle.steps, player.getTime());
        if (index >= 0) player.seek(bundle.steps[index]!.at);
        return;
      }
      case 'trim-start':
        return actions.trimStart();
      case 'trim-end':
        return actions.trimEnd();
      case 'add-cut':
        return actions.cut();
      case 'remove-waits':
        return actions.removeWaits();
      case 'zoom':
      case 'speed':
      case 'blur':
      case 'caption':
        return actions.effect(shortcut);
      case 'highlight':
        return actions.pointHighlight();
      case 'apply':
        if (live.current.suggestions.length) actions.applySuggestions();
        else if (live.current.state.selection?.kind === 'range') actions.cut();
        return;
      case 'delete':
        return actions.deleteSelection();
      case 'deselect':
        phone.close();
        setBlurPlacement(undefined);
        setSuggesting(false);
        return dispatch({ type: 'select', selection: undefined });
    }
  };
  useEditorKeys(runShortcut, editorStrings.isMac);

  const viewerActions = useMemo<ViewerActions>(
    () => ({
      steps: bundle.steps,
      errors,
      setTab: () => undefined,
      setExpandedRequest: () => undefined,
      goToStep: (index) => {
        const step = bundle.steps[index];
        if (step) player.seek(step.at);
      },
      goToNextStep: () => undefined,
      goToPreviousStep: () => undefined,
      jumpToError: (error) => player.seek(error.at),
      goToNextError: () => undefined,
      goToPreviousError: () => undefined,
      copyLink: () => undefined,
      switchFullscreen: () => undefined,
      openShortcuts: () => undefined,
      notify: (message) => notify(message),
      captions: false,
      switchCaptions: () => undefined,
    }),
    [bundle.steps, errors, player],
  );

  const menu = editorMenuItems({
    viewOriginal: () => void session.leave({ original: true }),
    removeWaits: actions.removeWaits,
    resetEdits: () => change(EMPTY_EDITS),
    canReset: !isEmptyEdits(edits),
  });
  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });
  const saveIndicator = (
    <SaveIndicator status={session.status} dirty={session.dirty} stored={session.stored} failure={session.failure} onRetry={() => void session.save()} />
  );
  const exportAction = <EditorExport meta={bundle.meta} stored={session.stored} dirty={session.dirty} saving={session.status === 'saving'} />;
  const setCaptionStyle = (style: ReplayCaptionStyle) => {
    const { captionStyle: _previous, ...rest } = live.current.state.present;
    change({ ...rest, captionStyle: style });
  };
  const setCursor = (cursor: ReplayEdits['cursor']) => {
    const { cursor: _previous, ...rest } = live.current.state.present;
    change(cursor ? { ...rest, cursor } : rest);
  };
  const timelineDispatch = mobile ? phone.timelineDispatch : dispatch;

  return (
    <PlayerContext.Provider value={player}>
      <ViewerContext.Provider value={viewerActions}>
        <main
          ref={shell}
          className="app-shell editor-shell"
          data-mobile={mobile || undefined}
          data-testid="editor"
          style={
            mobile
              ? undefined
              : ({ '--dock-height': `${dockCap}px`, '--editor-panel-width': `${panelCollapsed ? 0 : panelWidth}px` } as CSSProperties)
          }
        >
          {mobile ? (
            <MobileEditorHeader
              title={bundle.meta.title}
              status={
                session.conflict ? (
                  <span className="editor-save-state" role="status">
                    {editorStrings.save.mobileConflict}
                  </span>
                ) : (
                  saveIndicator
                )
              }
              canUndo={canUndo(state)}
              onUndo={undo}
              exportAction={exportAction}
              menu={[
                {
                  id: 'core:redo',
                  label: editorStrings.topbar.redo,
                  icon: <Redo2Icon aria-hidden="true" />,
                  onSelect: redo,
                  disabled: !canRedo(state),
                  shortcut: editorStrings.topbar.redoKeys,
                  testId: 'redo',
                },
                ...menu,
              ]}
              mobile={phone}
              onBack={() => void session.leave()}
            />
          ) : (
            <EditorTopbar
              title={bundle.meta.title}
              backHref={replayHref(id)}
              status={saveIndicator}
              context={{ canUndo: canUndo(state), canRedo: canRedo(state), undo, redo, done: () => void session.leave(), exportAction, menu }}
            />
          )}
          <section className="editor-stage" aria-label="Preview">
            <EditorPreviewFrame>
              <PlayerStage />
              <BlurOverlay
                edits={edits}
                selection={selection}
                dispatch={dispatch}
                placing={Boolean(blurPlacement)}
                onCancel={() => setBlurPlacement(undefined)}
                onPlace={(box) => actions.placeBlur(blurPlacement, box)}
              />
              {effects.captions.length ? <EditCaption captions={effects.captions} style={effects.captionStyle} /> : null}
            </EditorPreviewFrame>
            {mobile ? null : (
              <PanelSplit shell={shell} width={panelWidth} onWidthChange={setPanelWidth} collapsed={panelCollapsed} onCollapsedChange={collapsePanel} />
            )}
            {mobile ? null : panelCollapsed ? <PanelEdgeTab onOpen={() => collapsePanel(false)} /> : <PresentationPanel context={{ edits, setCursor, setCaptionStyle }} />}
          </section>
          {mobile ? null : <DockSplit shell={shell} dock={dock} onChange={setDockCap} />}
          <EditorDock
            dockRef={dock}
            mobile={mobile}
            controls={
              mobile ? (
                <>
                  <MobilePlayback onSwitch={playPause} original={timeline.originalDuration} edited={timeline.duration} />
                  {suggestions.length ? <MobileSuggestions count={suggestions.length} onApply={actions.applySuggestions} onDismiss={() => setSuggesting(false)} /> : null}
                </>
              ) : (
                <EditorBar
                  actions={actions}
                  playPause={playPause}
                  edits={edits}
                  selection={selection}
                  change={change}
                  duration={duration}
                  timeline={timeline}
                  suggestions={suggestions.length}
                  onDismissSuggestions={() => setSuggesting(false)}
                />
              )
            }
            notice={session.conflict ? <ConflictNotice conflict={session.conflict} onLoadTheirs={session.loadTheirs} onKeepMine={session.keepMine} /> : null}
            timeline={
              <Timeline
                mobile={mobile}
                duration={duration}
                edits={edits}
                selection={mobile ? phone.mobileSelection : selection}
                dispatch={timelineDispatch}
                suggestions={suggestions}
                onCutRange={actions.cut}
                lanes={
                  <EffectLanes
                    edits={edits}
                    selection={selection}
                    dispatch={timelineDispatch}
                    added={addedTracks}
                    {...(mobile ? {} : { onAddTrack: (kind: EffectKind) => setAddedTracks((tracks) => [...tracks.filter((item) => item !== kind), kind]) })}
                  />
                }
              />
            }
            tools={
              mobile ? (
                <MobileTools
                  edits={edits}
                  state={state}
                  duration={duration}
                  bundle={bundle}
                  player={player}
                  mobile={phone}
                  actions={actions}
                  change={change}
                  dispatch={dispatch}
                  say={say}
                  shell={shell}
                  placingBlur={Boolean(blurPlacement)}
                  cursorInspector={<CursorInspector settings={edits.cursor} onChange={setCursor} onClose={phone.finish} />}
                />
              ) : null
            }
            note={note}
            hint={hintFor(selection, suggesting, isEmptyEdits(edits))}
          />
        </main>
      </ViewerContext.Provider>
    </PlayerContext.Provider>
  );
}

function MobileSuggestions({ count, onApply, onDismiss }: { count: number; onApply: () => void; onDismiss: () => void }) {
  const strings = editorStrings.dock;
  return (
    <div className="editor-suggest" role="status" data-testid="wait-suggestions">
      {strings.waitsFound(count)}
      <Button variant="secondary" onClick={onApply} data-testid="apply-waits">
        {strings.removeAll}
      </Button>
      <Button variant="ghost" onClick={onDismiss}>
        {strings.dismiss}
      </Button>
    </div>
  );
}
