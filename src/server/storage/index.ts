import { FsStorage } from './fs.ts';
import { S3Storage } from './s3.ts';
import type { ObjectStorage } from './types.ts';

export { FsStorage } from './fs.ts';
export { MemoryStorage } from './memory.ts';
export { S3Error, S3Storage, type S3Credentials, type S3StorageOptions } from './s3.ts';
export * from './types.ts';

/**
 * The driver the environment asks for: `STORAGE=fs` (the default: `dataDir`, i.e. DATA_DIR) or `STORAGE=s3`
 * (any S3-compatible bucket) with `S3_BUCKET` (required), `S3_REGION` (default us-east-1), `S3_ENDPOINT`,
 * `S3_FORCE_PATH_STYLE=1`, `S3_PREFIX` and credentials in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
 * `AWS_SESSION_TOKEN`.
 */
export async function storageFromEnv(env: NodeJS.ProcessEnv, dataDir: string): Promise<ObjectStorage> {
  const driver = (env.STORAGE ?? 'fs').trim().toLowerCase();
  if (driver === 'fs') return new FsStorage(dataDir);
  if (driver === 's3') {
    const bucket = env.S3_BUCKET?.trim();
    if (!bucket) throw new Error('STORAGE=s3 needs S3_BUCKET');
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) throw new Error('STORAGE=s3 needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    const sessionToken = env.AWS_SESSION_TOKEN?.trim();
    const forcePathStyle = ['1', 'true', 'yes'].includes((env.S3_FORCE_PATH_STYLE ?? '').trim().toLowerCase());
    return new S3Storage({
      bucket,
      region: env.S3_REGION?.trim() || 'us-east-1',
      ...(env.S3_ENDPOINT?.trim() ? { endpoint: env.S3_ENDPOINT.trim() } : {}),
      ...(env.S3_PREFIX?.trim() ? { prefix: env.S3_PREFIX.trim() } : {}),
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
    });
  }
  throw new Error(`STORAGE must be fs or s3, not ${JSON.stringify(env.STORAGE)}`);
}
