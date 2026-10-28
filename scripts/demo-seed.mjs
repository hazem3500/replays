#!/usr/bin/env node
// Creates a self-contained, fictional sample data set without touching the live sample or upload directories.
//   node scripts/demo-seed.mjs [--output ./demo-seed-output]
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReplayBundle } from '../src/shared/replay.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = join(ROOT, 'demo-seed-output');
// rrweb 2.1 event/source enum values; test/demo-seed.test.ts checks these against the installed rrweb package.
const EventType = { FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4 };
const IncrementalSource = { Mutation: 0, MouseMove: 1, MouseInteraction: 2, Input: 5 };
const MouseInteractions = { MouseUp: 0, MouseDown: 1, Click: 2 };
const STYLES = `
  :root{font:15px/1.5 system-ui,sans-serif;color:#24313d;background:#f4f7f6}*{box-sizing:border-box}
  body{margin:0;padding:36px}main{max-width:850px;margin:auto;background:white;border:1px solid #dce5e1;border-radius:16px;padding:30px;box-shadow:0 12px 32px #22332212}
  h1{font-size:26px;margin:0 0 6px}p{color:#66756f;margin:0 0 20px}.eyebrow{color:#26765c;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .row{display:flex;gap:12px;align-items:center}.card{border:1px solid #dce5e1;border-radius:10px;padding:16px;margin:12px 0;background:#fbfdfc}
  button{border:0;border-radius:7px;padding:9px 13px;background:#26765c;color:white;font:inherit;font-weight:650}.quiet{background:#edf4f0;color:#26765c}
  label{display:block;font-weight:650;margin:12px 0 5px}input{font:inherit;border:1px solid #cbd7d1;border-radius:7px;padding:9px;width:100%}
  .error{color:#a43b32;background:#fff2ef;padding:10px 12px;border-radius:8px}.ok{color:#236846}.muted{color:#7b8982}.pill{display:inline-block;padding:3px 8px;border-radius:99px;background:#edf4f0;color:#26765c;font-size:12px}
  ul{padding-left:20px}li{margin:5px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
`;

let nextNodeId = 1;
function node(type, values = {}) {
  return { type, ...values, id: nextNodeId++ };
}
const text = (value) => node(3, { textContent: value });
function el(tagName, children = [], attributes = {}) {
  return node(2, { tagName, attributes, childNodes: children });
}
const p = (value, cls) => el('p', [text(value)], cls ? { class: cls } : {});
const heading = (value) => el('h1', [text(value)]);
const button = (value, cls = '', id) => el('button', [text(value)], { ...(cls ? { class: cls } : {}), ...(id ? { id } : {}) });
const field = (label, value, id, type = 'text') =>
  el('div', [
    el('label', [text(label)], { for: id }),
    // All sample input values are fictional and masked in the captured DOM.
    el('input', [], { id, type, value }),
  ]);

function pageTree(view) {
  const bodyContent = [el('div', [text(view.eyebrow)], { class: 'eyebrow' }), heading(view.heading), p(view.subtitle), ...view.content];
  const doc = node(0, {
    childNodes: [
      node(1, { name: 'html', publicId: '', systemId: '' }),
      el(
        'html',
        [
          el('head', [el('meta', [], { charset: 'utf-8' }), el('title', [text(view.heading)]), el('style', [text(STYLES)])], {
            lang: 'en',
          }),
          el('body', [el('main', bodyContent)]),
        ],
        { lang: 'en' },
      ),
    ],
    initialOffset: { left: 0, top: 0 },
  });
  return doc;
}

