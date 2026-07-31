import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageAResultSchema, stageBResultSchema, type StageAResult, type StageBResult } from './domain.ts';

type Stage = 'stage-a' | 'stage-b';

export interface OpenRouterAudit<T> {
  parsed: T;
  raw: unknown;
  model: string;
  provider: string;
  usage?: unknown;
}

const schemas = {
  'stage-a': {
    name: 'fencing_phrase_end',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'candidate_phrase_end',
        'local_timestamp_seconds',
        'confidence',
        'observable_cues',
      ],
      properties: {
        candidate_phrase_end: { type: 'boolean' },
        local_timestamp_seconds: { type: 'number', minimum: 0 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        observable_cues: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      },
    },
  },
  'stage-b': {
    name: 'fencing_point_award',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'point_awarded',
        'local_timestamp_seconds',
        'awarded_side',
        'confidence',
        'observable_cues',
      ],
      properties: {
        point_awarded: { type: 'boolean' },
        local_timestamp_seconds: { type: 'number', minimum: 0 },
        awarded_side: {
          type: 'string',
          enum: ['left', 'right', 'both', 'neither', 'unknown'],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        observable_cues: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      },
    },
  },
} as const;

const prompts: Record<Stage, string> = {
  'stage-a':
    'Inspect this fencing clip for an observable phrase-ending halt or touch. Optimize recall, but do not invent an event. Return only the requested JSON. The timestamp is local to this clip.',
  'stage-b':
    'Inspect the fencing clip around the candidate phrase ending. Decide whether the referee/scoreboard/lights visibly indicate an awarded point, and which on-screen side received it. Abstain with unknown where evidence is insufficient. Return only the requested JSON.',
};

function responseContent(raw: any): string {
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  throw new Error('OpenRouter returned no response content');
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

async function videoBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download clip for base64 fallback (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const max = Number(process.env.OPENROUTER_BASE64_MAX_BYTES ?? 20 * 1024 * 1024);
  if (bytes.byteLength > max) {
    throw new Error(`Clip exceeds the ${max} byte OpenRouter base64 fallback limit`);
  }
  return bytes;
}

function enabled(value: string | undefined, defaultValue = true) {
  return /^(1|true|yes)$/i.test(value ?? String(defaultValue));
}

function canRetryMedia(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return !/OpenRouter request failed \((?:401|402|403|429)\)/.test(message);
}

function isVideoCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /input video|video (?:input|url|modality)|support.*video|video.*support/i.test(message);
}

export function frameSamplingPlan(durationSeconds?: number, requestedMaxFrames = 8) {
  const duration =
    durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 12;
  const maxFrames = Math.max(1, Math.min(16, Math.floor(requestedMaxFrames) || 8));
  const fps = Math.max(0.1, Math.min(2, maxFrames / duration));
  return {
    durationSeconds: duration,
    maxFrames,
    fps: Number(fps.toFixed(6)),
    intervalSeconds: Number((1 / fps).toFixed(6)),
  };
}

async function runFfmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('FFmpeg frame sampling timed out'));
    }, Number(process.env.OPENROUTER_FRAME_TIMEOUT_MS ?? 60_000));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg frame sampling exited ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}

