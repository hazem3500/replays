import type { element as createElement } from './default-ui-dom.ts';
import { gestureIcon, playGestureOnIntent } from './default-ui-gesture-icon.ts';
import type { icon as createIcon } from './default-ui-icons.ts';
import { OPTIONS_STYLES } from './default-ui-options-styles.ts';
import type { RecorderMessages } from './messages.ts';
import type { FloatingSurface } from './surface-motion.ts';
import type { RecorderPrivacyMode, RecorderUi, RecordingChoice, RecordingChoiceOffer } from './types.ts';

type ChooseContext = Parameters<NonNullable<RecorderUi['chooseOptions']>>[0];
type Group = 'privacy' | 'profile' | 'network' | 'diagnostics';
type Item = { group: Group; value: string; label: string; detail?: string; disabled?: boolean };

/** What the options step borrows from the default UI's floating surface. */
export type OptionsStepDeps = {
  messages: RecorderMessages;
  /** why: passed in, so this lazy chunk shares the default UI's DOM helpers without splitting them out. */
  dom: { element: typeof createElement; icon: typeof createIcon };
  surface: (phase: string, announcement: string) => FloatingSurface;
  hide: () => void;
  onCleanup: (cleanup: () => void) => void;
};

// invariant: set from `deps.dom` at the start of every `chooseOptions`, before anything is built.
let element: typeof createElement;
let icon: typeof createIcon;

const MODES: readonly RecorderPrivacyMode[] = ['visible', 'text-masked', 'interface-visible', 'masked'];
/** Modes a staff menu lists even when the host does not allow them, disabled with a reason. */
const STAFF_MODES: readonly RecorderPrivacyMode[] = ['visible', 'text-masked', 'masked'];
const MENU_ID = 'recorder-options-menu';
const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/** A radio item with its label and, when it has one, a quiet line that describes it to assistive tech too. */
function itemNode(item: Item): HTMLElement {
  const id = `${MENU_ID}-${item.group}-${item.value}`;
  const detail = item.detail ? [element('span', { className: 'options-detail', id: `${id}-detail` }, [item.detail])] : [];
  const node = element('div', { className: 'options-item', tabIndex: -1, id }, [
    icon('check', 'options-check'),
    element('span', { className: 'options-text' }, [element('span', { className: 'options-label' }, [item.label]), ...detail]),
  ]);
  node.setAttribute('role', item.group === 'network' || item.group === 'diagnostics' ? 'menuitemcheckbox' : 'menuitemradio');
  if (item.detail) node.setAttribute('aria-describedby', `${id}-detail`);
  if (item.disabled) node.setAttribute('aria-disabled', 'true');
  node.dataset.group = item.group;
  node.dataset.value = item.value;
  return node;
}

function groupNode(group: Group, name: string, items: HTMLElement[]): HTMLElement {
  const heading = element('div', { className: 'options-heading', id: `${MENU_ID}-${group}` }, [name]);
  heading.setAttribute('role', 'presentation');
  const node = element('div', { className: 'options-group' }, [heading, ...items]);
  node.setAttribute('role', 'group');
  node.setAttribute('aria-labelledby', heading.id);
  return node;
}

/**
 * Each mode with what it records. A customer sees only the allowed modes, in the offer's order; staff see every mode,
 * one the host's privacy does not allow disabled with the reason.
 */
function privacyItems(offer: RecordingChoiceOffer, messages: RecorderMessages) {
  if (!offer.privacy.length) return [];
  const offeredModes = offer.privacy.map((entry) => entry.mode);
  const order = offer.by === 'customer' ? offeredModes : MODES.filter((mode) => STAFF_MODES.includes(mode) || offeredModes.includes(mode));
  return order.map((mode) => {
    const offered = offer.privacy.find((entry) => entry.mode === mode);
    return itemNode({
      group: 'privacy',
      value: mode,
      label: messages.privacyMode({ mode }),
      detail: offered ? messages.privacyHint({ mode, privacy: offered.facts }) : messages.privacyUnavailable,
      disabled: !offered,
    });
  });
}

/** The body option, disabled with the reason when the host's capture reads no body. */
function networkItems(offer: RecordingChoiceOffer, messages: RecorderMessages) {
  if (!offer.networkBodies) return [];
  const { allowed } = offer.networkBodies;
  return [
    itemNode({
      group: 'network',
      value: 'bodies',
      label: messages.networkBodies,
      ...(allowed ? {} : { detail: messages.privacyUnavailable, disabled: true }),
    }),
  ];
}

