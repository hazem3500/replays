import { RRWEB_EVENT, type ReplayRrwebEvent } from './bundle-types.ts';
import { REDACTED, maskText, redactUrl } from './redact.ts';

/**
 * Attribute passes over rrweb events. rrweb copies every element attribute as
 * is (its text masking only covers text nodes), so the recorder masks
 * text-bearing attributes and redacts URL attributes itself, in the full
 * snapshot and in mutations.
 */

/** Rrweb-snapshot `NodeType.Element`. */
const ELEMENT_NODE = 2;
/** Rrweb `IncrementalSource.Mutation`. */
const MUTATION_SOURCE = 0;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Attributes that hold a URL. Redacted, never masked (the replay needs them). */
const URL_ATTRIBUTES = new Set(['action', 'background', 'cite', 'formaction', 'href', 'longdesc', 'ping', 'poster', 'src', 'xlink:href']);
const NON_HTTP_SCHEME = /^\s*(mailto|tel|sms):/i;

/**
 * Attributes that never carry customer text and that the replay needs to
 * render: layout, state the CSS selects on, ARIA states and id references.
 * Every other HTML attribute (`title`, `aria-label`, `placeholder`, `alt`,
 * `value`, `content`, `data-*`…) is masked like the element's text.
 */
const SAFE_ATTRIBUTES = new Set([
  'align',
  'autocomplete',
  'charset',
  'checked',
  'class',
  'colspan',
  'cols',
  'contenteditable',
  'crossorigin',
  'decoding',
  'dir',
  'disabled',
  'draggable',
  'enctype',
  'for',
  'height',
  'hidden',
  'http-equiv',
  'id',
  'inputmode',
  'lang',
  'loading',
  'max',
  'maxlength',
  'media',
  'method',
  'min',
  'minlength',
  'multiple',
  'name',
  'open',
  'readonly',
  'rel',
  'required',
  'reversed',
  'role',
  'rows',
  'rowspan',
  'selected',
  'size',
  'sizes',
  'span',
  'spellcheck',
  'start',
  'step',
  'style',
  'tabindex',
  'target',
  'type',
  'valign',
  'width',
  'xmlns',
  'xmlns:xlink',
  // ARIA states and id references, not labels.
  'aria-activedescendant',
  'aria-atomic',
  'aria-autocomplete',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colspan',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-disabled',
  'aria-expanded',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-labelledby',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-owns',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  // State attributes Radix (and the design system) style on.
  'data-align',
  'data-active',
  'data-checked',
  'data-disabled',
  'data-highlighted',
  'data-orientation',
  'data-selected',
  'data-side',
  'data-size',
  'data-state',
  'data-swipe',
  'data-variant',
]);

/** Text-bearing attributes that are masked on SVG elements too. */
const SVG_TEXT_ATTRIBUTES = new Set(['alt', 'content', 'label', 'title']);

type Attributes = Record<string, unknown>;

type SerializedNode = {
  type?: number;
  id?: number;
  tagName?: string;
  isSVG?: boolean;
  attributes?: Attributes;
  childNodes?: SerializedNode[];
};

type AttributeContext = { id: number | undefined; isSVG: boolean | undefined; secretInput?: boolean };

type Transform = (name: string, value: string, context: AttributeContext) => string;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function transformAttributes(attributes: Attributes, context: AttributeContext, transform: Transform): Attributes {
  let changed = false;
  const result: Attributes = {};
  for (const [name, value] of Object.entries(attributes)) {
    const next = typeof value === 'string' ? transform(name.toLowerCase(), value, context) : value;
    if (next !== value) changed = true;
    result[name] = next;
  }
  return changed ? result : attributes;
}

function transformNode(node: SerializedNode, transform: Transform): SerializedNode {
  let next = node;
  if (node.type === ELEMENT_NODE && isObject(node.attributes)) {
    const attributes = transformAttributes(
      node.attributes,
      {
        id: node.id,
        isSVG: node.isSVG === true,
        secretInput: node.tagName?.toLowerCase() === 'input' && /^(password|hidden)$/i.test(String(node.attributes.type ?? '')),
      },
      transform,
    );
    if (attributes !== node.attributes) next = { ...next, attributes };
  }
  const children = node.childNodes;
  if (Array.isArray(children) && children.length) {
    const mapped = children.map((child) => transformNode(child, transform));
    if (mapped.some((child, index) => child !== children[index])) next = { ...next, childNodes: mapped };
  }
  return next;
}

/**
 * Applies `transform` to every string attribute of a full snapshot or a
 * mutation (added nodes and attribute changes). Returns the event itself when
 * nothing changed, and never mutates it.
 */
function transformEventAttributes(event: ReplayRrwebEvent, transform: Transform): ReplayRrwebEvent {
  const data = event.data;
  if (!isObject(data)) return event;

  if (event.type === RRWEB_EVENT.FullSnapshot && isObject(data.node)) {
    const node = transformNode(data.node, transform);
    return node === data.node ? event : { ...event, data: { ...data, node } };
  }

  if (event.type !== RRWEB_EVENT.Incremental || data.source !== MUTATION_SOURCE) {
    return event;
  }
  let next = data;
  if (Array.isArray(data.adds)) {
    const adds = data.adds as unknown[];
    const mapped = adds.map((add) => {
      if (!isObject(add) || !isObject(add.node)) return add;
      const node = transformNode(add.node, transform);
      return node === add.node ? add : { ...add, node };
    });
    if (mapped.some((add, index) => add !== adds[index])) next = { ...next, adds: mapped };
  }
  if (Array.isArray(data.attributes)) {
    const changes = data.attributes as unknown[];
    const mapped = changes.map((change) => {
      if (!isObject(change) || !isObject(change.attributes)) return change;
      const attributes = transformAttributes(
        change.attributes,
        {
          id: typeof change.id === 'number' ? change.id : undefined,
          isSVG: undefined,
          secretInput: /^(password|hidden)$/i.test(String(change.attributes.type ?? '')),
        },
        transform,
      );
      return attributes === change.attributes ? change : { ...change, attributes };
    });
    if (mapped.some((change, index) => change !== changes[index])) next = { ...next, attributes: mapped };
  }
  return next === data ? event : { ...event, data: next };
}

