const DASHES = /[–—]/;
const SCOPE = /(?:^|\/)src\/(?:(?:client|recorder|server|capture|mcp)\/|cli\.ts$)/;

const MESSAGE =
  'No em or en dashes in user-visible copy. Write ranges and asides in words: "0:00 to 0:07", "Unknown" or "Pending", or split into two sentences.';

/**
 * Reports em and en dashes in string literals, template literals and JSX text of user-facing code. Comments are exempt
 * because only copy reaches users.
 */
export const noDashInCopy = {
  meta: { type: 'problem', schema: [], messages: { copy: MESSAGE } },
  create(context) {
    if (!SCOPE.test(context.filename.replaceAll('\\', '/'))) return {};
    const check = (node, text) => {
      if (typeof text === 'string' && DASHES.test(text)) context.report({ node, messageId: 'copy' });
    };
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked ?? node.value.raw),
      JSXText: (node) => check(node, node.value),
    };
  },
};
