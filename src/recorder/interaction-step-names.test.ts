// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import type { RawStep } from './bundle.ts';
import { resolveCapture } from './capture-options.ts';
import { captureInteractionSteps } from './interaction-steps.ts';
import { recorderPrivacy } from './recorder-privacy.ts';
import { STEP_LABEL_MAX } from './step-label.ts';
import type { RecorderPrivacyOptions } from './types.ts';

const cleanups: Array<() => void> = [];

function capture(options: RecorderPrivacyOptions = { maskAllText: false }) {
  const steps: RawStep[] = [];
  const privacy = recorderPrivacy(options, resolveCapture({ privacy: options }));
  cleanups.push(captureInteractionSteps(privacy, (step) => steps.push(step)));
  return steps;
}

function control(html: string, tag = 'button') {
  const element = document.createElement(tag);
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  document.body.replaceChildren();
});

describe('click labels name the control, briefly', () => {
  it('prefers aria-label over aria-labelledby, title and text', () => {
    const steps = capture();
    document.body.insertAdjacentHTML('beforeend', '<span id="named">Named elsewhere</span>');
    const entry = control('Entry text');
    entry.setAttribute('aria-label', 'Time entry, 10:00 AM to 1:15 PM');
    entry.setAttribute('aria-labelledby', 'named');
    entry.setAttribute('title', 'Entry title');
    entry.click();
    expect(steps[0]?.label).toBe('Clicked “Time entry, 10:00 AM to 1:15 PM”');
  });

  it('uses aria-labelledby before title, and title before text', () => {
    const steps = capture();
    document.body.insertAdjacentHTML('beforeend', '<span id="a">Add</span><span id="b">project</span>');
    const labelled = control('x');
    labelled.setAttribute('aria-labelledby', 'a b');
    labelled.setAttribute('title', 'Ignored title');
    labelled.click();
    const titled = control('Visible text');
    titled.setAttribute('title', 'Open the menu');
    titled.click();
    expect(steps.map((step) => step.label)).toEqual(['Clicked “Add project”', 'Clicked “Open the menu”']);
  });

  it('names a control without an accessible name by its first line, not all of its text', () => {
    const steps = capture();
    control('<span>asdadasd</span><span>10:00 AM–1:15 PM</span><span>3h 15m asdadasd asdasd</span>').click();
    control('Save draft\nLast saved a minute ago').click();
    expect(steps.map((step) => step.label)).toEqual(['Clicked “asdadasd”', 'Clicked “Save draft”']);
  });

  it('caps a long name at a word boundary without an ellipsis', () => {
    const steps = capture();
    const long = 'Review the quarterly budget forecast for the whole platform team before Friday';
    const entry = control('x');
    entry.setAttribute('aria-label', long);
    entry.click();
    const name = /“(.*)”/u.exec(steps[0]?.label ?? '')?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(STEP_LABEL_MAX);
    expect(long.startsWith(`${name} `)).toBe(true);
    expect(steps[0]?.label).not.toContain('…');
  });

  it('keeps a long name ellipsis-free when it is redacted first', () => {
    const steps = capture();
    const entry = control('x');
    entry.setAttribute('aria-label', `${'word '.repeat(30)}ada@example.com`);
    entry.click();
    expect(steps[0]?.label).not.toMatch(/…|\.\.\./);
  });
});

describe('click labels never read masked or private text', () => {
  const masked = { maskAllText: false, maskTextSelector: '[data-private]', blockSelector: '[data-blocked]' } as const;

  it('ignores aria-label, aria-labelledby and title on a masked control', () => {
    const steps = capture(masked);
    document.body.insertAdjacentHTML('beforeend', '<span id="secret">Secret customer</span>');
    const entry = control('Private text');
    entry.setAttribute('data-private', '');
    entry.setAttribute('aria-label', 'Secret customer');
    entry.setAttribute('aria-labelledby', 'secret');
    entry.setAttribute('title', 'Secret customer');
    entry.click();
    expect(steps[0]?.label).toBe('Clicked button');
  });

  it('skips an aria-labelledby target that is masked or blocked and falls back to the title', () => {
    const steps = capture(masked);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span id="masked" data-private>Secret customer</span><span id="blocked" data-blocked>Hidden customer</span>',
    );
    const entry = control('Open');
    entry.setAttribute('aria-labelledby', 'masked blocked');
    entry.setAttribute('title', 'Open project');
    entry.click();
    expect(steps[0]?.label).toBe('Clicked “Open project”');
    expect(JSON.stringify(steps)).not.toMatch(/Secret|Hidden/);
  });

  it('puts no text in a label while all text is masked, whatever names the control', () => {
    const steps = capture({});
    const entry = control('Customer Ada Lovelace');
    entry.setAttribute('aria-label', 'Customer Ada Lovelace');
    entry.setAttribute('title', 'Customer Ada Lovelace');
    entry.click();
    expect(steps[0]?.label).toBe('Clicked button');
  });

  it('never reads a masked descendant when taking the first line', () => {
    const steps = capture(masked);
    control('<span data-private>Secret customer</span><span>Open</span>').click();
    expect(steps[0]?.label).toBe('Clicked “Open”');
  });
});
