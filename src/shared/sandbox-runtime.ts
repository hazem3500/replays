/**
 * The page a user plugin runs in (`GET /_malleable/sandbox.html`, served only with beta.malleable). The viewer embeds it as
 * `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the frame has an opaque origin: no cookies, no storage, no
 * access to the viewer's DOM), and the server answers it with a real CSP header (SANDBOX_CSP) that forbids every kind of
 * outgoing request. The only way out is the MessagePort the viewer hands over after the `ready` handshake; the viewer's broker
 * (src/client/malleable/broker.ts) decides what each call may do. Nothing in here is a security boundary on its own: the
 * boundary is the frame's sandbox + CSP + the broker.
 *
 * Wire protocol over the port (JSON-cloneable):
 *   frame → viewer  { id, method, params }          method: log | error | ready | done | seek | notify | comments.list | comments.add | download
 *   viewer → frame  { id, ok, result | error }       the answer to a call
 *   viewer → frame  { type: 'time' | 'theme' | 'dispose', ... }
 */

/** `script-src 'unsafe-inline'`: the plugin's source is appended as an inline script (no eval). Everything that loads or sends is off. */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const SANDBOX_PATH = '/_malleable/sandbox.html';

const RUNTIME = String.raw`
(function () {
  var parentWindow = window.parent;
  var port = null;
  var nextId = 1;
  var pending = {};
  var defs = { tab: {}, panel: {}, action: {}, section: {}, track: {} };
  var timeListeners = [];
  var lastTime = 0;
  var cleanups = [];
  var heartbeatTimer = null;

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      port.postMessage({ id: id, method: method, params: params });
    });
  }
  function fire(method, params) { try { port.postMessage({ id: 0, method: method, params: params }); } catch (e) {} }
  function show(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(show(arguments[i]));
      if (port) fire('log', { level: level, message: parts.join(' ').slice(0, 2000) });
      if (original) original.apply(console, arguments);
    };
  });
  function reportError(error) {
    var message = error && error.stack ? String(error.stack) : String(error && error.message ? error.message : error);
    if (port) fire('error', { message: message.slice(0, 2000) });
  }
  window.addEventListener('error', function (event) { reportError(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { reportError(event.reason); });

  function register(kind) {
    return function (id, fn) {
      if (typeof id !== 'string' || typeof fn !== 'function') throw new Error('replays.' + kind + '(id, function)');
      defs[kind][id] = fn;
    };
  }
  window.replays = { tab: register('tab'), panel: register('panel'), action: register('action'), section: register('section'), track: register('track') };

  function denied(name) {
    return function () { return Promise.reject(new Error('permission-denied: ' + name)); };
  }

  function makeContext(init) {
    var ctx = {
      theme: init.theme,
      getTime: function () { return lastTime; },
      onTime: function (listener) {
        timeListeners.push(listener);
        return function () { timeListeners = timeListeners.filter(function (l) { return l !== listener; }); };
      },
      seek: function (ms) { return call('seek', { ms: ms }); },
      notify: function (message) { return call('notify', { message: String(message) }); },
      settings: {
        get: function (id) { return call('settings.get', { id: id }); },
        set: function (id, value) { return call('settings.set', { id: id, value: value }); },
      },
      comments: {
        list: function () { return call('comments.list', {}); },
        add: function (input) { return call('comments.add', input); },
      },
      download: function (name, mime, text) { return call('download', { name: name, mime: mime, text: text }); },
    };
    if (init.replay) ctx.replay = init.replay;
    else Object.defineProperty(ctx, 'replay', { get: function () { throw new Error('permission-denied: replay:read'); } });
    return ctx;
  }

  function applyTheme(theme, vars) {
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    for (var name in vars) root.style.setProperty(name, vars[name]);
  }

  function start(init) {
    heartbeatTimer = setInterval(function () { fire('heartbeat', {}); }, 1000);
    fire('heartbeat', {});
    applyTheme(init.theme, init.vars || {});
    lastTime = init.time || 0;
    var script = document.createElement('script');
    script.textContent = init.source;
    document.head.appendChild(script);
    var ctx = makeContext(init);
    var root = document.getElementById('root');
    var fn = (defs[init.mode] || {})[init.contribution];
    if (typeof fn !== 'function') {
      reportError(new Error('the source never called replays.' + init.mode + '("' + init.contribution + '", …)'));
      fire('done', {});
      return;
    }
    Promise.resolve()
      .then(function () { return fn(init.mode === 'action' || init.mode === 'track' ? ctx : root, ctx); })
      .then(function (result) { if (init.mode === 'track') { fire('markers', { markers: result }); return; } if (typeof result === 'function') cleanups.push(result); if (init.mode === 'action') fire('done', {}); else fire('rendered', {}); })
      .catch(function (error) { reportError(error); if (init.mode === 'action' || init.mode === 'track') fire('done', {}); else fire('rendered', {}); });
  }

  window.addEventListener('message', function onInit(event) {
    if (event.source !== parentWindow || !event.data || event.data.type !== 'init' || !event.ports[0] || port) return;
    window.removeEventListener('message', onInit);
    port = event.ports[0];
    port.onmessage = function (message) {
      var data = message.data;
      if (data.type === 'time') {
        lastTime = data.ms;
        timeListeners.slice().forEach(function (l) { try { l(lastTime); } catch (e) { reportError(e); } });
      } else if (data.type === 'theme') applyTheme(data.theme, data.vars || {});
      else if (data.type === 'dispose') {
        clearInterval(heartbeatTimer);
        cleanups.forEach(function (c) { try { c(); } catch (e) {} });
        cleanups = [];
      } else if (data.id && pending[data.id]) {
        var entry = pending[data.id];
        delete pending[data.id];
        if (data.ok) entry.resolve(data.result); else entry.reject(new Error(data.error));
      }
    };
    start(event.data);
  });
  parentWindow.postMessage({ replaysSandbox: 'ready' }, '*');
})();
`;

export const SANDBOX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>plugin sandbox</title>
<style>
  :root { --text: #e8e8ec; --surface: #17171b; --line: #2c2c33; --accent: #7aa2ff; --muted: #9a9aa6; }
  html, body { margin: 0; background: transparent; color: var(--text); font: 12px/1.5 system-ui, sans-serif; }
  #root { padding: 12px 14px; }
  h1, h2, h3 { margin: 0 0 8px; font-weight: 600; }
  h3 { font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  code, .mono { font: 11px ui-monospace, monospace; }
  .muted { color: var(--muted); }
  a { color: var(--accent); }
  button { font: inherit; color: var(--text); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
</style></head>
<body><div id="root"></div><script>${RUNTIME}</script></body></html>
`;
