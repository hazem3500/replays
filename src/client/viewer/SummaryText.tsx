import type { ReactNode } from 'react';

import {
  type Block,
  type Inline,
  type ListBlock,
  type ResultLine,
  leadLabel,
  parseInline,
  parseResult,
  summaryBlocks,
} from './summary-markdown.ts';

function keyer() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return `${text}#${count}`;
  };
}

function InlineNode({ node }: { node: Inline }) {
  if (node.kind === 'text') return node.text;
  if (node.kind === 'code') return <code>{node.text}</code>;
  if (node.kind === 'strong') return <strong>{renderInline(node.children)}</strong>;
  if (node.kind === 'em') return <em>{renderInline(node.children)}</em>;
  // why: only http(s) links reach here (the parser refuses other schemes); the full address stays in the title.
  return (
    <a href={node.href} title={node.href} target="_blank" rel="noreferrer noopener">
      {node.label}
    </a>
  );
}

function renderInline(nodes: Inline[]): ReactNode {
  const key = keyer();
  return nodes.map((node) => <InlineNode key={key(node.kind === 'link' ? node.href : node.kind)} node={node} />);
}

/** Inline Markdown (code, bold, italic, links, bare URLs) of one line of text. */
function InlineText({ text }: { text: string }): ReactNode {
  return renderInline(parseInline(text));
}

/** A `Result:` status as a colored badge with its qualifier as a small muted tag. */
function ResultBadge({ result }: { result: ResultLine }): ReactNode {
  return (
    <span className="summary-result">
      <span className="summary-result-status" data-tone={result.tone}>
        {result.status}
      </span>
      {result.qualifier ? <span className="summary-result-tag">{result.qualifier}</span> : null}
    </span>
  );
}

function Line({ text }: { text: string }) {
  const result = parseResult(text);
  if (result) {
    return (
      <>
        <ResultBadge result={result} /> {result.rest ? <InlineText text={result.rest} /> : null}
      </>
    );
  }
  const lead = leadLabel(text);
  return lead ? (
    <>
      <strong>{lead.label}:</strong> <InlineText text={lead.rest} />
    </>
  ) : (
    <InlineText text={text} />
  );
}

function List({ list }: { list: ListBlock }) {
  const key = keyer();
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {list.items.map((item) => (
        <li key={key(item.text)}>
          <Line text={item.text} />
          {item.children ? <List list={item.children} /> : null}
        </li>
      ))}
    </Tag>
  );
}

function blockKey(block: Block): string {
  return block.kind === 'list' ? `list:${block.items.map((item) => item.text).join('\n')}` : `${block.kind}:${block.text}`;
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'list') return <List list={block} />;
  if (block.kind === 'code') {
    // why: a long line scrolls inside the block, so it can be focused and read by keyboard.
    return (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- why: keyboard users need to scroll long code lines.
      <pre tabIndex={0}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === 'quote') {
    return (
      <blockquote>
        <InlineText text={block.text} />
      </blockquote>
    );
  }
  if (block.kind === 'heading') {
    const Tag = block.level === 2 ? 'h3' : 'h4';
    return (
      <Tag className="summary-heading">
        <InlineText text={block.text} />
      </Tag>
    );
  }
  return (
    <p>
      <Line text={block.text} />
    </p>
  );
}

/** Already-parsed summary blocks, drawn as React elements; nothing here ever becomes HTML. */
function SummaryBlocks({ blocks, className }: { blocks: Block[]; className?: string }): ReactNode {
  const key = keyer();
  return (
    <div className={className ? `summary-text ${className}` : 'summary-text'} data-testid="summary-text">
      {blocks.map((block) => (
        <BlockView key={key(blockKey(block))} block={block} />
      ))}
    </div>
  );
}

/** A suite's or run's `summary` as rich text: a Markdown subset (see docs/extension-api.md), never HTML. */
export function SummaryText({ summary, className }: { summary: string; className?: string }): ReactNode {
  return <SummaryBlocks blocks={summaryBlocks(summary)} {...(className ? { className } : {})} />;
}
