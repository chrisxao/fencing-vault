# Fencing Vault

A video-analysis webapp for fencers. Upload bout videos, segment them into touches, label every
action, comment on any frame, and track your strengths and weaknesses over time.

- **Frontend**: React + TypeScript (Vite), Recharts
- **Data & auth**: [InstantDB](https://instantdb.com) (magic-code email sign-in, realtime sync)
- **Video storage**: any S3-compatible object storage (built for Railway buckets / MinIO), with a
  local-disk fallback for development

## Features

- **Dashboard** — upload videos (weapon type: foil / épée / sabre, plus opponent, event, bout date),
  see touch counts and scores per bout.
- **Bout analyzer** — frame-step playback (1/30s), slow motion, touch segmentation by timestamp
  (mark start → mark end), per-touch replay that auto-pauses at the end of the point.
- **Labels** — every touch gets a result (scored / received / double / simultaneous / no touch),
  a general category (short/long attack, short/long defense, middle — middle only for foil & sabre),
  and any number of specific action labels (attack on preparation, reprise, parry riposte, counter
  attack, prise de fer, attack en fer, …). Add your own custom labels inline.
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

The app works schemaless out of the box (Instant creates attributes on the fly), but pushing the
schema enables server-side validation, cascade deletes, and permission rules:

```bash
npx instant-cli@latest login   # opens a browser to authenticate
npx instant-cli@latest push    # pushes instant.schema.ts + instant.perms.ts
```

### 3. Run

```bash
npm run dev
```

This starts the Vite dev server on [http://localhost:5173](http://localhost:5173) and the
upload/playback API on port 8787 (proxied under `/api`).

## How data is modeled

- `videos` — title, weapon, storage key, optional opponent/event/bout date
- `segments` — one touch: `startTime`/`endTime` (seconds), general category, result, notes, linked labels
- `comments` — linked to a segment (touch discussion) or to the video with a `timestamp` (frame comment)
- `labels` — per-user action taxonomy; defaults are seeded on first sign-in, custom labels supported

Permissions (`instant.perms.ts`) restrict every entity to its owner.
