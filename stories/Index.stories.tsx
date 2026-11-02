import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ReplayIndex } from '../src/client/ReplayIndex.tsx';
import { FilterMenu, FilterSheet, type FilterState } from '../src/client/index/FilterMenu.tsx';
import type { ReplayFilters } from '../src/shared/replay.ts';
import { feedEntries, suite } from './fixtures/replays.ts';
const meta = {
  title: 'App/Index/Library',
  component: ReplayIndex,
  parameters: { layout: 'fullscreen' },
  play: async ({ canvasElement, parameters }) => {
    if (parameters.layout !== 'fullscreen' || parameters.api?.state === 'loading') return;
    await waitFor(() => expect(canvasElement.querySelector('.index-body')).toHaveAttribute('aria-busy', 'false'));
    const shell = canvasElement.querySelector<HTMLElement>('.index-shell')!;
    const gutter = parseFloat(getComputedStyle(shell).getPropertyValue('--gutter'));
    await expect(gutter).toBeGreaterThan(0);
    await expect(shell.querySelector('.index-head .app-topbar')).not.toBeNull();
    const poster = shell.querySelector('.feed-list .poster');
    if (poster && poster.getBoundingClientRect().width > 0)
      await expect(poster.getBoundingClientRect().left).toBeGreaterThanOrEqual(gutter);
  },
} satisfies Meta<typeof ReplayIndex>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const FirstRun: Story = { parameters: { api: { state: 'empty' } } };
export const Loading: Story = { parameters: { api: { state: 'loading' } } };
export const Error: Story = { parameters: { api: { state: 'error' } } };
export const Search: Story = { parameters: { search: 'q=checkout' } };
export const NoSearchResults: Story = {
  parameters: { api: { state: 'empty' }, search: 'q=missing-recording' },
};
export const ActiveFilters: Story = {
  parameters: { search: 'host=checkout.northstar.demo.test&errors=true&tag=demo' },
};
export const Mobile: Story = { globals: { viewport: { value: 'mobile390', isRotated: false } } };
export const NarrowMobile: Story = {
  globals: { viewport: { value: 'mobile320', isRotated: false } },
};
export const Light: Story = { globals: { theme: 'light' } };
// Use the real page rather than an orphaned Feed: --gutter, header and toolbar stay in sync.
const rowSummaries = (count = 6) => feedEntries(count).flatMap((entry) => (entry.kind === 'session' ? [entry.summary] : []));
export const FeedRows: Story = { parameters: { api: { summaries: rowSummaries(), suites: [] } } };
export const GridCards: Story = { parameters: { indexView: 'grid', api: { summaries: rowSummaries(), suites: [] } } };
export const SuiteStacks: Story = { parameters: { indexView: 'grid', api: { summaries: rowSummaries(2), suites: [suite] } } };
export const DenseRows: Story = { parameters: { api: { summaries: rowSummaries(60), suites: [] } } };
export const LongTitles: Story = {
  parameters: {
    indexView: 'grid',
    api: {
      suites: [],
      summaries: rowSummaries().map((summary) => ({
        ...summary,
        title: 'Checkout regression in the international storefront with a very long scenario name and support investigation notes '.repeat(
          3,
        ),
      })),
    },
  },
};
export const HighlightedSearch: Story = { parameters: { search: 'q=checkout', api: { summaries: rowSummaries(), suites: [] } } };
export const LoadingRows: Story = { parameters: { api: { state: 'loading' } } };
export const LoadingCards: Story = { parameters: { indexView: 'grid', api: { state: 'loading' } } };
function Filters({ active = false, mobile = false }: { active?: boolean; mobile?: boolean }) {
  const [filters, setFilters] = useState<ReplayFilters>(active ? { host: 'checkout.northstar.demo.test', errors: true, tag: 'demo' } : {});
  const [kind, setKind] = useState<FilterState['kind']>();
  const state: FilterState = {
    filters,
    kind,
    hosts: ['checkout.northstar.demo.test', 'dashboard.northstar.demo.test'],
    tags: ['demo', 'checkout', 'regression'],
    update: (key, value) =>
      setFilters((current) => {
        const next = { ...current };
        if (value === undefined) delete next[key];
        else Object.assign(next, { [key]: value });
        return next;
      }),
    setParam: () => {},
    setKind,
    clearFilters: () => {
      setFilters({});
      setKind(undefined);
    },
  };
  return <div className="sb-stage">{mobile ? <FilterSheet {...state} /> : <FilterMenu {...state} />}</div>;
}
export const FiltersPopover: Story = {
  parameters: { layout: 'padded' },
  render: () => <Filters />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /filter/i }));
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('Has errors')).toBeVisible());
    // Axe must inspect the settled popup, not the translucent enter-animation frame.
    await waitFor(() => {
      const popup = canvasElement.ownerDocument.querySelector('.filter-menu');
      expect(popup).not.toBeNull();
      expect(Number(getComputedStyle(popup!).opacity)).toBe(1);
      expect(popup!.getAnimations({ subtree: true }).every((animation) => animation.playState === 'finished')).toBe(true);
    });
  },
};
export const FiltersWithSelection: Story = { parameters: { layout: 'padded' }, render: () => <Filters active /> };
export const FiltersMobile: Story = {
  parameters: { layout: 'padded' },
  render: () => <Filters active mobile />,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};

export const MobileActiveFilterChips: Story = {
  ...ActiveFilters,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