function bundle(spec) {
  const timestamp = Date.parse(spec.capturedAt);
  const snapshot = pageTree(spec.view);
  const nodes = [];
  const currentText = new Map();
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 2) nodes.push(value);
    if (value.type === 3) {
      currentText.set(value.id, value.textContent);
    }
    for (const child of value.childNodes ?? []) collect(child);
  };
  collect(snapshot);
  const getTarget = (selector) => {
    if (!selector) return undefined;
    const id = selector.match(/^#([\w-]+)$/)?.[1];
    const className = selector.match(/^\.([\w-]+)$/)?.[1];
    const tagAndClass = selector.match(/^([a-z]+)\.([\w-]+)$/i);
    const checkbox = selector === 'input[type=checkbox]';
    const tag = selector.match(/^[a-z]+$/i)?.[0]?.toLowerCase();
    return nodes.find((item) => {
      const attributes = item.attributes ?? {};
      const elementTag = String(item.tagName ?? '').toLowerCase();
      const classes = String(attributes.class ?? '').split(/\s+/);
      if (id) return attributes.id === id;
      if (className) return classes.includes(className);
      if (tagAndClass) return elementTag === tagAndClass[1].toLowerCase() && classes.includes(tagAndClass[2]);
      if (checkbox) return elementTag === 'input' && attributes.type === 'checkbox';
      return tag ? elementTag === tag : false;
    });
  };
  const timeEvent = (type, data, at) => ({ type, data, timestamp: timestamp + at });
  const incremental = (source, data, at) => timeEvent(3, { source, ...data }, at);
  const events = [
    timeEvent(EventType.Meta, { href: spec.url, width: spec.viewport.width, height: spec.viewport.height }, 0),
    timeEvent(EventType.FullSnapshot, { node: snapshot, initialOffset: { left: 0, top: 0 } }, 20),
  ];

  // Actions are real rrweb incremental events on the page's serialized node IDs.
  spec.steps.forEach(([at, kind, , selector], index) => {
    const target = getTarget(selector);
    const point = { x: 180 + (index % 4) * 145, y: 150 + Math.floor(index / 4) * 115 };
    if (target && ['click', 'press', 'fill', 'type'].includes(kind)) {
      events.push(
        incremental(IncrementalSource.MouseMove, { positions: [{ ...point, id: target.id, timeOffset: 0 }] }, Math.max(21, at - 70)),
      );
      events.push(incremental(IncrementalSource.MouseInteraction, { type: MouseInteractions.MouseDown, id: target.id, ...point }, at));
      events.push(incremental(IncrementalSource.MouseInteraction, { type: MouseInteractions.Click, id: target.id, ...point }, at + 1));
      events.push(incremental(IncrementalSource.MouseInteraction, { type: MouseInteractions.MouseUp, id: target.id, ...point }, at + 2));
    }
  });
  for (const input of spec.inputs ?? []) {
    const target = getTarget(input.selector);
    if (!target) throw new Error(`${spec.id}: input selector did not match: ${input.selector}`);
    events.push(
      incremental(
        IncrementalSource.Input,
        { id: target.id, text: input.text, isChecked: input.isChecked ?? false, userTriggered: true },
        input.at,
      ),
    );
  }
  for (const change of spec.changes ?? []) {
    const targets = [...currentText.entries()].filter(([, value]) => value === change.from).map(([id]) => id);
    if (targets.length !== 1) throw new Error(`${spec.id}: expected one text node for transition “${change.to}”, found ${targets.length}`);
    const id = targets[0];
    currentText.set(id, change.to);
    events.push(
      incremental(IncrementalSource.Mutation, { texts: [{ id, value: change.to }], attributes: [], removes: [], adds: [] }, change.at),
    );
  }
  events.sort((left, right) => left.timestamp - right.timestamp || left.type - right.type);
  const replay = {
    meta: {
      id: spec.id,
      title: spec.title,
      url: spec.url,
      capturedAt: spec.capturedAt,
      duration: spec.duration,
      viewport: spec.viewport,
      eventCount: events.length,
      version: 1,
      source: spec.source ?? 'agent',
      tags: ['demo', 'synthetic', ...spec.tags],
    },
    events,
    steps: spec.steps.map(([at, kind, label, selector]) => ({ at, kind, label, ...(selector ? { selector } : {}) })),
    console: spec.console ?? [],
    network: spec.network ?? [],
    performance: spec.performance ?? { supported: [], entries: [] },
    context: {
      version: 1,
      capturedAt: spec.capturedAt,
      app: { name: spec.app, environment: 'demo', origin: new URL(spec.url).origin, version: 'demo-1.0' },
      test: { suite: spec.suiteName, case: spec.id.replaceAll('-', ' '), runId: spec.id },
      fields: { demo: true, fictional: true },
    },
  };
  assertReplayBundle(replay);
  return replay;
}

const sharedSuiteContext = (capturedAt) => ({
  version: 1,
  capturedAt,
  app: { name: 'Northstar Demo', environment: 'demo', version: 'demo-1.0' },
  fields: { demo: true, fictional: true },
});

function suite(id, title, createdAt, runs) {
  const value = {
    version: 1,
    id,
    title,
    createdAt,
    context: sharedSuiteContext(createdAt),
    runs,
  };
  assertReviewSuite(value);
  return value;
}

