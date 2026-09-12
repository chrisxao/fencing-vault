import { z } from 'zod';

const supportedHost = /^(www\.)?fencingtv\.com$/i;

export interface FencingTvReference {
  kind: 'competition' | 'bout' | 'video' | 'athlete' | 'unknown';
  canonicalUrl: string;
  slug: string;
}

export function parseFencingTvUrl(value: string): FencingTvReference {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' || !supportedHost.test(parsed.hostname)) {
    throw new Error('Use an HTTPS fencingtv.com URL');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.hostname = 'fencingtv.com';
  const parts = parsed.pathname.split('/').filter(Boolean);
  const collection = parts[0];
  const kind = parts.includes('bouts')
    ? 'bout'
    : collection === 'competitions' || collection === 'videos' || collection === 'athletes'
      ? collection === 'competitions'
      ? 'competition'
      : collection === 'videos'
        ? 'video'
        : 'athlete'
      : 'unknown';
  const slug = parts.at(-1) ?? '';
  if (!slug || kind === 'unknown') {
    throw new Error('Use a FencingTV bout, competition, video, or athlete detail URL');
  }
  return {
    kind,
    canonicalUrl: parsed.toString().replace(/\/$/, ''),
    slug,
  };
}

export const fencingTvImportSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(240),
  tournamentName: z.string().trim().max(240).default(''),
  tournamentDate: z.string().date().nullable().default(null),
  round: z.string().trim().max(80).default(''),
  leftFencerId: z.string().uuid().nullable().default(null),
  rightFencerId: z.string().uuid().nullable().default(null),
  captureMode: z.enum(['link-only', 'browser-session', 'direct-hls', 'screen-recording']).default('link-only'),
  captureStartMs: z.number().int().nonnegative().nullable().default(null),
  captureEndMs: z.number().int().positive().nullable().default(null),
}).superRefine((input, context) => {
  const workerCapture = input.captureMode === 'browser-session' || input.captureMode === 'direct-hls';
  if (workerCapture && input.captureStartMs === null) {
    context.addIssue({ code: 'custom', path: ['captureStartMs'], message: 'Enter the bout start time within the piste recording' });
  }
  if (workerCapture && input.captureEndMs === null) {
    context.addIssue({ code: 'custom', path: ['captureEndMs'], message: 'Enter the bout end time within the piste recording' });
  }
  if ((input.captureStartMs === null) !== (input.captureEndMs === null)) {
    context.addIssue({ code: 'custom', path: ['captureEndMs'], message: 'Enter both the bout start and end times' });
  }
  if (input.captureStartMs !== null && input.captureEndMs !== null && input.captureEndMs <= input.captureStartMs) {
    context.addIssue({ code: 'custom', path: ['captureEndMs'], message: 'Bout end time must be after its start time' });
  }
});

export function fencingTvDedupKey(value: string, captureStartMs: number | null = null, captureEndMs: number | null = null) {
  const reference = parseFencingTvUrl(value);
  const sourceKey = `fencingtv:${reference.kind}:${reference.slug.toLowerCase()}`;
  return captureStartMs !== null && captureEndMs !== null
    ? `${sourceKey}:${captureStartMs}-${captureEndMs}`
    : sourceKey;
}
