import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { MASK_INPUT_OPTIONS, maskCapturedInputs } from '../src/capture/mask-inputs.ts';

const hiddenInput = (id: number, value: string) => ({
  type: 2,
  id,
  tagName: 'input',
  attributes: { type: 'hidden', name: 'csrf_token', value },
  childNodes: [],
});

describe('hidden inputs', () => {
  it('masks hidden input values in snapshots, added nodes, attribute changes and input events', () => {
    const events = maskCapturedInputs([
      { type: 2, data: { node: { type: 0, id: 1, childNodes: [hiddenInput(2, 'snapshot-csrf')] } } },
      { type: 3, data: { source: 0, adds: [{ parentId: 1, node: hiddenInput(3, 'added-csrf') }], removes: [], texts: [], attributes: [] } },
      { type: 3, data: { source: 0, adds: [], removes: [], texts: [], attributes: [{ id: 2, attributes: { value: 'rotated-csrf' } }] } },
      { type: 3, data: { source: 5, id: 3, text: 'input-csrf' } },
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of ['snapshot-csrf', 'added-csrf', 'rotated-csrf', 'input-csrf']) expect(serialized).not.toContain(secret);
    expect(maskCapturedInputs(structuredClone(events))).toEqual(events);
  });

  it('records hidden inputs masked in the capture recorder too', async () => {
    expect(MASK_INPUT_OPTIONS).toMatchObject({ hidden: true, password: true, text: true, textarea: true, select: true });
    const source = await readFile(new URL('../src/capture/injected-recorder.ts', import.meta.url), 'utf8');
    expect(source).toContain('maskInputOptions: MASK_INPUT_OPTIONS');
    expect(source).not.toContain('maskAllInputs: true');
  });
});

const textInput = (id: number, value: string) => ({ type: 2, id, tagName: 'input', attributes: { type: 'text', value }, childNodes: [] });
const snapshot = (...childNodes: unknown[]) => ({ type: 2, data: { node: { type: 0, id: 1, childNodes } } });
const attributeChange = (id: number, attributes: Record<string, unknown>) => ({
  type: 3,
  data: { source: 0, adds: [], removes: [], texts: [], attributes: [{ id, attributes }] },
});

describe('visible inputs kept', () => {
  it('masks a visible field from the moment it becomes a password field', () => {
    const events = maskCapturedInputs(
      [
        snapshot(textInput(2, 'shown-before')),
        attributeChange(2, { type: 'password', value: 'turned-secret' }),
        { type: 3, data: { source: 5, id: 2, text: 'typed-secret' } },
      ],
      { keepVisible: true },
    );
    const serialized = JSON.stringify(events);
    expect(serialized).toContain('shown-before');
    for (const secret of ['turned-secret', 'typed-secret']) expect(serialized).not.toContain(secret);
  });

  it('masks typing into a field the recording never showed', () => {
    const events = maskCapturedInputs([snapshot(textInput(2, 'shown')), { type: 3, data: { source: 5, id: 9, text: 'unseen-secret' } }], {
      keepVisible: true,
    });
    expect(JSON.stringify(events)).not.toContain('unseen-secret');
  });

  it('masks typing into a field once it has been removed from the page', () => {
    const removal = { type: 3, data: { source: 0, adds: [], removes: [{ parentId: 1, id: 2 }], texts: [], attributes: [] } };
    const events = maskCapturedInputs(
      [snapshot(textInput(2, 'shown')), removal, { type: 3, data: { source: 5, id: 2, text: 'gone-secret' } }],
      { keepVisible: true },
    );
    expect(JSON.stringify(events)).not.toContain('gone-secret');
  });
});
