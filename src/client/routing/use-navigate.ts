import { navigate } from '../navigation.ts';
import { appBase } from '../route.ts';

/**
 * Temporary: the call shape of TanStack Router's `useNavigate` over the old navigation module, so callers move to
 * typed destinations before the router is live. Deleted at the switchover, when callers import `useNavigate` from
 * '@tanstack/react-router' instead.
 */
interface NavigateOptions {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | number | boolean | undefined>;
  replace?: boolean;
}

function hrefFor({ to, params = {}, search = {} }: NavigateOptions) {
  const path = to.replace(/\$(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== false) query.set(key, value === true ? '1' : String(value));
  const text = query.toString();
  return `${appBase()}${path}${text ? `?${text}` : ''}`;
}

const go = (options: NavigateOptions) => {
  navigate(hrefFor(options), { replace: options.replace ?? false });
};

export function useNavigate() {
  return go;
}
