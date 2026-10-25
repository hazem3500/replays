// Host plugin for the people e2e spec (listed in a JSON config): roles in priority order, a linkable GitHub handle,
// avatars and profile links from that handle, and an identity resolver that names the signed-in person.
export default {
  name: 'e2e-people',
  apiVersion: 1,
  setup(api) {
    api.people({
      roles: ['pr-author', 'reviewer', 'requester', 'mentioned'],
      handles: [{ id: 'github', label: 'GitHub username', pattern: '[a-z0-9-]{1,39}' }],
      avatarUrl: (person) => (person.handles?.github ? `https://avatars.example.test/${person.handles.github}.png` : undefined),
      profileUrl: (person) => (person.handles?.github ? `https://profiles.example.test/${person.handles.github}` : undefined),
    });
    api.identity({ resolve: (identity) => ({ ...identity, name: `Directory ${identity.id}` }) });
  },
};
