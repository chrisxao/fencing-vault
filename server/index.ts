// Upload/playback URL server.
//
// Targets any S3-compatible object storage (Railway object storage / MinIO,
// AWS S3, R2, ...). Complete bucket configuration is required at startup.
import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { registerAuthRoutes } from './auth-routes.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

interface StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const REQUIRED_STORAGE_VARIABLES = [
  ['endpoint', 'AWS_ENDPOINT_URL', 'S3_ENDPOINT'],
  ['bucket', 'AWS_S3_BUCKET_NAME', 'S3_BUCKET'],
  ['region', 'AWS_DEFAULT_REGION', 'S3_REGION'],
  ['accessKeyId', 'AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID'],
  ['secretAccessKey', 'AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY'],
] as const satisfies ReadonlyArray<[keyof StorageConfig, string, string]>;

function requireCompleteStorageConfig(
  config: Partial<StorageConfig>,
): asserts config is StorageConfig {
  const missing = REQUIRED_STORAGE_VARIABLES.filter(([key]) => !config[key]).map(
    ([, primary, alias]) => `${primary} (or ${alias})`,
  );
  if (missing.length > 0) {
    throw new Error(`[storage] Missing required S3 configuration: ${missing.join(', ')}`);
  }
}

const PORT = Number(process.env.PORT ?? 8787);
const storageConfig: Partial<StorageConfig> = {
  endpoint: firstEnv('AWS_ENDPOINT_URL', 'S3_ENDPOINT'),
  bucket: firstEnv('AWS_S3_BUCKET_NAME', 'S3_BUCKET'),
  region: firstEnv('AWS_DEFAULT_REGION', 'S3_REGION'),
  accessKeyId: firstEnv('AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID'),
  secretAccessKey: firstEnv('AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY'),
};
requireCompleteStorageConfig(storageConfig);

const FORCE_PATH_STYLE = /^(1|true|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE?.trim() ?? '');

const s3 = new S3Client({
  endpoint: storageConfig.endpoint,
  region: storageConfig.region,
  credentials: {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  },
  // Railway's current buckets use virtual-hosted addressing. MinIO and
  // other providers that require path-style URLs can opt in explicitly.
  forcePathStyle: FORCE_PATH_STYLE,
});

const app = express();
app.use(cors());
app.use(express.json());

registerAuthRoutes(app);

function sanitizeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(-80) || 'video.mp4';
}

/** Keys look like "<uuid>__<filename>"; reject anything else (path traversal). */
function isValidKey(key: string): boolean {
  return /^[a-f0-9-]{36}__[a-zA-Z0-9._-]+$/.test(key);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: 's3' });
});

app.post('/api/presign-upload', async (req, res) => {
  const { fileName, contentType } = req.body ?? {};
  if (typeof fileName !== 'string') {
    res.status(400).json({ error: 'fileName is required' });
    return;
  }
  const key = `${crypto.randomUUID()}__${sanitizeName(fileName)}`;

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
        ContentType: typeof contentType === 'string' ? contentType : 'video/mp4',
      }),
      { expiresIn: 60 * 60 }, // 1 hour to complete the upload
    );
    res.json({ key, uploadUrl, storage: 's3' });
  } catch (err) {
    console.error('presign failed', err);
    res.status(500).json({ error: 'Failed to create upload URL' });
  }
});

app.get('/api/playback-url', async (req, res) => {
  const key = String(req.query.key ?? '');
  if (!isValidKey(key)) {
    res.status(400).json({ error: 'Invalid key' });
    return;
  }
  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: storageConfig.bucket, Key: key }),
      { expiresIn: 60 * 60 * 6 }, // 6 hours of playback
    );
    res.json({ url });
  } catch (err) {
    console.error('playback-url failed', err);
    res.status(500).json({ error: 'Failed to create playback URL' });
  }
});

// Keep API misses as JSON instead of letting the SPA fallback return index.html.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Railway runs this same Express process for both the API and the built web app.
// Development keeps using Vite and its /api proxy, so static serving is production-only.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_DIR));
  app.get('/{*path}', (_req, res, next) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  console.log(
    `[api] storage: S3-compatible (${FORCE_PATH_STYLE ? 'path-style' : 'virtual-hosted style'})`,
  );
});