export function createDemoSeed() {
  nextNodeId = 1;
  const replays = [
    bundle({
      id: 'demo-seed-signup',
      title: 'Signup · masked form',
      app: 'Northstar Newsletter',
      suiteName: 'Signup flow',
      url: 'https://signup.northstar.demo.test/join',
      capturedAt: '2026-10-08T10:00:00.000Z',
      duration: 4300,
      tags: ['signup', 'form'],
      viewport: { width: 1280, height: 800 },
      view: {
        eyebrow: 'Northstar newsletter',
        heading: 'Join the field notes',
        subtitle: 'A small fictional signup flow recorded with masked form values.',
        content: [
          field('Name', '', 'name'),
          field('Email', '', 'email', 'email'),
          el('label', [el('input', [], { type: 'checkbox' }), text(' Send me the monthly field notes')]),
          button('Join the list'),
          el('div', [text('Signup is ready to submit.')], { class: 'ok card' }),
        ],
      },
      steps: [
        [500, 'click', 'Focus the name field', '#name'],
        [900, 'type', 'Enter a masked name', '#name'],
        [1900, 'fill', 'Enter a masked email', '#email'],
        [2900, 'click', 'Choose monthly updates', 'input[type=checkbox]'],
        [3700, 'click', 'Join the list', 'button'],
      ],
      inputs: [
        { at: 1050, selector: '#name', text: '***********' },
        { at: 2050, selector: '#email', text: '**********************' },
        { at: 3050, selector: 'input[type=checkbox]', text: 'on', isChecked: true },
      ],
      changes: [{ at: 4300, from: 'Signup is ready to submit.', to: 'Thanks — your demo signup is complete.' }],
      network: [
        {
          id: 'signup-post',
          at: 3650,
          duration: 182,
          method: 'POST',
          url: 'https://api.northstar.demo.test/v1/subscriptions',
          status: 201,
          statusText: 'Created',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
      ],
    }),
    bundle({
      id: 'demo-seed-checkout-error',
      title: 'Checkout · coupon rejected, order retained',
      app: 'Pinecone Goods Demo',
      suiteName: 'Checkout review',
      url: 'https://shop.pinecone.demo.test/checkout',
      capturedAt: '2026-10-14T16:20:00.000Z',
      duration: 11100,
      tags: ['checkout', 'error'],
      viewport: { width: 1440, height: 900 },
      view: {
        eyebrow: 'Pinecone Goods · demo cart',
        heading: 'Your order',
        subtitle: 'Two fictional items · $38.00 before shipping',
        content: [
          el('div', [el('strong', [text('Smoked pine tea')]), el('span', [text('$14.00')])], { class: 'row card cart' }),
          el('div', [el('strong', [text('Stoneware mug')]), el('span', [text('$24.00')])], { class: 'row card cart' }),
          field('Email for the receipt', '', 'receipt-email', 'email'),
          field('Discount code', '', 'coupon'),
          button('Apply coupon', 'quiet', 'apply'),
          el('div', [text('Enter a demo code to check available savings.')], { class: 'error', id: 'coupon-result' }),
          el('div', [el('strong', [text('Total $38.00')]), button('Place order', '', 'place-order')], { class: 'row card' }),
        ],
      },
      steps: [
        [600, 'click', 'Review cart contents', '.cart'],
        [1600, 'fill', 'Enter a masked receipt email', '#receipt-email'],
        [3900, 'type', 'Enter the demo coupon', '#coupon'],
        [5700, 'click', 'Apply coupon', '#apply'],
        [7600, 'wait', 'Read the coupon validation error'],
        [9900, 'click', 'Place the order', '#place-order'],
      ],
      inputs: [
        { at: 1800, selector: '#receipt-email', text: '**********************' },
        { at: 4100, selector: '#coupon', text: '********' },
      ],
      changes: [
        { at: 6100, from: 'Enter a demo code to check available savings.', to: 'That demo code has expired. Your cart is still saved.' },
        { at: 10800, from: 'Total $38.00', to: 'Order received · $38.00' },
        { at: 10800, from: 'Place order', to: 'Order confirmed' },
        { at: 11100, from: 'Order received · $38.00', to: 'Order received · receipt details masked' },
      ],
      console: [
        {
          at: 5840,
          level: 'warn',
          message: 'Coupon validation returned 422; cart remains available.',
          url: 'https://shop.pinecone.demo.test/checkout',
        },
      ],
      network: [
        {
          id: 'checkout-cart',
          at: 420,
          duration: 96,
          method: 'GET',
          url: 'https://api.pinecone.demo.test/v1/cart',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'checkout-coupon',
          at: 5700,
          duration: 140,
          method: 'POST',
          url: 'https://api.pinecone.demo.test/v1/coupons/SPRING10',
          status: 422,
          statusText: 'Unprocessable Content',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'checkout-submit',
          at: 9900,
          duration: 305,
          method: 'POST',
          url: 'https://orders.pinecone.demo.test/v1/orders',
          status: 201,
          statusText: 'Created',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
      ],
    }),
    bundle({
      id: 'demo-seed-dashboard-search',
      title: 'Operations dashboard · search and inspect',
      app: 'Northstar Operations',
      suiteName: 'Dashboard search',
      url: 'https://ops.northstar.demo.test/activity',
      capturedAt: '2026-10-18T09:42:00.000Z',
      duration: 16200,
      tags: ['dashboard', 'search', 'desktop'],
      viewport: { width: 1536, height: 960 },
      view: {
        eyebrow: 'Northstar operations · demo',
        heading: 'Activity overview',
        subtitle: 'Search recent fictional workspace events across three demo services.',
        content: [
          el('div', [field('Search activity', '', 'activity-search'), button('Search', '', 'activity-search-submit')], {
            class: 'grid card',
          }),
          el('div', [text('Showing all recent activity.')], { class: 'muted', id: 'search-summary' }),
          el(
            'div',
            [
              el('strong', [text('Invoice review completed')]),
              p('Workspace Delta · 09:37 · web app'),
              el('span', [text('success')], { class: 'pill' }),
            ],
            { class: 'card', id: 'invoice-result' },
          ),
          el(
            'div',
            [
              el('strong', [text('Invoice export queued')]),
              p('Workspace Cedar · 09:31 · reports service'),
              el('span', [text('queued')], { class: 'pill' }),
            ],
            { class: 'card' },
          ),
          el(
            'div',
            [
              el('strong', [text('Invoice member invited')]),
              p('Workspace Meadow · 09:22 · identity service'),
              el('span', [text('success')], { class: 'pill' }),
            ],
            { class: 'card' },
          ),
          button('Load more activity', 'quiet'),
        ],
      },
      steps: [
        [500, 'goto', 'Open the activity dashboard'],
        [2700, 'fill', 'Search for invoice activity', '#activity-search'],
        [4300, 'press', 'Submit the search', '#activity-search'],
        [8200, 'click', 'Open the invoice review result', '#invoice-result'],
        [12700, 'click', 'Load more activity', 'button.quiet'],
      ],
      inputs: [{ at: 3000, selector: '#activity-search', text: 'invoice', isChecked: false }],
      changes: [
        { at: 5000, from: 'Showing all recent activity.', to: '3 demo events match “invoice”.' },
        { at: 9000, from: 'Invoice review completed', to: 'Invoice review · details opened' },
        { at: 16200, from: '3 demo events match “invoice”.', to: 'Search complete · 3 demo results retained.' },
      ],
      network: [
        {
          id: 'dashboard-page',
          at: 250,
          duration: 122,
          method: 'GET',
          url: 'https://ops.northstar.demo.test/activity',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'text/html' }],
        },
        {
          id: 'dashboard-search',
          at: 4300,
          duration: 346,
          method: 'GET',
          url: 'https://api.northstar.demo.test/v1/activity?q=invoice',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'dashboard-identity',
          at: 4650,
          duration: 89,
          method: 'GET',
          url: 'https://identity.northstar.demo.test/v1/current-user',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'dashboard-more',
          at: 12700,
          duration: 205,
          method: 'GET',
          url: 'https://api.northstar.demo.test/v1/activity?cursor=demo-2',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
      ],
    }),
    bundle({
      id: 'demo-seed-network-retry',
      title: 'Report export · timeout followed by retry',
      app: 'Northstar Reports',
      suiteName: 'Network retry',
      url: 'https://reports.northstar.demo.test/exports',
      capturedAt: '2026-10-20T14:05:00.000Z',
      duration: 19800,
      tags: ['network', 'retry', 'recovery'],
      viewport: { width: 1365, height: 850 },
      view: {
        eyebrow: 'Northstar reports · demo',
        heading: 'Export is ready',
        subtitle: 'The first request timed out. A retry completed and produced a fictional report.',
        content: [
          el('div', [text('Export queued. Waiting for the first response…')], { class: 'error card', id: 'export-status' }),
          el('div', [text('Retry has not started yet.')], { class: 'ok card', id: 'retry-status' }),
          el('div', [el('strong', [text('Quarterly activity summary.csv')]), el('span', [text(' 42 KB · expires in 1 hour')])], {
            class: 'row card',
          }),
          button('Download report'),
          button('Start export', 'quiet', 'export'),
          button('Retry export', 'quiet', 'retry'),
        ],
      },
      steps: [
        [700, 'click', 'Start a report export', '#export'],
        [11200, 'wait', 'Observe the request timeout'],
        [12600, 'click', 'Retry the export', '#retry'],
        [18300, 'wait', 'Confirm the completed export'],
      ],
      changes: [
        { at: 10710, from: 'Export queued. Waiting for the first response…', to: 'First attempt timed out after 10 seconds.' },
        { at: 13220, from: 'Retry has not started yet.', to: 'Retry 2 of 2 · completed at 14:05:13' },
        { at: 19800, from: 'First attempt timed out after 10 seconds.', to: 'Retry completed · fictional report is ready.' },
      ],
      console: [
        {
          at: 10710,
          level: 'error',
          message: 'Export request failed: network timeout (demo fixture).',
          url: 'https://reports.northstar.demo.test/exports',
        },
        {
          at: 13220,
          level: 'info',
          message: 'Export retry completed with status 200.',
          url: 'https://reports.northstar.demo.test/exports',
        },
      ],
      network: [
        {
          id: 'export-first',
          at: 700,
          duration: 10000,
          method: 'POST',
          url: 'https://api.northstar.demo.test/v1/exports',
          status: 0,
          statusText: 'Network Error',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [],
        },
        {
          id: 'export-retry',
          at: 12600,
          duration: 620,
          method: 'POST',
          url: 'https://api.northstar.demo.test/v1/exports',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'export-download',
          at: 18400,
          duration: 198,
          method: 'GET',
          url: 'https://cdn.northstar.demo.test/demo/quarterly-activity-summary.csv',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/csv',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'text/csv' }],
        },
      ],
    }),
    bundle({
      id: 'demo-seed-console-diagnostics',
      title: 'Settings diagnostics · warning and recovered preference',
      app: 'Northstar Preferences',
      suiteName: 'Console diagnostics',
      url: 'https://settings.northstar.demo.test/preferences',
      capturedAt: '2026-10-22T11:15:00.000Z',
      duration: 8400,
      tags: ['console', 'settings', 'warning'],
      viewport: { width: 1280, height: 800 },
      view: {
        eyebrow: 'Northstar preferences · demo',
        heading: 'Notification settings',
        subtitle: 'A stale preference is ignored and the safe default is restored.',
        content: [
          el('div', [text('Checking the saved digest preference…')], { class: 'error card' }),
          el('label', [el('input', [], { type: 'checkbox', checked: 'checked' }), text(' Email me a weekly summary')], { class: 'card' }),
          el('label', [el('input', [], { type: 'checkbox' }), text(' Notify me about product updates')], { class: 'card' }),
          el('div', [text('Changes are ready to save.')], { class: 'ok card' }),
          button('Save preferences'),
        ],
      },
      steps: [
        [500, 'goto', 'Open notification settings'],
        [2200, 'click', 'Review the restored weekly setting', 'input[type=checkbox]'],
        [4600, 'click', 'Save the safe preferences', 'button'],
        [7200, 'wait', 'Confirm the saved state'],
      ],
      changes: [
        { at: 2000, from: 'Checking the saved digest preference…', to: 'Digest value was not recognized. Weekly default restored.' },
        { at: 5100, from: 'Changes are ready to save.', to: 'Preferences saved with the weekly default.' },
        { at: 8400, from: 'Preferences saved with the weekly default.', to: 'Preferences saved · weekly email selected.' },
      ],
      console: [
        {
          at: 350,
          level: 'warn',
          message: 'Unknown digestSchedule value; falling back to weekly.',
          url: 'https://settings.northstar.demo.test/preferences',
        },
        { at: 4810, level: 'info', message: 'Preference update saved.', url: 'https://settings.northstar.demo.test/preferences' },
      ],
      network: [
        {
          id: 'preferences-read',
          at: 250,
          duration: 114,
          method: 'GET',
          url: 'https://api.northstar.demo.test/v1/preferences',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'preferences-save',
          at: 4600,
          duration: 176,
          method: 'PUT',
          url: 'https://api.northstar.demo.test/v1/preferences',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
      ],
    }),
    bundle({
      id: 'demo-seed-long-activity',
      title: 'Team workspace · longer activity session',
      app: 'Northstar Workspace',
      suiteName: 'Workspace activity',
      url: 'https://workspace.northstar.demo.test/team',
      capturedAt: '2026-10-26T08:35:00.000Z',
      duration: 63200,
      tags: ['activity', 'long-session', 'team'],
      viewport: { width: 1440, height: 900 },
      view: {
        eyebrow: 'Northstar workspace · demo',
        heading: 'Team activity',
        subtitle: 'A longer fictional session moving between a task, comments, and a saved view.',
        content: [
          el('div', [el('strong', [text('Launch checklist')]), p('8 of 10 items complete · updated just now'), button('Open checklist')], {
            class: 'card',
          }),
          el(
            'div',
            [
              el('strong', [text('Recent activity')]),
              el('ul', [
                el('li', [text('Avery moved “Review email copy” to Done')]),
                el('li', [text('Morgan added a note to “Mobile navigation”')]),
                el('li', [text('Taylor created “Release smoke checks”')]),
                el('li', [text('Avery saved the “My open tasks” view')]),
              ]),
            ],
            { class: 'card' },
          ),
          field('Find a teammate', '', 'member-search'),
          button('Save this view', 'quiet', 'save-view'),
        ],
      },
      steps: [
        [800, 'goto', 'Open the team workspace'],
        [5300, 'click', 'Open the launch checklist', 'button'],
        [12400, 'scroll', 'Read recent activity'],
        [21600, 'click', 'Open the mobile navigation note', 'li'],
        [30700, 'fill', 'Find a teammate', '#member-search'],
        [38900, 'press', 'Filter team activity', '#member-search'],
        [48100, 'click', 'Save the current view', 'button.quiet'],
        [59600, 'wait', 'Review the saved activity view'],
      ],
      inputs: [{ at: 31000, selector: '#member-search', text: 'Morgan', isChecked: false }],
      changes: [
        {
          at: 6000,
          from: '8 of 10 items complete · updated just now',
          to: 'Checklist opened · 8 of 10 items complete',
        },
        { at: 24000, from: 'Morgan added a note to “Mobile navigation”', to: 'Mobile navigation · note opened by Morgan' },
        { at: 41000, from: 'Recent activity', to: 'Recent activity · Morgan match found' },
        { at: 52000, from: 'Avery saved the “My open tasks” view', to: 'Saved view · “My open tasks”' },
        { at: 63200, from: 'Launch checklist', to: 'Launch checklist · demo session complete' },
      ],
      network: [
        {
          id: 'team-page',
          at: 250,
          duration: 120,
          method: 'GET',
          url: 'https://workspace.northstar.demo.test/team',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'text/html' }],
        },
        {
          id: 'team-tasks',
          at: 900,
          duration: 240,
          method: 'GET',
          url: 'https://api.northstar.demo.test/v1/tasks?view=launch',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'team-events',
          at: 12400,
          duration: 304,
          method: 'GET',
          url: 'https://events.northstar.demo.test/v1/activity?team=demo',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'team-search',
          at: 38900,
          duration: 159,
          method: 'GET',
          url: 'https://identity.northstar.demo.test/v1/members?q=Morgan',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestHeaders: [],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
        {
          id: 'team-save-view',
          at: 48100,
          duration: 207,
          method: 'PUT',
          url: 'https://api.northstar.demo.test/v1/views/demo-open-tasks',
          status: 201,
          statusText: 'Created',
          mimeType: 'application/json',
          requestHeaders: [{ name: 'content-type', value: 'application/json' }],
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        },
      ],
    }),
  ];

  const byId = new Map(replays.map((replay) => [replay.meta.id, replay]));
  const run = (id, sequence, label, status, startedAt, replayId, finishedAt) => ({
    id,
    sequence,
    label,
    status,
    startedAt,
    ...(finishedAt ? { finishedAt } : {}),
    ...(replayId
      ? {
          replayId,
          recording: {
            title: byId.get(replayId).meta.title,
            duration: byId.get(replayId).meta.duration,
            steps: byId.get(replayId).steps.length,
            viewport: byId.get(replayId).meta.viewport,
          },
        }
      : {}),
  });
  const suites = [
    suite('demo-suite-release-smoke', 'Release smoke · storefront and account', '2026-10-26T09:00:00.000Z', [
      run('signup-desktop', 1, 'Signup · desktop', 'passed', '2026-10-26T08:48:00.000Z', 'demo-seed-signup', '2026-10-26T08:48:05.000Z'),
      run(
        'checkout-desktop',
        2,
        'Checkout · coupon edge case',
        'failed',
        '2026-10-26T08:50:00.000Z',
        'demo-seed-checkout-error',
        '2026-10-26T08:50:12.000Z',
      ),
      run(
        'dashboard-search',
        3,
        'Dashboard · search activity',
        'passed',
        '2026-10-26T08:53:00.000Z',
        'demo-seed-dashboard-search',
        '2026-10-26T08:53:17.000Z',
      ),
      run('mobile-checkout', 4, 'Checkout · narrow viewport follow-up', 'running', '2026-10-26T09:00:00.000Z'),
    ]),
    suite('demo-suite-reliability', 'Reliability review · retry and diagnostics', '2026-10-23T13:20:00.000Z', [
      run(
        'export-first-attempt',
        1,
        'Export retry · initial timeout',
        'failed',
        '2026-10-23T13:02:00.000Z',
        'demo-seed-network-retry',
        '2026-10-23T13:02:20.000Z',
      ),
      run(
        'settings-recovery',
        2,
        'Preferences · fallback recovery',
        'passed',
        '2026-10-23T13:08:00.000Z',
        'demo-seed-console-diagnostics',
        '2026-10-23T13:08:09.000Z',
      ),
      run(
        'background-sync',
        3,
        'Background sync · partial recording',
        'partial',
        '2026-10-23T13:14:00.000Z',
        undefined,
        '2026-10-23T13:14:30.000Z',
      ),
    ]),
    suite('demo-suite-workspace-activity', 'Workspace activity · team collaboration', '2026-10-26T08:35:00.000Z', [
      run(
        'team-long-session',
        1,
        'Team activity · long session',
        'passed',
        '2026-10-26T08:35:00.000Z',
        'demo-seed-long-activity',
        '2026-10-26T08:36:04.000Z',
      ),
      run('team-search-follow-up', 2, 'Teammate search · follow-up', 'partial', '2026-10-26T08:42:00.000Z'),
    ]),
  ];

  // Correlate suite-linked bundles with their actual stored run ids.
  const links = new Map();
  for (const item of suites)
    for (const itemRun of item.runs) if (itemRun.replayId) links.set(itemRun.replayId, { suiteId: item.id, runId: itemRun.id });
  for (const replay of replays) {
    const suiteRun = links.get(replay.meta.id);
    if (suiteRun) replay.suiteRun = suiteRun;
    assertReplayBundle(replay);
  }
  return { replays, suites };
}

export async function writeStable(path, value) {
  const body = typeof value === 'string' ? value : `${JSON.stringify(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, body, { flag: 'wx' });
    return 'created';
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(path, 'utf8');
    if (existing !== body) throw new Error(`refusing to replace existing non-seed file: ${path}`, { cause: error });
    return 'unchanged';
  }
}

export async function writeDemoSeed(outputDir = DEFAULT_OUTPUT) {
  const output = resolve(outputDir);
  const { replays, suites } = createDemoSeed();
  const results = [];
  for (const replay of replays) {
    results.push([await writeStable(join(output, 'sample', `${replay.meta.id}.json`), replay), `sample/${replay.meta.id}.json`]);
  }
  for (const item of suites) {
    results.push([await writeStable(join(output, 'data', '_suites', `${item.id}.json`), item), `data/_suites/${item.id}.json`]);
  }
  await writeStable(
    join(output, 'README.txt'),
    [
      'Fictional local preview data generated by scripts/demo-seed.mjs.',
      'Copy sample/*.json into the directory used by SAMPLE_DIR.',
      'Copy data/_suites/*.json into DATA_DIR/_suites/ (create the folder if needed).',
      'Copy the sample replay JSON files into DATA_DIR/<replay-id>/replay.json too if the suite workspace should resolve run summaries from uploaded storage.',
      'Each bundle has a pre-action rrweb snapshot followed by timed pointer, input, and DOM mutation events through its declared duration.',
      'All input values are masked, all records are fictional demo fixtures, and no live requests or customer data are used.',
      'To update only existing copies owned by this seed, run --refresh-preview with the configured SAMPLE_DIR and DATA_DIR after checking its marker requirements in docs/demo-seed.md.',
      '',
    ].join('\n'),
  );
  return { output, results, replays: replays.length, suites: suites.length };
}

const OWNED_REPLAY_IDS = [
  'demo-seed-signup',
  'demo-seed-checkout-error',
  'demo-seed-dashboard-search',
  'demo-seed-network-retry',
  'demo-seed-console-diagnostics',
  'demo-seed-long-activity',
];
const OWNED_SUITE_IDS = ['demo-suite-release-smoke', 'demo-suite-reliability', 'demo-suite-workspace-activity'];

function assertOwnedReplay(value, id, path) {
  assertReplayBundle(value);
  if (
    value.meta.id !== id ||
    !value.meta.tags?.includes('demo') ||
    !value.meta.tags?.includes('synthetic') ||
    value.context?.fields?.demo !== true ||
    value.context?.fields?.fictional !== true ||
    value.context?.app?.environment !== 'demo'
  ) {
    throw new Error(`refusing to refresh replay without this seed's demo markers: ${path}`);
  }
}

