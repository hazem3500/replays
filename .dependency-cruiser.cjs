// Resolved paths also cover aliases, re-exports, dynamic imports and bare Node builtins.
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: { path: '^src/' }, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'shared-is-portable',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/', pathNot: '^src/shared/' },
    },
    {
      name: 'recorder-is-independent',
      severity: 'error',
      from: { path: '^src/recorder/' },
      to: { path: '^src/', pathNot: '^src/recorder/' },
    },
    {
      name: 'browser-no-node',
      severity: 'error',
      from: { path: '^src/(client|shared|recorder)/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'recorder-no-framework',
      severity: 'error',
      from: { path: '^src/recorder/' },
      to: { path: '(^|/)(react|react-dom|react-native|preact|vue|svelte|solid-js|@angular)(/|$)' },
    },
    {
      name: 'client-no-server',
      severity: 'error',
      from: { path: '^src/client/' },
      to: { path: '^src/(server|capture|plugin|config|first-party|mcp|cli)(/|\\.)' },
    },
    {
      name: 'server-no-client-runtime',
      severity: 'error',
      from: { path: '^src/server/' },
      to: { path: '^src/client/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'plugin-contracts-no-implementation',
      severity: 'error',
      from: { path: '^src/plugin/' },
      to: { path: '^src/(client|server|capture|recorder|config|first-party|mcp|cli)(/|\\.)', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'cli-no-client',
      severity: 'error',
      from: { path: '^src/cli(/|\\.)' },
      to: { path: '^src/client/' },
    },
    {
      name: 'cli-is-an-entry',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/cli(/|\\.)' },
      to: { path: '^src/cli(/|\\.)' },
    },
  ],
  options: {
    // Co-located tests run on Node; the production browser/recorder policy does not apply to them.
    exclude: { path: '\\.(test|spec)\\.[cm]?[jt]sx?$' },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
};
