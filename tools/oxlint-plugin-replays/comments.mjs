const declarations = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'VariableDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'MethodDefinition',
  'PropertyDefinition',
  'TSPropertySignature',
  'TSMethodSignature',
]);

const declarationParents = new Set([
  'Program',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ClassBody',
  'TSInterfaceBody',
  'TSTypeLiteral',
]);
const isContractDeclaration = (node) => declarations.has(node.type) && declarationParents.has(node.parent?.type);

function documentedComments(source) {
  const attached = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || !node.type) return;
    const parent = node.parent;
    if (isContractDeclaration(node)) {
      const target = parent.type.startsWith('Export') ? parent : node;
      for (const comment of source.getCommentsBefore(target)) {
        if (comment.type === 'Block' && comment.value.startsWith('*') && source.text.slice(comment.range[1], target.range[0]).trim() === '')
          attached.add(comment.range[0]);
      }
    }
    for (const key of source.visitorKeys[node.type] ?? []) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else visit(value);
    }
  };
  visit(source.ast);
  return attached;
}

export const commentPolicy = {
  meta: { type: 'suggestion', schema: [], messages: { tag: 'Delete narration or explain a reason with why: or invariant:.' } },
  create(context) {
    return {
      Program() {
        const source = context.sourceCode;
        const attached = documentedComments(source);
        for (const comment of source.getAllComments()) {
          const text = comment.value.replace(/^\*\s*/, '').trim();
          if (/^(?:why|invariant):\s*\S/.test(text) || attached.has(comment.range[0])) continue;
          if (/^(?:(?:oxlint|eslint|oxfmt)-|@(?:ts-|vitest|vite-|jsx)|[#@]__PURE__|istanbul|c8\b|v8 ignore|\/\s*<reference)/.test(text))
            continue;
          if (comment.range[0] < 200 && /(?:copyright|license|spdx)/i.test(text)) continue;
          context.report({ loc: comment.loc, messageId: 'tag' });
        }
      },
    };
  },
};

export const disableNeedsWhy = {
  meta: { type: 'suggestion', schema: [], messages: { why: 'Lint disables require a specific -- why: explanation.' } },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/\b(?:oxlint|eslint)-disable/.test(comment.value) && !/--\s*why:\s*\S/.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'why' });
          }
        }
      },
    };
  },
};
