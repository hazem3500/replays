import type { RecorderPrivacyMode } from '../recorder/types.ts';

/** The recorder's privacy modes, loosest first; `inputs-masked` is what a capture records without `--privacy`. */
export const CAPTURE_PRIVACY_MODES: readonly RecorderPrivacyMode[] = [
  'visible',
  'inputs-masked',
  'text-masked',
  'interface-visible',
  'masked',
];

/** What a mode lets the capture show, so `--privacy` can be checked against a profile that already hides text. */
const SHOWS_TEXT: Readonly<Record<RecorderPrivacyMode, boolean>> = {
  visible: true,
  'inputs-masked': true,
  'text-masked': false,
  'interface-visible': true,
  masked: false,
};

/** `--privacy <mode>`, checked. Undefined keeps the default (`inputs-masked`). */
export function privacyFlag(value?: string): RecorderPrivacyMode | undefined {
  if (value === undefined) return undefined;
  const mode = CAPTURE_PRIVACY_MODES.find((option) => option === value);
  if (!mode) throw new Error(`--privacy must be one of ${CAPTURE_PRIVACY_MODES.join(', ')}`);
  return mode;
}

/**
 * invariant: a flag never loosens a profile. A profile that masks all text refuses a mode that shows page text, even
 * the public-marker text of `interface-visible`.
 */
export function assertPrivacyFitsProfile(mode: RecorderPrivacyMode | undefined, maskAllText: boolean): void {
  if (mode !== undefined && maskAllText && SHOWS_TEXT[mode])
    throw new Error(`--privacy ${mode} shows page text, but this profile masks all text (privacy.maskAllText); use text-masked or masked`);
}

/** Whether a capture in this mode records ordinary typed values (`meta.captured.inputs: 'visible'`); only `visible` does. */
export const inputsVisible = (mode: RecorderPrivacyMode | undefined): boolean => mode === 'visible';