function assertOwnedSuite(value, id, path) {
  assertReviewSuite(value);
  if (
    value.id !== id ||
    value.context?.fields?.demo !== true ||
    value.context?.fields?.fictional !== true ||
    value.context?.app?.environment !== 'demo'
  ) {
    throw new Error(`refusing to refresh suite without this seed's demo markers: ${path}`);
  }
}

async function ownedTarget(path, id, assertOwned) {
  const info = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`refusing to refresh missing seed target: ${path}`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`refusing to refresh non-file seed target: ${path}`);
  const original = await readFile(path, 'utf8');
  const current = JSON.parse(original);
  assertOwned(current, id, path);
  return { path, original };
}

/** Safely refresh only already-existing, marker-verified files owned by this seed. */
export async function refreshDemoSeed(sampleDir, dataDir) {
  const sample = resolve(sampleDir);
  const data = resolve(dataDir);
  const { replays, suites } = createDemoSeed();
  const replayById = new Map(replays.map((replay) => [replay.meta.id, replay]));
  const suiteById = new Map(suites.map((item) => [item.id, item]));
  const targets = [];

  // All required destinations are verified before the first write. Optional uploaded copies
  // are refreshed only when present and only after they pass the same ownership checks.
  for (const id of OWNED_REPLAY_IDS) {
    const replay = replayById.get(id);
    targets.push({ ...(await ownedTarget(join(sample, `${id}.json`), id, assertOwnedReplay)), value: replay });
    const uploaded = join(data, id, 'replay.json');
    try {
      await lstat(uploaded);
      targets.push({ ...(await ownedTarget(uploaded, id, assertOwnedReplay)), value: replay });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const id of OWNED_SUITE_IDS) {
    targets.push({
      ...(await ownedTarget(join(data, '_suites', `${id}.json`), id, assertOwnedSuite)),
      value: suiteById.get(id),
    });
  }

  const updated = [];
  const staged = [];
  try {
    for (const [index, target] of targets.entries()) {
      const temp = `${target.path}.demo-refresh-${process.pid}-${index}.tmp`;
      await writeFile(temp, `${JSON.stringify(target.value)}\n`, { flag: 'wx' });
      staged.push({ ...target, temp });
    }
    for (const target of staged) {
      if ((await readFile(target.path, 'utf8')) !== target.original) {
        throw new Error(`refusing to refresh seed target changed after preflight: ${target.path}`);
      }
      await rename(target.temp, target.path);
      updated.push(target.path);
    }
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => unlink(temp).catch(() => {})));
    throw error;
  }
  return { sampleDir: sample, dataDir: data, updated };
}

