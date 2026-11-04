import type { CapturedChoice } from '../shared/capture-profile.ts';
import type { ReplayBundle, ReplayCaptured } from '../shared/replay.ts';

export interface SanitizeReplayOptions {
  /**
   * Keep ordinary input values when the bundle declares `meta.captured.inputs: 'visible'`. Password and hidden inputs
   * stay masked. The server sets it only for a host that opted in and a signed-in staff upload; off by default. A bundle
   * that carries a customer's choice (`meta.captured.choice`) ignores it and follows `keepCustomerChoices`.
   */
  keepVisibleInputs?: boolean;
  /**
   * Keep what a customer chose in the recorder's options step (`meta.captured.choice`): ordinary input values and
   * network bodies, only when the claim matches what the bundle declares it captured (`inputs`, `network`). The server
   * sets it only for an upload to a host with `privacy.keepCustomerChoices`; off by default. Without it a customer's
   * bundle keeps no input value and no body.
   */
  keepCustomerChoices?: boolean;
}

/** What the privacy pass keeps beyond its defaults, decided once per bundle from its claims and the options. */
export interface Kept {
  inputs: boolean;
  bodies: boolean;
  /** The customer's claim, when the bundle carries one; rewritten to what is kept. */
  choice?: CapturedChoice;
}

/**
 * A bundle with a customer's choice follows `keepCustomerChoices` and its claim; any other bundle follows
 * `keepVisibleInputs` and keeps its redacted bodies, as before customer choices existed.
 */
export function keptFields(captured: ReplayCaptured | undefined, options: SanitizeReplayOptions): Kept {
  const choice = captured?.choice;
  if (captured === undefined || choice === undefined)
    return { inputs: options.keepVisibleInputs === true && captured?.inputs === 'visible', bodies: true };
  /* invariant: a claim that differs from what the bundle declares it captured, in either direction, or typed values
     under a mode that never shows them, keeps nothing. */
  const matches =
    (choice.inputs === 'visible') === (captured.inputs === 'visible') &&
    choice.bodies === (captured.network === 'bodies') &&
    (choice.inputs !== 'visible' || choice.mode === 'visible');
  const honoured = options.keepCustomerChoices === true && matches;
  return { inputs: honoured && choice.inputs === 'visible', bodies: honoured && choice.bodies, choice };
}

/** `meta.captured` without a `visible` inputs claim, once every input has been masked. */
export function inputsMasked(meta: ReplayBundle['meta']): ReplayBundle['meta'] {
  if (meta.captured?.inputs !== 'visible') return meta;
  const captured = { ...meta.captured };
  delete captured.inputs;
  return { ...meta, captured };
}

/** `meta.captured` saying what the stored bundle keeps of a customer's choice: no bodies, or masked inputs, when not kept. */
export function choiceKept(meta: ReplayBundle['meta'], kept: Kept): ReplayBundle['meta'] {
  const { captured } = meta;
  if (!captured || !kept.choice) return meta;
  const choice: CapturedChoice = {
    by: 'customer',
    mode: kept.choice.mode,
    inputs: kept.inputs ? 'visible' : 'masked',
    text: kept.choice.text === 'visible' ? 'visible' : 'masked',
    bodies: kept.bodies,
  };
  return {
    ...meta,
    captured: { ...captured, network: !kept.bodies && captured.network === 'bodies' ? 'headers' : captured.network, choice },
  };
}
