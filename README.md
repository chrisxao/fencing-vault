# Fencing Vault

A video-analysis app for fencers. Upload bout videos, segment them into touches, label every
action, comment on any frame, and track your strengths and weaknesses over time.

Runs as a React web app and an Expo React Native app for iOS and Android.

- **Frontend**: React + TypeScript (Vite), Recharts
- **Data & auth**: [InstantDB](https://instantdb.com) with email/password (custom auth via Admin SDK)
- **Video storage**: required S3-compatible object storage (built for Railway buckets / MinIO)
- **Native**: Expo 57 + React Native, using the Expo managed workflow

## Features

- **Dashboard** — upload videos (weapon type: foil / épée / sabre, plus opponent, event, bout date),
  see touch counts and scores per bout.
- **Bout analyzer** — frame-step playback (1/30s), slow motion, touch segmentation by timestamp
  (mark start → mark end), per-touch replay that auto-pauses at the end of the point.
- **Labels** — every touch gets a result (scored / received / double / simultaneous / no touch),
  a general category (short/long attack, short/long defense, middle — middle only for foil & sabre),
  and specific action labels (attack on preparation, reprise, beat attack, parry riposte, …).
  Add your own custom labels inline.
- **Comments** — threaded comments per touch, plus frame comments pinned to any timestamp.
- **Stats** — filter by video / weapon / period (last month, 3 months, year, all time), switch
  between bar, pie, radar and trend charts, per-action success table, and automatic
  strength/weakness callouts.

## Setup

### 1. Install & configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | What it is |
| --- | --- |
| `VITE_INSTANT_APP_ID` | Public app ID from [instantdb.com](https://instantdb.com) |
| `INSTANT_APP_ADMIN_TOKEN` | Secret admin token — required for password auth (never commit) |
| `VITE_API_URL` | Optional API origin for separate clients; keep empty for local Vite and combined Railway deployments |
| `AWS_ENDPOINT_URL` | S3 base endpoint from Railway's **AWS SDK (Generic)** preset |
| `AWS_S3_BUCKET_NAME` | Globally unique S3 bucket name from the preset |
| `AWS_DEFAULT_REGION` | Bucket region from the preset (usually `auto`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Bucket credentials from the preset |
| `S3_FORCE_PATH_STYLE` | Set `true` only for providers that require path-style URLs; default `false` |

The existing `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and
`S3_SECRET_ACCESS_KEY` aliases remain supported for other S3-compatible providers.

Video storage is required in local development as well as production. Configure all five storage
values before starting the API; startup fails with a list of any missing variables. The server does
not store uploads on local disk.

#### Railway object storage

In Railway, connect the **Bucket** service to the API service and choose the **AWS SDK (Generic)**
preset. Railway injects `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_S3_URL_STYLE=virtual`.

Current Railway buckets require virtual-hosted-style URLs, so leave `S3_FORCE_PATH_STYLE` unset or
`false`. For MinIO or another provider that explicitly requires path-style addressing, set
`S3_FORCE_PATH_STYLE=true`. Uploads and playback both use short-lived presigned URLs, so the bucket
can remain private.

#### Railway deployment

Deploy the repository as one public API service plus private worker services backed by one Redis
service and one connected Bucket. The API process serves both `/api` and the production Vite build,
so a separate static service is neither needed nor supported by the same-origin configuration.

Configure the public service with:

- Build command: `npm run build`
- Start command: `npm start`
- `SERVICE_ROLE=api` (optional because `api` is the default)
- `VITE_API_URL`: leave empty or unset so browser requests use the public service's own `/api`
- `VITE_INSTANT_APP_ID` and `INSTANT_APP_ADMIN_TOKEN`: set from the Instant dashboard
- Bucket variables: connect the Bucket using Railway's **AWS SDK (Generic)** preset

Railway supplies `PORT`; the server listens on that port at `0.0.0.0`. Set the Railway health-check
path to `/api/health`. A healthy deployment returns JSON with `ok: true` there, serves HTML from `/`
and BrowserRouter paths such as `/settings`, returns a JSON `404` for unknown `/api/...` paths, and
routes `POST /api/auth/signin` to Express rather than the static host.

To verify the same production topology locally after building:

```bash
npm run build
npm run smoke:production
```

The production smoke test supplies isolated dummy S3 values and only checks presigned URL
authentication boundaries; it never uploads to or downloads from a bucket.

### Automated analysis services

The analysis MVP runs as separate processes from the public API:

- `npm run start:api` — web/API service; starts normally without Redis
- `npm run start:media-worker` — one FFmpeg preprocessing worker
- `npm run start:vlm-worker` — BullMQ/OpenRouter inference worker; each clip is an independent,
  idempotent job, so replicas parallelize a single long video
- `npm run start:cleanup-worker` — derived-clip and orphan scanner; deletion remains disabled until
  `MEDIA_CLEANUP_ENABLED=true`

Use the checked-in Dockerfile for all services; it installs FFmpeg/ffprobe and runs `npm start`.
Set `SERVICE_ROLE` to `media-worker`, `vlm-worker`, or `cleanup-worker` on each private worker
service. The shared entrypoint exposes `/api/health` on every role, so the checked-in Railway health
check works without per-service start-command overrides. Connect one private Railway Redis service
to the API and workers through `REDIS_URL`. Connect the Bucket and Instant admin credentials to the
API and all workers. Set `OPENROUTER_MODEL=google/gemini-3.1-flash-lite` on both the API and VLM
worker so the API's config hash and persisted model match worker execution. Give
`OPENROUTER_API_KEY` only to the VLM worker. Workers need no public domain.

Analysis requests are authenticated and idempotent by video, source object checksum, and pipeline
configuration. `POST /api/analysis/start`, `GET /api/analysis/:jobId`,
`POST /api/analysis/:jobId/retry`, and `POST /api/analysis/:jobId/cancel` all verify ownership
through the Instant Admin SDK. If Redis is absent they return `503 ANALYSIS_UNAVAILABLE`; unrelated
API and web routes remain available.

Each clip persists its validated detection or negative result, usage, cost, status, and attempt
count. A deterministic finalization job runs only after every clip succeeds, deduplicates detections,
and writes candidates and parent totals under a Redis lock. Terminal clip failure fails the parent;
cancel and retry apply to every clip in that analysis run.

`POST /api/analysis/candidates/:candidateId/review` accepts authenticated `accept`, `correct`, and
`reject` decisions. Accepted/corrected candidates upsert one deterministic normal segment, while
rejections remove that candidate's generated segment. Every request appends immutable before/after
feedback. Web and mobile show current-run markers, progress, evidence, and explicit review controls.

Uploads require a bearer token, declared MIME type and byte length, a client-generated video UUID,
and a completion call that verifies the object with S3 `HeadObject`. Playback is owner-scoped and
uses 15-minute URLs. The MVP uses bounded single presigned PUTs (2 GiB by default), not multipart;
change `MEDIA_MAX_UPLOAD_BYTES` only if the selected S3 provider supports the desired single-PUT
size. Failed uploads older than `MEDIA_ORPHAN_GRACE_HOURS` are cleanup candidates.

Run focused pipeline tests and an optional labeled-model bake-off with:

```bash
npm test
npm run analysis:bakeoff -- path/to/labeled-fixtures.json
```

The bake-off registry is provider-neutral and can be replaced with
`ANALYSIS_MODEL_REGISTRY_JSON`. The built-in default enables the GA
`google/gemini-3.1-flash-lite` model (currently listed at $0.25/M input tokens and $1.50/M output
tokens). Qwen candidates remain registered but disabled because their current OpenRouter endpoints
do not satisfy the enforced ZDR route. OpenRouter calls request strict JSON, deny provider data
collection, request ZDR, disable provider fallback, and retain raw responses for audit. Native video
requests fall back to base64 video and then sampled image frames when provider media support requires
it; every fallback retains the same privacy controls.

### 2. Push the InstantDB schema (one-time, recommended)

```bash
npx instant-cli@latest login   # opens a browser to authenticate
npx instant-cli@latest push    # pushes instant.schema.ts + instant.perms.ts
```

### 3. Run the web app

```bash
npm run dev
```

Vite on [http://localhost:5173](http://localhost:5173); upload API on port `8787` (proxied under `/api`).

## Mobile (Expo — iOS & Android)

The native client lives in `mobile/` and shares the InstantDB schema, password-auth API, and upload
API with the web app.

```bash
cp mobile/.env.example mobile/.env
npm --prefix mobile install

# Start the API and Expo together from the repository root
npm run dev:mobile

# Or launch a platform directly
npm run dev:mobile:ios
npm run dev:mobile:android
```

Set `EXPO_PUBLIC_INSTANT_APP_ID` to the same app ID as `VITE_INSTANT_APP_ID`, and set
`EXPO_PUBLIC_API_URL` to the Express server's origin. The iOS simulator can use
`http://127.0.0.1:8787`; a physical device needs your computer's current LAN address, not a sample
or stale IP. The `dev:mobile*` scripts start Express and Expo together. The `mobile*` scripts start
only Expo and require `npm run dev:api` in another terminal.

This project intentionally uses Expo's managed workflow: there are no checked-in `ios/` or
`android/` projects. Use EAS Build for signed App Store and Play Store binaries. See
[`mobile/README.md`](mobile/README.md) for mobile-specific setup.

Run `npm run mobile:typecheck` to check the native client.

## How data is modeled

- `profiles` — display name, default weapon, linked 1:1 to the Instant user
- `credentials` — password hashes (server/admin only; never exposed to the client)
- `videos` — title, weapon, storage key, optional opponent/event/bout date
- `segments` — one touch: `startTime`/`endTime` (seconds), general category, result, notes, linked labels
- `comments` — linked to a segment (touch discussion) or to the video with a `timestamp` (frame comment)
- `labels` — per-user action taxonomy; defaults are seeded on first sign-in, custom labels supported

Permissions (`instant.perms.ts`) restrict every entity to its owner. Password credentials are locked
to admin-only access.

Analysis adds `analysisJobs`, `analysisClips`, `analysisCandidates`, `analysisFeedback`,
`ingestionSources`, and `ingestionJobs`. Generated candidates stay separate from `segments`, so
unreviewed model output never changes bout statistics. Push the updated schema and permissions only
after reviewing them; this repository does not push them automatically.
