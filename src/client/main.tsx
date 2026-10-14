import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './tailwind.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

// Synchronous first render, with the module script render-blocking (index.html): a page transition's
// incoming snapshot is the app, not an empty #root, so the top bar can stay put across pages.
const app = createRoot(root);
flushSync(() =>
  app.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
