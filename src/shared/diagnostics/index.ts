/** Replay diagnosis: what went wrong, and why. Pure functions on bundle data, shared by the viewer, CLI and MCP bridge. */
export { byImportance, detectIssues, groupInteractions, ms, type Interaction } from './detect.ts';
export { headline, headlineParts, type HeadlinePart } from './headline.ts';
export type { DetectOptions, EvidenceRef, Issue, IssueKind, IssueLayer, IssueLink, IssueLinkRole, IssueSeverity } from './types.ts';
export * from './budgets.ts';
