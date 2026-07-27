// Upload/playback URL server.
//
// Targets any S3-compatible object storage (Railway object storage / MinIO,
// AWS S3, R2, ...). When no bucket is configured it falls back to storing
// files on local disk under ./uploads so the app works out of the box in dev.
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const PORT = Number(process.env.PORT ?? 8787);
const BUCKET = process.env.S3_BUCKET;
const ENDPOINT = process.env.S3_ENDPOINT; // e.g. Railway/MinIO endpoint URL
const REGION = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'auto';
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

const useS3 = Boolean(BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);

const s3 = useS3
  ? new S3Client({
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
      // S3-compatible providers (Railway, MinIO) generally require
      // path-style addressing rather than virtual-hosted buckets.
      ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
    })
  : null;

const app = express();
app.use(cors());
app.use(express.json());

function sanitizeName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(-80) || 'video.mp4';
}

/** Keys look like "<uuid>__<filename>"; reject anything else (path traversal). */
function isValidKey(key: string): boolean {
  return /^[a-f0-9-]{36}__[a-zA-Z0-9._-]+$/.test(key);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: useS3 ? 's3' : 'local' });
});

app.post('/api/presign-upload', async (req, res) => {
  const { fileName, contentType } = req.body ?? {};
  if (typeof fileName !== 'string') {
    res.status(400).json({ error: 'fileName is required' });
    return;
  }
  const key = `${crypto.randomUUID()}__${sanitizeName(fileName)}`;

  try {
    if (s3) {
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          ContentType: typeof contentType === 'string' ? contentType : 'video/mp4',
        }),
        { expiresIn: 60 * 60 }, // 1 hour to complete the upload
      );
      res.json({ key, uploadUrl, storage: 's3' });
    } else {
      res.json({ key, uploadUrl: `/api/local-upload/${key}`, storage: 'local' });
    }
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
    if (s3) {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: 60 * 60 * 6 }, // 6 hours of playback
      );
      res.json({ url });
    } else {
      res.json({ url: `/api/files/${key}` });
    }
  } catch (err) {
    console.error('playback-url failed', err);
    res.status(500).json({ error: 'Failed to create playback URL' });
  }
});

// ---- Local-disk fallback (dev only, used when no bucket is configured) ----

app.put('/api/local-upload/:key', (req, res) => {
  const { key } = req.params;
  if (!isValidKey(key)) {
    res.status(400).json({ error: 'Invalid key' });
    return;
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const dest = fs.createWriteStream(path.join(UPLOADS_DIR, key));
  req.pipe(dest);
  dest.on('finish', () => res.status(200).json({ ok: true }));
  dest.on('error', (err) => {
    console.error('local upload failed', err);
    res.status(500).json({ error: 'Failed to store file' });
  });
});

// sendFile handles HTTP Range requests, which the <video> element needs for seeking.
app.get('/api/files/:key', (req, res) => {
  const { key } = req.params;
  if (!isValidKey(key)) {
    res.status(400).json({ error: 'Invalid key' });
    return;
  }
  res.sendFile(path.join(UPLOADS_DIR, key), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  if (useS3) {
    console.log(`[api] storage: S3-compatible bucket "${BUCKET}"${ENDPOINT ? ` via ${ENDPOINT}` : ''}`);
  } else {
    console.log('[api] storage: LOCAL DISK fallback (./uploads). Set S3_* env vars to use a bucket.');
  }
});
