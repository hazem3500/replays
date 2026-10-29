import type { RecorderState, RecorderStatus } from '../../src/recorder/index.ts';
import type { TimelineEntry } from './session.ts';
import { Button } from '../../src/client/components/ui/button.tsx';
import { Progress } from '../../src/client/components/ui/progress.tsx';
import { StatusLabel, type StatusTone } from '../../src/client/components/ui/status-label.tsx';
import type { EndpointMode, ReceivedUpload, UploadEndpoint } from './upload-endpoint.ts';

const TONE: Partial<Record<RecorderStatus, StatusTone>> = {
  recording: 'danger',
  uploading: 'accent',
  uploaded: 'success',
  error: 'warning',
};
const MODES: { mode: EndpointMode; label: string }[] = [
  { mode: 'accept', label: 'Accept' },
  { mode: 'hold', label: 'Hold' },
  { mode: 'unavailable', label: 'Return 503' },
];

function UploadProgress({ state }: { state: RecorderState }) {
  if (state.status !== 'uploading') return null;
  const fraction = state.progress?.fraction;
  if (fraction === undefined) return <p className="rec-muted">Sending. This transport does not report byte progress.</p>;
  return <Progress value={Math.round(fraction * 100)} aria-label="Upload progress" data-testid="upload-progress" />;
}

function Received({ upload }: { upload: ReceivedUpload }) {
  const { bundle, note } = upload.report;
  return (
    <li className="rec-upload">
      <strong>{bundle.meta.title}</strong>
      <span>
        {bundle.events.length} events, {upload.wireBytes.toLocaleString('en')} bytes {upload.contentEncoding ?? 'uncompressed'}
      </span>
      <span>
        {bundle.console.length} console entries, {bundle.network.length} requests
      </span>
      {note ? <span>Note: {note}</span> : null}
    </li>
  );
}

/** What a recorder author needs while iterating: live state, its history, progress and what the endpoint received. */
export function RecorderInspector({
  state,
  timeline,
  uploads,
  endpoint,
}: {
  state: RecorderState;
  timeline: readonly TimelineEntry[];
  uploads: readonly ReceivedUpload[];
  endpoint: UploadEndpoint;
}) {
  return (
    <aside className="rec-inspector" aria-label="Recorder inspector">
      <section className="sb-section">
        <h3>Recorder state</h3>
        <span data-testid="recorder-status">
          <StatusLabel tone={TONE[state.status] ?? 'neutral'}>{state.status}</StatusLabel>
        </span>
        <ol className="rec-timeline" aria-label="State history">
          {timeline.map(({ id, status }) => (
            <li key={id}>{status}</li>
          ))}
        </ol>
        <UploadProgress state={state} />
      </section>
      <section className="sb-section">
        <h3>Upload endpoint</h3>
        <div className="sb-row" role="group" aria-label="Next upload">
          {MODES.map(({ mode, label }) => (
            <Button key={mode} type="button" variant="outline" onClick={() => endpoint.setMode(mode)}>
              {label}
            </Button>
          ))}
          <Button type="button" variant="secondary" onClick={endpoint.release}>
            Release held upload
          </Button>
        </div>
        {uploads.length ? (
          <ul className="rec-uploads" aria-label="Received uploads">
            {uploads.map((upload) => (
              <Received key={upload.id} upload={upload} />
            ))}
          </ul>
        ) : (
          <p className="rec-muted">Nothing received yet.</p>
        )}
      </section>
    </aside>
  );
}
