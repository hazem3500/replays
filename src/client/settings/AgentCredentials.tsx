import { CheckIcon, CopyIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { Switch } from '@/components/ui/switch.tsx';

import { apiUrl } from '../route.ts';

interface Credential {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: number;
  revokedAt: number | null;
}
interface Capability {
  enabled: boolean;
  scopes: string[];
  maxExpirySeconds: number;
}
const SCOPE_NAMES: Record<string, string> = {
  'replays:read': 'Read replay metadata',
  'conversations:read': 'Read conversations',
  'conversations:write': 'Create conversations',
};
const EXPIRIES = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '1 day' },
  { seconds: 604800, label: '7 days' },
  { seconds: 2592000, label: '30 days' },
];

type CredentialState = { status: 'ready'; capability: Capability; records: Credential[] } | { status: 'unavailable' | 'signin' };

async function readCredentials(signal: AbortSignal | undefined): Promise<CredentialState> {
  const options: RequestInit = { credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}) };
  const response = await fetch(apiUrl('agent-capabilities'), options);
  if (response.status === 404) return { status: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { status: 'signin' };
  if (!response.ok) throw new Error('capabilities');
  const result = (await response.json()) as { credentials?: Capability };
  const capability = result.credentials;
  if (!capability?.enabled) return { status: 'unavailable' };
  if (!Array.isArray(capability.scopes) || !Number.isSafeInteger(capability.maxExpirySeconds) || capability.maxExpirySeconds < 60)
    throw new Error('capabilities');
  const list = await fetch(apiUrl('agent-credentials'), options);
  if (!list.ok) throw new Error('list');
  const data = (await list.json()) as { credentials: Credential[] };
  return { status: 'ready', capability, records: data.credentials };
}

