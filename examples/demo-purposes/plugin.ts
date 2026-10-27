import { definePlugin, type PurposeInferInput } from '../../src/plugin/index.ts';

const mentionsDesignReview = (input: PurposeInferInput) => /\b(review|design)\b/i.test(`${input.title} ${(input.tags ?? []).join(' ')}`);

export const inferTriage = (input: PurposeInferInput) => input.errors > 0;

export const inferDesignReview = (input: PurposeInferInput) => Boolean(input.suiteRun) || mentionsDesignReview(input);

export const inferWalkthrough = (input: PurposeInferInput) => input.errors === 0 && input.steps > 0;

export default definePlugin({
  name: 'demo-purposes',
  setup(api) {
    api.purpose({ id: 'triage', label: 'Triage', infer: inferTriage });
    api.purpose({ id: 'design-review', label: 'Design reviews', infer: inferDesignReview });
    api.purpose({ id: 'walkthrough', label: 'Walkthroughs', infer: inferWalkthrough });
  },
});
