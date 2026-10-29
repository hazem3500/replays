import { DemoShop } from './DemoShop.tsx';
import { RecorderInspector } from './RecorderInspector.tsx';
import { useRecorderSession, useUploads } from './hooks/use-recorder-session.ts';
import type { SessionOptions } from './session.ts';
import type { UploadEndpoint } from './upload-endpoint.ts';

export type WorkbenchProps = SessionOptions & { endpoint: UploadEndpoint };

/** The real recorder on a demo page, next to an inspector of its state and of the mocked endpoint. */
export function RecorderWorkbench({ endpoint, ...options }: WorkbenchProps) {
  const { recorder, state, timeline } = useRecorderSession(options);
  const uploads = useUploads(endpoint);
  return (
    <div className="rec-workbench">
      <DemoShop reportDisabled={state.status !== 'idle'} onReport={() => void recorder.request({ source: 'user' })} />
      <RecorderInspector state={state} timeline={timeline} uploads={uploads} endpoint={endpoint} />
    </div>
  );
}
