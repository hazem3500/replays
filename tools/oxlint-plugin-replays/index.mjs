import { commentPolicy, disableNeedsWhy } from './comments.mjs';
import { noDashInCopy } from './copy.mjs';
import { maxComponentProps, maxJsxDepth, noEffectOutsideHooks, noForwardRef, noManualMemo, noRenderTimeStoreRead } from './react.mjs';

const filename = (context) => context.filename.replaceAll('\\', '/');
const client = (context) => /(?:^|\/)src\/client\//.test(filename(context));
const memberName = (node) => {
  if (node?.type === 'MemberExpression') return node.computed ? node.property.value : node.property.name;
  return null;
};

function rule(message, create) {
  return { meta: { type: 'problem', schema: [], messages: { policy: message } }, create };
}

const noProcessEnv = rule('Read environment at the server configuration boundary; pass typed configuration to consumers.', (context) => {
  if (!/(?:^|\/)src\//.test(filename(context)) || /(?:^|\/)src\/(?:server\/config|cli|capture\/cli)\.ts$/.test(filename(context)))
    return {};
  return {
    MemberExpression(node) {
      if (node.object.name === 'process' && memberName(node) === 'env') context.report({ node, messageId: 'policy' });
    },
  };
});

const noManualNavigation = rule('Use the routing layer for URL state and navigation.', (context) => {
  if (!client(context) || filename(context).endsWith('/router.tsx')) return {};
  return {
    CallExpression(node) {
      const text = context.sourceCode.getText(node.callee);
      if (/^(?:(?:window\.)?history\.(?:pushState|replaceState)|(?:window\.)?location\.(?:assign|replace))$/.test(text))
        context.report({ node, messageId: 'policy' });
    },
    NewExpression(node) {
      if (
        node.callee.name === 'URLSearchParams' &&
        node.arguments.some((arg) => /^(?:window\.)?location\.search$/.test(context.sourceCode.getText(arg)))
      )
        context.report({ node, messageId: 'policy' });
    },
  };
});

const noRawFetch = rule('Keep transport requests in the shared client data layer.', (context) => {
  if (!client(context) || /\/(?:queries\.ts|data\/)/.test(filename(context))) return {};
  return {
    CallExpression(node) {
      if (
        node.callee.name === 'fetch' ||
        (['window', 'globalThis'].includes(node.callee.object?.name) && memberName(node.callee) === 'fetch')
      )
        context.report({ node, messageId: 'policy' });
    },
  };
});

const noDirectStorage = rule('Use a shared storage adapter that validates persisted data.', (context) => {
  if (!client(context) || filename(context).endsWith('/src/client/storage.ts')) return {};
  return {
    Identifier(node) {
      if (!['localStorage', 'sessionStorage'].includes(node.name)) return;
      if (node.parent.type === 'MemberExpression' && node.parent.property === node && !node.parent.computed) return;
      if (node.parent.type === 'Property' && node.parent.key === node && !node.parent.computed && !node.parent.shorthand) return;
      context.report({ node, messageId: 'policy' });
    },
    MemberExpression(node) {
      if (['window', 'globalThis'].includes(node.object.name) && ['localStorage', 'sessionStorage'].includes(memberName(node)))
        context.report({ node, messageId: 'policy' });
    },
  };
});

const noProductNameLiteral = rule('Import PRODUCT_NAME or PRODUCT_SLUG from shared/brand.ts.', (context) => {
  if (!/(?:^|\/)src\//.test(filename(context)) || filename(context).endsWith('/shared/brand.ts')) return {};
  return {
    Literal(node) {
      if (node.value === 'replays') context.report({ node, messageId: 'policy' });
    },
  };
});

const noThrowPlainErrorInRoutes = rule('Route failures need an explicit HTTP/validation error contract.', (context) => {
  if (!/(?:^|\/)src\/server\/(?:.*routes|app)\.ts$/.test(filename(context))) return {};
  return {
    ThrowStatement(node) {
      if (node.argument?.type === 'NewExpression' && node.argument.callee.name === 'Error') context.report({ node, messageId: 'policy' });
    },
  };
});

// oxlint-disable-next-line import/no-default-export -- why: oxlint loads the plugin through its default export.
export default {
  meta: { name: 'replays', version: '1.0.0' },
  rules: {
    'comment-policy': commentPolicy,
    'disable-needs-why': disableNeedsWhy,
    'no-effect-outside-hooks': noEffectOutsideHooks,
    'no-manual-memo': noManualMemo,
    'no-forward-ref': noForwardRef,
    'no-process-env': noProcessEnv,
    'no-manual-navigation': noManualNavigation,
    'no-raw-fetch': noRawFetch,
    'no-direct-storage': noDirectStorage,
    'max-component-props': maxComponentProps,
    'max-jsx-depth': maxJsxDepth,
    'no-product-name-literal': noProductNameLiteral,
    'no-throw-plain-error-in-routes': noThrowPlainErrorInRoutes,
    'no-render-time-store-read': noRenderTimeStoreRead,
    'no-dash-in-copy': noDashInCopy,
  },
};
