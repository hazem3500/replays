import { BotIcon, DownloadIcon, FileUpIcon, PlusIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { diffLines } from '../../shared/line-diff.ts';
import { CAPABILITIES, type Capability, isWriteCapability, PluginFormatError, starterPlugin } from '../../shared/malleable.ts';
import { targetsFor } from '../../shared/malleable-policy.ts';
import { appBase } from '../route.ts';
import { notify } from '../toast.ts';
import { connectAgent, disconnectAgent, useBridge } from './bridge.ts';
import { DiffView } from './DiffView.tsx';
import { dismissReview, getHealthSnapshot, needsReview, subscribeHealth } from './health.ts';
import { useHost } from './host.ts';
import { isDirty, latestSaved, manager, type PluginEntry, useManager } from './manager.ts';
import { Modal } from './Modal.tsx';
import { setMalleableUi, useMalleableUi } from './ui-state.ts';

type Pane = 'source' | 'manifest' | 'history' | 'share';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const close = () => setMalleableUi({ workshopOpen: false });
const originLabel = { agent: 'agent draft', workshop: 'draft', saved: 'saved' } as const;

/**
 * The plugin workshop: the list of plugins in this viewer, an editable source view with hot reload, diagnostics, version
 * history with diffs and revert, file export/import, and the agent bridge. It edits the *working copy* held by the manager;
 * nothing is stored until the approval dialog (KeepDialog) is accepted.
 */
export function Workshop() {
  const { workshopOpen, workshopPlugin } = useMalleableUi();
  const { entries, disabled } = useManager();
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<'plugins' | 'agent'>('plugins');
  const entry = entries.find((candidate) => candidate.id === (workshopPlugin ?? selectedId ?? entries[0]?.id));
  const selectPlugin = (id: string | undefined) => {
    setSelectedId(id);
    setMalleableUi({ workshopPlugin: undefined });
  };
  if (!workshopOpen) return null;
  return (
    <Modal title="Plugin workshop" wide testId="workshop" onClose={close}>
      <div className="mall-tabs" role="tablist">
        {(['plugins', 'agent'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={view === name}
            data-testid={`workshop-view-${name}`}
            onClick={() => setView(name)}
          >
            {name === 'plugins' ? 'Plugins' : 'Agent'}
          </button>
        ))}
        <button type="button" className="mall-close" aria-label="Close the workshop" data-testid="workshop-close" onClick={close}>
          Close
        </button>
      </div>
      {view === 'agent' ? (
        <AgentPane />
      ) : (
        <>
          <ReviewNotice entries={entries} onSelect={selectPlugin} />
          <div className="mall-split">
            <nav className="mall-list" aria-label="Plugins">
              <ul>
                {entries.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-current={candidate.id === entry?.id}
                      data-testid={`plugin-item:${candidate.id}`}
                      onClick={() => selectPlugin(candidate.id)}
                    >
                      <span className="mall-name">{candidate.manifest.name}</span>
                      <span className="mall-badges">
                        <span data-testid={`plugin-origin:${candidate.id}`}>{originLabel[candidate.origin]}</span>
                        {isDirty(candidate) && candidate.versions.length ? <span>unsaved</span> : null}
                        {disabled.includes(candidate.id) ? <span>off</span> : null}
                        {latestSaved(candidate) ? <span>v{latestSaved(candidate)!.n}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mall-list-actions">
                <button
                  type="button"
                  className="mall-btn"
                  data-testid="plugin-new"
                  onClick={() => {
                    const taken = new Set(entries.map((candidate) => candidate.id));
                    let n = 1;
                    while (taken.has(n === 1 ? 'my-tab' : `my-tab-${n}`)) n++;
                    const { manifest, source } = starterPlugin(n === 1 ? 'my-tab' : `my-tab-${n}`);
                    selectPlugin(
                      manager.upsert({ manifest: { ...manifest, ...(n > 1 ? { name: `My tab ${n}` } : {}) }, source, origin: 'workshop' })
                        .id,
                    );
                  }}
                >
                  <PlusIcon aria-hidden="true" /> New plugin
                </button>
                <ImportButton onImported={selectPlugin} />
              </div>
            </nav>
            {entry ? (
              <Editor key={entry.id} entry={entry} onGone={() => selectPlugin(undefined)} />
            ) : (
              <div className="mall-empty" data-testid="workshop-empty">
                <p>No plugins yet.</p>
                <p className="mall-note">
                  Start from a template with “New plugin”, import a <code>.replays-plugin.json</code> file, or connect an agent and ask it
                  for one.
                </p>
              </div>
            )}
          </div>
          <PolicyNote />
        </>
      )}
    </Modal>
  );
}

const RULE_TEXT = { allow: 'allowed', ask: 'asks you', deny: 'not allowed' } as const;

/** What this server lets user plugins do (the host's `malleable` policy), so nobody writes a plugin it would refuse. */
function PolicyNote() {
  const { policy, versions } = useHost();
  const targets = targetsFor(versions);
  return (
    <details className="mall-policy" data-testid="workshop-policy">
      <summary>This server’s rules for plugins</summary>
      <ul>
        <li data-testid="policy-scopes">
          Can be kept for:{' '}
          {policy.scopes.length
            ? policy.scopes.map((scope) => (scope === 'user' ? 'only you' : 'the workspace')).join(', ')
            : 'nobody (saving is off)'}
        </li>
        {(Object.keys(CAPABILITIES) as Capability[]).map((capability) => (
          <li key={capability} data-testid={`policy-capability:${capability}`} data-rule={policy.capabilities[capability]}>
            <code>{capability}</code> {RULE_TEXT[policy.capabilities[capability]]}
          </li>
        ))}
        {policy.lockedSurfaces.length ? (
          <li data-testid="policy-locked">
            Plugins cannot replace or hide:{' '}
            {policy.lockedSurfaces.map((surface) => (
              <code key={surface}>{surface} </code>
            ))}
          </li>
        ) : null}
        {targets.core ? (
          <li className="mall-note" data-testid="policy-versions">
            Running {targets.distribution ? `${targets.distribution} on ` : ''}core {targets.core}
          </li>
        ) : null}
      </ul>
    </details>
  );
}

/**
 * The upgrade contract's notice: saved plugins that loaded before and fail now that the versions changed. It only points
 * them out; nothing is switched off, changed or deleted (src/client/malleable/health.ts).
 */
function ReviewNotice({ entries, onSelect }: { entries: readonly PluginEntry[]; onSelect: (id: string) => void }) {
  const { versions } = useHost();
  const health = useSyncExternalStore(subscribeHealth, getHealthSnapshot);
  const failing = entries.filter((entry) => needsReview(versions, entry.id, latestSaved(entry), health));
  if (!failing.length) return null;
  return (
    <div className="mall-review" role="status" data-testid="review-plugins">
      <p>
        <strong>Review plugins.</strong> Since this server was updated, {failing.length === 1 ? 'one plugin' : `${failing.length} plugins`}{' '}
        failed to load. {failing.length === 1 ? 'It is' : 'They are'} still on and unchanged:{' '}
        {failing.map((entry, index) => (
          <span key={entry.id}>
            {index ? ', ' : ''}
            <button type="button" className="mall-link" data-testid={`review-plugin:${entry.id}`} onClick={() => onSelect(entry.id)}>
              {entry.manifest.name}
            </button>
          </span>
        ))}
        .
      </p>
      <button
        type="button"
        className="mall-btn"
        data-testid="review-dismiss"
        onClick={() => {
          dismissReview(
            versions,
            failing.map((entry) => entry.id),
          );
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function ImportButton({ onImported }: { onImported: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="mall-btn" data-testid="plugin-import" onClick={() => input.current?.click()}>
        <FileUpIcon aria-hidden="true" /> Import
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="plugin-import-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            onImported(manager.importFile(await file.text()).id);
            notify('Imported as a draft');
          } catch (error) {
            notify(`Could not import: ${error instanceof PluginFormatError ? error.message : 'unreadable file'}`);
          }
        }}
      />
    </>
  );
}

function Editor({ entry, onGone }: { entry: PluginEntry; onGone: () => void }) {
  const [pane, setPane] = useState<Pane>('source');
  const [source, setSource] = useState(entry.source);
  const [manifestText, setManifestText] = useState(() => JSON.stringify(entry.manifest, null, 2));
  const [problem, setProblem] = useState<string>();
  const [auto, setAuto] = useState(true);
  const pushed = useRef(entry.revision);
  const { disabled } = useManager();
  const off = disabled.includes(entry.id);

  // The working copy changed under the editor (an agent updated it, a version was loaded): show it.
  useEffect(() => {
    if (entry.revision === pushed.current) return;
    pushed.current = entry.revision;
    setSource(entry.source);
    setManifestText(JSON.stringify(entry.manifest, null, 2));
    setProblem(undefined);
  }, [entry.revision, entry.source, entry.manifest]);

  const push = (nextSource: string, nextManifest: string) => {
    try {
      const loaded = manager.upsert({ manifest: JSON.parse(nextManifest), source: nextSource, origin: 'workshop', scope: entry.scope });
      pushed.current = loaded.revision;
      setProblem(undefined);
    } catch (error) {
      setProblem(
        error instanceof PluginFormatError
          ? error.message
          : error instanceof SyntaxError
            ? `The manifest is not valid JSON: ${error.message}`
            : String(error),
      );
    }
  };
  // Hot reload: typing reloads the running plugin shortly after the last keystroke.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<(() => void) | undefined>(undefined);
  // Closing the editor right after typing must not lose the last edit: leaving applies it at once.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );
  const edited = (nextSource: string, nextManifest: string) => {
    setSource(nextSource);
    setManifestText(nextManifest);
    clearTimeout(timer.current);
    pending.current = () => {
      pending.current = undefined;
      push(nextSource, nextManifest);
    };
    if (auto) timer.current = setTimeout(() => pending.current?.(), 350);
    else pending.current = undefined;
  };

  const dirty = isDirty(entry);
  const saved = latestSaved(entry);
  return (
    <section className="mall-editor" aria-label={`Editing ${entry.manifest.name}`} data-testid="workshop-editor">
      <header className="mall-editor-head">
        <div>
          <h3 data-testid="editor-title">{entry.manifest.name}</h3>
          <p className="mall-note">
            <code>{entry.id}</code> · {entry.scope === 'user' ? 'only you' : 'workspace'} ·{' '}
            {saved ? `saved v${saved.n}${dirty ? ', with unsaved changes' : ''}` : 'not saved'}
          </p>
        </div>
        <div className="mall-actions">
          <button type="button" className="mall-btn" data-testid="plugin-reload" onClick={() => push(source, manifestText)}>
            Reload
          </button>
          <button
            type="button"
            className="mall-btn mall-btn-primary"
            data-testid="plugin-keep"
            disabled={!dirty}
            onClick={() => manager.requestKeep(entry.id)}
          >
            Keep…
          </button>
        </div>
      </header>
      <div className="mall-tabs" role="tablist" aria-label="Editor sections">
        {(['source', 'manifest', 'history', 'share'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={pane === name}
            data-testid={`pane-${name}`}
            onClick={() => setPane(name)}
          >
            {name[0]!.toUpperCase() + name.slice(1)}
          </button>
        ))}
        <label className="mall-auto">
          <input type="checkbox" checked={auto} data-testid="auto-reload" onChange={(event) => setAuto(event.target.checked)} /> Reload as I
          type
        </label>
      </div>
      {pane === 'source' ? (
        <textarea
          className="mall-code"
          aria-label="Plugin source"
          data-testid="source-editor"
          spellCheck={false}
          value={source}
          onChange={(event) => edited(event.target.value, manifestText)}
        />
      ) : null}
      {pane === 'manifest' ? (
        <textarea
          className="mall-code"
          aria-label="Plugin manifest"
          data-testid="manifest-editor"
          spellCheck={false}
          value={manifestText}
          onChange={(event) => edited(source, event.target.value)}
        />
      ) : null}
      {pane === 'history' ? <History entry={entry} /> : null}
      {pane === 'share' ? (
        <div className="mall-share">
          <p className="mall-note">
            A plugin is one JSON file (<code>*.replays-plugin.json</code>). Send it to someone; they import it here and it loads as a draft
            they approve themselves.
          </p>
          <div className="mall-actions">
            <button
              type="button"
              className="mall-btn"
              data-testid="export-file"
              onClick={() =>
                download(`${entry.id}.replays-plugin.json`, `${JSON.stringify(manager.exportFile(entry.id, false), null, 2)}\n`)
              }
            >
              <DownloadIcon aria-hidden="true" /> Export file
            </button>
            <button
              type="button"
              className="mall-btn"
              data-testid="export-file-versions"
              disabled={!entry.versions.length}
              onClick={() =>
                download(
                  `${entry.id}.with-versions.replays-plugin.json`,
                  `${JSON.stringify(manager.exportFile(entry.id, true), null, 2)}\n`,
                )
              }
            >
              <DownloadIcon aria-hidden="true" /> Export with versions
            </button>
          </div>
          <div className="mall-actions">
            <button type="button" className="mall-btn" data-testid="plugin-switch" onClick={() => manager.setEnabled(entry.id, off)}>
              {off ? 'Switch on' : 'Switch off on this device'}
            </button>
            <button
              type="button"
              className="mall-btn"
              data-testid="plugin-discard"
              onClick={() => (manager.discard(entry.id), saved ? undefined : onGone())}
            >
              {saved ? 'Discard unsaved changes' : 'Discard draft'}
            </button>
            <button
              type="button"
              className="mall-btn mall-btn-danger"
              data-testid="plugin-delete"
              onClick={async () => {
                if (!window.confirm(`Delete “${entry.manifest.name}”${saved ? ' and its saved versions' : ''}?`)) return;
                try {
                  await manager.deleteApproved(entry.id);
                  onGone();
                } catch (error) {
                  notify(`Could not delete: ${error instanceof Error ? error.message : String(error)}`);
                }
              }}
            >
              Delete…
            </button>
          </div>
        </div>
      ) : null}
      {problem ? (
        <p className="mall-error" role="alert" data-testid="editor-problem">
          {problem}
        </p>
      ) : null}
      <Diagnostics entry={entry} />
    </section>
  );
}

function Diagnostics({ entry }: { entry: PluginEntry }) {
  return (
    <section className="mall-diagnostics" aria-label="What the plugin printed" data-testid="diagnostics">
      <h4>
        Output <span className="mall-note">revision {entry.revision}</span>
      </h4>
      {entry.diagnostics.length === 0 ? <p className="mall-note">Nothing yet.</p> : null}
      <ul>
        {entry.diagnostics.slice(-30).map((line, index) => (
          <li key={index} data-level={line.level}>
            <span className="mall-level">{line.level}</span> {line.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ entry }: { entry: PluginEntry }) {
  const versions = entry.versions.toReversed();
  const [selected, setSelected] = useState<number>();
  const chosen = entry.versions.find((version) => version.n === (selected ?? versions[0]?.n));
  const diff = useMemo(() => (chosen ? diffLines(chosen.source, entry.source) : []), [chosen, entry.source]);
  if (!versions.length)
    return (
      <p className="mall-note" data-testid="history-empty">
        No saved versions yet. “Keep…” saves the first one.
      </p>
    );
  return (
    <div className="mall-history" data-testid="history">
      <ol>
        {versions.map((version) => (
          <li key={version.n}>
            <button
              type="button"
              aria-current={version.n === chosen?.n}
              data-testid={`version:${version.n}`}
              onClick={() => setSelected(version.n)}
            >
              <strong>v{version.n}</strong> {version.message || '(no note)'}
              <span className="mall-note">
                {' '}
                · {version.by} · {new Date(version.at).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {chosen ? (
        <div>
          <p className="mall-note">Version {chosen.n} → your working copy:</p>
          <DiffView diff={diff} testId="version-diff" />
          <div className="mall-actions">
            <button type="button" className="mall-btn" data-testid="version-load" onClick={() => manager.loadVersion(entry.id, chosen.n)}>
              Load into editor
            </button>
            <button
              type="button"
              className="mall-btn mall-btn-primary"
              data-testid="version-revert"
              onClick={() => {
                manager.loadVersion(entry.id, chosen.n);
                manager.requestKeep(entry.id);
              }}
            >
              Revert to v{chosen.n}…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentPane() {
  const bridge = useBridge();
  const [error, setError] = useState<string>();
  const command = bridge.token ? `REPLAYS_URL=${location.origin}${appBase()} REPLAYS_BRIDGE_TOKEN=${bridge.token} replays mcp` : '';
  return (
    <div className="mall-agent" data-testid="agent-pane">
      <p className="mall-lead">
        Let a coding agent look at this viewer and write plugins for you. It sees what you see (the open replay, the playhead, comments),
        can load a draft plugin into this page, and can ask you to keep it. It cannot save anything, grant a permission or act outside the
        sandbox.
      </p>
      <h3>
        <BotIcon aria-hidden="true" /> In the browser (WebMCP)
      </h3>
      <p className="mall-note" data-testid="webmcp-status">
        {(document as Document & { modelContext?: { polyfill?: boolean } }).modelContext?.polyfill
          ? 'This browser has no WebMCP yet, so the viewer registered its tools with a built-in stand-in (document.modelContext). Agents that read the page can use them.'
          : 'The viewer registered its tools with this browser’s WebMCP implementation.'}
      </p>
      <h3>Outside the browser (MCP server)</h3>
      {bridge.status === 'off' ? (
        <button
          type="button"
          className="mall-btn mall-btn-primary"
          data-testid="agent-connect"
          onClick={() => connectAgent().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))}
        >
          Connect an agent
        </button>
      ) : (
        <>
          <p className="mall-note" data-testid="agent-status">
            {bridge.status === 'connected' ? 'Connected. Waiting for an agent.' : 'Connecting…'} The token works only for this tab and only
            until you disconnect or close it.
          </p>
          <label className="mall-field">
            <span>Token</span>
            <input
              className="mall-input mall-mono"
              readOnly
              value={bridge.token ?? ''}
              data-testid="bridge-token"
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label className="mall-field">
            <span>Start the MCP server (stdio) from your agent’s config</span>
            <input
              className="mall-input mall-mono"
              readOnly
              value={command}
              data-testid="bridge-command"
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button type="button" className="mall-btn" data-testid="agent-disconnect" onClick={disconnectAgent}>
            Disconnect
          </button>
        </>
      )}
      {error ? (
        <p className="mall-error" role="alert">
          {error}
        </p>
      ) : null}
      <h3>What the agent did</h3>
      <ul className="mall-activity" data-testid="agent-activity">
        {bridge.activity.length === 0 ? <li className="mall-note">Nothing yet.</li> : null}
        {bridge.activity.map((item, index) => (
          <li key={index} data-ok={item.ok}>
            <code>{item.tool}</code> <span className="mall-note">{item.summary}</span>
          </li>
        ))}
      </ul>
      <p className="mall-note">
        Write permissions are still yours: a plugin that comments or downloads asks you first, whoever wrote it.{' '}
        {Object.entries(CAPABILITIES)
          .filter(([, value]) => value.tier === 'write')
          .map(([name]) => name)
          .join(', ')}
        .
      </p>
    </div>
  );
}

export { isWriteCapability };
