import { useReducer, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { EditorSkeleton } from '../src/client/ViewerSkeleton.tsx';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Editor } from '../src/client/editor/Editor.tsx';
import { Timeline } from '../src/client/editor/Timeline.tsx';
import { EffectLanes } from '../src/client/editor/EffectLanes.tsx';
import { CursorInspector } from '../src/client/editor/CursorInspector.tsx';
import { initialEditorState, editorReducer } from '../src/client/editor/state.ts';
import type { ReplayCursorSettings } from '../src/shared/cursor.ts';
import type { ReplayEdits } from '../src/shared/edits.ts';
import { emptyReplay, replay } from './fixtures/replays.ts';
import { PlayerFixture } from './fixtures/player.tsx';
import '../src/client/editor/editor.css';
const edits: ReplayEdits = {
  version: 1,
  cuts: [{ id: 'cut-1', from: 1000, to: 1700 }],
  zooms: [{ id: 'zoom-1', from: 2000, to: 4000, scale: 1.8 }],
  speeds: [{ id: 'speed-1', from: 5000, to: 6500, rate: 2 }],
  captions: [{ id: 'caption-1', from: 2200, to: 4000, text: 'Checkout reports an error' }],
  blurs: [{ id: 'blur-1', from: 2000, to: 5000, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
  highlights: [{ id: 'mark-1', kind: 'point', at: 3200, label: 'Failure starts' }],
};
const meta = {
  title: 'App/Editor/Workspace',
  parameters: { layout: 'fullscreen' },
  component: Editor,
  args: { bundle: replay(), loaded: { stored: { ...edits, revision: 1 }, etag: '"story-1"' } },
} satisfies Meta<typeof Editor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {};
export const EmptyEdits: Story = {
  args: { loaded: { stored: { version: 1, cuts: [], revision: 0 }, etag: '"empty"' } },
};
export const EmptyTracks: Story = { args: { bundle: emptyReplay() } };
export const Mobile: Story = { globals: { viewport: { value: 'mobile390', isRotated: false } } };
export const NarrowMobile: Story = {
  globals: { viewport: { value: 'mobile320', isRotated: false } },
};
export const Tablet: Story = { globals: { viewport: { value: 'tablet768', isRotated: false } } };
export const Light: Story = { globals: { theme: 'light' } };
export const SaveError: Story = {
  parameters: { api: { save: 'error' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('add-point-highlight'));
    await waitFor(() => expect(canvas.getByTestId('save-state')).toHaveAttribute('data-state', 'failed'), { timeout: 5000 });
  },
};
export const Saving: Story = {
  parameters: { api: { save: 'saving' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('add-point-highlight'));
    await waitFor(() => expect(canvas.getByTestId('save-state')).toHaveTextContent('Saving'), {
      timeout: 5000,
    });
  },
};
export const Loading: Story = { render: () => <EditorSkeleton /> };
function TimelineDemo({ mobile = false, empty = false }: { mobile?: boolean; empty?: boolean }) {
  const [state, dispatch] = useReducer(editorReducer, empty ? { version: 1, cuts: [] } : edits, initialEditorState);
  return (
    <PlayerFixture>
      <div className="sb-stage">
        <Timeline
          duration={8400}
          edits={state.present}
          selection={state.selection}
          dispatch={dispatch}
          suggestions={[]}
          onCutRange={() => {}}
          mobile={mobile}
          lanes={<EffectLanes edits={state.present} selection={state.selection} dispatch={dispatch} />}
        />
      </div>
    </PlayerFixture>
  );
}
export const TimelineAllTracks: Story = { parameters: { layout: 'padded' }, render: () => <TimelineDemo /> };
export const TimelineEmpty: Story = { parameters: { layout: 'padded' }, render: () => <TimelineDemo empty /> };
export const TimelineMobile: Story = {
  parameters: { layout: 'padded' },
  render: () => <TimelineDemo mobile />,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
function CursorDemo({ hidden = false, embedded = true }: { hidden?: boolean; embedded?: boolean }) {
  const [settings, setSettings] = useState<ReplayCursorSettings | undefined>(hidden ? { visible: false } : undefined);
  return (
    <div className="sb-stage" style={{ maxWidth: 420 }}>
      <CursorInspector settings={settings} onChange={setSettings} onClose={() => {}} embedded={embedded} />
    </div>
  );
}
export const CursorPanel: Story = { parameters: { layout: 'padded' }, render: () => <CursorDemo /> };
export const CursorHidden: Story = { parameters: { layout: 'padded' }, render: () => <CursorDemo hidden /> };
export const CursorMobileInspector: Story = {
  parameters: { layout: 'padded' },
  render: () => <CursorDemo embedded={false} />,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
