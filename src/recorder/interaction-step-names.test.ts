// @vitest-environment happy-dom
import { describe, expect, it, onTestFinished } from 'vitest';

import type { RawStep } from './bundle.ts';
import { resolveCapture } from './capture-options.ts';
import { captureInteractionSteps } from './interaction-steps.ts';
import { recorderPrivacy } from './recorder-privacy.ts';
import { STEP_LABEL_MAX } from './step-label.ts';
import type { RecorderPrivacyOptions } from './types.ts';

const originalUrl = location.href;

function capture(options: RecorderPrivacyOptions = { maskAllText: false }) {
  const steps: RawStep[] = [];
  const privacy = recorderPrivacy(options, resolveCapture({ privacy: options }));
  onTestFinished(captureInteractionSteps(privacy, (step) => steps.push(step)));
  return steps;
}

function control(html: string, tag = 'button') {
  const element = document.createElement(tag);
  element.innerHTML = html;
  document.body.append(element);
  onTestFinished(() => element.remove());
  return element;
}

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
    control('<span>asdadasd</span><span>10:00 AM to 1:15 PM</span><span>3h 15m asdadasd asdasd</span>').click();
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

describe('semantic step names', () => {
  it('names a field by its label, placeholder or legend and says it was focused', () => {
    const steps = capture();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<label for="task">Task name</label><input id="task" value="private">
       <label>Notes <textarea>typed text</textarea></label>
       <input placeholder="Search tasks:">
       <fieldset><legend>Due date</legend><input type="text"></fieldset>
       <input type="checkbox" aria-label="Billable">`,
    );
    onTestFinished(() => document.body.replaceChildren());
    for (const field of document.querySelectorAll<HTMLElement>('input, textarea')) field.click();
    expect(steps.map((step) => step.label)).toEqual([
      'Focused “Task name”',
      'Focused “Notes”',
      'Focused “Search tasks”',
      'Focused “Due date”',
      'Clicked “Billable”',
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/private|typed text/);
  });

  it('names an icon-only button from an inner icon and trims a trailing colon', () => {
    const steps = capture();
    control('<svg aria-label="Close"></svg>').click();
    control('Profile:').click();
    expect(steps.map((step) => step.label)).toEqual(['Clicked “Close”', 'Clicked “Profile”']);
  });

  it('marks its labels as generated', () => {
    const steps = capture();
    control('Save').click();
    expect(steps[0]).toMatchObject({ kind: 'click', auto: true });
  });

  it('folds a click and the navigation it causes into one step', () => {
    const steps = capture();
    control('Projects').click();
    history.pushState(null, '', '/projects');
    onTestFinished(() => history.replaceState(null, '', originalUrl));
    expect(steps.map((step) => step.label)).toEqual(['Opened “Projects”']);
  });

  it('names a navigation alone by its page', () => {
    const steps = capture();
    history.pushState(null, '', '/workspace/tasks');
    onTestFinished(() => history.replaceState(null, '', originalUrl));
    expect(steps.map((step) => step.label)).toEqual(['Opened Tasks']);
  });

  it('drops the form submission that a submit button click already shows', () => {
    const steps = capture();
    const form = document.createElement('form');
    form.addEventListener('submit', (event) => event.preventDefault());
    form.innerHTML = '<button type="submit">Create task</button>';
    document.body.append(form);
    onTestFinished(() => form.remove());
    form.querySelector('button')?.click();
    expect(steps.map((step) => step.label)).toEqual(['Clicked “Create task”']);
  });
});
