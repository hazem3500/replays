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
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === 'ul') last.items.push(bullet[1]!.trim());
      else blocks.push({ kind: 'ul', items: [bullet[1]!.trim()] });
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
  return (
    <div className={className ? `summary-text ${className}` : 'summary-text'} data-testid="summary-text">
      {summaryBlocks(summary).map((block, index) =>
        block.kind === 'p' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
