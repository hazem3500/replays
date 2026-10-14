import { readFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';

// ajv-formats is CommonJS with a default export; under NodeNext the namespace import carries it as `.default`.
const addFormats = (formatsModule as unknown as { default: (ajv: Ajv2020) => void }).default;

/**
 * The optional JSON Schema for `context.fields` (CONTEXT_SCHEMA_FILE). Uploads whose fields do not match it are
 * refused with the validator's message; the viewer renders the fields using the schema's `title`s, property order,
 * `description`s and `format: "uri"` hints.
 */
export interface ContextSchema {
  schema: Record<string, unknown>;
  /** Returns an error message, or undefined when `fields` is valid. */
  validate(fields: unknown): string | undefined;
}

export function compileContextSchema(schema: unknown): ContextSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('the context schema must be a JSON Schema object');
  if ((schema as { type?: unknown }).type !== 'object') throw new Error('the context schema must describe an object ("type": "object")');
  const ajv = new Ajv2020({ allErrors: false, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return {
    schema: schema as Record<string, unknown>,
    validate(fields) {
      if (validate(fields)) return undefined;
      const error = validate.errors?.[0];
      return `context.fields${error?.instancePath ? error.instancePath.replaceAll('/', '.') : ''} ${error?.message ?? 'is invalid'}`;
    },
  };
}

export async function loadContextSchema(file: string): Promise<ContextSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read CONTEXT_SCHEMA_FILE ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return compileContextSchema(parsed);
}
