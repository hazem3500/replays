import { createServerEntry, createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';

import { serverPageContext } from './server-context.ts';

/**
 * The Start server entry our node:http server calls for page requests. One build serves every base: asset URLs get
 * the request's base at render time.
 */
const fetch = createStartHandler({
  handler: defaultStreamHandler,
  transformAssets: {
    transform: ({ url }) => ({ href: `${serverPageContext().deployment.base}${url.replace(/^\/?\.\//, '/')}` }),
    cache: false,
  },
});

// oxlint-disable-next-line import/no-default-export -- why: Start loads its server entry's default export.
export default createServerEntry({ fetch });
