import { defineConfig } from '@hazem3500/replays/config';

import acme from './src/plugin.ts';

export default defineConfig({
  plugins: [acme({ audience: 'acme-replays', domain: 'acme.test' })],
  retentionDays: 30,
});
