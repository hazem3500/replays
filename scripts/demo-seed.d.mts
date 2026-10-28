import type { ReviewSuite } from '../src/shared/review-suite.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

export interface DemoSeedResult {
  output: string;
  results: Array<['created' | 'unchanged', string]>;
  replays: number;
  suites: number;
}

export interface DemoRefreshResult {
  sampleDir: string;
  dataDir: string;
  updated: string[];
}

export function createDemoSeed(): { replays: ReplayBundle[]; suites: ReviewSuite[] };
export function writeDemoSeed(outputDir?: string): Promise<DemoSeedResult>;
export function refreshDemoSeed(sampleDir: string, dataDir: string): Promise<DemoRefreshResult>;
export function writeStable(path: string, value: unknown): Promise<'created' | 'unchanged'>;