function menuNode(offer: RecordingChoiceOffer, messages: RecorderMessages) {
  const privacy = privacyItems(offer, messages);
  const network = networkItems(offer, messages);
  const diagnostics = offer.diagnostics
    ? (['performance', 'debugging'] as const).map((key) =>
        itemNode({
          group: 'diagnostics',
          value: key,
          label: key === 'performance' ? messages.performanceLabel : messages.debuggingLabel,
          disabled: !offer.diagnostics?.[key],
        }),
      )
    : [];
  const profiles = offer.profiles.map(({ id, label, description }) =>
    itemNode({ group: 'profile', value: id, label, ...(description ? { detail: description } : {}) }),
  );
  const groups = [
    ...(profiles.length ? [groupNode('profile', messages.profileLabel, profiles)] : []),
    ...(privacy.length ? [groupNode('privacy', messages.privacyLabel, privacy)] : []),
    ...(network.length ? [groupNode('network', messages.networkLabel, network)] : []),
    ...(diagnostics.length ? [groupNode('diagnostics', messages.diagnosticsLabel, diagnostics)] : []),
  ];
  const node = element('div', { className: 'options-menu', id: MENU_ID, hidden: true }, groups);
  node.setAttribute('role', 'menu');
  node.setAttribute('aria-label', messages.optionsTitle);
  return { node, items: [...profiles, ...privacy, ...network, ...diagnostics] };
}

function iconButton(className: string, label: string, name: 'sliders-horizontal' | 'x') {
  const svg = gestureIcon(name);
  const button = element('button', { type: 'button', className: `icon-button ${className}`.trim() }, [svg]);
  button.setAttribute('aria-label', label);
  return { button, stopGesture: playGestureOnIntent(button, svg, name) };
}

function buttons(messages: RecorderMessages) {
  const dot = element('span', { className: 'record-icon' });
  dot.setAttribute('aria-hidden', 'true');
  const record = element('button', { type: 'button', className: 'record-button' }, [dot, messages.record]);
  record.dataset.recorderAction = 'record';
  const options = iconButton('options-button', messages.optionsTitle, 'sliders-horizontal');
  options.button.id = `${MENU_ID}-trigger`;
  options.button.setAttribute('aria-haspopup', 'menu');
  options.button.setAttribute('aria-expanded', 'false');
  options.button.setAttribute('aria-controls', MENU_ID);
  options.button.dataset.recorderAction = 'options';
  const cancel = iconButton('', messages.close, 'x');
  cancel.button.title = messages.close;
  cancel.button.dataset.recorderAction = 'options-cancel';
  const stopGestures = () => {
    options.stopGesture();
    cancel.stopGesture();
  };
  return { record, options: options.button, cancel: cancel.button, stopGestures };
}

type Parts = {
  offer: RecordingChoiceOffer;
  messages: RecorderMessages;
  menu: ReturnType<typeof menuNode>;
  controls: ReturnType<typeof buttons>;
};

function checked(item: HTMLElement, choice: RecordingChoice): boolean {
  if (item.dataset.group === 'diagnostics')
    return item.dataset.value === 'performance' ? choice.performance === true : choice.debugging === true;
  if (item.dataset.group === 'network') return choice.networkBodies === true;
  return item.dataset.value === (item.dataset.group === 'privacy' ? choice.privacy : choice.profile);
}

/** `choice` with `item`'s value, or the body option toggled; a value outside the offer changes nothing. */
function picked(choice: RecordingChoice, item: HTMLElement): RecordingChoice {
  const value = item.dataset.value;
  if (item.dataset.group === 'diagnostics')
    return value === 'performance' ? { ...choice, performance: !choice.performance } : { ...choice, debugging: !choice.debugging };
  if (item.dataset.group === 'network') return { ...choice, networkBodies: choice.networkBodies !== true };
  if (item.dataset.group !== 'privacy') return value ? { ...choice, profile: value } : choice;
  const mode = MODES.find((candidate) => candidate === value);
  return mode ? { ...choice, privacy: mode } : choice;
}

/** The options button's tooltip and dot, and the menu's check marks, for the current choice. */
function render({ offer, messages, menu, controls }: Parts, choice: RecordingChoice) {
  for (const item of menu.items) item.setAttribute('aria-checked', String(checked(item, choice)));
  const mode = offer.privacy.find((entry) => entry.mode === choice.privacy);
  const profile = offer.profiles.find((entry) => entry.id === choice.profile);
  controls.options.setAttribute(
    'title',
    messages.optionsSummary({
      ...(mode ? { privacy: messages.privacyMode({ mode: mode.mode }) } : {}),
      ...(profile ? { profile: profile.label } : {}),
    }),
  );
  controls.options.toggleAttribute(
    'data-changed',
    choice.privacy !== offer.defaults.privacy ||
      choice.profile !== offer.defaults.profile ||
      (choice.networkBodies === true) !== (offer.defaults.networkBodies === true) ||
      (choice.performance === true) !== (offer.defaults.performance === true) ||
      (choice.debugging === true) !== (offer.defaults.debugging === true),
  );
}

