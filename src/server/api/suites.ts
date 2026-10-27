import { sanitizeUrlFields } from '../../capture/sanitize.ts';
import { assertReplayContext } from '../../shared/context.ts';
import {
  assertReviewRunRegistration,
  assertReviewSuite,
  assertReviewSuiteRegistration,
  type ResolvedSuiteRegistration,
  suitePersonMatch,
} from '../../shared/review-suite.ts';
import { parseJsonBody, readBytes } from '../http/body.ts';
import { compressed, json } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { checkPeople, decorateSuite, forMeQuery } from '../people.ts';
import { applyContextAdapters } from '../plugin-runtime.ts';
import type { ApiServices } from './services.ts';
import { resolveContext } from './upload-checks.ts';

const SUITE_ID = /[a-z0-9][a-z0-9-]{0,79}/;
const RUN_ID = /[a-zA-Z0-9][a-zA-Z0-9-]{0,79}/;

/** Review suites: the list, one suite, and registering a suite or one of its runs (`PUT`, idempotent). */
export function suiteRoutes(services: ApiServices) {
  const { deployment, registry, redaction } = services;
  const store = deployment.store;
  const roles = registry.people?.value.roles;
  return [
    defineRoute({
      method: 'GET',
      path: '/api/suites',
      async handler({ request, url, identity: user }) {
        const me = forMeQuery(registry, url.searchParams, user);
        const expand = url.searchParams.get('expand') === 'runs';
        let body: unknown[];
        if (me) {
          const entries = await store.listSuiteIndex(Number(url.searchParams.get('limit') ?? (expand ? 100 : 20)));
          body = entries.flatMap((entry) => {
            const reason = suitePersonMatch(entry, me, roles);
            if (!reason) return [];
            const { runDetails, ...summary } = decorateSuite(registry, entry);
            return [{ ...summary, ...(expand ? { runDetails } : {}), reason }];
          });
        } else {
          const entries = expand
            ? await store.listSuiteIndex(Number(url.searchParams.get('limit') ?? 100))
            : await store.listSuiteSummaries(Number(url.searchParams.get('limit') ?? 20));
          body = entries.map((entry) => decorateSuite(registry, entry));
        }
        return compressed(request, 200, JSON.stringify(body));
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/api/suites/:suite',
      params: { suite: SUITE_ID },
      async handler({ request, url, params }) {
        const suite = await store.loadSuite(params.suite);
        const body =
          suite && url.searchParams.get('expand') === 'runs'
            ? { ...suite, runDetails: decorateSuite(registry, await store.suiteIndexEntry(suite)).runDetails }
            : suite;
        // why: suites change while runs register, so they revalidate (ETag) instead of caching.
        return compressed(request, suite ? 200 : 404, JSON.stringify(body ?? { error: 'suite not found' }));
      },
    }),
    defineRoute({
      method: 'PUT',
      path: '/api/suites/:suite',
      params: { suite: SUITE_ID },
      async handler({ request, params, identity, legacy }) {
        // invariant: the same privacy pass as replay uploads, and idempotent, so a re-registration compares equal.
        const input: unknown = sanitizeUrlFields(parseJsonBody((await readBytes(request, 64 * 1024)).toString('utf8')), redaction);
        assertReviewSuiteRegistration(input, params.suite);
        const adapted = await applyContextAdapters(registry, input.context, { kind: 'suite', identity, request: legacy.request });
        if (adapted) input.context = adapted;
        const { subject, ...rest } = input;
        const registration: ResolvedSuiteRegistration = {
          ...rest,
          ...(subject ? { subject: deployment.sources.resolve(subject, 'suite.subject') } : {}),
        };
        if (registration.context) resolveContext({ context: registration.context }, deployment);
        // why: the resolved registration (a link, not a reference) is what is stored, so it is checked again.
        assertReviewSuite({ ...registration, runs: [] });
        checkPeople(registry, registration.people, 'suite.people');
        return json(200, await store.registerSuite(params.suite, registration));
      },
    }),
    defineRoute({
      method: 'PUT',
      path: '/api/suites/:suite/runs/:run',
      params: { suite: SUITE_ID, run: RUN_ID },
      async handler({ request, params, identity, legacy }) {
        const input: unknown = sanitizeUrlFields(parseJsonBody((await readBytes(request, 64 * 1024)).toString('utf8')), redaction);
        assertReviewRunRegistration(input, params.run);
        const adapted = await applyContextAdapters(registry, input.context, { kind: 'run', identity, request: legacy.request });
        if (adapted) input.context = adapted;
        if (input.context) {
          resolveContext({ context: input.context }, deployment);
          if (adapted) assertReplayContext(input.context);
        }
        return json(200, await store.registerRun(params.suite, params.run, input));
      },
    }),
  ];
}
