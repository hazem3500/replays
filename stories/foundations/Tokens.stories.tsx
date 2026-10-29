import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

const COLOURS = {
  Surfaces: ['--page', '--surface', '--surface-raised', '--surface-hover', '--surface-pressed', '--canvas'],
  Text: ['--text', '--text-secondary', '--text-tertiary'],
  Lines: ['--line', '--line-strong'],
  Signals: ['--accent', '--accent-soft', '--danger', '--danger-soft', '--warning', '--success'],
} as const;

const TYPE = ['--text-xs', '--text-sm', '--text-md', '--text-lg'] as const;

const resolved = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

function Swatch({ token }: { token: string }) {
  return (
    <figure className="sb-card" style={{ margin: 0 }}>
      <div className="sb-swatch" style={{ background: `var(${token})` }} />
      <figcaption>
        <strong style={{ fontSize: 'var(--text-xs)' }}>{token}</strong>
        <br />
        <code>{resolved(token)}</code>
      </figcaption>
    </figure>
  );
}

function Colours() {
  return (
    <div className="sb-stack" style={{ maxWidth: 'none' }}>
      {Object.entries(COLOURS).map(([group, tokens]) => (
        <section key={group} className="sb-section" aria-label={group}>
          <h3>{group}</h3>
          <div className="sb-grid">
            {tokens.map((token) => (
              <Swatch key={token} token={token} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Type() {
  return (
    <div className="sb-stack">
      {TYPE.map((token) => (
        <div key={token} className="sb-card">
          <code>
            {token}: {resolved(token)}
          </code>
          <p style={{ margin: 0, fontSize: `var(${token})` }}>Checkout fails after saving the delivery address</p>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  parameters: {
    docs: {
      description: {
        component: 'Live values from src/client/styles.css for the current theme. Switch the toolbar theme to compare dark and light.',
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Colour: Story = {
  render: () => <Colours />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('figure')).toHaveLength(Object.values(COLOURS).flat().length);
  },
};

export const ColourLight: Story = { render: () => <Colours />, globals: { theme: 'light' } };

export const Typography: Story = { render: () => <Type /> };
