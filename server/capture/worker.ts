import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.ts';
import { createPool, runMigrations } from '../migrate.ts';
import { storageConfigured, uploadVideoFile } from '../storage.ts';
import { resolveFencingTvStream } from './fencingtv-browser.ts';
import { captureHls, probeVideo, sha256File, verifyMediaTools } from './media-tools.ts';
import { CaptureQueue, type CaptureJob } from './queue.ts';

function positiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function redactWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&](?:token|sig|signature|jwt|auth|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Cookie:\s*[^\r\n]+/gi, 'Cookie: [redacted]');
}

function captureWindow(job: CaptureJob) {
  const value = job.metadata.captureWindow;
  if (!value || typeof value !== 'object') throw new Error('Capture job is missing its bout start and end timestamps');
  const startMs = Number((value as Record<string, unknown>).startMs);
  const endMs = Number((value as Record<string, unknown>).endMs);
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) {
    throw new Error('Capture job has an invalid bout time window');
  }
  if ((endMs - startMs) / 1_000 > config.captureWorker.maxClipSeconds) {
    throw new Error(`Capture window exceeds FENCINGTV_MAX_CLIP_SECONDS (${config.captureWorker.maxClipSeconds})`);
  }
  return { startMs, endMs };
}

async function processJob(queue: CaptureQueue, job: CaptureJob) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `sabre-capture-${job.id}-`));
  const outputPath = path.join(workDir, `fencingtv-${job.id}.mp4`);
  let stage = 'resolving-stream';
  let state: 'capturing' | 'uploading' = 'capturing';
  let leaseError: unknown;
  const heartbeatMs = Math.max(5_000, Math.floor(config.captureWorker.leaseSeconds * 1_000 / 3));
  const heartbeat = setInterval(() => {
    void queue.heartbeat(job.id, stage, state).catch((error) => { leaseError = error; });
  }, heartbeatMs);

  try {
    const clip = captureWindow(job);
    await queue.heartbeat(job.id, stage, 'capturing', { captureWindow: clip });
    const stream = await resolveFencingTvStream(job.sourceUrl);
    if (leaseError) throw leaseError;

    stage = 'capturing-stream';
    await queue.heartbeat(job.id, stage);
    const capture = await captureHls({ hlsUrl: stream.hlsUrl, headers: stream.headers, outputPath, clip });
    if (leaseError) throw leaseError;

    stage = 'probing-video';
    await queue.heartbeat(job.id, stage);
    const [details, checksum] = await Promise.all([probeVideo(outputPath), sha256File(outputPath)]);
    if (!details.durationMs || !details.width || !details.height) throw new Error('Captured file is missing valid video metadata');

    stage = 'uploading-source';
    state = 'uploading';
    await queue.heartbeat(job.id, stage, state, { durationMs: details.durationMs, checksum });
    const filename = `fencingtv-${job.id}.mp4`;
    const uploaded = await uploadVideoFile({
      boutId: job.boutId,
      filePath: outputPath,
      filename,
      checksum,
      objectKey: `source-videos/${job.boutId}/${filename}`,
    });
    if (leaseError) throw leaseError;

    stage = 'committing';
    await queue.heartbeat(job.id, stage, state, { objectKey: uploaded.objectKey });
    await queue.complete(job, { ...details, ...uploaded, checksum, normalized: capture.normalized });
  } finally {
    clearInterval(heartbeat);
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function runCaptureWorker(options: { once?: boolean } = {}) {
  if (!config.fencingTvCaptureEnabled) throw new Error('Set FENCINGTV_CAPTURE_ENABLED=true before starting the capture worker');
  if (!config.databaseUrl) throw new Error('The capture worker requires DATABASE_URL');
  if (!storageConfigured()) throw new Error('The capture worker requires S3-compatible object storage');
  positiveInteger('CAPTURE_WORKER_POLL_MS', config.captureWorker.pollMs);
  positiveInteger('CAPTURE_WORKER_LEASE_SECONDS', config.captureWorker.leaseSeconds);
  positiveInteger('CAPTURE_WORKER_MAX_ATTEMPTS', config.captureWorker.maxAttempts);
  positiveInteger('CAPTURE_WORKER_RETRY_BASE_SECONDS', config.captureWorker.retryBaseSeconds);
  positiveInteger('FENCINGTV_MAX_CLIP_SECONDS', config.captureWorker.maxClipSeconds);
  await verifyMediaTools();

  const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const pool = createPool();
  await runMigrations(pool);
  const queue = new CaptureQueue(
    pool,
    workerId,
    config.captureWorker.maxAttempts,
    config.captureWorker.leaseSeconds,
    config.captureWorker.retryBaseSeconds,
  );
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`FencingTV capture worker ${workerId} is ready.`);

  try {
    do {
      const job = await queue.claim();
      if (!job) {
        if (options.once) break;
        await new Promise((resolve) => setTimeout(resolve, config.captureWorker.pollMs));
        continue;
      }
      console.log(`Capture job ${job.id} claimed (attempt ${job.attempts}/${config.captureWorker.maxAttempts}).`);
      try {
        await processJob(queue, job);
        console.log(`Capture job ${job.id} completed.`);
      } catch (error) {
        const message = redactWorkerError(error);
        console.error(`Capture job ${job.id} failed: ${message}`);
        await queue.fail(job, message);
      }
      if (options.once) break;
    } while (!stopping);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCaptureWorker({ once: process.argv.includes('--once') || process.env.CAPTURE_WORKER_ONCE === 'true' })
    .catch((error) => {
      console.error(redactWorkerError(error));
      process.exitCode = 1;
    });
}
