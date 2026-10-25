import { fileURLToPath } from 'node:url';
import { defineConfig } from '@hazem3500/replays/config';
import { definePlugin } from '@hazem3500/replays/plugin';

// Local-only evaluation host. Production must explicitly choose its auth/storage plugins.
export default defineConfig({
  name: 'Replays · Agent-Native spike',
  auth: 'none',
  storage: 'fs',
  malleable: { enabled: true },
  plugins: [definePlugin({
    name: 'agent-native-browser',
    requires: '>=0.1.0 <0.2.0',
    setup(api) {
      api.client({ id: 'tools', script: fileURLToPath(new URL('./dist/client.js', import.meta.url)) });
    },
  })],
});
