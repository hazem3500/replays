import { createContext } from 'react';

/** The Network search's words (request-label.ts searchWords): request labels keep and mark what matched. Empty outside a search. */
export const LabelSearch = createContext<readonly string[]>([]);
