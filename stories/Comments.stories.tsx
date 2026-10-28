import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CommentsPanelView } from '../src/client/comments/CommentsPanel.tsx';
import type { CommentsApi, PlacedThread } from '../src/client/comments/CommentsProvider.tsx';
import { PlayerContext, type ReplayController } from '../src/client/player.ts';
import { placeComment, type PublicComment, threadsOf } from '../src/shared/comments.ts';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const person = (name: string) => ({ name });

const THREADS: PublicComment[] = [
  {
    id: 'c-story001',
    body: 'Walked through this before standup. Two layout notes below.',
    author: person('Mira Chen'),
    createdAt: ago(190),
    mine: false,
  },
  {
    id: 'c-story002',
    at: 2000,
    body: 'The submit button shifts down when the error appears. Can we reserve the space?',
    author: person('Theo Park'),
    createdAt: ago(160),
    mine: false,
  },
  {
    id: 'c-story003',
    parentId: 'c-story002',
    body: 'Agreed, it jumps about 8 px on my screen.',
    author: person('Mira Chen'),
    createdAt: ago(150),
    mine: true,
  },
  { id: 'c-story004', at: 2400, body: '', emoji: '👀', author: person('Sam Okafor'), createdAt: ago(140), mine: false },
  { id: 'c-story005', at: 2800, body: '', emoji: '🐛', author: person('Mira Chen'), createdAt: ago(120), mine: true },
  {
    id: 'c-story006',
    at: 6900,
    body: 'Copy: "Your order is placed" reads better than "Order placed successfully".',
    author: person('Mira Chen'),
    createdAt: ago(60),
    resolved: { by: 'Theo Park', at: ago(50) },
    mine: true,
  },
];

/** A paused player at 2.0 s: enough of the controller for the panel (playhead, seek, pause). */
const player = {
  duration: 11_000,
  getTime: () => 2000,
  subscribeTime: () => () => {},
  seek: () => {},
  pause: () => {},
} as unknown as ReplayController;

const rejected = () => Promise.reject(new Error('Storybook fixture: nothing is saved'));

function fixture(comments: PublicComment[], overrides: Partial<CommentsApi> = {}): CommentsApi {
  const threads: PlacedThread[] = threadsOf(comments).map((thread) => ({ ...thread, placement: placeComment(thread.root.at) }));
  return {
    replayId: 'storybook',
    loaded: true,
    error: undefined,
    retry: () => {},
    me: { name: 'Mira Chen', anonymous: false },
    anonymous: false,
    threads,
    pins: threads.flatMap((thread) => (thread.placement.state === 'visible' ? [{ thread, at: thread.placement.at }] : [])),
    count: comments.filter((comment) => !comment.emoji).length,
    selectedId: undefined,
    reveal: () => {},
    select: () => {},
    composerRequest: undefined,
    consumeComposerRequest: () => {},
    startComment: () => {},
    sourceTime: (time) => time,
    create: rejected,
    edit: rejected,
    resolve: rejected,
    remove: rejected,
    copyLink: () => {},
    originalHref: () => '#',
    ...overrides,
  };
}

function Panel({ comments }: { comments: CommentsApi }) {
  return (
    <PlayerContext.Provider value={player}>
      <div className="inspector-panel" style={{ height: 420, maxWidth: 820 }}>
        <CommentsPanelView comments={comments} />
      </div>
    </PlayerContext.Provider>
  );
}

const meta = { title: 'Viewer/Comments', component: Panel, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { comments: fixture([]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No comments yet')).toBeVisible();
    await expect(canvas.getByTestId('comment-pin')).toHaveTextContent('0:02.0');
    await expect(canvas.queryByTestId('comments-filter')).toBeNull();
  },
};

export const Threads: Story = {
  args: { comments: fixture(THREADS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('comment-thread')).toHaveLength(3);
    await expect(canvas.getAllByTestId('comment-reaction').map((node) => node.textContent)).toEqual(['👀', '🐛']);
    await userEvent.click(canvas.getByTestId('comments-filter-resolved'));
    await expect(canvas.getAllByTestId('comment-thread')).toHaveLength(1);
    await expect(canvas.getByTestId('comment-resolved-note')).toHaveTextContent('Resolved by Theo Park');
  },
};

export const AnonymousComposing: Story = {
  args: { comments: fixture([], { anonymous: true, me: { name: 'Anonymous', anonymous: true } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('comments-anonymous-notice')).not.toBeVisible();
    await userEvent.type(canvas.getByTestId('comment-input'), 'The total wraps onto two lines here');
    await expect(canvas.getByTestId('comments-anonymous-notice')).toBeVisible();
    await expect(canvas.getByTestId('comment-submit')).toBeEnabled();
  },
};

export const Loading: Story = { args: { comments: fixture([], { loaded: false }) } };

export const LoadFailed: Story = {
  args: { comments: fixture([], { loaded: false, error: 'Comments failed to load (503)' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
