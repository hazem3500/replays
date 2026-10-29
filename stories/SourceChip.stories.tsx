import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SourceChip } from '../src/client/viewer/SourceChip.tsx';

const SOURCES = [
  { provider: 'github', url: 'https://github.com/acme/shop/pull/42', label: 'acme/shop#42' },
  { provider: 'gitlab', url: 'https://gitlab.com/acme/shop/-/merge_requests/7', label: 'acme/shop!7' },
  { provider: 'linear', url: 'https://linear.app/acme/issue/SHOP-12', label: 'SHOP-12' },
  { provider: 'jira', url: 'https://acme.atlassian.net/browse/SHOP-9', label: 'SHOP-9' },
  { provider: 'slack', url: 'https://acme.slack.com/archives/C123/p456', label: '#checkout thread' },
  { provider: 'notion', url: 'https://www.notion.so/acme/Checkout-spec', label: 'Checkout spec' },
  { provider: 'url', url: 'https://status.example.com/incidents/3', label: 'Incident 3' },
];

/** The viewer top bar's source chip for each built-in provider: the same marks as the index rows. */
function SourceChips() {
  return (
    <header className="topbar app-topbar" style={{ flexWrap: 'wrap', gap: 8, padding: 16 }}>
      {SOURCES.map((source) => (
        <SourceChip key={source.provider} source={source} />
      ))}
    </header>
  );
}

const meta = { title: 'Viewer/Source chip', component: SourceChips, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof SourceChips
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Providers: Story = {
  play: async ({ canvasElement }) => {
    const chips = within(canvasElement).getAllByTestId('source-chip');
    const marks = chips.map((chip) => chip.querySelector('[data-provider-mark]')?.getAttribute('data-provider-mark'));
    await expect(marks).toEqual(['github', 'gitlab', 'linear', 'jira', 'slack', 'notion', 'link']);
  },
};
