import type { ReplayRrwebEvent } from '../bundle-types.ts';
import type { RrwebModule } from '../types.ts';
import type { IssueReport, IssueReportUpload } from '../upload.ts';
type FakeRrweb = {
  module: RrwebModule;
  load: () => Promise<RrwebModule>;
  emit(event: ReplayRrwebEvent): void;
  readonly loads: number;
  readonly stopped: number;
};
function isEmitter(value: unknown): value is (event: ReplayRrwebEvent) => void {
  return typeof value === 'function';
}
export function createFakeRrweb(): FakeRrweb {
  let send: ((event: ReplayRrwebEvent) => void) | undefined;
  let loads = 0;
  let stopped = 0;
  const module: RrwebModule = {
    record(options) {
      if (!isEmitter(options.emit)) throw new Error('Fake rrweb requires an emitter');
      send = options.emit;
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
    load: (): Promise<RrwebModule> => {
      loads++;
      return Promise.resolve(module);
    },
    emit: (event: ReplayRrwebEvent): void => send?.(event),
    get loads(): number {
      return loads;
    },
    get stopped(): number {
      return stopped;
    },
  };
}
export function createFakeTransport(): { upload: IssueReportUpload; reports: IssueReport[] } {
  const reports: IssueReport[] = [];
  const upload: IssueReportUpload = (report, context) => {
    if (context.signal.aborted) return Promise.reject(new Error('Aborted'));
    reports.push(report);
    context.onProgress?.({ loaded: 40, total: 100 });
    return Promise.resolve({ replayId: 'test-recording', reference: 'TEST' });
  };
  return { upload, reports };
}
