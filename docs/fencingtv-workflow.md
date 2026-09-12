# FencingTV workflow

Sabre Studio supports four paths because authentication and player delivery can change independently of the labeling system.

## 1. Discover current or completed events

The Import page reads public competition/video links from [FencingTV competitions](https://fencingtv.com/competitions) and [FencingTV videos](https://fencingtv.com/videos), cached for 15 minutes. If the page stops exposing server-rendered links, use “Open calendar” and paste the detail URL. Every URL is canonicalized and deduplicated.

## 2. Create a source record

Choose `Reference now` to create the bout without copying video. This is useful for cataloging live/current events before a replay is available. Choose `I’ll upload a screen recording` when that is the simplest route.

## 3. Record the bout window

FencingTV replays often represent one piste for an entire competition day. In Sabre Studio, enter the desired bout's start and end timestamps exactly as shown by that full recording. Automatic capture requires both values and rejects reversed or overly long windows.

## 4. Capture an authenticated replay automatically

Create a local authenticated session file:

```bash
npm run auth:fencingtv
```

The command opens FencingTV in a normal local Chromium browser. Log in there and press Enter in the terminal after the account page loads. Credentials are never accepted by the script; the resulting Playwright storage-state file contains sensitive session cookies and must be treated like a password.

Configure `FENCINGTV_STORAGE_STATE_PATH`, set `FENCINGTV_CAPTURE_ENABLED=true`, and run:

```bash
npm run worker:capture
```

The worker claims one PostgreSQL ingestion job with a lease, opens the source using the saved session, observes the HLS playlist requested by the player, captures only the submitted bout window, probes and hashes the result, uploads it to object storage, and atomically marks the media and job ready. It retries transient failures with exponential backoff. Expired login sessions and unsupported DRM fail with an actionable message; the worker does not attempt to bypass DRM.

## 5. Manual authenticated replay fallback

Log into FencingTV in your normal browser and play the exact bout. In Developer Tools → Network, filter for `m3u8`. Either copy the playlist URL or save a HAR after playback begins.

```bash
APP_PASSWORD='studio password' npm run capture:fencingtv -- \
  --hls='https://stream…/master.m3u8?token=…' \
  --url='https://fencingtv.com/videos/…' \
  --start='01:12:30' \
  --end='01:16:45' \
  --output='./captures/bout.mp4' \
  --bout-id='UUID from Sabre Studio'
```

Use `--har=/path/session.har` instead of `--hls` to discover the playlist from a saved log. For sessions that require cookie forwarding, export a temporary Netscape cookie file and add `--cookies=/path/cookies.txt`.

The script requires `--start` and `--end`, accurately trims that window into normalized H.264/AAC, reads duration/frame rate/resolution with ffprobe, requests a presigned upload, and attaches the object key to the bout. HARs, cookies, signed HLS URLs, and captures are ignored by Git when kept under the recommended local folders. Delete temporary HAR/cookie files when finished.

## 6. Screen-recording fallback

Record only the bout player at the highest stable frame rate available, ideally 60 fps. Do not alter playback speed. Include enough pre-roll to capture the first `Play` and enough post-roll to capture the referee signal and score update. Upload it through the Screen recording tab and retain the FencingTV source URL.

## Normalization job (next worker increment)

For each newly attached video, a worker should create:

- immutable source checksum and ffprobe metadata;
- 720p seek proxy with fixed keyframe interval;
- exact presentation-timestamp map (`frame ↔ source PTS`);
- audio waveform and optional referee-speech regions;
- sampled thumbnails for annotation navigation.

Labels always bind to source milliseconds and frame numbers, never only to proxy frame indices.
