import { useEffect } from 'react';

/** The tab's title while the calling page shows (`undefined` leaves it as it is). */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title !== undefined) document.title = title;
  }, [title]);
}
