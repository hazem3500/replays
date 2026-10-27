import { createRoot } from 'react-dom/client';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { createTokenUpload } from '@hazem3500/replays/recorder';
import { RecorderUi } from './RecorderUi.tsx';
const upload = createTokenUpload({
  endpoint: '/api/recordings',
  getToken: async () => {
    const response = await fetch('/api/recording-token', { method: 'POST' });
    if (!response.ok) throw new Error('Could not get an upload token');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string')
      throw new Error('Token response is invalid');
    return body.token;
  },
});
const root = document.getElementById('root');
if (!root) throw new Error('Example root is missing');
createRoot(root).render(
  <RecorderProvider options={{ upload }}>
    <main className="p-8">
      <h1>My app</h1>
      <RecorderUi />
    </main>
  </RecorderProvider>,
);
