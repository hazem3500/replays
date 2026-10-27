import { createRoot } from 'react-dom/client';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { createTokenUpload } from '@hazem3500/replays/recorder';
import { RecorderUi } from './RecorderUi.tsx';
import './style.css';
const upload = createTokenUpload({
  endpoint: '/api/recordings',
  getToken: async () => {
    const response = await fetch('/api/recording-token', { method: 'POST' });
    if (!response.ok) throw new Error('Could not get an upload token');
    return ((await response.json()) as { token: string }).token;
  },
});
createRoot(document.getElementById('root')!).render(
  <RecorderProvider options={{ upload }}>
    <main className="p-8">
      <h1>My app</h1>
      <RecorderUi />
    </main>
  </RecorderProvider>,
);
