// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultUi } from './default-ui.ts';
import { must } from './testing.ts';
import type { PrivacyFacts, RecorderPrivacyMode, RecordingChoiceOffer } from './types.ts';

const MODES: RecorderPrivacyMode[] = ['visible', 'inputs-masked', 'interface-visible', 'masked'];

const masked: PrivacyFacts = {
  mode: 'masked',
  maxDurationMs: 180_000,
  reviewRequired: true,
  captures: { pageText: false, inputs: false, media: false, console: true, network: true },
};
/** A host that keeps media blocked: Inputs hidden collapses into Masked, so it is not offered. */
const offer: RecordingChoiceOffer = {
  by: 'staff',
  privacy: [
    { mode: 'visible', facts: { ...masked, mode: 'visible', captures: { ...masked.captures, pageText: true, inputs: true } } },
    { mode: 'masked', facts: masked },
  ],
  profiles: [
    { id: 'triage', label: 'Triage' },
    { id: 'design-review', label: 'Design review', description: 'Layout and visual feedback' },
  ],
  initial: { privacy: 'masked', profile: 'triage' },
  defaults: { privacy: 'masked', profile: 'triage' },
};

const root = () => must(document.querySelector('[data-recorder-ui]')?.shadowRoot);
const node = <T extends HTMLElement = HTMLElement>(selector: string) => must(root().querySelector<T>(selector), selector);
const item = (group: string, value: string) => node(`[role=menuitemradio][data-group=${group}][data-value=${value}]`);
const key = (target: HTMLElement, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
const active = () => {
  const element = root().activeElement;
  if (!(element instanceof HTMLElement)) throw new Error('Nothing in the recorder UI has focus');
  return element;
};
const trigger = () => node('[data-recorder-action=options]');
const open = async () => {
  const abort = new AbortController();
  const choice = createDefaultUi().chooseOptions({ trigger: { source: 'user' }, offer, signal: abort.signal });
  await vi.waitFor(() => node('[data-recorder-action=record]'));
  return { abort, choice };
};

const clearPage = () => {
  document.body.innerHTML = '';
};

describe('default UI options pill', () => {
  afterEach(clearPage);

  it('shows only Record, the options button and close in the pill, with Record focused', async () => {
    await open();
    const pill = node('.pill');
    expect([...pill.querySelectorAll('button')].map((button) => button.dataset.recorderAction)).toEqual([
      'record',
      'options',
      'options-cancel',
    ]);
    expect(pill.textContent).toBe('Record');
    expect(active()).toBe(node('[data-recorder-action=record]'));
  });

  it('summarizes the current choice in the options tooltip and marks a non-default one', async () => {
    await open();
    expect(trigger().title).toBe('Fully masked · Triage');
    expect(trigger().hasAttribute('data-changed')).toBe(false);
    trigger().click();
    item('privacy', 'visible').click();
    expect(trigger().title).toBe('Visible · Triage');
    expect(trigger().hasAttribute('data-changed')).toBe(true);
  });
});

const describedBy = (element: HTMLElement) => node(`#${element.getAttribute('aria-describedby') ?? ''}`).textContent;

describe('default UI options menu content', () => {
  afterEach(clearPage);

  it('lists Profile before Privacy', async () => {
    await open();
    expect([...root().querySelectorAll('.options-heading')].map((heading) => heading.textContent)).toEqual(['Profile', 'Privacy']);
  });

  it('describes each mode in one short line tied to its item', async () => {
    await open();
    expect(MODES.map((mode) => describedBy(item('privacy', mode)))).toEqual([
      'Records text and inputs',
      'Not allowed here',
      'Not allowed here',
      'Hides everything',
    ]);
  });

  it('disables a mode the host does not allow', async () => {
    await open();
    expect(item('privacy', 'inputs-masked').getAttribute('aria-disabled')).toBe('true');
    trigger().click();
    item('privacy', 'inputs-masked').click();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('adds no note under the privacy group', async () => {
    await open();
    const group = node('[role=group][aria-labelledby=recorder-options-menu-privacy]');
    expect(group.hasAttribute('aria-describedby')).toBe(false);
    expect(group.textContent).not.toContain('Passwords');
  });

  it("shows a profile's description under it and leaves one without a description plain", async () => {
    await open();
    expect(describedBy(item('profile', 'design-review'))).toBe('Layout and visual feedback');
    expect(item('profile', 'triage').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('default UI options menu', () => {
  afterEach(clearPage);

  it('opens on ArrowDown at the first checked item and skips disabled modes with the arrow keys', async () => {
    await open();
    key(trigger(), 'ArrowDown');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(active()).toBe(item('profile', 'triage'));
    key(active(), 'End');
    expect(active()).toBe(item('privacy', 'masked'));
    key(active(), 'ArrowUp');
    expect(active()).toBe(item('privacy', 'visible'));
  });

  it('closes on select, returns focus to the options button and resolves Record with the choice', async () => {
    const { choice } = await open();
    trigger().click();
    key(active(), 'End');
    key(active(), 'ArrowUp');
    key(active(), 'Enter');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(active()).toBe(trigger());
    trigger().click();
    item('profile', 'design-review').click();
    expect(item('profile', 'design-review').getAttribute('aria-checked')).toBe('true');
    node('[data-recorder-action=record]').click();
    await expect(choice).resolves.toEqual({ privacy: 'visible', profile: 'design-review' });
  });

  it('closes the menu on Escape before cancelling the step', async () => {
    const { choice } = await open();
    trigger().click();
    key(active(), 'Escape');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    key(trigger(), 'Escape');
    await expect(choice).resolves.toBeUndefined();
    expect(root().querySelector('#recorder-options-menu')).toBeNull();
  });

  it('closes the menu on a pointer press outside it', async () => {
    await open();
    trigger().click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('cancels when the recorder aborts the prompt', async () => {
    const { abort, choice } = await open();
    abort.abort();
    await expect(choice).resolves.toBeUndefined();
  });
});

const customerOffer: RecordingChoiceOffer = {
  by: 'customer',
  privacy: [
    { mode: 'interface-visible', facts: { ...masked, captures: { ...masked.captures, interfaceText: true } } },
    { mode: 'masked', facts: masked },
    { mode: 'visible', facts: { ...masked, mode: 'visible', captures: { ...masked.captures, pageText: true, inputs: true } } },
  ],
  profiles: [],
  networkBodies: { allowed: true },
  initial: { privacy: 'interface-visible', networkBodies: false },
  defaults: { privacy: 'interface-visible', networkBodies: false },
};

const openCustomer = async () => {
  const choice = createDefaultUi().chooseOptions({
    trigger: { source: 'user' },
    offer: customerOffer,
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => node('[data-recorder-action=record]'));
  return { choice };
};

describe('default UI options for a customer', () => {
  afterEach(clearPage);

  it('lists the offered modes in the offer order, the default first, with no disabled mode', async () => {
    await openCustomer();
    const modes = [...root().querySelectorAll<HTMLElement>('[data-group=privacy]')];
    expect(modes.map((mode) => mode.textContent)).toEqual([
      "Your data hiddenShows only the app's menus and labels",
      'Fully maskedHides everything',
      'VisibleRecords text and inputs',
    ]);
    expect(modes.filter((mode) => mode.hasAttribute('aria-disabled'))).toEqual([]);
    expect(item('privacy', 'interface-visible').getAttribute('aria-checked')).toBe('true');
  });

  it('offers network content unchecked and resolves Record with it once picked', async () => {
    const { choice } = await openCustomer();
    const bodies = node('[role=menuitemcheckbox][data-group=network]');
    expect(bodies.textContent).toBe('Include request/response content');
    expect(bodies.getAttribute('aria-checked')).toBe('false');
    trigger().click();
    bodies.click();
    expect(bodies.getAttribute('aria-checked')).toBe('true');
    node('[data-recorder-action=record]').click();
    expect(await choice).toEqual({ privacy: 'interface-visible', networkBodies: true });
  });
});
