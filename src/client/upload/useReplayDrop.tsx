import { SurfaceMotion } from '@/components/ui/surface-motion.tsx';
import { UploadIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

function carriesFiles(event: DragEvent) {
  return Boolean(event.dataTransfer?.types.includes('Files'));
}

/**
 * Whole-window drag-and-drop for replay files. Returns the overlay to render (anywhere; it is
 * fixed to the viewport) and calls `onFile` with the first dropped file. Text and link drags
 * are ignored, and the browser never navigates to a dropped file.
 */
export function useReplayDrop(onFile: (file: File) => void, { enabled = true }: { enabled?: boolean } = {}): ReactNode {
  const [dragging, setDragging] = useState(false);
  const callback = useRef(onFile);
  useEffect(() => {
    callback.current = onFile;
  }, [onFile]);

  useEffect(() => {
    if (!enabled) return;
    // dragenter/dragleave fire for every child crossed; count them to know when the drag left the window.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) callback.current(file);
    };
    const end = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', end);
    window.addEventListener('blur', end);
    // Capture phase: a drop zone that stops propagation still clears the overlay.
    window.addEventListener('drop', end, true);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', end);
      window.removeEventListener('blur', end);
      window.removeEventListener('drop', end, true);
    };
  }, [enabled]);

  return (
    <SurfaceMotion
      open={dragging}
      kind="backdrop"
      className="upload-drop-overlay"
      data-active={dragging || undefined}
      aria-hidden={!dragging}
      data-testid="upload-drop-overlay"
    >
      <SurfaceMotion open={dragging} kind="modal" className="upload-drop-message">
        <UploadIcon aria-hidden="true" />
        <p>Drop a replay.json or rrweb export</p>
        <span>.json or .json.gz, up to 25 MB</span>
      </SurfaceMotion>
    </SurfaceMotion>
  );
}
