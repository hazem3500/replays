import { assign, createActor, fromPromise, setup } from 'xstate';

interface ApprovalContext {
  revision: number;
  message: string;
  error: string | undefined;
}
type ApprovalEvent =
  | { type: 'requestKeep' }
  | { type: 'sourceChanged'; revision: number }
  | { type: 'approve'; revision: number; message: string; human: boolean }
  | { type: 'cancel' }
  | { type: 'discard' };
type SaveDraft = (revision: number, message: string, signal: AbortSignal) => Promise<void>;

/** Orchestration only: server consent and sandbox policy remain authoritative. No bridge exposes approve. */
export function createDraftApproval(revision: number, save: SaveDraft) {
  const machine = setup({
    types: { context: {} as ApprovalContext, events: {} as ApprovalEvent },
    actors: {
      save: fromPromise<void, { revision: number; message: string }>(async ({ input, signal }) => {
        await save(input.revision, input.message, signal);
      }),
    },
    guards: {
      humanReviewMatches: ({ context, event }) => event.type === 'approve' && event.human && event.revision === context.revision,
    },
    actions: {
      changed: assign(({ event }) => (event.type === 'sourceChanged' ? { revision: event.revision, error: undefined, message: '' } : {})),
      rememberMessage: assign(({ event }) => (event.type === 'approve' ? { message: event.message, error: undefined } : {})),
      clearError: assign({ error: undefined }),
    },
  }).createMachine({
    context: { revision, message: '', error: undefined },
    initial: 'draft',
    on: {
      sourceChanged: { target: '.draft', actions: 'changed' },
      discard: { target: '.discarded' },
    },
    states: {
      draft: { on: { requestKeep: { target: 'reviewing', actions: 'clearError' } } },
      reviewing: {
        on: {
          approve: { guard: 'humanReviewMatches', target: 'saving', actions: 'rememberMessage' },
          cancel: { target: 'draft', actions: 'clearError' },
        },
      },
      saving: {
        invoke: {
          src: 'save',
          input: ({ context }) => ({ revision: context.revision, message: context.message }),
          onDone: { target: 'saved' },
          onError: {
            target: 'reviewing',
            actions: assign({ error: ({ event }) => (event.error instanceof Error ? event.error.message : String(event.error)) }),
          },
        },
        on: { cancel: { target: 'draft', actions: 'clearError' } },
      },
      saved: {},
      discarded: { type: 'final' },
    },
  });
  return createActor(machine);
}
