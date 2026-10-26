import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from 'xstate';

import { starterPlugin, USER_PLUGIN_HISTORY_FORMAT, type PluginHistory } from '../src/shared/malleable.ts';
import { manager } from '../src/client/malleable/manager.ts';
import { getHistory, mintApproval, savePlugin } from '../src/client/malleable/api.ts';
import { createDraftApproval } from '../src/client/malleable/approval-machine.ts';

type Api = typeof import('../src/client/malleable/api.ts');
type Save = (revision: number, message: string, signal: AbortSignal) => Promise<void>;

vi.mock('../src/client/malleable/api.ts', () => ({
  mintApproval: vi.fn<Api['mintApproval']>(),
  savePlugin: vi.fn<Api['savePlugin']>(),
  getHistory: vi.fn<Api['getHistory']>(),
  listPlugins: vi.fn<Api['listPlugins']>(),
  deletePlugin: vi.fn<Api['deletePlugin']>(),
}));
afterEach(() => vi.resetAllMocks());

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('draft review/save lifecycle', () => {
  it('requires a matching human review and never turns request_keep into approval', async () => {
    const save = vi.fn<Save>(async () => {});
    const actor = createDraftApproval(1, save).start();
    actor.send({ type: 'approve', revision: 1, message: '', human: true });
    expect(save).not.toHaveBeenCalled();
    actor.send({ type: 'requestKeep' });
    actor.send({ type: 'approve', revision: 1, message: '', human: false });
    actor.send({ type: 'approve', revision: 0, message: '', human: true });
    expect(save).not.toHaveBeenCalled();
    actor.send({ type: 'approve', revision: 1, message: 'Reviewed', human: true });
    await waitFor(actor, (snapshot) => snapshot.matches('saved'));
    expect(save).toHaveBeenCalledExactlyOnceWith(1, 'Reviewed', expect.any(AbortSignal));
    actor.stop();
  });

  it('invalidates review on a source change and rejects the old revision', async () => {
    const save = vi.fn<Save>(async () => {});
    const actor = createDraftApproval(1, save).start();
    actor.send({ type: 'requestKeep' });
    actor.send({ type: 'sourceChanged', revision: 2 });
    actor.send({ type: 'approve', revision: 1, message: '', human: true });
    actor.send({ type: 'requestKeep' });
    actor.send({ type: 'approve', revision: 1, message: '', human: true });
    expect(save).not.toHaveBeenCalled();
    expect(actor.getSnapshot().matches('reviewing')).toBe(true);
    actor.stop();
  });

  it('aborts in-flight saves and ignores late success after cancellation, source change, discard or disposal', async () => {
    for (const event of ['cancel', 'sourceChanged', 'discard', 'stop'] as const) {
      const pending = deferred();
      let signal: AbortSignal | undefined;
      const actor = createDraftApproval(1, async (_revision, _message, supplied) => {
        signal = supplied;
        await pending.promise;
      }).start();
      actor.send({ type: 'requestKeep' });
      actor.send({ type: 'approve', revision: 1, message: '', human: true });
      expect(actor.getSnapshot().matches('saving')).toBe(true);
      if (event === 'stop') actor.stop();
      else if (event === 'sourceChanged') actor.send({ type: event, revision: 2 });
      else actor.send({ type: event });
      expect(signal?.aborted).toBe(true);
      pending.resolve();
      await pending.promise;
      await Promise.resolve();
      expect(actor.getSnapshot().matches('saved')).toBe(false);
      actor.stop();
    }
  });

  it('returns failed saves to review with retry information and requires another human click', async () => {
    const failed = deferred();
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(() => failed.promise)
      .mockResolvedValueOnce(undefined);
    const actor = createDraftApproval(3, save).start();
    actor.send({ type: 'requestKeep' });
    actor.send({ type: 'approve', revision: 3, message: '', human: true });
    failed.reject(new Error('Store unavailable'));
    await waitFor(actor, (snapshot) => snapshot.matches('reviewing') && Boolean(snapshot.context.error));
    expect(actor.getSnapshot().context.error).toBe('Store unavailable');
    expect(save).toHaveBeenCalledTimes(1);
    actor.send({ type: 'approve', revision: 3, message: 'retry', human: true });
    await waitFor(actor, (snapshot) => snapshot.matches('saved'));
    expect(save).toHaveBeenCalledTimes(2);
    actor.stop();
  });
});

