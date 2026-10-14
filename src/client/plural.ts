/** "1 error", "2 errors", "1 entry", "3 entries": a count with its noun in the right number. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Just the noun for a count: "request" for 1, "requests" otherwise. */
export function nounFor(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}
