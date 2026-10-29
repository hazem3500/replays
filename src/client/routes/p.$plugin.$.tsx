import { createFileRoute } from '@tanstack/react-router';

import { PluginPage } from '../pages/PluginPage.tsx';

/** A plugin's page (`/p/<plugin>/<path>`), registered with `api.registerPluginPage`; it owns its query string. */
export const Route = createFileRoute('/p/$plugin/$')({
  component: function Plugin() {
    const { plugin, _splat } = Route.useParams();
    const search = Object.fromEntries(Object.entries(Route.useSearch()).filter((entry) => typeof entry[1] === 'string'));
    return <PluginPage key={plugin} plugin={plugin} path={_splat ?? ''} search={search} />;
  },
});
