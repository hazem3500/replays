import { useEffect, useMemo, useRef, useState } from 'react';
import { createRecorder, gzip, type IssueReport, type IssueReportReceipt, type Recorder } from '../src/recorder/index.ts';
import { createDefaultUi } from '../src/recorder/ui/index.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';
import { Viewer } from '../src/client/Viewer.tsx';
import { CheckCircle2Icon } from 'lucide-react';
import { RecorderHost } from './fixtures/recorder-host.tsx';

export interface PlaygroundArgs {
  uploadMode: 'mock' | 'server';
  serverUrl: string;
  consent: boolean;
  review: boolean;
  privacy: 'masked' | 'visible';
  theme: 'dark' | 'light';
  maxDuration: number;
}
export interface CapturedUpload {
  report: IssueReport;
  compressed: ArrayBuffer;
  receipt: IssueReportReceipt;
}
const uploads = new WeakMap<HTMLElement, CapturedUpload>();
export const recordedUpload = (root: HTMLElement) => uploads.get(root);

export function RecorderPlayground({ uploadMode, serverUrl, consent, review, privacy, theme, maxDuration }: PlaygroundArgs) {
  const root = useRef<HTMLDivElement>(null);
  const recorder = useRef<Recorder | undefined>(undefined);
  const [status, setStatus] = useState('idle');
  const [receipt, setReceipt] = useState<CapturedUpload>();
  const [problem, setProblem] = useState('');
  const [requestStatus, setRequestStatus] = useState('No request sent');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    const ui = createDefaultUi({ theme, privacyMode: privacy, completion: { actions: [] } });
    const controller = createRecorder({
      ui,
      prompts: { consent, review },
      maxDurationMs: maxDuration,
      privacy: { sanitize: privacy === 'masked' },
      app: { name: 'Pinecone Goods Demo', environment: 'local' },
      title: 'Storybook recorder playground',
      // Deliberately omit loadRrweb: exercise the production dynamic import and real rrweb observer.
      upload: async (report, { signal }) => {
        const compressed = await gzip(JSON.stringify(report.bundle));
        if (!compressed) throw new Error('This browser needs CompressionStream for the gzip playground.');
        let result: IssueReportReceipt = {
          replayId: report.bundle.meta.id,
          reference: 'STORYBOOK-LOCAL',
        };
        if (uploadMode === 'server') {
          const api = new URL(serverUrl.replace(/\/$/, '') + '/', location.href);
          const response = await fetch(new URL('replays', api), {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
            body: compressed,
          });
          if (!response.ok) throw new Error(`Upload failed (${response.status}). Check server access and the proxy.`);
          const body = (await response.json()) as { id?: string };
          if (!body.id || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.id)) throw new Error('Server did not return a replay id');
          const replayUrl = new URL(`../r/${encodeURIComponent(body.id)}`, api);
          result = { replayId: body.id, url: replayUrl.href };
        }
        const captured = { report, compressed, receipt: result };
        if (live && root.current) {
          uploads.set(root.current, captured);
          setReceipt(captured);
        }
        return result;
      },
    });
    recorder.current = controller;
    const unsubscribe = controller.subscribe((state) => {
      if (live) setStatus(state.status);
    });
    return () => {
      live = false;
      unsubscribe();
      controller.destroy();
      ui.dismiss?.();
      recorder.current = undefined;
    };
  }, [uploadMode, serverUrl, consent, review, privacy, theme, maxDuration]);
  const begin = () => {
    setReceipt(undefined);
    setProblem('');
    void recorder.current
      ?.request({ source: 'user' })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'Recorder failed'));
  };
  const captured = useMemo(() => (receipt ? structuredClone(receipt.report.bundle) : undefined), [receipt]);
  if (captured) assertReplayBundle(captured);
  return (
    <div ref={root} data-playground-root>
      <RecorderHost
        status={status}
        uploadMode={uploadMode}
        recordAction={begin}
        saved={saved}
        problem={problem}
        requestStatus={requestStatus}
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
        onError={() => {
          console.error('STORYBOOK_CHECKOUT_ERROR: checkout validation failed');
          setProblem('Checkout validation failed. Try again.');
        }}
        onRequest={() => {
          setRequestStatus('Request pending');
          void fetch('/api/storybook-checkout-failure').then(
            (response) => setRequestStatus(response.ok ? 'Unexpected success' : `Request failed (${response.status})`),
            () => setRequestStatus('Request failed (network)'),
          );
        }}
      />
      {receipt && (
        <div role="group" className="demo-receipt" data-recorder-block data-testid="recording-receipt" aria-label="Upload receipt">
          <div className="demo-receipt-card">
            <h2>
              <CheckCircle2Icon size={18} style={{ color: 'var(--success)' }} />
              Recording received
            </h2>
            <p>Reference: {receipt.receipt.reference ?? receipt.receipt.replayId}</p>
            <div className="demo-receipt-stats">
              <span data-testid="event-count">{captured?.events.length} recorded events</span>
              <span>{receipt.compressed.byteLength} gzip bytes</span>
              <span>{captured?.console.filter((entry) => entry.level === 'error').length} console errors</span>
              <span>{captured?.network.filter((entry) => entry.status === 0 || entry.status >= 400).length} failed requests</span>
            </div>
            {receipt.report.note && <p>{receipt.report.note}</p>}
            {receipt.receipt.url && (
              <a href={receipt.receipt.url} target="_blank" rel="noreferrer">
                Open created replay ↗
              </a>
            )}
          </div>
          {uploadMode === 'mock' && captured && (
            <div className="demo-playback">
              <Viewer bundle={captured} skipLink={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
