import type { MigrateInfo } from '../../src/server/migrate.ts';

export function translateSource(source: unknown): unknown;
export function translateContext(context: unknown): unknown;
export default function translate(raw: unknown, info: MigrateInfo): unknown;
export function translateSuite(raw: unknown, info?: MigrateInfo): unknown;
