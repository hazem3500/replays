const effects = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const memo = new Set(['useMemo', 'useCallback', 'memo']);
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const filename = (context) => context.filename.replaceAll('\\', '/');
const isReactArea = (context) => /(?:^|\/)(?:src\/client|src\/recorder|stories|\.storybook)\//.test(filename(context));

function importRule(names, allowed, message) {
  return {
    meta: { type: 'suggestion', schema: [], messages: { policy: message } },
    create(context) {
      if (!isReactArea(context) || allowed(context)) return {};
      const namespaces = new Set();
      return {
        ImportDeclaration(node) {
          if (node.source.value !== 'react') return;
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportSpecifier' && names.has(specifier.imported.name ?? specifier.imported.value)) {
              context.report({ node: specifier, messageId: 'policy' });
            } else if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
              namespaces.add(specifier.local.name);
            }
          }
        },
        ExportNamedDeclaration(node) {
          if (node.source?.value !== 'react') return;
          for (const specifier of node.specifiers) {
            if (names.has(specifier.local.name ?? specifier.local.value)) context.report({ node: specifier, messageId: 'policy' });
          }
        },
        VariableDeclarator(node) {
          if (!namespaces.has(node.init?.name) || node.id.type !== 'ObjectPattern') return;
          for (const property of node.id.properties) {
            if (names.has(property.key?.name ?? property.key?.value)) context.report({ node: property, messageId: 'policy' });
          }
        },
        MemberExpression(node) {
          const property = node.computed ? node.property.value : node.property.name;
          if (namespaces.has(node.object.name) && names.has(property)) context.report({ node, messageId: 'policy' });
        },
      };
    },
  };
}

export const noEffectOutsideHooks = importRule(
  effects,
  (context) => /(?:^|\/)src\/client\/hooks\//.test(filename(context)),
  'Effects belong in a named hook under src/client/hooks/. Derive state, use events or subscribe to an external store.',
);
export const noManualMemo = importRule(
  memo,
  () => false,
  'React Compiler handles memoization. Exceptions need profiling evidence and a scoped disable with -- why:.',
);
export const noForwardRef = importRule(new Set(['forwardRef']), () => false, 'Use a ref prop with React 19.');

function functionName(node) {
  return node.id?.name ?? (node.parent?.type === 'VariableDeclarator' ? node.parent.id.name : undefined);
}

export const maxComponentProps = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { props: 'Compose components with children/slots instead of more than eight named props.' },
  },
  create(context) {
    if (!isReactArea(context)) return {};
    return {
      ':function'(node) {
        if (!/^[A-Z]/.test(functionName(node) ?? '')) return;
        const parameter = node.params[0];
        if (parameter?.type === 'ObjectPattern' && parameter.properties.filter((p) => p.type !== 'RestElement').length > 8) {
          context.report({ node: parameter, messageId: 'props' });
        }
      },
    };
  },
};

export const noRenderTimeStoreRead = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { snapshot: 'Read reactive state through useSyncExternalStore, not an imperative getter during render.' },
  },
  create(context) {
    if (!isReactArea(context)) return {};
    return {
      CallExpression(node) {
        const callee = context.sourceCode.getText(node.callee);
        if (
          !/^(?:(?:window\.)?matchMedia|player\.getTime|viewerRegistry\.getSnapshot|(?:window\.)?(?:localStorage|sessionStorage)\.getItem)$/.test(
            callee,
          )
        )
          return;
        let owner = node.parent;
        while (owner && !functions.has(owner.type)) owner = owner.parent;
        if (owner && /^[A-Z]/.test(functionName(owner) ?? '')) context.report({ node, messageId: 'snapshot' });
      },
    };
  },
};

export const maxJsxDepth = {
  meta: { type: 'suggestion', schema: [], messages: { depth: 'Extract a composable view instead of nesting JSX more than seven levels.' } },
  create(context) {
    return {
      JSXElement(node) {
        let depth = 1;
        let parent = node.parent;
        while (parent && !functions.has(parent.type)) {
          if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') depth += 1;
          parent = parent.parent;
        }
        if (depth === 8) context.report({ node, messageId: 'depth' });
      },
    };
  },
};
