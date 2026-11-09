import type { ReactNode } from 'react';

const BULLET = /^\s*[-*]\s+(.*)$/;

type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

/** Blank lines split paragraphs; consecutive `- ` or `* ` lines make one list. Nothing else is interpreted. */
export function summaryBlocks(summary: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const line of summary.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line)?.[1]?.trim();
    if (bullet !== undefined) {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === 'ul') last.items.push(bullet);
      else blocks.push({ kind: 'ul', items: [bullet] });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** A suite's or run's `summary` as text: paragraphs and bullet lists, never HTML. */
export function SummaryText({ summary, className }: { summary: string; className?: string }): ReactNode {
  const seen = new Map<string, number>();
  const keyFor = (text: string) => {
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return `${text}#${count}`;
  };
  return (
    <div className={className ? `summary-text ${className}` : 'summary-text'} data-testid="summary-text">
      {summaryBlocks(summary).map((block) =>
        block.kind === 'p' ? (
          <p key={keyFor(block.text)}>{block.text}</p>
        ) : (
          <ul key={keyFor(block.items.join('\n'))}>
            {block.items.map((item) => (
              <li key={keyFor(item)}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
