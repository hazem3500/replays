import { assertReplayEdits, type ReplayEdits } from '../../shared/edits.ts';
import type { EditorToolContext, EditorToolDefinition } from './contributions.ts';

/** Copies prevent a tool's in-place mutation from corrupting undo history. */
export function runEditorTool(definition: EditorToolDefinition, context: EditorToolContext): ReplayEdits | undefined {
  const result = definition.run({ ...context, edits: structuredClone(context.edits) });
  if (result === undefined) return undefined;
  assertReplayEdits(result, context.duration);
  return result;
}
