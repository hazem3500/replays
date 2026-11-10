import { apiUrl } from '../api/fetch.ts';

/** `DELETE /api/plugins/github-connect/link`: true once the server has dropped the person's GitHub link. */
export async function deleteGithubLink(): Promise<boolean> {
  const response = await fetch(apiUrl('plugins/github-connect/link'), { method: 'DELETE' });
  return response.ok;
}
