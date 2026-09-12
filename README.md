# Sabre Studio

A private, rule-aware workspace for sabre video intake, frame-accurate labeling, model training data, and bout/fencer/team statistics.

Sabre Studio is the sole application in this repository. All development focuses on sabre analysis, with the web app, capture worker, database migrations, and sabre ML package maintained together at the repository root.

## What works now

- FencingTV public catalog discovery, leased authenticated-browser capture jobs, exact bout-window clipping, and screen-recording/direct-upload fallbacks.
- Phrase start/end marking, including no-touch referee halts, violations, equipment issues, and broadcast cuts.
- Timestamped preparation, footwork, blade, attack, defense, priority, hit, referee, and violation events.
- Editable action taxonomy with stable training keys.
- Left/right body and weapon keypoints, piste positions, opponent distance, and occlusion labels.
- Calls separated into observation, ordered events, score effect, explanation, rule references, and human review state.
- Bout, fencer, and team/country aggregate statistics.
- Versioned FIE/USA rules layer with curated sabre passages and optional full-rulebook indexing.
- PostgreSQL revision history, S3-compatible video storage, JSON dataset export, and Railway-ready deployment.
- A stage-gated Python ML package, including a BiFenceNet-style skeleton TCN baseline.

## Run locally

Node 22+ is required. Run these commands from the repository root:

```bash
npm install
npm run dev
```

Open `http://localhost:5174`. With no `DATABASE_URL`, the app starts in ephemeral demo mode using fictional fencers. For persistent local data, copy `.env.example`, start PostgreSQL with `docker compose up postgres`, and run `npm run db:migrate`.

Production build and checks:

```bash
npm test
npm run build
npm run rules:check
```

## Rule corpus

The built-in rules desk uses dated source manifests and curated evidence cards. To download and index the complete official FIE and USA PDFs into PostgreSQL, install Poppler (`pdftotext`) and run:

```bash
npm run rules:index
```

The downloaded source files and generated local corpus are gitignored. Every reviewed call still requires an explicit rule reference; retrieval never substitutes for observed video evidence.

## FencingTV capture

First save a FencingTV browser session. This opens a local browser; enter the credentials there, never in Sabre Studio or chat:

```bash
npm run auth:fencingtv
```

Set `FENCINGTV_STORAGE_STATE_PATH` to the saved file, enable `FENCINGTV_CAPTURE_ENABLED`, and start the worker beside the web app:

```bash
npm run worker:capture
```

On import, enter the desired bout's start and end timestamps within the full-day piste recording. The worker observes the authenticated player's HLS request, clips only that window with FFmpeg, uploads it to object storage, and attaches it to the bout. Jobs use database leases, exponential retry, and visible capture state in the labeler.

The manual HAR/HLS command remains available as a fallback:

```bash
APP_PASSWORD='your-studio-password' npm run capture:fencingtv -- \
  --har=/path/to/session.har \
  --url=https://fencingtv.com/videos/example \
  --start=01:12:30 \
  --end=01:16:45 \
  --output=./captures/example.mp4 \
  --bout-id=YOUR_BOUT_UUID
```

The fallback command uses FFmpeg to accurately trim and normalize the submitted bout window, preserves a local copy, probes timing, uploads directly to object storage, and attaches it to the bout. See `docs/fencingtv-workflow.md`.

## Documentation

- `docs/architecture.md` — services, data model, and trust boundaries
- `docs/labeling-guide.md` — the manual annotation protocol
- `docs/ml-roadmap.md` — staged models, dataset targets, metrics, and gates
- `docs/fencingtv-workflow.md` — current/completed event intake and capture options
- `docs/railway-deployment.md` — Railway web, PostgreSQL, and Bucket setup

Official rule sources are the [FIE Rules portal](https://fie.org/documents/rules), [FIE Technical Rules (August 2026)](https://static.fie.org/uploads/40/204138-Technical%20rules%20August%202026%20ang.pdf), [USA Fencing Rules for Competition (November 2025)](https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt0f86b976c72458f2/690baa8337acae1b6b5ac0d3/2025-11_USA_Fencing_Rules.pdf), and [USA Fencing referee guidance](https://www.usafencing.org/Referee-faq-and-guidelines).
