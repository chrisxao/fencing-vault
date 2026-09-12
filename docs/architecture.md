# Architecture

Sabre Studio is a modular monolith for one owner. Keeping the labeler and statistics together makes iteration fast; the model worker remains a separate process because video decoding and GPU dependencies have different scaling needs.

```text
Browser labeler
  ├─ metadata, labels, stats ───────► Express API ─────► PostgreSQL
  ├─ direct presigned video PUT ───► S3 / Railway Bucket
  └─ signed playback GET ◄───────── S3 / Railway Bucket

Capture CLI ── FFmpeg + ffprobe ──► S3 + Express API
ML worker   ── source/proxy video ─► model proposals ──► human review queue
Rules desk  ── FIE/USA corpus ─────► cited context ────► event-graph caller
```

## Trust and provenance

The immutable source video, media checksum, frame timestamps, label revisions, action taxonomy, ruleset edition, dataset export, model version, and human decision are separate records. A model proposal never overwrites a human label. PostgreSQL mode snapshots old phrase/event payloads before updates.

The application has a single password-protected owner session. Videos upload from the browser directly to a private bucket through short-lived presigned URLs. Database and bucket credentials remain server-side. FencingTV browser credentials are never stored by Sabre Studio.

## Core data hierarchy

```text
Tournament → Bout → Media asset
                  ├─ Phrase → Timestamped events
                  ├─ Pose/weapon keyframes
                  └─ Ingestion and model jobs

Team/Country → Membership → Fencer → side-aware aggregate stats
Rule source → Passage → rule refs attached to calls/events
Dataset export → Model run → proposal → human review
```

`left` and `right` always mean screen position for that bout. Named identity and track identity are stored separately so a camera cut or mirrored source cannot silently swap athletes.

## Why PostgreSQL + S3

PostgreSQL provides transactions, constraints, revision history, full-text rule retrieval, and reproducible aggregate queries. Object storage holds large immutable videos and derived proxies. The web container stays stateless, which fits Railway deploys and permits a later worker service without migrating the application database.
