import type { ResolvedCapture } from './capture-options.ts';
import { BLOCK_ATTRIBUTE, UI_ATTRIBUTE } from './privacy.ts';
import { maskText } from './redact.ts';
import type { PrivacyFacts, RecorderPrivacyOptions } from './types.ts';

const MEDIA_SELECTOR = 'img, picture, video, audio, canvas, iframe, object, embed';

/** Rrweb's `maskAllInputs` set plus hidden inputs (CSRF tokens). Same set as Replays' `MASK_INPUT_OPTIONS`. */
export const MASK_INPUT_OPTIONS = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  hidden: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
} as const;

/** why: rrweb swallows the error `matches()` throws, so an invalid privacy selector would silently block or mask nothing. */
function assertSelector(option: string, selector: string | undefined): void {
  if (!selector) return;
  try {
    document.createDocumentFragment().querySelector(selector);
  } catch {
    throw new Error(`privacy.${option} is not a valid CSS selector: ${selector}`);
  }
}

/** One recorder's privacy settings, resolved: what rrweb blocks and masks, and how the consent prompt describes it. */
export interface RecorderPrivacy {
  sanitize: boolean;
  maskAllText: boolean;
  /** Whether rrweb masks `element`'s text; an unknown element is masked. */
  textMasked: (element: Element | undefined) => boolean;
  /** Checks the selectors once a DOM exists; a no-op afterwards. */
  checkSelectors: () => void;
  /** The masking and blocking part of rrweb's `record()` options. */
  rrwebOptions: () => Record<string, unknown>;
  /** What the consent prompt tells the user is captured. */
  facts: (maxDurationMs: number, reviewRequired: boolean) => PrivacyFacts;
}

function textMasker(privacy: RecorderPrivacyOptions, maskAllText: boolean): (element: Element | undefined) => boolean {
  const unmask = privacy.unmaskTextSelector;
  const maskSelector = privacy.maskTextSelector;
  return (element) => {
    if (maskAllText) return !unmask || !element || element.closest(unmask) === null;
    if (!maskSelector) return false;
    return !element || element.closest(maskSelector) !== null;
  };
}

function selectorChecker(privacy: RecorderPrivacyOptions): () => void {
  let checked = false;
  return () => {
    // why: without a DOM (server rendering) the check runs on the first start().
    if (checked || typeof document === 'undefined') return;
    assertSelector('blockSelector', privacy.blockSelector);
    assertSelector('maskTextSelector', privacy.maskTextSelector);
    assertSelector('unmaskTextSelector', privacy.unmaskTextSelector);
    checked = true;
  };
}

function rrwebMasking(privacy: RecorderPrivacyOptions, capture: ResolvedCapture): Record<string, unknown> {
  const sanitize = privacy.sanitize !== false;
  const unmask = privacy.unmaskTextSelector;
  const blockSelector = [
    `[${UI_ATTRIBUTE}]`,
    `[${BLOCK_ATTRIBUTE}]`,
    ...(capture.blockMedia ? [MEDIA_SELECTOR] : []),
    ...(privacy.blockSelector ? [privacy.blockSelector] : []),
  ].join(', ');
  const maskTextSelector = capture.maskAllText ? '*' : privacy.maskTextSelector;
  return {
    maskAllInputs: sanitize,
    maskInputOptions: sanitize ? MASK_INPUT_OPTIONS : { password: true, hidden: true },
    // why: every character, spaces included, the same as Replays' server pass.
    maskInputFn: (text: string) => '*'.repeat(text.length),
    ...(maskTextSelector ? { maskTextSelector } : {}),
    maskTextFn: (text: string, element: HTMLElement | null) => (unmask && element?.closest(unmask) ? text : maskText(text)),
    blockSelector,
  };
}

/** Resolves `privacy` with the capture settings; the selectors are checked now when a DOM exists. */
export function recorderPrivacy(privacy: RecorderPrivacyOptions, capture: ResolvedCapture): RecorderPrivacy {
  const sanitize = privacy.sanitize !== false;
  const maskAllText = capture.maskAllText;
  const checkSelectors = selectorChecker(privacy);
  checkSelectors();
  return {
    sanitize,
    maskAllText,
    textMasked: textMasker(privacy, maskAllText),
    checkSelectors,
    rrwebOptions: () => rrwebMasking(privacy, capture),
    facts: (maxDurationMs, reviewRequired) => ({
      mode: sanitize && maskAllText ? 'masked' : 'visible',
      maxDurationMs,
      reviewRequired,
      captures: {
        pageText: !maskAllText || Boolean(privacy.unmaskTextSelector),
        inputs: !sanitize,
        media: !capture.blockMedia,
        console: capture.consoleLevels.length > 0,
        network: capture.network !== 'off',
        networkBodies: capture.network === 'bodies',
      },
    }),
  };
}