describe('approval transport binding', () => {
  it('never submits a save when the source changes while human consent is being minted', async () => {
    const draft = starterPlugin('revision-guard');
    const entry = manager.upsert({ ...draft, origin: 'agent' });
    let consent!: (token: string) => void;
    vi.mocked(mintApproval).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          consent = resolve;
        }),
    );
    const saving = manager.saveApproved(entry.id, '', { revision: entry.revision });
    manager.upsert({ ...draft, source: `${draft.source}\n// edited during review`, origin: 'workshop' });
    consent('human-consent');
    await expect(saving).rejects.toThrow('draft changed');
    expect(savePlugin).not.toHaveBeenCalled();
    manager.discard(entry.id);
  });

  it('forwards cancellation into the real approval request and refuses any later save', async () => {
    const entry = manager.upsert({ ...starterPlugin('cancel-guard'), origin: 'agent' });
    const controller = new AbortController();
    vi.mocked(mintApproval).mockImplementationOnce(async (_input, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort(new Error('review cancelled'));
      return 'late-consent';
    });
    await expect(manager.saveApproved(entry.id, '', { revision: entry.revision, signal: controller.signal })).rejects.toThrow(
      'review cancelled',
    );
    expect(savePlugin).not.toHaveBeenCalled();
    manager.discard(entry.id);
  });
});

function savedHistory(id: string, draft: ReturnType<typeof starterPlugin>): PluginHistory {
  return {
    format: USER_PLUGIN_HISTORY_FORMAT,
    id,
    versions: [
      {
        n: 1,
        at: new Date().toISOString(),
        by: 'human',
        message: '',
        manifest: draft.manifest,
        source: draft.source,
        sha256: 'a'.repeat(64),
      },
    ],
  };
}

it('reconciles a committed save after cancellation without replacing a newer working source', async () => {
  const draft = starterPlugin('committed-cancel');
  const entry = manager.upsert({ ...draft, origin: 'agent' });
  const controller = new AbortController();
  vi.mocked(mintApproval).mockResolvedValueOnce('consent');
  vi.mocked(savePlugin).mockImplementationOnce(async () => {
    manager.upsert({ ...draft, source: `${draft.source}\n// newer draft`, origin: 'workshop' });
    controller.abort(new Error('cancelled after commit'));
    return { version: 1 };
  });
  vi.mocked(getHistory).mockResolvedValueOnce(savedHistory(entry.id, draft));
  await expect(manager.saveApproved(entry.id, '', { revision: entry.revision, signal: controller.signal })).rejects.toThrow(
    'cancelled after commit',
  );
  expect(manager.get(entry.id)?.source).toContain('// newer draft');
  expect(manager.get(entry.id)?.versions.at(-1)?.n).toBe(1);
});

it('recovers committed history on retry after a failed history read without saving a duplicate version', async () => {
  const draft = starterPlugin('history-retry');
  const entry = manager.upsert({ ...draft, origin: 'agent' });
  vi.mocked(mintApproval).mockResolvedValueOnce('consent');
  vi.mocked(savePlugin).mockResolvedValueOnce({ version: 1 });
  vi.mocked(getHistory).mockRejectedValueOnce(new Error('history unavailable')).mockResolvedValueOnce(savedHistory(entry.id, draft));
  await expect(manager.saveApproved(entry.id, '', { revision: entry.revision })).rejects.toThrow('history unavailable');
  await expect(manager.saveApproved(entry.id, 'retry', { revision: entry.revision })).resolves.toBeUndefined();
  expect(savePlugin).toHaveBeenCalledTimes(1);
  expect(mintApproval).toHaveBeenCalledTimes(1);
  expect(manager.get(entry.id)?.versions.at(-1)?.n).toBe(1);
});
