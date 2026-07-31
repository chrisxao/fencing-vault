// Upload/playback URL server.
//
// Targets any S3-compatible object storage (Railway object storage / MinIO,
// AWS S3, R2, ...). Complete bucket configuration is required at startup.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { registerAuthRoutes } from './auth-routes.ts';
import { registerMediaRoutes } from './media-routes.ts';
import { registerAnalysisRoutes } from './analysis/routes.ts';
import { analysisQueues } from './analysis/queue.ts';
import { forcePathStyle } from './storage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const developmentOrigins = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
app.use(
  cors((req, callback) => {
    const origin = req.header('Origin');
    const forwardedProtocol = req.header('X-Forwarded-Proto')?.split(',')[0]?.trim();
    const host = req.header('Host');
    const requestOrigin = host ? `${forwardedProtocol || req.protocol}://${host}` : '';
    const allowed =
      !origin ||
      origin === requestOrigin ||
      configuredOrigins.includes(origin) ||
      (process.env.NODE_ENV !== 'production' &&
        developmentOrigins.some((pattern) => pattern.test(origin)));
    callback(null, {
      origin: allowed ? origin ?? true : false,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86_400,
    });
  }),
);
app.use(express.json({ limit: '256kb' }));

registerAuthRoutes(app);
registerMediaRoutes(app);
registerAnalysisRoutes(app);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: 's3', analysis: analysisQueues() ? 'available' : 'unavailable' });
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
    `[api] storage: S3-compatible (${forcePathStyle ? 'path-style' : 'virtual-hosted style'})`,
  );
});
