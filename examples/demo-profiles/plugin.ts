import { definePlugin, type ProfileInferInput } from '../../src/plugin/index.ts';

const mentionsDesignReview = (input: ProfileInferInput) => /\b(review|design)\b/i.test(`${input.title} ${(input.tags ?? []).join(' ')}`);

export const inferTriage = (input: ProfileInferInput) => input.errors > 0;

export const inferDesignReview = (input: ProfileInferInput) => Boolean(input.suiteRun) || mentionsDesignReview(input);

export const inferWalkthrough = (input: ProfileInferInput) => input.errors === 0 && input.steps > 0;

export default definePlugin({
  name: 'demo-profiles',
  setup(api) {
    api.profile({ id: 'triage', label: 'Triage', infer: inferTriage });
    api.profile({ id: 'design-review', label: 'Design reviews', infer: inferDesignReview });
    api.profile({ id: 'walkthrough', label: 'Walkthroughs', infer: inferWalkthrough });
  },
});