function redactSrcset(value: string) {
  const candidates = value.split(',').map((candidate) => {
    const [url = '', ...descriptors] = candidate.trim().split(/\s+/);
    return { url, redacted: redactUrl(url), descriptors };
  });
  if (candidates.every(({ url, redacted }) => url === redacted)) return value;
  return candidates.map(({ redacted, descriptors }) => [redacted, ...descriptors].join(' ')).join(', ');
}

/**
 * Redacts a URL attribute: credentials and sensitive parameters (`redactUrl`),
 * and the address of a `mailto:`, `tel:` or `sms:` link. Other attributes are
 * returned unchanged.
 */
export function redactAttributeUrl(name: string, value: string): string {
  if (name === 'srcset') return redactSrcset(value);
  if (!URL_ATTRIBUTES.has(name)) return value;
  const scheme = NON_HTTP_SCHEME.exec(value);
  if (scheme) return `${scheme[1]!.toLowerCase()}:${REDACTED}`;
  return redactUrl(value);
}

/**
 * Redacts the URLs inside an rrweb event: the page `href` of a Meta event and
 * every URL attribute in snapshots and mutations.
 */
export function redactEventUrls(event: ReplayRrwebEvent): ReplayRrwebEvent {
  let next = transformEventAttributes(event, (name, value) => redactAttributeUrl(name, value));
  const data = next.data;
  if (next.type === RRWEB_EVENT.Meta && isObject(data) && typeof data.href === 'string') {
    const href = redactUrl(data.href);
    if (href !== data.href) next = { ...next, data: { ...data, href } };
  }
  return next;
}

/** Whether an attribute can carry customer text and must follow text masking. */
export function isTextAttribute(name: string, isSVG: boolean, allowed: ReadonlySet<string> = new Set()): boolean {
  // rrweb's own attributes: element sizes, inlined stylesheets.
  if (name.startsWith('rr_') || name.startsWith('_')) return false;
  if (URL_ATTRIBUTES.has(name) || name === 'srcset') return false;
  if (SAFE_ATTRIBUTES.has(name) || allowed.has(name)) return false;
  // SVG presentation attributes (`d`, `fill`, `viewBox`…) carry no text.
  if (isSVG) return name.startsWith('aria-') || name.startsWith('data-') || SVG_TEXT_ATTRIBUTES.has(name);
  return true;
}

export type AttributeMaskerOptions = {
  /** The live element of a serialized node id (rrweb's mirror). */
  element: (id: number) => Element | undefined;
  /**
   * Whether the text of `element` is masked. Called with `undefined` when the
   * element is unknown; the answer should then fail closed.
   */
  textMasked: (element: Element | undefined) => boolean;
  /** Extra attribute names that are never masked. */
  allowed?: readonly string[];
  /** False preserves ordinary page/input attributes; secret inputs stay masked. */
  sanitize?: boolean;
};

/**
 * Returns a pass that masks the text-bearing attributes of every element whose
 * text is masked, with the same mask as text (`maskText`).
 */
export function createAttributeMasker(options: AttributeMaskerOptions): (event: ReplayRrwebEvent) => ReplayRrwebEvent {
  const allowed = new Set(options.allowed?.map((name) => name.toLowerCase()));
  const secretInputs = new Set<number>();
  const isSecret = (id: number | undefined, element: Element | undefined, serialized = false) => {
    const secret = serialized || (element?.matches('input[type="password"], input[type="hidden"]') ?? false);
    if (secret && id !== undefined) secretInputs.add(id);
    return secret || (id !== undefined && secretInputs.has(id));
  };
  return (event) => {
    // rrweb input events carry a separate text field outside node attributes.
    const data = event.data;
    if (
      event.type === RRWEB_EVENT.Incremental &&
      isObject(data) &&
      data.source === 5 &&
      typeof data.id === 'number' &&
      typeof data.text === 'string'
    ) {
      const element = options.element(data.id);
      if (options.sanitize !== false || isSecret(data.id, element)) return { ...event, data: { ...data, text: maskText(data.text) } };
    }
    return transformEventAttributes(event, (name, value, context) => {
      if (!value) return value;
      const element = context.id === undefined ? undefined : options.element(context.id);
      const secret = isSecret(context.id, element, context.secretInput);
      if (secret && name === 'value') return maskText(value);
      if (options.sanitize === false) return value;
      const isSVG = context.isSVG ?? element?.namespaceURI === SVG_NAMESPACE;
      // rrweb input values must stay masked even inside unmasked text regions.
      if (name === 'value' && element?.matches('input, textarea, select')) return maskText(value);
      if (!isTextAttribute(name, isSVG, allowed)) return value;
      return options.textMasked(element) ? maskText(value) : value;
    });
  };
}
