// oxlint-disable-next-line import/no-default-export -- why: the config loader imports a plugin module's default export.
export default {
  name: 'e2e-customer-ingest',
  apiVersion: 1,
  setup(api) {
    api.uploadEndpoint({
      path: '/api/ingest/v1/recordings',
      authenticate: (request) => (request.headers['x-app-key'] === 'e2e-key' ? { id: 'app:acme' } : undefined),
    });
  },
};
