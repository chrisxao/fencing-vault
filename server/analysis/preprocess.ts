import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { headObject, s3, storageBucket } from '../storage.ts';
import { createChunkWindows, deterministicUuid, pipelineConfig } from './domain.ts';
import { upsertClip } from './repository.ts';

const probeSchema = z.object({
  format: z.object({
    duration: z.coerce.number().positive(),
    size: z.coerce.number().nonnegative().optional(),
    format_name: z.string().optional(),
  }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
    }).passthrough(),
  ),
});

async function run(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function probeVideo(file: string) {
  const output = await run(
    process.env.FFPROBE_PATH ?? 'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    Number(process.env.FFPROBE_TIMEOUT_MS ?? 60_000),
  );
  return probeSchema.parse(JSON.parse(output));
}

async function downloadObject(key: string, destination: string) {
  const response = await s3.send(new GetObjectCommand({ Bucket: storageBucket, Key: key }));
  if (!response.Body) throw new Error('Source video object was empty');
  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination));
}

async function normalizeVideo(source: string, destination: string) {
  await run(
    process.env.FFMPEG_PATH ?? 'ffmpeg',
    [
      '-y',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-c:v',
      'libx264',
      '-preset',
      process.env.FFMPEG_PRESET ?? 'veryfast',
      '-crf',
      process.env.FFMPEG_CRF ?? '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      destination,
    ],
    Number(process.env.FFMPEG_NORMALIZE_TIMEOUT_MS ?? 3_600_000),
  );
}

export async function preprocessVideo(input: {
  analysisJobId: string;
  runId: string;
  ownerId: string;
  videoId: string;
  sourceKey: string;
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fencing-analysis-'));
  try {
    const sourcePath = path.join(tempDir, 'source');
    const normalizedPath = path.join(tempDir, 'normalized.mp4');
    await downloadObject(input.sourceKey, sourcePath);
    const sourceProbe = await probeVideo(sourcePath);
    const maxDuration = Number(process.env.ANALYSIS_MAX_DURATION_SECONDS ?? 7_200);
    if (sourceProbe.format.duration > maxDuration) {
      throw new Error(`Video duration exceeds the ${maxDuration}s analysis limit`);
    }
    await normalizeVideo(sourcePath, normalizedPath);
    const normalizedProbe = await probeVideo(normalizedPath);
    const windows = createChunkWindows(
      normalizedProbe.format.duration,
      pipelineConfig.windowSeconds,
      pipelineConfig.strideSeconds,
    );
    for (const window of windows) {
      const clipId = deterministicUuid(
        `${input.analysisJobId}:${input.runId}:clip:${window.index}`,
      );
      const key = `analysis/${input.ownerId}/${input.videoId}/${input.analysisJobId}/runs/${
        input.runId
      }/clips/${String(window.index).padStart(5, '0')}.mp4`;
      const existing = await headObject(key).catch(() => null);
      if (existing?.Metadata?.sha256) {
        await upsertClip({
          clipId,
          ...input,
          jobId: input.analysisJobId,
          index: window.index,
          sourceStart: window.start,
          sourceEnd: window.end,
          overlap: window.overlap,
          s3Key: key,
          checksum: existing.Metadata.sha256,
          metadataJson: existing.Metadata.mapping ?? '{}',
        });
        continue;
      }
      const clipPath = path.join(tempDir, `clip-${window.index}.mp4`);
      await run(
        process.env.FFMPEG_PATH ?? 'ffmpeg',
        [
          '-y',
          '-ss',
          String(window.start),
          '-i',
          normalizedPath,
          '-t',
          String(window.end - window.start),
          '-c:v',
          'libx264',
          '-preset',
          process.env.FFMPEG_PRESET ?? 'veryfast',
          '-crf',
          process.env.FFMPEG_CRF ?? '23',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          clipPath,
        ],
        Number(process.env.FFMPEG_CLIP_TIMEOUT_MS ?? 300_000),
      );
      const checksum = await sha256File(clipPath);
      const mapping = JSON.stringify({
        sourceStart: window.start,
        sourceEnd: window.end,
        normalizedStart: window.start,
        normalizedEnd: window.end,
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: storageBucket,
          Key: key,
          Body: createReadStream(clipPath),
          ContentType: 'video/mp4',
          Metadata: { sha256: checksum, mapping },
        }),
      );
      await upsertClip({
        clipId,
        ...input,
        jobId: input.analysisJobId,
        index: window.index,
        sourceStart: window.start,
        sourceEnd: window.end,
        overlap: window.overlap,
        s3Key: key,
        checksum,
        metadataJson: mapping,
      });
    }
    return { sourceProbe, normalizedProbe, clipCount: windows.length };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
