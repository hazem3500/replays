import { http, HttpResponse } from 'msw';

/** The `/api` routes the client calls, matched under any origin and deployment base path. */
const api = (path: string) => `*/api/${path}`;

/** `GET /api/config`. */
export const config = (body: Record<string, unknown>) => http.get(api('config'), () => HttpResponse.json(body));

/** `HEAD /api/replays/:id/preview`, answering each probe with the next response and the last one thereafter. */
export const previewProbe = (...responses: { status: number; headers?: Record<string, string> }[]) => {
  let call = 0;
  return http.head(api('replays/:id/preview'), () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return new HttpResponse(null, next);
  });
};