function parseArgs(args) {
  if (args[0] === '--refresh-preview') {
    const sampleIndex = args.indexOf('--sample-dir');
    const dataIndex = args.indexOf('--data-dir');
    if (args.length !== 5 || sampleIndex < 0 || dataIndex < 0 || sampleIndex === dataIndex) {
      throw new Error('usage: node scripts/demo-seed.mjs --refresh-preview --sample-dir <dir> --data-dir <dir>');
    }
    const sampleDir = args[sampleIndex + 1];
    const dataDir = args[dataIndex + 1];
    if (!sampleDir || sampleDir.startsWith('--') || !dataDir || dataDir.startsWith('--')) {
      throw new Error('--refresh-preview requires existing --sample-dir and --data-dir paths');
    }
    return { mode: 'refresh', sampleDir, dataDir };
  }
  const outputIndex = args.indexOf('--output');
  if (outputIndex === -1) {
    if (args.length) throw new Error('usage: node scripts/demo-seed.mjs [--output <directory>]');
    return { mode: 'seed', output: DEFAULT_OUTPUT };
  }
  const value = args[outputIndex + 1];
  if (!value || value.startsWith('--')) throw new Error('--output requires a directory');
  if (args.filter((arg) => arg === '--output').length !== 1 || args.length !== 2)
    throw new Error('usage: node scripts/demo-seed.mjs [--output <directory>]');
  return { mode: 'seed', output: value };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result =
      options.mode === 'refresh' ? await refreshDemoSeed(options.sampleDir, options.dataDir) : await writeDemoSeed(options.output);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
