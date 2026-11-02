/** Keeps a title's text in one stable, accessible host; the topbar owns its whole-label transition. */
export function TitleMorph({ text }: { text: string }) {
  return <span data-title-morph="">{text}</span>;
}
