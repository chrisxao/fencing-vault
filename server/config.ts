function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const config = {
  port: numberEnv('PORT', 8790),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL?.trim() ?? '',
  databaseSsl: booleanEnv('DATABASE_SSL', false),
  autoMigrate: booleanEnv('AUTO_MIGRATE', true),
  appPassword: process.env.APP_PASSWORD ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  sessionHours: numberEnv('SESSION_HOURS', 24 * 14),
  // Presigned uploads currently use one S3 PUT, whose hard limit is 5 GiB.
  maxUploadBytes: numberEnv('MAX_UPLOAD_BYTES', 4 * 1024 * 1024 * 1024),
  fencingTvCaptureEnabled: booleanEnv('FENCINGTV_CAPTURE_ENABLED', false),
  fencingTvDiscoveryEnabled: booleanEnv('FENCINGTV_DISCOVERY_ENABLED', true),
  captureWorker: {
    pollMs: numberEnv('CAPTURE_WORKER_POLL_MS', 5_000),
    leaseSeconds: numberEnv('CAPTURE_WORKER_LEASE_SECONDS', 15 * 60),
    maxAttempts: numberEnv('CAPTURE_WORKER_MAX_ATTEMPTS', 3),
    retryBaseSeconds: numberEnv('CAPTURE_WORKER_RETRY_BASE_SECONDS', 60),
    navigationTimeoutMs: numberEnv('FENCINGTV_NAVIGATION_TIMEOUT_MS', 45_000),
    streamTimeoutMs: numberEnv('FENCINGTV_STREAM_TIMEOUT_MS', 30_000),
    maxClipSeconds: numberEnv('FENCINGTV_MAX_CLIP_SECONDS', 2 * 60 * 60),
    browserExecutable: process.env.FENCINGTV_BROWSER_EXECUTABLE?.trim() ?? '',
    storageStatePath: process.env.FENCINGTV_STORAGE_STATE_PATH?.trim() ?? '',
    storageStateBase64: process.env.FENCINGTV_STORAGE_STATE_BASE64?.trim() ?? '',
    headless: booleanEnv('FENCINGTV_HEADLESS', true),
  },
  corsAllowedOrigin: process.env.CORS_ALLOWED_ORIGIN?.trim() ?? '',
  s3: {
    endpoint: process.env.AWS_ENDPOINT_URL ?? process.env.S3_ENDPOINT ?? '',
    bucket: process.env.AWS_S3_BUCKET_NAME ?? process.env.S3_BUCKET ?? '',
    region: process.env.AWS_DEFAULT_REGION ?? process.env.S3_REGION ?? 'auto',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: booleanEnv('S3_FORCE_PATH_STYLE', false),
  },
} as const;

export function validateProductionConfig() {
  if (config.nodeEnv !== 'production') return;
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.appPassword) missing.push('APP_PASSWORD');
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push('SESSION_SECRET (32+ chars)');
  for (const [name, value] of [
    ['AWS_ENDPOINT_URL', config.s3.endpoint],
    ['AWS_S3_BUCKET_NAME', config.s3.bucket],
    ['AWS_ACCESS_KEY_ID', config.s3.accessKeyId],
    ['AWS_SECRET_ACCESS_KEY', config.s3.secretAccessKey],
  ]) {
    if (!value) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }
}
