import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ReplayContext } from '../src/shared/context.ts';
import type { FieldSchema } from '../src/client/config.ts';
import { fieldRows, humanizeKey, httpsHref } from '../src/client/viewer/context-fields.ts';
import { ContextPanel } from '../src/client/viewer/ContextPanel.tsx';
import { replay } from './fixtures.ts';

const base: ReplayContext = {
  version: 1,
  capturedAt: '2026-10-10T12:00:00.000Z',
  app: { name: 'Example App', environment: 'staging', version: '2026.10.10.1234', commit: 'a1b2c3d', origin: 'https://app.example.test' },
  test: { suite: 'checkout', case: 'pays with a card', runId: 'run-42' },
  sources: [
    { provider: 'github', ref: 'acme/shop#12', url: 'https://github.com/acme/shop/pull/12', label: 'Add card payments' },
    { provider: 'url', url: 'https://tracker.example.test/T-1' },
  ],
};

function render(context: ReplayContext | undefined, schema?: FieldSchema) {
  const bundle = { ...replay(), ...(context ? { context } : {}) };
  return renderToStaticMarkup(createElement(ContextPanel, { bundle, schema }));
}

describe('ContextPanel', () => {
  it('renders the app summary, build and test rows and the source links', () => {
    const html = render(base);
    expect(html).toContain('Example App');
    expect(html).toContain('data-env="staging"');
    expect(html).toContain('2026.10.10.1234');
    expect(html).toContain('pays with a card');
    expect(html).toContain('run-42');
    expect(html).toMatch(/href="https:\/\/github\.com\/acme\/shop\/pull\/12"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain('Add card payments');
    // A source without a label or ref shows its host.
    expect(html).toContain('tracker.example.test');
    expect(html).toContain('href="https://app.example.test"');
  });

  it('never links a non-https source or origin', () => {
    const html = render({
      ...base,
      app: { origin: 'http://localhost:3000' },
      sources: [{ provider: 'url', url: 'javascript:alert(1)', label: 'bad' }],
    });
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="http://localhost');
    expect(html).toContain('bad');
  });

  it('omits groups without data and shows the empty state without context', () => {
    const minimal = render({ version: 1, capturedAt: base.capturedAt });
    expect(minimal).not.toContain('ctx-group');
    expect(minimal).not.toContain('ctx-sources');

    const empty = render(undefined);
    expect(empty).not.toContain('data-testid="context-panel"');
    expect(empty).toContain('No context was attached');
  });

  it('renders fields with the schema: titles, order, help, links, booleans, chips and nested objects', () => {
    const schema: FieldSchema = {
      title: 'Test data',
      properties: {
        tenant: { type: 'string', title: 'Tenant', description: 'Which tenant the run used' },
        admin: { type: 'boolean', title: 'Admin' },
        dashboard: { type: 'string', format: 'uri', title: 'Dashboard' },
        roles: { type: 'array', items: { type: 'string' } },
        billing: { type: 'object', title: 'Billing', properties: { plan: { type: 'string', title: 'Plan tier' } } },
      },
    };
    const html = render(
      {
        ...base,
        fields: {
          extra_flag: false,
          roles: ['owner', 'editor'],
          billing: { plan: 'team', seats: 3 },
          dashboard: 'https://dash.example.test/t/1',
          admin: true,
          tenant: 'acme',
        },
      },
      schema,
    );
    expect(html).toContain('Test data');
    // Schema order first (tenant, admin, dashboard, roles, billing), then the extra key.
    const order = ['Tenant', 'Admin', 'Dashboard', 'Roles', 'Billing', 'Extra flag'].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('data-help=""');
    expect(html).toMatch(/href="https:\/\/dash\.example\.test\/t\/1"/);
    expect(html).toContain('<code>owner</code>');
    expect(html).toContain('Plan tier');
    expect(html).toContain('>Seats<');
    expect(html).toContain('data-nested="true"');
    expect(html).toMatch(/data-value="true"[^>]*>(<svg.*?<\/svg>)?Yes/);
    expect(html).toMatch(/data-value="false"[^>]*>No/);
  });

  it('humanizes field names without a schema and links nothing', () => {
    const html = render({ ...base, fields: { billing_plan: 'team', homepageUrl: 'https://example.test/' } });
    expect(html).toContain('>Billing plan<');
    expect(html).toContain('>Homepage url<');
    expect(html).toContain('>Details<');
    expect(html).not.toContain('href="https://example.test/"');
  });
});

describe('context fields', () => {
  it('humanizes keys', () => {
    expect(humanizeKey('billing_plan')).toBe('Billing plan');
    expect(humanizeKey('billingPlan')).toBe('Billing plan');
    expect(humanizeKey('x-request-id')).toBe('X request id');
    expect(humanizeKey('')).toBe('');
  });

  it('only accepts https URLs without credentials', () => {
    expect(httpsHref('https://example.test/a')).toBe('https://example.test/a');
    expect(httpsHref('http://example.test')).toBeUndefined();
    expect(httpsHref('javascript:alert(1)')).toBeUndefined();
    expect(httpsHref('https://user:pw@example.test')).toBeUndefined();
    expect(httpsHref('not a url')).toBeUndefined();
  });

  it('builds a render tree', () => {
    const rows = fieldRows(
      { n: 3, empty: null, list: [{ a: 1 }, { a: 2 }], tags: ['x', 2, true], mode: 'fast' },
      { properties: { mode: { enum: ['fast', 'slow'], title: 'Mode' } } },
    );
    expect(rows.map((row) => row.label)).toEqual(['Mode', 'N', 'Empty', 'List', 'Tags']);
    expect(rows[0]!.value).toEqual({ kind: 'text', text: 'fast' });
    expect(rows[1]!.value).toEqual({ kind: 'text', text: '3' });
    expect(rows[2]!.value).toEqual({ kind: 'empty' });
    expect(rows[3]!.value).toMatchObject({ kind: 'rows', rows: [{ label: '#1' }, { label: '#2' }] });
    expect(rows[4]!.value).toEqual({ kind: 'chips', items: ['x', '2', 'Yes'] });
  });
});
