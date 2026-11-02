import { useLayoutEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnimatedIcon } from '../src/client/components/animated-icon.tsx';
import { ANIMATED_ICONS } from '../src/client/components/animated-icon-data.ts';
import styles from '../src/client/styles.css?raw';
import tailwind from '../src/client/tailwind.css?raw';

const meta = { title: 'Foundations/Tokens', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const declarations = [...`${styles}\n${tailwind}`.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)];
const names = [...new Set(declarations.map((match) => match[1]!))];
function Tokens({ kind }: { kind: 'colour' | 'type' | 'spacing' | 'radius' | 'shadow' | 'motion' }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    const read = () => {
      const css = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(names.map((name) => [name, css.getPropertyValue(name).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  const selected = names.filter((name) =>
    kind === 'colour'
      ? /^--(page|surface|canvas|text$|text-secondary|text-tertiary|line|accent|danger|warning|success|ring)/.test(name)
      : kind === 'type'
        ? /^--(text-|sans|mono)/.test(name) && !['--text-secondary', '--text-tertiary'].includes(name)
        : kind === 'radius'
          ? name.startsWith('--radius')
          : kind === 'shadow'
            ? name.startsWith('--shadow')
            : kind === 'motion'
              ? /^--(motion|ease)/.test(name)
              : name.startsWith('--spacing'),
  );
  return (
    <section className="sb-stage">
      <h1>{kind} tokens</h1>
      {selected.length === 0 ? (
        <p>
          The app has no shared spacing custom properties. Existing layout spacing uses local pixel values and Tailwind utilities; a shared
          spacing scale needs a design-system seam.
        </p>
      ) : (
        <div className="sb-grid">
          {selected.map((name) => (
            <article className="sb-card" key={name}>
              <div
                className="sb-token"
                style={{
                  background: kind === 'colour' ? `var(${name})` : 'var(--surface-hover)',
                  borderRadius: kind === 'radius' ? `var(${name})` : undefined,
                  boxShadow: kind === 'shadow' ? `var(${name})` : undefined,
                }}
              />
              {kind === 'type' && (
                <p
                  style={{
                    fontSize: name.startsWith('--text-') ? `var(${name})` : undefined,
                    fontFamily: name === '--mono' ? 'var(--mono)' : 'var(--sans)',
                  }}
                >
                  Replay Aa 012345
                </p>
              )}
              <code>{name}</code>
              <p>{values[name] || declarations.find((entry) => entry[1] === name)?.[2]}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export const Colours: Story = { render: () => <Tokens kind="colour" /> };
export const TypeScale: Story = { render: () => <Tokens kind="type" /> };
export const Spacing: Story = { render: () => <Tokens kind="spacing" /> };
export const Radii: Story = { render: () => <Tokens kind="radius" /> };
export const Shadows: Story = { render: () => <Tokens kind="shadow" /> };
export const Motion: Story = { render: () => <Tokens kind="motion" /> };
export const Icons: Story = {
  render: () => (
    <section className="sb-stage">
      <h1>Animated icons</h1>
      <div className="sb-grid">
        {Object.keys(ANIMATED_ICONS).map((name) => (
          <div className="sb-card sb-stack" key={name}>
            <AnimatedIcon name={name as keyof typeof ANIMATED_ICONS} />
            <code>{name}</code>
          </div>
        ))}
      </div>
    </section>
  ),
};
export const LightPalette: Story = { ...Colours, globals: { theme: 'light' } };
