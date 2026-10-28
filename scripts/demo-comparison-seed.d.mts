import type { ReviewSuite } from '../src/shared/review-suite.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

export function createComparisonSeed(): { replays: ReplayBundle[]; suites: ReviewSuite[] };
export function writeComparisonSeed(outputDir?: string): Promise<{ output: string; replays: number; suites: number }>;
