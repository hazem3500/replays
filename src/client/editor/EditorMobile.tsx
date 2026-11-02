import { ArrowLeftIcon, EllipsisIcon, MousePointer2Icon, Undo2Icon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';

import type { ReplayEdits } from '../../shared/edits.ts';
import { proposeStepCaptions } from '../../shared/effects.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { MobileEditing } from '../hooks/use-mobile-editing.ts';
import type { ReplayController } from '../player.ts';
import { ThemeSwitch } from '../theme.tsx';
import { type EditorActions, zoomOnClicks } from './actions.ts';
import { EffectControls, HighlightControls } from './controls.tsx';
import type { EditorMenuItem } from './EditorTopbar.tsx';
import { MobileAddToolbar, MobileInspector, mobileTimelineObjects } from './MobileInspector.tsx';
import { type EditorAction, type EditorState, type Selection, withEffectList } from './state.ts';
import { editorStrings } from './strings.ts';

const strings = editorStrings.mobile;

/** The phone's header: back, the title over its save state, Undo, Export and a More disclosure. */
export function MobileEditorHeader({
  title,
  status,
  canUndo,
  onUndo,
  exportAction,
  menu,
  mobile,
  onBack,
}: {
  title: string;
  status: ReactNode;
  canUndo: boolean;
  onUndo: () => void;
  exportAction: ReactNode;
  menu: readonly EditorMenuItem[];
  mobile: MobileEditing;
  onBack: () => void;
}) {
  const more = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (more.current) more.current.open = false;
    more.current?.querySelector('summary')?.focus();
  };
  return (
    <header className="editor-mobile-header">
      <Button variant="ghost" size="icon" aria-label={editorStrings.topbar.back} onClick={onBack} data-testid="editor-done">
        <ArrowLeftIcon aria-hidden="true" />
      </Button>
      <div className="editor-mobile-heading">
        <h1 id="replay-title" title={title}>
          {title}
        </h1>
        {status}
      </div>
      <IconButton label={editorStrings.topbar.undo} disabled={!canUndo} onClick={onUndo} data-testid="undo">
        <Undo2Icon aria-hidden="true" />
      </IconButton>
      {exportAction}
      {/* Native details is interactive; Escape closes its disclosure from descendant controls. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <details
        ref={more}
        className="editor-mobile-more"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            close();
          }
          if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
        }}
      >
        <summary aria-label={strings.more}>
          <EllipsisIcon aria-hidden="true" />
        </summary>
        <div className="editor-mobile-menu" role="group" aria-label={strings.more}>
          {menu.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={() => {
                item.onSelect();
                close();
              }}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              close();
              mobile.openCursor();
            }}
          >
            <MousePointer2Icon aria-hidden="true" />
            {strings.cursorOptions}
          </Button>
          <ThemeSwitch />
        </div>
      </details>
    </header>
  );
}

/** Under the phone's timeline: the add toolbar and the selected object's properties. */
export function MobileTools({
  edits,
  state,
  duration,
  bundle,
  player,
  mobile,
  actions,
  change,
  dispatch,
  say,
  shell,
  placingBlur,
  cursorInspector,
}: {
  edits: ReplayEdits;
  state: EditorState;
  duration: number;
  bundle: ReplayBundle;
  player: ReplayController;
  mobile: MobileEditing;
  actions: EditorActions;
  change: (edits: ReplayEdits, select?: Selection) => void;
  dispatch: (action: EditorAction) => void;
  say: (message: string) => void;
  shell: { current: HTMLElement | null };
  placingBlur: boolean;
  cursorInspector: ReactNode;
}) {
  const selection = state.selection;
  const run = (action: () => void) => () => {
    mobile.remember();
    mobile.settle();
    action();
  };
  return (
    <>
      <MobileAddToolbar
        objects={mobileTimelineObjects(edits)}
        onSelectObject={(object) => {
          mobile.timelineDispatch({ type: 'select', selection: object.selection });
          mobile.returnTo(shell.current?.querySelector<HTMLElement>('.editor-add-more') ?? null);
          player.pause();
          player.seek(object.at);
          if (object.selection?.kind === 'caption') mobile.focusCaptionNext();
        }}
        onTrim={mobile.openTrim}
        onCaption={() => mobile.add('caption')}
        onBlur={() => mobile.add('blur')}
        onZoom={() => mobile.add('zoom')}
        more={[
          { label: strings.speedUp, action: () => mobile.add('speed'), testId: 'add-speed' },
          { label: selection?.kind === 'range' ? strings.cutSelection : strings.cutAtPlayhead, action: run(actions.cut), testId: 'add-cut' },
          { label: strings.selectRange, action: mobile.selectRange, testId: 'select-range' },
          { label: strings.highlightMoment, action: run(actions.pointHighlight), testId: 'add-point-highlight' },
          { label: strings.cursorOptions, action: mobile.openCursor },
          {
            label: strings.stepCaptions,
            disabled: Boolean(edits.captions?.length),
            action: () => {
              if (state.present.captions?.length) return;
              const captions = proposeStepCaptions(bundle.steps, duration);
              if (captions.length) {
                mobile.settle();
                change(withEffectList(state.present, 'caption', captions), { kind: 'caption', id: captions[0]!.id });
              } else say(editorStrings.notes.noSteps);
            },
            testId: 'generate-step-captions',
          },
          {
            label: strings.zoomClicks,
            action: run(() => {
              const present = state.present;
              const regions = zoomOnClicks(present, bundle, duration);
              if (regions.length)
                change(withEffectList(present, 'zoom', [...(present.zooms ?? []), ...regions]), { kind: 'zoom', id: regions[0]!.id });
              else say(editorStrings.notes.noClicks);
            }),
          },
        ]}
      />
      <MobileInspector
        edits={edits}
        selection={mobile.mobileSelection}
        duration={duration}
        change={change}
        onSelectRange={(from, to) => dispatch({ type: 'select', selection: { kind: 'range', from, to } })}
        onDone={mobile.finish}
        onDelete={() => {
          actions.deleteSelection();
          mobile.finishFromRuler();
        }}
        onCut={actions.cut}
        onPeriodHighlight={actions.periodHighlight}
        cursorOpen={mobile.cursorOpen}
        placingBlur={placingBlur}
        cursorInspector={cursorInspector}
        effectControls={<EffectControls mobile edits={edits} selection={selection} change={change} />}
        highlightControls={<HighlightControls edits={edits} selection={selection} duration={duration} change={change} afterRemove={mobile.finishFromRuler} />}
      />
    </>
  );
}
