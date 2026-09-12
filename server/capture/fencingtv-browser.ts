import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContextOptions, type Request } from 'playwright-core';
import { parseFencingTvUrl } from '../../shared/fencingtv.ts';
import { config } from '../config.ts';

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

interface HlsCandidate {
  url: string;
  headers: Record<string, string>;
}

const executableCandidates = () => [
  config.captureWorker.browserExecutable,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '',
  process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
  process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : '',
  process.platform === 'darwin' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : '',
  process.platform === 'win32' ? path.join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe') : '',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

export async function findBrowserExecutable() {
  for (const candidate of executableCandidates()) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error('No Chromium browser was found. Set FENCINGTV_BROWSER_EXECUTABLE or install Chromium.');
}

export async function loadFencingTvStorageState(): Promise<StorageState> {
  let source = '';
  if (config.captureWorker.storageStateBase64) {
    source = Buffer.from(config.captureWorker.storageStateBase64, 'base64').toString('utf8');
  } else if (config.captureWorker.storageStatePath) {
    source = await fs.readFile(path.resolve(config.captureWorker.storageStatePath), 'utf8');
  } else {
    throw new Error('FencingTV session state is missing. Run npm run auth:fencingtv, then configure FENCINGTV_STORAGE_STATE_PATH or FENCINGTV_STORAGE_STATE_BASE64.');
  }
  const parsed = JSON.parse(source) as StorageState;
  if (!parsed || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw new Error('FencingTV storage state is not a valid Playwright session file');
  }
  return parsed;
}

export function isHlsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.m3u8(?:$|[?#])/i.test(url.toString());
  } catch {
    return false;
  }
}

export function selectHlsCandidate(values: Iterable<HlsCandidate>) {
  const candidates = [...values].filter((candidate) => isHlsUrl(candidate.url));
  candidates.sort((left, right) => score(right.url) - score(left.url));
  return candidates[0] ?? null;
}

function score(value: string) {
  const url = new URL(value);
  let result = 0;
  if (/master|playlist|index/i.test(url.pathname)) result += 8;
  if (/stream\.mux\.com$/i.test(url.hostname)) result += 6;
  if (/audio|subtitle|caption/i.test(url.pathname)) result -= 8;
  if (/\.m3u8$/i.test(url.pathname)) result += 2;
  return result;
}

async function requestCandidate(request: Request): Promise<HlsCandidate | null> {
  if (!isHlsUrl(request.url())) return null;
  const headers = await request.allHeaders().catch(() => request.headers());
  return { url: request.url(), headers };
}

function stringsFromPage() {
  const pageGlobal = globalThis as unknown as {
    performance: { getEntriesByType(type: string): Array<{ name: string }> };
    document: { querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }> };
  };
  const values = new Set<string>();
  for (const entry of pageGlobal.performance.getEntriesByType('resource')) values.add(entry.name);
  for (const element of Array.from(pageGlobal.document.querySelectorAll('[src], [playback-id], [stream-type]'))) {
    for (const name of ['src', 'playback-id']) {
      const value = element.getAttribute(name);
      if (value) values.add(value);
    }
  }
  return [...values];
}

export async function resolveFencingTvStream(sourceUrl: string) {
  const reference = parseFencingTvUrl(sourceUrl);
  const executablePath = await findBrowserExecutable();
  const storageState = await loadFencingTvStorageState();
  const browser = await chromium.launch({
    executablePath,
    headless: config.captureWorker.headless,
    args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  const candidates = new Map<string, HlsCandidate>();
  try {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    page.on('request', (request) => {
      void requestCandidate(request).then((candidate) => {
        if (candidate) candidates.set(candidate.url, candidate);
      });
    });
    await page.goto(reference.canonicalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.captureWorker.navigationTimeoutMs,
    });
    if (new URL(page.url()).pathname.startsWith('/auth/login')) {
      throw new Error('The saved FencingTV session has expired. Run npm run auth:fencingtv again.');
    }

    const triggerPlayback = async () => {
      await page.locator('video').first().evaluate((video: unknown) => (video as { play: () => Promise<void> }).play()).catch(() => undefined);
      await page.locator('mux-player').first().evaluate((player: unknown) => (player as { play?: () => Promise<void> }).play?.()).catch(() => undefined);
      await page.getByRole('button', { name: /play/i }).first().click({ timeout: 2_000 }).catch(() => undefined);
    };
    await triggerPlayback();

    const deadline = Date.now() + config.captureWorker.streamTimeoutMs;
    while (Date.now() < deadline && !selectHlsCandidate(candidates.values())) {
      for (const value of await page.evaluate(stringsFromPage).catch(() => [] as string[])) {
        if (isHlsUrl(value)) candidates.set(value, { url: value, headers: {} });
      }
      await page.waitForTimeout(500);
    }
    const selected = selectHlsCandidate(candidates.values());
    if (!selected) {
      throw new Error('No HLS playlist appeared after playback. Confirm the saved account can play this bout; DRM-protected streams are not supported.');
    }

    const cookies = await context.cookies(selected.url);
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const headers: Record<string, string> = {
      ...selected.headers,
      referer: reference.canonicalUrl,
      origin: new URL(reference.canonicalUrl).origin,
      'user-agent': userAgent,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    };
    return { hlsUrl: selected.url, headers };
  } finally {
    await browser.close();
  }
}

export function defaultStorageStatePath() {
  return path.join(os.homedir(), '.sabre-studio', 'fencingtv-storage-state.json');
}