async function sampleVideoFrames(bytes: Uint8Array, durationSeconds?: number) {
  const plan = frameSamplingPlan(
    durationSeconds,
    Number(process.env.OPENROUTER_FRAME_SAMPLE_COUNT ?? 8),
  );
  const width = Math.max(
    160,
    Math.min(1280, Number(process.env.OPENROUTER_FRAME_MAX_WIDTH ?? 640)),
  );
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fencing-openrouter-frames-'));
  try {
    const source = path.join(tempDir, 'clip.mp4');
    const pattern = path.join(tempDir, 'frame-%03d.jpg');
    await writeFile(source, bytes);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      `fps=${plan.fps},scale=${width}:-2:force_original_aspect_ratio=decrease`,
      '-frames:v',
      String(plan.maxFrames),
      '-q:v',
      '5',
      pattern,
    ]);
    const names = (await readdir(tempDir))
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort();
    if (names.length === 0) throw new Error('FFmpeg frame sampling produced no images');
    const frames = await Promise.all(
      names.map(async (name, index) => ({
        timestamp: Number(Math.min(plan.durationSeconds, index / plan.fps).toFixed(3)),
        dataUrl: `data:image/jpeg;base64,${(await readFile(path.join(tempDir, name))).toString('base64')}`,
      })),
    );
    return { frames, plan };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function request<T>(
  stage: Stage,
  videoUrl: string,
  input: {
    model: string;
    provider: string;
    promptVersion: string;
    durationSeconds?: number;
  },
): Promise<OpenRouterAudit<T>> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  const endpoint = process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
  const attempt = async (media: unknown[], mediaNote = '') => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(process.env.OPENROUTER_TIMEOUT_MS ?? 120_000),
    );
    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Fencing Vault Analysis',
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${prompts[stage]}\nPrompt version: ${input.promptVersion}${mediaNote}`,
                },
                ...media,
              ],
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { ...schemas[stage], strict: true },
          },
          provider: {
            ...(input.provider ? { only: [input.provider] } : {}),
            allow_fallbacks: false,
            data_collection: 'deny',
            zdr: true,
          },
          temperature: 0,
        }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`OpenRouter request failed (${response.status}): ${JSON.stringify(raw).slice(0, 500)}`);
      }
      return raw;
    } finally {
      clearTimeout(timer);
    }
  };

  let raw: any;
  try {
    raw = await attempt([{ type: 'video_url', video_url: { url: videoUrl } }]);
  } catch (urlError) {
    if (!canRetryMedia(urlError)) throw urlError;
    let bytes: Uint8Array | undefined;
    let fallbackError = urlError;
    if (enabled(process.env.OPENROUTER_BASE64_FALLBACK)) {
      bytes = await videoBytes(videoUrl);
      try {
        raw = await attempt([
          {
            type: 'video_url',
            video_url: { url: `data:video/mp4;base64,${Buffer.from(bytes).toString('base64')}` },
          },
        ]);
      } catch (error) {
        fallbackError = error;
      }
    }
    if (!raw) {
      if (
        !enabled(process.env.OPENROUTER_FRAME_FALLBACK) ||
        (!isVideoCompatibilityError(urlError) && !isVideoCompatibilityError(fallbackError))
      ) {
        throw fallbackError;
      }
      bytes ??= await videoBytes(videoUrl);
      const sampled = await sampleVideoFrames(bytes, input.durationSeconds);
      const frameMedia = sampled.frames.flatMap((frame, index) => [
        {
          type: 'text',
          text: `Frame ${index + 1} at ${frame.timestamp.toFixed(3)} seconds`,
        },
        { type: 'image_url', image_url: { url: frame.dataUrl } },
      ]);
      raw = await attempt(
        frameMedia,
        `\nThe following ${sampled.frames.length} frames are sampled in chronological order from a ${sampled.plan.durationSeconds.toFixed(3)}-second clip. Timestamp labels are local to the clip.`,
      );
    }
  }
  const value = parseJsonContent(responseContent(raw));
  const parsed =
    stage === 'stage-a' ? stageAResultSchema.parse(value) : stageBResultSchema.parse(value);
  return {
    parsed: parsed as T,
    raw,
    model: String(raw.model ?? input.model),
    provider: String(raw.provider ?? input.provider ?? 'unknown'),
    usage: raw.usage,
  };
}

export function detectPhraseEnd(
  videoUrl: string,
  input: {
    model: string;
    provider: string;
    promptVersion: string;
    durationSeconds?: number;
  },
) {
  return request<StageAResult>('stage-a', videoUrl, input);
}

export function classifyAward(
  videoUrl: string,
  input: {
    model: string;
    provider: string;
    promptVersion: string;
    durationSeconds?: number;
  },
) {
  return request<StageBResult>('stage-b', videoUrl, input);
}
