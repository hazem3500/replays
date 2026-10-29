/**
 * The last compound part of a mask selector (`.card [data-private]` checks `[data-private]`), as matched against serialized
 * rrweb nodes. Pseudo-classes are ignored, so a serialized recording is masked for the same text or more, never less.
 */
export interface CompoundSelector {
  tag?: string;
  ids: string[];
  classes: string[];
  attributes: Array<{ name: string; operator?: string; value?: string; insensitive: boolean }>;
}

/** The parts of a serialized rrweb element a compound selector reads. */
export interface SelectorNode {
  tagName?: unknown;
  attributes?: Record<string, unknown> | undefined;
}

/** Splits on `separator` outside brackets, parentheses and quotes. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quote) {
      if (char === '\\') current += char + text.charAt(++index);
      else {
        if (char === quote) quote = '';
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (depth === 0 && separator.test(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const SELECTOR_TOKEN =
  /\[\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]+))\s*(i)?\s*)?\]|#([\w-]+)|\.([\w-]+)|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|^([a-zA-Z][\w-]*|\*)/g;

function parseCompound(selector: string): CompoundSelector | undefined {
  const last = splitTopLevel(selector, /[\s>+~]/).at(-1);
  if (!last) return;
  const compound: CompoundSelector = { ids: [], classes: [], attributes: [] };
  for (const [, name, operator, double, single, bare, insensitive, id, className, tag] of last.matchAll(SELECTOR_TOKEN)) {
    if (name) {
      const value = double ?? single ?? bare;
      compound.attributes.push({
        name: name.toLowerCase(),
        ...(operator ? { operator } : {}),
        ...(value === undefined ? {} : { value }),
        insensitive: Boolean(insensitive),
      });
    } else if (id) compound.ids.push(id);
    else if (className) compound.classes.push(className);
    else if (tag && tag !== '*') compound.tag = tag.toLowerCase();
  }
  return compound;
}

/** Every comma-separated selector in `selectors`, as compounds; unparseable ones are left out. */
export function compileMaskSelectors(selectors: readonly string[]): CompoundSelector[] {
  return selectors.flatMap((list) => splitTopLevel(list, /,/)).flatMap((selector) => parseCompound(selector) ?? []);
}

function attributeMatches(actual: string, rule: CompoundSelector['attributes'][number]): boolean {
  const { operator, value: expected } = rule;
  if (!operator || expected === undefined) return true;
  const [a, e] = rule.insensitive ? [actual.toLowerCase(), expected.toLowerCase()] : [actual, expected];
  switch (operator) {
    case '=':
      return a === e;
    case '~=':
      return a.split(/\s+/).includes(e);
    case '|=':
      return a === e || a.startsWith(`${e}-`);
    case '^=':
      return Boolean(e) && a.startsWith(e);
    case '$=':
      return Boolean(e) && a.endsWith(e);
    default:
      return Boolean(e) && a.includes(e);
  }
}

export function compoundMatches(node: SelectorNode, compound: CompoundSelector): boolean {
  const attributes = node.attributes ?? {};
  const text = (name: string): string | undefined => {
    const value = attributes[name];
    return typeof value === 'string' ? value : undefined;
  };
  if (compound.tag && (typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '') !== compound.tag) return false;
  if (compound.ids.some((id) => text('id') !== id)) return false;
  const classes = (text('class') ?? '').split(/\s+/);
  if (compound.classes.some((name) => !classes.includes(name))) return false;
  return compound.attributes.every((rule) => {
    const value = attributes[rule.name];
    if (value === undefined || value === null || value === false) return false;
    return attributeMatches(typeof value === 'string' ? value : JSON.stringify(value), rule);
  });
}
