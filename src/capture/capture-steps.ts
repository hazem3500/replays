import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { RawStep, WaitState } from './drivers/types.ts';

type Fields = Record<string, unknown>;
type Labelled = { label?: string };

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const WAIT_STATES: readonly WaitState[] = ['visible', 'attached', 'hidden'];
/** The longest a selector wait may last: past this a page is stuck, not slow. */
export const MAX_WAIT_TIMEOUT_MS = 300_000;
const SHOT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDirection = (value: unknown): value is (typeof DIRECTIONS)[number] => DIRECTIONS.some((direction) => direction === value);
const isNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** invariant: a capture only opens https pages, or http on this machine. */
export function assertCaptureUrl(value: string, flag: string): void {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error(`${flag} must use https (http only for localhost)`);
}

function requiredString(step: Fields, field: string, index: number): string {
  const value = step[field];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--steps[${index}].${field} must be a non-empty string`);
  return value;
}

function waitStep(step: Fields, index: number, labelled: Labelled): RawStep {
  const { selector, ms, state, timeout } = step;
  if (selector === undefined) {
    if (state !== undefined || timeout !== undefined) throw new Error(`--steps[${index}] state and timeout need a selector`);
    if (!isNonNegative(ms)) throw new Error(`--steps[${index}].ms must be a non-negative number`);
    return { kind: 'wait', ms, ...labelled };
  }
  if (ms !== undefined) throw new Error(`--steps[${index}] waits for a selector or ms, not both`);
  const waitState = WAIT_STATES.find((candidate) => candidate === state);
  if (state !== undefined && !waitState) throw new Error(`--steps[${index}].state must be ${WAIT_STATES.join(', ')}`);
  if (timeout !== undefined && !(isNonNegative(timeout) && timeout > 0 && timeout <= MAX_WAIT_TIMEOUT_MS))
    throw new Error(`--steps[${index}].timeout must be a number of milliseconds between 1 and ${MAX_WAIT_TIMEOUT_MS}`);
  return {
    kind: 'wait',
    selector: requiredString(step, 'selector', index),
    ...(waitState ? { state: waitState } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
    ...labelled,
  };
}

function scrollStep(step: Fields, index: number, labelled: Labelled): RawStep {
  const { direction, pixels } = step;
  if (step.selector !== undefined) {
    if (direction !== undefined || pixels !== undefined)
      throw new Error(`--steps[${index}] scrolls to a selector or by direction, not both`);
    return { kind: 'scroll', selector: requiredString(step, 'selector', index), ...labelled };
  }
  if (!isDirection(direction)) throw new Error(`--steps[${index}].direction must be up, down, left, or right`);
  if (pixels !== undefined && !isNonNegative(pixels)) throw new Error(`--steps[${index}].pixels must be a non-negative number`);
  return { kind: 'scroll', direction, ...(pixels === undefined ? {} : { pixels }), ...labelled };
}

function typedStep(kind: 'type' | 'fill', step: Fields, index: number, labelled: Labelled): RawStep {
  if (typeof step.text !== 'string') throw new Error(`--steps[${index}].text must be a string`);
  return { kind, selector: requiredString(step, 'selector', index), text: step.text, ...labelled };
}

function shotStep(step: Fields, index: number, labelled: Labelled, names: Set<string>): RawStep {
  const name = requiredString(step, 'name', index);
  if (!SHOT_NAME.test(name)) throw new Error(`--steps[${index}].name must be lowercase letters, digits and hyphens (at most 64)`);
  if (names.has(name)) throw new Error(`--steps[${index}].name repeats an earlier shot: ${name}`);
  names.add(name);
  return { kind: 'shot', name, ...labelled };
}

function stepOf(kind: string, step: Fields, index: number, labelled: Labelled, shots: Set<string>): RawStep {
  switch (kind) {
    case 'click':
    case 'hover':
      return { kind, selector: requiredString(step, 'selector', index), ...labelled };
    case 'type':
    case 'fill':
      return typedStep(kind, step, index, labelled);
    case 'press':
      return { kind, key: requiredString(step, 'key', index), ...labelled };
    case 'wait':
      return waitStep(step, index, labelled);
    case 'scroll':
      return scrollStep(step, index, labelled);
    case 'shot':
      return shotStep(step, index, labelled, shots);
    case 'goto': {
      const url = requiredString(step, 'url', index);
      assertCaptureUrl(url, `--steps[${index}].url`);
      return { kind, url, ...labelled };
    }
    default:
      throw new Error(`--steps[${index}].kind is unsupported: ${kind}`);
  }
}

/** The closed list of steps a capture runs (`--steps`), each checked for its kind's fields. */
export function validateSteps(value: unknown): RawStep[] {
  if (!Array.isArray(value)) throw new Error('--steps must be a JSON array');
  const raw: unknown[] = value;
  const shots = new Set<string>();
  return raw.map((step, index) => {
    if (!isFields(step)) throw new Error(`--steps[${index}] must be an object`);
    const kind = requiredString(step, 'kind', index);
    if (step.label !== undefined && (typeof step.label !== 'string' || step.label.length === 0))
      throw new Error(`--steps[${index}].label must be a non-empty string`);
    return stepOf(kind, step, index, typeof step.label === 'string' ? { label: step.label } : {}, shots);
  });
}

/** `--steps`: inline JSON, or `@file`. */
export async function readSteps(raw?: string): Promise<RawStep[]> {
  if (!raw) return [];
  const source = raw.startsWith('@') ? await readFile(resolve(raw.slice(1)), 'utf8') : raw;
  const steps: unknown = JSON.parse(source);
  return validateSteps(steps);
}
