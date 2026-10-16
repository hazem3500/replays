// Auth plugin for the comments e2e specs: the person is named by request headers, with a display name and an
// avatar URL, the way an identity-aware proxy would hand them over. (AUTH_MODE=plugin, AUTH_PLUGIN=this file.)
export default function commentsAuth() {
  return {
    name: 'e2e-comments',
    authenticate(request) {
      const id = request.headers['x-e2e-user'];
      if (typeof id !== 'string' || !id) return undefined;
      const name = request.headers['x-e2e-name'];
      const avatarUrl = request.headers['x-e2e-avatar'];
      return { id, email: id, ...(typeof name === 'string' ? { name } : {}), ...(typeof avatarUrl === 'string' ? { avatarUrl } : {}) };
    },
  };
}
