import type { ReplayRrwebEvent } from '../bundle-types.ts';
import type { RrwebModule } from '../types.ts';
import type { IssueReport, IssueReportUpload } from '../upload.ts';
export function createFakeRrweb() {
  let send: ((event: ReplayRrwebEvent) => void) | undefined;
  let loads = 0;
  let stopped = 0;
  const module: RrwebModule = {
    record(options) {
      send = options.emit as typeof send;
      send?.({ type: 4, timestamp: Date.now(), data: { href: 'https://example.test', width: 800, height: 600 } });
      send?.({ type: 2, timestamp: Date.now(), data: { node: { type: 0, id: 1, childNodes: [] } } });
      return () => {
        stopped++;
        send = undefined;
      };
    },
  };
  return {
    module,
    load: async () => {
      loads++;
      return module;
    },
    emit: (event: ReplayRrwebEvent) => send?.(event),
    get loads() {
      return loads;
    },
    get stopped() {
      return stopped;
    },
  };
}
export function createFakeTransport() {
  const reports: IssueReport[] = [];
  const upload: IssueReportUpload = async (report, context) => {
    if (context.signal.aborted) throw new Error('Aborted');
    reports.push(report);
    context.onProgress?.({ loaded: 40, total: 100 });
    return { replayId: 'test-recording', reference: 'TEST' };
  };
  return { upload, reports };
}
