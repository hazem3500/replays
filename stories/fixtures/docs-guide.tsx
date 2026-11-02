import { Fragment } from 'react';

export function DocsHero({ eyebrow, title, description }: { eyebrow: string; title: string[]; description: string }) {
  return (
    <header className="sb-docs-hero">
      <span className="sb-docs-eyebrow">{eyebrow}</span>
      <h1>
        {title.map((line, index) => (
          <Fragment key={line}>
            {index > 0 && <br />}
            {line}
          </Fragment>
        ))}
      </h1>
      <p>{description}</p>
    </header>
  );
}
export function DocsCards({ cards }: { cards: Array<{ eyebrow: string; title: string; description: string }> }) {
  return (
    <div className="sb-docs-nav">
      {cards.map((card) => (
        <article key={card.title}>
          <span>{card.eyebrow}</span>
          <h3>{card.title}</h3>
          <p>{card.description}</p>
        </article>
      ))}
    </div>
  );
}
