# Railway deployment

The topology is one stateless web service, one capture worker service, one PostgreSQL service, and one private Bucket. A later CPU job service can normalize video; GPU training should consume exported manifests and write artifacts back to the same bucket.

## Provision

1. Create a Railway project from this repository and use the repository root (`/`) as the service root directory, with config file `/railway.toml`.
2. Add PostgreSQL. Reference its private `DATABASE_URL` in the web service.
3. Add a Bucket. Reference its `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` variables in the web service.
4. Configure Bucket CORS to allow `PUT`, `GET`, and `HEAD` from the final application domain and the `Content-Type` header. Direct browser uploads will fail without this.
5. Generate `APP_PASSWORD` and a random `SESSION_SECRET` of at least 32 characters. Set `AUTO_MIGRATE=true` for the first private deployment.
6. Run `npm run auth:fencingtv` locally. Base64-encode the generated storage-state JSON and store it as the sealed `FENCINGTV_STORAGE_STATE_BASE64` variable. Treat it like a password and rotate it by logging in again when the session expires.
7. Add a second service from the same repository with root directory `/` and config file `/railway.worker.toml`. It uses `Dockerfile.worker`, which contains Chromium and FFmpeg. Give it the same PostgreSQL and Bucket references as the web service.
8. Set `FENCINGTV_CAPTURE_ENABLED=true` on both services after the worker is configured, then deploy. `railway.toml` gives the web service its health check; the worker has no public domain.

For an existing Sabre Studio service, clear the former `sabre-studio` root directory and update any config-file or watch paths to the repository root before deploying this layout.

Required production variables:

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_PASSWORD=...
SESSION_SECRET=...
AWS_ENDPOINT_URL=${{Bucket.AWS_ENDPOINT_URL}}
AWS_S3_BUCKET_NAME=${{Bucket.AWS_S3_BUCKET_NAME}}
AWS_DEFAULT_REGION=${{Bucket.AWS_DEFAULT_REGION}}
AWS_ACCESS_KEY_ID=${{Bucket.AWS_ACCESS_KEY_ID}}
AWS_SECRET_ACCESS_KEY=${{Bucket.AWS_SECRET_ACCESS_KEY}}
FENCINGTV_DISCOVERY_ENABLED=true
FENCINGTV_CAPTURE_ENABLED=true
```

Worker-only variables:

```text
FENCINGTV_STORAGE_STATE_BASE64=...
FENCINGTV_BROWSER_EXECUTABLE=/usr/bin/chromium
FENCINGTV_HEADLESS=true
FENCINGTV_MAX_CLIP_SECONDS=7200
CAPTURE_WORKER_POLL_MS=5000
CAPTURE_WORKER_LEASE_SECONDS=900
CAPTURE_WORKER_MAX_ATTEMPTS=3
CAPTURE_WORKER_RETRY_BASE_SECONDS=60
```

Variable names exposed by a Railway Bucket can be referenced rather than copied; use the exact names shown in that service if they differ. Keep PostgreSQL and worker traffic on Railway private networking. Only the web service needs a public domain.

## Storage behavior

The browser asks the API for a 15-minute presigned `PUT`, uploads directly to the bucket, then records the object key. Playback uses a one-hour signed `GET`. The current single-upload limit is 4 GiB, below S3’s 5 GiB single-PUT ceiling. Multipart upload is the next increment if full tournament recordings exceed that; one-bout captures should normally remain below it.

## Backups and updates

- Enable PostgreSQL backups before labeling irreplaceable footage.
- Treat bucket source videos as immutable; derived proxies use different prefixes.
- Run `npm run rules:check` on rule-update days, then `npm run rules:index` against the production database after reviewing source editions.
- Export a JSON dataset manifest at each model-training milestone and retain its checksum with the model run.
