import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { captureHls, probeVideo } from '../server/capture/media-tools.ts';
import { parseFencingTvUrl } from '../shared/fencingtv.ts';

function args() {
  return Object.fromEntries(process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  }));
}

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(`Usage:
  npm run capture:fencingtv -- --hls="https://…m3u8" --start=01:12:30 --end=01:16:45 --output=./bout.mp4 [--bout-id=UUID]
  npm run capture:fencingtv -- --har=./authenticated-session.har --url="https://fencingtv.com/videos/…" --start=01:12:30 --end=01:16:45 --output=./bout.mp4 [--bout-id=UUID]

Optional: --cookies=./cookies.txt --api=http://localhost:8790 --password-env=APP_PASSWORD`);
  process.exit(exitCode);
}

function findHlsInHar(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/https?:[^"'\s\\]+\.m3u8[^"'\s\\]*/g)) {
        try { found.add(decodeURIComponent(match[0].replaceAll('\\u0026', '&'))); } catch { found.add(match[0]); }
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found];
}

async function cookieHeader(file?: string) {
  if (!file) return '';
  const text = await fsp.readFile(path.resolve(file), 'utf8');
  return text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split('\t')).filter((parts) => parts.length >= 7).map((parts) => `${parts[5]}=${parts[6]}`).join('; ');
}

function timestampMs(value: string | undefined, name: string) {
  if (!value) throw new Error(`--${name} is required so the full-piste recording is clipped to one bout`);
  const parts = value.trim().split(':');
  const values = parts.map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === '') || values.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`--${name} must use MM:SS or HH:MM:SS`);
  }
  const seconds = parts.length === 3
    ? values[0] * 3_600 + values[1] * 60 + values[2]
    : values[0] * 60 + values[1];
  if (values.at(-1)! >= 60 || (parts.length === 3 && values[1] >= 60)) {
    throw new Error(`--${name} is not a valid timestamp`);
  }
  return Math.round(seconds * 1_000);
}

async function json<T>(url: string, init: RequestInit, cookie = ''): Promise<{ data: T; cookie: string }> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...init.headers } });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `API request failed (${response.status})`);
  return { data: body, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}

async function putFile(urlValue: string, file: string, contentType: string) {
  const url = new URL(urlValue); const transport = url.protocol === 'https:' ? https : http; const size = (await fsp.stat(file)).size;
  await new Promise<void>((resolve, reject) => {
    const request = transport.request(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': size } }, (response) => {
      response.resume(); response.on('end', () => response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error(`Object storage returned ${response.statusCode}`)));
    });
    request.on('error', reject); fs.createReadStream(file).on('error', reject).pipe(request);
  });
}

async function upload(apiBase: string, boutId: string, output: string, details: Awaited<ReturnType<typeof probeVideo>>, passwordEnv: string) {
  let cookie = '';
  const password = process.env[passwordEnv] ?? '';
  const login = await json<{ authenticated: boolean }>(`${apiBase}/api/auth/login`, { method: 'POST', body: JSON.stringify({ password }) }); cookie = login.cookie;
  const stat = await fsp.stat(output); const filename = path.basename(output);
  const signed = await json<{ objectKey: string; uploadUrl: string }>(`${apiBase}/api/bouts/${boutId}/uploads/presign`, { method: 'POST', body: JSON.stringify({ filename, contentType: 'video/mp4', sizeBytes: stat.size }) }, cookie);
  await putFile(signed.data.uploadUrl, output, 'video/mp4');
  await json(`${apiBase}/api/bouts/${boutId}/media`, { method: 'POST', body: JSON.stringify({ kind: 'external', objectKey: signed.data.objectKey, externalUrl: null, filename, mimeType: 'video/mp4', sizeBytes: stat.size, ...details, status: 'ready' }) }, cookie);
}

async function main() {
  const options = args();
  if (options.help === 'true') usage(0);
  if (options.url) parseFencingTvUrl(options.url);
  let hls = options.hls ?? '';
  if (!hls && options.har) {
    const candidates = findHlsInHar(JSON.parse(await fsp.readFile(path.resolve(options.har), 'utf8')));
    const masters = candidates.filter((value) => /master|index|playlist/i.test(new URL(value).pathname));
    const selected = masters[0] ?? candidates[0];
    if (!selected) throw new Error('No HLS playlist was found in the HAR. Play the bout before saving the network log.');
    if (candidates.length > 1) console.log(`Found ${candidates.length} HLS candidates; using ${new URL(selected).hostname}${new URL(selected).pathname}.`);
    hls = selected;
  }
  if (!hls || !options.output) usage();
  const startMs = timestampMs(options.start, 'start');
  const endMs = timestampMs(options.end, 'end');
  if (endMs <= startMs) throw new Error('--end must be later than --start');
  const output = path.resolve(options.output); await fsp.mkdir(path.dirname(output), { recursive: true });
  console.log(`Capturing ${options.start}–${options.end} to ${output}…`);
  const cookie = await cookieHeader(options.cookies);
  await captureHls({
    hlsUrl: hls,
    outputPath: output,
    headers: {
      referer: options.url ?? 'https://fencingtv.com/',
      ...(cookie ? { cookie } : {}),
    },
    clip: { startMs, endMs },
  });
  const details = await probeVideo(output); console.log(`Captured ${details.durationMs ? Math.round(details.durationMs / 1_000) : '?'}s, ${details.width ?? '?'}×${details.height ?? '?'}, ${details.fps?.toFixed(2) ?? '?'} fps.`);
  if (options['bout-id']) {
    console.log('Uploading training copy and attaching it to the bout…');
    await upload((options.api ?? 'http://localhost:8790').replace(/\/$/, ''), options['bout-id'], output, details, options['password-env'] ?? 'APP_PASSWORD');
    console.log('Capture attached successfully.');
  } else console.log('No --bout-id supplied; the local capture was kept without uploading.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
