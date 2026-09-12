import assert from 'node:assert/strict';
import test from 'node:test';
import { isHlsUrl, selectHlsCandidate } from '../server/capture/fencingtv-browser.ts';
import { redactWorkerError } from '../server/capture/worker.ts';
import { fencingTvDedupKey, fencingTvImportSchema, parseFencingTvUrl } from '../shared/fencingtv.ts';

test('FencingTV bout URLs are canonicalized as individual capture sources', () => {
  assert.deepEqual(
    parseFencingTvUrl('https://fencingtv.com/competitions/world-cup/bouts/019f92dc-990b-7932-b910-be70418bb415?autoplay=1'),
    {
      kind: 'bout',
      canonicalUrl: 'https://fencingtv.com/competitions/world-cup/bouts/019f92dc-990b-7932-b910-be70418bb415',
      slug: '019f92dc-990b-7932-b910-be70418bb415',
    },
  );
});

test('automatic capture requires a valid window in the full-piste recording', () => {
  const base = {
    url: 'https://fencingtv.com/videos/example',
    title: 'Example bout',
    captureMode: 'browser-session' as const,
  };
  assert.equal(fencingTvImportSchema.safeParse(base).success, false);
  assert.equal(fencingTvImportSchema.safeParse({ ...base, captureStartMs: 3_000, captureEndMs: 2_000 }).success, false);
  assert.equal(fencingTvImportSchema.safeParse({ ...base, captureStartMs: 2_000, captureEndMs: 3_000 }).success, true);
});

test('different bouts in one piste recording have distinct ingestion identities', () => {
  const source = 'https://fencingtv.com/videos/piste-8';
  assert.notEqual(fencingTvDedupKey(source, 60_000, 120_000), fencingTvDedupKey(source, 180_000, 240_000));
  assert.equal(fencingTvDedupKey(source, 60_000, 120_000), fencingTvDedupKey(`${source}?autoplay=1`, 60_000, 120_000));
});

test('HLS selection prefers the observed Mux master playlist', () => {
  assert.equal(isHlsUrl('https://stream.mux.com/id.m3u8?token=secret'), true);
  assert.equal(isHlsUrl('http://stream.mux.com/id.m3u8'), false);
  const selected = selectHlsCandidate([
    { url: 'https://cdn.example.com/audio.m3u8', headers: {} },
    { url: 'https://stream.mux.com/id/master.m3u8?token=secret', headers: { referer: 'https://fencingtv.com/' } },
  ]);
  assert.equal(selected?.url, 'https://stream.mux.com/id/master.m3u8?token=secret');
});

test('capture worker errors redact signed stream credentials', () => {
  const message = redactWorkerError(new Error('GET https://stream.mux.com/id.m3u8?token=secret&foo=bar\nCookie: session=private'));
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('session=private'), false);
  assert.match(message, /token=\[redacted\]/);
  assert.match(message, /Cookie: \[redacted\]/);
});
