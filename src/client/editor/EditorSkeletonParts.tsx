import { DownloadIcon, Redo2Icon, Undo2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';

/** The top bar's editing actions, drawn where the editor puts them and disabled until it arrives. */
export function TopbarActionsSkeleton() {
  return (
    <>
      <div className="editor-history" aria-hidden="true">
        <Button variant="ghost" size="icon" disabled tabIndex={-1}>
          <Undo2Icon aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" disabled tabIndex={-1}>
          <Redo2Icon aria-hidden="true" />
        </Button>
      </div>
      <Button size="sm" className="editor-export" disabled tabIndex={-1} aria-hidden="true">
        <DownloadIcon aria-hidden="true" /> Export
      </Button>
    </>
  );
}
