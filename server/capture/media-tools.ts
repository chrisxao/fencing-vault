import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

export interface VideoProbe {
  durationMs: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  frameCount: number | null;
}

function redact(value: string) {
  return value.replace(/https?:\/\/[^\s]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.search = parsed.search ? '?[redacted]' : '';
      return parsed.toString();
    } catch {
      return '[redacted URL]';
    }
  });
}

async function run(command: string, args: string[], captureOutput = false) {
  return new Promise<string>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(command, args, {
      stdio: ['ignore', captureOutput ? 'pipe' : 'ignore', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (stderr.reduce((size, item) => size + item.length, 0) > 64_000) stderr.shift();
    });
    child.on('error', (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else {
        const detail = redact(Buffer.concat(stderr).toString('utf8').trim()).slice(-4_000);
        reject(new Error(`${command} exited with ${code}${detail ? `: ${detail}` : ''}`));
      }
    });
  });
}

function safeHeaders(headers: Record<string, string>) {
  const allowed = new Set(['authorization', 'cookie', 'origin', 'referer', 'user-agent']);
  return Object.entries(headers)
    .filter(([name, value]) => allowed.has(name.toLowerCase()) && value && !/[\r\n]/.test(name + value))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\r\n');
}

export async function captureHls(input: {
  hlsUrl: string;
  outputPath: string;
  headers: Record<string, string>;
  clip?: { startMs: number; endMs: number };
}) {
  const url = new URL(input.hlsUrl);
  if (url.protocol !== 'https:') throw new Error('The observed HLS stream must use HTTPS');
  if (input.clip && (!Number.isInteger(input.clip.startMs) || !Number.isInteger(input.clip.endMs) || input.clip.startMs < 0 || input.clip.endMs <= input.clip.startMs)) {
    throw new Error('Capture clip needs valid start and end timestamps');
  }
  const headerBlock = safeHeaders(input.headers);
  const seekStartSeconds = input.clip ? Math.max(0, (input.clip.startMs / 1_000) - 5) : null;
  const decodeOffsetSeconds = input.clip ? (input.clip.startMs / 1_000) - (seekStartSeconds ?? 0) : null;
  const clipDurationSeconds = input.clip ? (input.clip.endMs - input.clip.startMs) / 1_000 : null;
  const common = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'warning',
    '-rw_timeout', '30000000',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    ...(headerBlock ? ['-headers', `${headerBlock}\r\n`] : []),
    ...(seekStartSeconds !== null ? ['-ss', seekStartSeconds.toFixed(3)] : []),
    '-i', input.hlsUrl,
    ...(decodeOffsetSeconds !== null ? ['-ss', decodeOffsetSeconds.toFixed(3)] : []),
    ...(clipDurationSeconds !== null ? ['-t', clipDurationSeconds.toFixed(3)] : []),
    '-map', '0:v:0',
    '-map', '0:a?',
  ];
  if (input.clip) {
    await run('ffmpeg', [
      ...common,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      '-y', input.outputPath,
    ]);
    return { normalized: true };
  }
  try {
    await run('ffmpeg', [...common, '-c', 'copy', '-movflags', '+faststart', '-y', input.outputPath]);
    return { normalized: false };
  } catch (copyError) {
    try {
      await run('ffmpeg', [
        ...common,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        '-y', input.outputPath,
      ]);
      return { normalized: true };
    } catch (normalizedError) {
      throw new AggregateError([copyError, normalizedError], 'FencingTV stream capture failed in copy and normalized modes');
    }
  }
}

export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const output = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames',
    '-of', 'json',
    filePath,
  ], true);
  const result = JSON.parse(output) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string }>;
  };
  const video = result.streams?.find((stream) => stream.codec_type === 'video');
  const [numerator, denominator] = (video?.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = denominator && Number.isFinite(numerator / denominator) ? numerator / denominator : null;
  const durationMs = result.format?.duration ? Math.round(Number(result.format.duration) * 1_000) : null;
  const explicitFrames = Number(video?.nb_frames);
  const frameCount = Number.isFinite(explicitFrames) && explicitFrames > 0
    ? Math.round(explicitFrames)
    : durationMs && fps
      ? Math.round((durationMs / 1_000) * fps)
      : null;
  return {
    durationMs: durationMs && durationMs > 0 ? durationMs : null,
    fps: fps && fps > 0 ? fps : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    frameCount,
  };
}

export async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function verifyMediaTools() {
  await Promise.all([
    run('ffmpeg', ['-version']),
    run('ffprobe', ['-version']),
  ]);
}
