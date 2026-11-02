import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReplayIndex } from '../../src/client/ReplayIndex.tsx';
import { PosterPlaceholder } from '../../src/client/index/Poster.tsx';
import { ScopeCount } from '../../src/client/index/ScopeCount.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../../src/shared/thumbhash.ts';
import beforeGrid from './before/index-grid-dark.png';
import beforeList from './before/index-list-light.png';
import beforePanels from './before/viewer-panels-dark.png';
import beforeSuite from './before/viewer-suite-dark.png';

/*
 * Loading states, before and after (the loading-states increment; .review-artifacts/loading-states/increments.md).
 * "Before" stories are screenshots of the old states; "After" stories render the live components:
 *   - the index's pending feed is the real Feed with stand-in entries (FeedSkeleton.tsx), text redacted to bands on
 *     the real line boxes, posters as plain tiles, one slow breathing layer;
 *   - posters show their ThumbHash at once (the real image fades in over it), a calm tile without one;
 *   - the count line keeps its count through refreshes (the header's hairline shows a refresh past 300 ms).
 */

const meta = {
  title: 'Loading/Before and after',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Shot({ src, label }: { src: string; label: string }) {
  return (
    <figure style={{ margin: 0, padding: 16 }}>
      <figcaption style={{ marginBottom: 8, color: 'var(--text-secondary)', font: '500 12px var(--sans)' }}>{label}</figcaption>
      <img src={src} alt={label} style={{ display: 'block', maxWidth: '100%', borderRadius: 8, boxShadow: '0 0 0 1px var(--line)' }} />
    </figure>
  );
}

export const BeforeIndexGrid: Story = {
  name: 'Before · index grid',
  render: () => <Shot src={beforeGrid} label="Before: slabs and bars, a screenful regardless of count" />,
};
export const BeforeIndexList: Story = { name: 'Before · index list', render: () => <Shot src={beforeList} label="Before: list rows" /> };
export const BeforeViewer: Story = {
  name: 'Before · suite viewer',
  render: () => <Shot src={beforeSuite} label="Before: every region a wall of pills" />,
};
export const BeforePanels: Story = {
  name: 'Before · panels',
  render: () => <Shot src={beforePanels} label="Before: “Loading Network…” and “Preparing step controls…”" />,
};

export const AfterIndexGrid: Story = {
  name: 'After · index grid (pending feed)',
  parameters: { layout: 'fullscreen', indexView: 'grid', api: { state: 'loading' } },
  render: () => <ReplayIndex />,
};
export const AfterIndexList: Story = {
  name: 'After · index list (pending feed)',
  parameters: { layout: 'fullscreen', api: { state: 'loading' } },
  render: () => <ReplayIndex />,
};
export const AfterIndexPhone: Story = {
  ...AfterIndexList,
  name: 'After · index on a phone',
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};

/** A ThumbHash of a page-like picture (a blue header over a light page with a green button), as the server makes one. */
function sampleHash() {
  const width = 40;
  const height = 25;
  const rgba: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rgba.push(...(y < 4 ? [52, 84, 196, 255] : y > 15 && y < 19 && x > 6 && x < 15 ? [40, 140, 90, 255] : [244, 245, 247, 255]));
  return thumbHashToBase64(rgbaToThumbHash(width, height, rgba));
}

export const AfterPosters: Story = {
  name: 'After · poster states',
  render: () => (
    <div className="sb-grid">
      {[
        { label: 'ThumbHash (instant, the image fades in over it)', node: <PosterPlaceholder size="card" hash={sampleHash()} /> },
        { label: 'No poster (posters off): a calm tile', node: <PosterPlaceholder size="card" /> },
        { label: 'On its way, no ThumbHash: breathing', node: <PosterPlaceholder size="card" loading /> },
      ].map(({ label, node }) => (
        <figure key={label} style={{ margin: 0 }}>
          {node}
          <figcaption style={{ marginTop: 8, color: 'var(--text-secondary)', font: '500 12px var(--sans)' }}>{label}</figcaption>
        </figure>
      ))}
    </div>
  ),
};

export const AfterCountLine: Story = {
  name: 'After · count line',
  render: () => (
    <div className="scope-bar" style={{ display: 'grid', gap: 12, padding: 24 }}>
      <ScopeCount replays={undefined} shown state="loading" />
      <ScopeCount replays={22} suites={4} shown state="updating" />
      <ScopeCount replays={1} shown state="ready" />
    </div>
  ),
};
