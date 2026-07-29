# Fencing Vault

A video-analysis app for fencers. Upload bout videos, segment them into touches, label every
action, comment on any frame, and track your strengths and weaknesses over time.

Runs as a **web app**, **iOS / Android** (Capacitor), and **desktop** (Electron) from one React
codebase.

- **Frontend**: React + TypeScript (Vite), Recharts
- **Data & auth**: [InstantDB](https://instantdb.com) (magic-code email sign-in, realtime sync)
- **Video storage**: any S3-compatible object storage (built for Railway buckets / MinIO), with a
  local-disk fallback for development
- **Native**: Capacitor 8 (iOS + Android), Electron (macOS / Windows / Linux)

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
| `INSTANT_APP_ADMIN_TOKEN` | Secret admin token from the Instant dashboard (never commit) |
| `VITE_API_URL` | Deployed upload API origin for mobile/desktop builds (empty = Vite `/api` proxy) |
| `S3_ENDPOINT` | Endpoint URL of your Railway bucket (or any S3-compatible store) |
| `S3_BUCKET` | Bucket name |
| `S3_REGION` | Usually `auto` for S3-compatible providers |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Bucket credentials |

**No bucket yet?** Leave the `S3_*` variables empty and uploads are stored on local disk under
`./uploads` — perfect for development.

#### Railway object storage

In Railway, create a **Bucket** service in your project, then copy its connection values into
`.env`: the endpoint URL → `S3_ENDPOINT`, bucket name → `S3_BUCKET`, and the generated access
key/secret → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`. The server automatically uses path-style
addressing (`forcePathStyle`) whenever a custom endpoint is set, which S3-compatible providers
require. Uploads and playback both use short-lived presigned URLs, so the bucket can stay private.

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

## Desktop (Electron)

```bash
# Dev window against the Vite server + API
npm run desktop:dev

# Packaged installers (dmg/zip, nsis, AppImage) → ./release
npm run desktop:build

# Unpackaged app dir (faster smoke test)
npm run desktop:build:dir
```

Packaged builds load the static `dist/` files. For video upload/playback in a packaged app, set
`VITE_API_URL` to your deployed API origin **before** `desktop:build`.

## Mobile (Capacitor — iOS & Android)

Requirements:

- **iOS**: macOS + Xcode + CocoaPods (or Swift Package Manager via Capacitor 8)
- **Android**: Android Studio + SDK

```bash
# Build the web UI and copy it into the native projects
npm run mobile:sync

# Open in Xcode / Android Studio
npm run mobile:ios
npm run mobile:android
```

Then run on a simulator/emulator or device from the IDE.

### Pointing mobile builds at the API

Packaged Capacitor apps cannot use the Vite `/api` proxy. Set `VITE_API_URL` to a reachable API
origin, then rebuild and sync:

```bash
# Example: API deployed on Railway
echo 'VITE_API_URL=https://your-api.up.railway.app' >> .env
npm run mobile:sync
```

For **local device testing** against your laptop API:

1. Put your machine's LAN IP in `VITE_API_URL` (e.g. `http://192.168.1.20:8787`) and rebuild.
2. Optionally live-reload the UI from Vite by temporarily adding to `capacitor.config.json`:

```json
"server": {
  "url": "http://192.168.1.20:5173",
  "cleartext": true
}
```

(Remove `server.url` before shipping.)

### Shipping notes

- App ID is `com.fencingvault.app` (change in `capacitor.config.json` / `electron-builder.yml` if
  you need a different bundle ID).
- Icons/splash screens live under `ios/App/App/Assets.xcassets` and
  `android/app/src/main/res/` — replace the Capacitor defaults before store submission.
- iOS App Store and Google Play both need developer accounts and signing setup in Xcode /
  Android Studio.

## How data is modeled

- `videos` — title, weapon, storage key, optional opponent/event/bout date
- `segments` — one touch: `startTime`/`endTime` (seconds), general category, result, notes, linked labels
- `comments` — linked to a segment (touch discussion) or to the video with a `timestamp` (frame comment)
- `labels` — per-user action taxonomy; defaults are seeded on first sign-in, custom labels supported

Permissions (`instant.perms.ts`) restrict every entity to its owner.
