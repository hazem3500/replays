// @vitest-environment happy-dom
import { act } from 'react';
import { describe, it } from 'vitest';
import { testRecorderUi } from '@hazem3500/replays/recorder/testing';
import { referenceFactory } from './ui-fixture.tsx';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
testRecorderUi(
  'shadcn recorder UI',
  referenceFactory,
  { describe, it },
  {
    render: async (flush) => {
      await act(flush);
    },
  },
);
