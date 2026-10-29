import { getRequest } from '@tanstack/react-start/server';

import { PAGE_HEADER, pageContexts } from '../../shared/page-context.ts';

/** The page context our server registered for the request being rendered (src/server/pages/start.ts). */
export function serverPageContext() {
  const context = pageContexts.get(getRequest().headers.get(PAGE_HEADER));
  if (!context) throw new Error('A Start page rendered outside the Replays server (no page context for this request)');
  return context;
}
