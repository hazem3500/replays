// why: the lazy entry for code that must not pull ajv in up front; a direct dynamic import of context-schema.ts becomes an empty facade chunk because the server already bundles that module.
import { compileContextSchema, loadContextSchema, type ContextSchema } from './context-schema.ts';

export function compileSchema(schema: unknown): ContextSchema {
  return compileContextSchema(schema);
}

export function loadSchema(file: string): Promise<ContextSchema> {
  return loadContextSchema(file);
}
