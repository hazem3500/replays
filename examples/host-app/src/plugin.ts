import { fileURLToPath } from 'node:url';

import { definePlugin } from '@hazem3500/replays/plugin';

const mark = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#853764" d="M3 3h18v13H9l-6 5z"/></svg>',
).toString('base64')}`;

/** A trusted deploy-time plugin; removal leaves its context and summary fields as ordinary data. */
export default definePlugin((options: { staffDomain: string; staffUploadOrigins: string[] }) => ({
  name: 'company-host',
  requires: '>=0.1.0 <0.2.0',
  setup(api) {
    if (options.staffUploadOrigins.length) {
      api.requestPolicy({
        path: '/api/replays',
        methods: ['POST'],
        origins: options.staffUploadOrigins,
        headers: ['content-type', 'content-encoding'],
        credentials: true,
      });
    }
    api.identity({
      resolve(identity) {
        // Enrich only from the authenticated identity; no caller-supplied directory/identity headers.
        if (!identity.email || identity.name) return;
        const name = identity.email.split('@')[0]!.replace(/[._-]+/g, ' ');
        return { ...identity, name };
      },
    });
    api.people({
      roles: ['pr-author', 'reviewer', 'requester', 'assignee', 'uploader', 'mentioned'],
      handles: [{ id: 'staff', label: 'Staff handle', pattern: '[a-z0-9-]{1,39}' }],
      validate(person) {
        // Customer participants can be external; the roles granting staff responsibility must name a staff email.
        if (['pr-author', 'reviewer', 'assignee', 'uploader'].includes(person.role)) {
          if (!person.email?.toLowerCase().endsWith(`@${options.staffDomain}`)) return 'staff roles need a staff email';
        }
      },
      avatarUrl: (person) => person.handles?.staff && `https://people.example.com/avatar/${encodeURIComponent(person.handles.staff)}.png`,
      profileUrl: (person) => person.handles?.staff && `https://people.example.com/people/${encodeURIComponent(person.handles.staff)}`,
    });
    api.contextAdapter({
      name: 'company-context',
      schema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            enum: ['local', 'staging', 'production'],
            title: 'Environment',
            'x-replays-group': 'Product',
            'x-replays-order': 0,
          },
          uploadedBy: { type: 'string', title: 'Uploaded by', 'x-replays-group': 'Provenance' },
          customerSession: { type: 'boolean', title: 'Customer session', 'x-replays-group': 'Product' },
          flags: {
            type: 'array',
            title: 'Feature flags',
            'x-replays-group': 'Product',
            'x-replays-widget': 'signals',
            items: {
              type: 'object',
              required: ['key', 'state'],
              properties: {
                key: { type: 'string' },
                state: { enum: ['enabled', 'disabled', 'unknown'] },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      normalize(context, { identity }) {
        return {
          ...context,
          version: 1,
          capturedAt: context?.capturedAt ?? new Date().toISOString(),
          fields: { ...context?.fields, uploadedBy: identity.email ?? identity.id },
        };
      },
    });
    api.sourceProvider({
      id: 'company-support',
      label: 'Example support',
      icon: mark,
      noun: 'ticket',
      resolve: (ref) => (/^SUP-\d{1,9}$/.test(ref) ? { url: `https://support.example.com/tickets/${ref}`, label: ref } : undefined),
    });
    api.redaction({
      headers: [/^x-company-session$/i],
      queryParams: ['invite_token'],
      jsonKeys: ['customer_secret'],
      maskSelectors: ['[data-customer-private]'],
    });
    api.summaryFields({
      name: 'handoff',
      fields: (bundle) => ({
        environment: String(bundle.context?.fields?.environment ?? 'unknown'),
        customerSession: bundle.context?.fields?.customerSession === true,
      }),
    });
    api.indexFilter({
      id: 'customer-sessions',
      param: 'x-customer-session',
      match: (summary, value) => value === '1' && summary.ext?.['company-host']?.customerSession === true,
    });
    api.client({
      id: 'main',
      script: fileURLToPath(new URL('../dist/client.js', import.meta.url)),
      style: fileURLToPath(new URL('../dist/style.css', import.meta.url)),
    });
  },
}));
