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

Deploy the repository as one public Railway service backed by one connected Bucket. The Express
process serves both `/api` and the production Vite build, so a separate static service is neither
needed nor supported by the same-origin configuration.

Configure the public service with:

- Build command: `npm run build`
- Start command: `npm start`
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
generation; it never uploads to or downloads from a bucket.

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

# Start Expo from the repository root
npm run mobile

# Or launch a platform directly
npm run mobile:ios
npm run mobile:android
```

Set `EXPO_PUBLIC_INSTANT_APP_ID` to the same app ID as `VITE_INSTANT_APP_ID`, and set
`EXPO_PUBLIC_API_URL` to the Express server's origin. A physical device needs your computer's LAN
address (for example `http://192.168.1.20:8787`), not `localhost`.

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