/** A menu button with radio items in two groups, keyboard-operable like a Base UI menu. */
function wireMenu({ menu, controls }: Parts, choose: (item: HTMLElement) => void) {
  const enabled = () => menu.items.filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const isOpen = () => !menu.node.hidden;
  const close = (restoreFocus: boolean) => {
    menu.node.toggleAttribute('hidden', true);
    controls.options.setAttribute('aria-expanded', 'false');
    if (restoreFocus) controls.options.focus();
  };
  const open = (focus: 'checked' | 'last') => {
    menu.node.toggleAttribute('hidden', false);
    controls.options.setAttribute('aria-expanded', 'true');
    const items = enabled();
    const target = focus === 'last' ? items.at(-1) : (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0]);
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  };
  controls.options.addEventListener('click', () => (isOpen() ? close(true) : open('checked')));
  controls.options.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp' ? 'last' : 'checked');
  });
  menu.node.addEventListener('click', (event) => {
    const item = enabled().find((candidate) => event.target instanceof Node && candidate.contains(event.target));
    if (item) choose(item);
  });
  menu.node.addEventListener('keydown', (event) => onMenuKey(event, enabled(), { choose, close }));
  return { isOpen, close };
}

function onMenuKey(
  event: KeyboardEvent,
  items: HTMLElement[],
  menu: { choose: (item: HTMLElement) => void; close: (restore: boolean) => void },
) {
  const index = items.findIndex((item) => item === event.target);
  const step = STEPS[event.key];
  if (step) {
    event.preventDefault();
    items[step(index, items.length)]?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const item = items[index];
    if (item) menu.choose(item);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    menu.close(true);
  } else if (event.key === 'Tab') menu.close(true);
}

function addStyles(root: ShadowRoot) {
  if (root.querySelector('style[data-options]')) return;
  const style = element('style', { textContent: OPTIONS_STYLES });
  style.dataset.options = '';
  root.append(style);
}

/**
 * The options step on the floating pill: Record, a quiet options button and close. The options button opens one small
 * menu with the profile and masking choices. Resolves with the choice on Record, or undefined on close, Escape, abort
 * or dismissal.
 */
export function chooseOptions({ offer, signal }: ChooseContext, deps: OptionsStepDeps): Promise<RecordingChoice | undefined> {
  ({ element, icon } = deps.dom);
  return new Promise((resolve) => {
    const settle = (value?: RecordingChoice) => resolve(value);
    if (signal.aborted) {
      settle();
      return;
    }
    const floating = deps.surface('options', deps.messages.optionsTitle);
    floating.shell.setAttribute('aria-label', deps.messages.optionsTitle);
    addStyles(floating.root);
    const parts: Parts = { offer, messages: deps.messages, menu: menuNode(offer, deps.messages), controls: buttons(deps.messages) };
    let choice: RecordingChoice = { ...offer.initial };
    const menu = wireMenu(parts, (item) => {
      choice = picked(choice, item);
      render(parts, choice);
      menu.close(true);
    });
    let done = false;
    const onOutside = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(parts.menu.node) && !path.includes(parts.controls.options)) menu.close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menu.isOpen()) menu.close(true);
      else finish();
    };
    const release = () => {
      document.removeEventListener('pointerdown', onOutside, true);
      floating.shell.removeEventListener('keydown', onKey);
      signal.removeEventListener('abort', onAbort);
      parts.controls.stopGestures();
      parts.menu.node.remove();
    };
    const finish = (value?: RecordingChoice) => {
      if (done) return;
      done = true;
      release();
      deps.hide();
      settle(value);
    };
    const onAbort = () => finish();
    const { record, options, cancel } = parts.controls;
    record.addEventListener('click', () => finish(choice));
    cancel.addEventListener('click', () => finish());
    floating.content.append(record, element('div', { className: 'surface-controls' }, [options, cancel]));
    floating.root.append(parts.menu.node);
    render(parts, choice);
    document.addEventListener('pointerdown', onOutside, true);
    floating.shell.addEventListener('keydown', onKey);
    signal.addEventListener('abort', onAbort, { once: true });
    // why: another surface (indicator, result) or dismiss() may replace the step while it is open.
    deps.onCleanup(() => {
      if (done) return;
      done = true;
      release();
      settle();
    });
    record.focus();
  });
}