/** Human-managed credentials. Secrets never enter a shared query cache or persistent browser storage. */
export function AgentCredentials() {
  const controller = useRef<AbortController | null>(null);
  const [capability, setCapability] = useState<Capability>();
  const [records, setRecords] = useState<Credential[]>([]);
  const [now, setNow] = useState(Date.now);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'signin' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['replays:read']);
  const [expiry, setExpiry] = useState(86400);
  const [secret, setSecret] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const signal = controller.current?.signal;
    return fetch(apiUrl(path), { ...init, credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}) });
  }, []);

  const load = useCallback(() => {
    const signal = controller.current?.signal;
    return readCredentials(signal).then(
      (result) => {
        if (signal?.aborted) return;
        if (result.status === 'ready') {
          setCapability(result.capability);
          setScopes(result.capability.scopes.includes('replays:read') ? ['replays:read'] : []);
          setExpiry(Math.min(86400, result.capability.maxExpirySeconds));
          setRecords(result.records);
        }
        setStatus(result.status);
      },
      () => {
        if (!signal?.aborted) setStatus('error');
      },
    );
  }, []);

  useEffect(() => {
    controller.current = new AbortController();
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    void load();
    return () => {
      controller.current?.abort();
      clearInterval(clock);
    };
  }, [load]);

  async function create() {
    const signal = controller.current?.signal;
    if (!capability || !name.trim() || !scopes.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request('agent-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes, expiresInSeconds: Math.min(expiry, capability.maxExpirySeconds) }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'Revoke an existing credential before creating another.'
            : 'Credential could not be created. Try again.',
        );
        return;
      }
      const result = (await response.json()) as { credential: Credential; secret: string };
      if (signal?.aborted) return;
      setRecords((previous) => [result.credential, ...previous]);
      setSecret(result.secret);
      setCopied(false);
      setCopyFailed(false);
      setEditing(false);
      setName('');
    } catch {
      if (!signal?.aborted) setError('Credential could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const signal = controller.current?.signal;
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request(`agent-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('revoke');
      if (!signal?.aborted) {
        const revokedAt = now;
        setNow(revokedAt);
        setRecords((previous) => previous.map((record) => (record.id === id ? { ...record, revokedAt } : record)));
      }
    } catch {
      if (!signal?.aborted) setError('Credential could not be revoked. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  const expiryChoices = EXPIRIES.filter((choice) => choice.seconds <= (capability?.maxExpirySeconds ?? 0));
  if (capability && !expiryChoices.some((choice) => choice.seconds === Math.min(86400, capability.maxExpirySeconds)))
    expiryChoices.push({ seconds: capability.maxExpirySeconds, label: `${Math.floor(capability.maxExpirySeconds / 60)} minutes` });

  return (
    <section aria-labelledby="agent-credentials-title" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="agent-credentials-title" className="font-medium">
          Agent credentials
        </h3>
        {status === 'ready' && !editing && !secret ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(true);
              setError('');
            }}
          >
            <PlusIcon aria-hidden="true" />
            New credential
          </Button>
        ) : null}
      </div>
      {status === 'loading' ? (
        <p role="status" className="text-muted-foreground">
          Checking credential support…
        </p>
      ) : null}
      {status === 'unavailable' ? (
        <p className="text-muted-foreground">
          API token creation is not available on this deployment. Credentials are issued by its authentication provider.
        </p>
      ) : null}
      {status === 'signin' ? (
        <p className="text-muted-foreground">Sign in through this deployment’s authentication provider to manage agent credentials.</p>
      ) : null}
      {status === 'error' ? (
        <div role="alert">
          <p className="mb-2">Credential settings could not be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus('loading');
              setError('');
              void load();
            }}
          >
            Retry credential settings
          </Button>
        </div>
      ) : null}
      {status === 'ready' ? (
        <>
          <p className="text-muted-foreground">
            These credentials narrow an agent’s access to your account. Agents must also authenticate with this deployment’s host. They
            cannot use these credentials to record or upload replays.
          </p>
          {secret ? (
            <div
              className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
              role="region"
              aria-label="New credential secret"
            >
              <p className="font-medium">Copy your credential now</p>
              <p className="text-muted-foreground">
                It will not be shown again. Send it as <code>x-replays-agent-token</code> alongside your host credentials.
              </p>
              <Input aria-label="New credential secret" readOnly value={secret} className="font-mono" />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void copy();
                  }}
                >
                  {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}Copy credential
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSecret(undefined)}>
                  I’ve saved it
                </Button>
              </div>
              <p role="status" className="text-muted-foreground">
                {copyFailed
                  ? 'Copy is unavailable. Select the credential above to copy it.'
                  : copied
                    ? 'Credential copied.'
                    : 'Keep this credential private.'}
              </p>
            </div>
          ) : null}
          {editing ? (
            <form
              className="space-y-3 rounded-lg border border-border p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label htmlFor="agent-credential-name" className="block space-y-1">
                <span>Name</span>
                <Input
                  id="agent-credential-name"
                  value={name}
                  maxLength={100}
                  required
                  placeholder="My development agent"
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-medium">Permissions</legend>
                {capability?.scopes
                  .filter((scope) => Object.hasOwn(SCOPE_NAMES, scope))
                  .map((scope) => (
                    <div key={scope} className="flex items-center justify-between gap-3">
                      <span>{SCOPE_NAMES[scope]}</span>
                      <Switch
                        aria-label={SCOPE_NAMES[scope]}
                        checked={scopes.includes(scope)}
                        onCheckedChange={(checked) =>
                          setScopes((previous) => (checked ? [...previous, scope] : previous.filter((value) => value !== scope)))
                        }
                      />
                    </div>
                  ))}
              </fieldset>
              <div className="space-y-1">
                <label htmlFor="agent-credential-expiry">Expires after</label>
                <Select
                  items={expiryChoices.map((choice) => ({ value: choice.seconds, label: choice.label }))}
                  value={expiry}
                  onValueChange={(value) => {
                    if (typeof value === 'number') setExpiry(value);
                  }}
                >
                  <SelectTrigger id="agent-credential-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryChoices.map((choice) => (
                      <SelectItem key={choice.seconds} value={choice.seconds}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || !name.trim() || !scopes.length}>
                  {busy ? 'Creating…' : 'Create credential'}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          {records.length ? (
            <ul className="divide-y divide-border">
              {records.map((record) => {
                const inactive = record.revokedAt !== null || record.expiresAt <= now;
                return (
                  <li key={record.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{record.name}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {record.revokedAt !== null
                          ? 'Revoked'
                          : record.expiresAt <= now
                            ? 'Expired'
                            : `Expires ${new Date(record.expiresAt).toLocaleDateString()}`}
                      </p>
                      <p className="text-muted-foreground">{record.scopes.map((scope) => SCOPE_NAMES[scope] ?? scope).join(' · ')}</p>
                    </div>
                    {!inactive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`Revoke ${record.name}`}
                        onClick={() => {
                          void revoke(record.id);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground">No agent credentials yet.</p>
          )}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
