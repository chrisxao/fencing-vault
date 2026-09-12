import type { Pool, PoolClient } from 'pg';
import type { VideoProbe } from './media-tools.ts';

export type CaptureJobState = 'discovered' | 'capturing' | 'uploading' | 'ready' | 'failed';

export interface CaptureJob {
  id: string;
  boutId: string;
  sourceUrl: string;
  state: CaptureJobState;
  attempts: number;
  metadata: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
}

export interface CompletedCapture extends VideoProbe {
  objectKey: string;
  filename: string;
  sizeBytes: number;
  checksum: string;
  normalized: boolean;
}

function captureJob(row: Record<string, unknown>): CaptureJob {
  return {
    id: String(row.id),
    boutId: String(row.bout_id),
    sourceUrl: String(row.source_url),
    state: String(row.state) as CaptureJobState,
    attempts: Number(row.attempts),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    checkpoint: (row.checkpoint ?? {}) as Record<string, unknown>,
  };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class CaptureQueue {
  private readonly pool: Pool;
  private readonly workerId: string;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;
  private readonly retryBaseSeconds: number;

  constructor(
    pool: Pool,
    workerId: string,
    maxAttempts: number,
    leaseSeconds: number,
    retryBaseSeconds: number,
  ) {
    this.pool = pool;
    this.workerId = workerId;
    this.maxAttempts = maxAttempts;
    this.leaseSeconds = leaseSeconds;
    this.retryBaseSeconds = retryBaseSeconds;
  }

  async claim() {
    await this.pool.query(`UPDATE ingestion_jobs
      SET state='failed', error='Capture attempts exhausted', locked_at=NULL, locked_by=NULL, updated_at=now()
      WHERE provider='fencingtv' AND capture_mode='browser-session' AND state='discovered' AND attempts >= $1`,
    [this.maxAttempts]);

    const result = await this.pool.query(`WITH candidate AS (
      SELECT id FROM ingestion_jobs
      WHERE provider='fencingtv' AND capture_mode='browser-session' AND bout_id IS NOT NULL AND attempts < $2
        AND (
          (state='discovered' AND available_at <= now()) OR
          (state IN ('capturing','uploading') AND locked_at < now() - ($3 * interval '1 second'))
        )
      ORDER BY available_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ingestion_jobs AS job
      SET state='capturing', attempts=job.attempts + 1, locked_at=now(), locked_by=$1,
          error='', checkpoint=job.checkpoint || '{"stage":"claimed"}'::jsonb, updated_at=now()
    FROM candidate
    WHERE job.id=candidate.id
    RETURNING job.*`,
    [this.workerId, this.maxAttempts, this.leaseSeconds]);
    return result.rowCount ? captureJob(result.rows[0]) : null;
  }

  async heartbeat(jobId: string, stage: string, state: 'capturing' | 'uploading' = 'capturing', detail: Record<string, unknown> = {}) {
    const result = await this.pool.query(`UPDATE ingestion_jobs
      SET state=$3, checkpoint=checkpoint || $4::jsonb, locked_at=now(), updated_at=now()
      WHERE id=$1 AND locked_by=$2 AND state IN ('capturing','uploading')`,
    [jobId, this.workerId, state, JSON.stringify({ stage, ...detail })]);
    if (!result.rowCount) throw new Error('Capture job lease was lost');
  }

  async complete(job: CaptureJob, capture: CompletedCapture) {
    await transaction(this.pool, async (client) => {
      const media = await client.query(`UPDATE media_assets SET
        kind='external', object_key=$2, external_url=$3, filename=$4, mime_type='video/mp4', size_bytes=$5,
        checksum=$6, duration_ms=$7, fps=$8, width=$9, height=$10, frame_count=$11,
        status='ready', updated_at=now()
        WHERE bout_id=$1
        RETURNING id`,
      [job.boutId, capture.objectKey, job.sourceUrl, capture.filename, capture.sizeBytes, capture.checksum,
        capture.durationMs, capture.fps, capture.width, capture.height, capture.frameCount]);
      if (!media.rowCount) throw new Error('Capture job has no media record');

      await client.query(`UPDATE bouts SET status=CASE WHEN status='queued' THEN 'ready' ELSE status END, updated_at=now() WHERE id=$1`, [job.boutId]);
      const completed = await client.query(`UPDATE ingestion_jobs SET
        state='ready', metadata=metadata || $4::jsonb, checkpoint=checkpoint || '{"stage":"ready"}'::jsonb,
        error='', locked_at=NULL, locked_by=NULL, completed_at=now(), updated_at=now()
        WHERE id=$1 AND locked_by=$2 AND state='uploading' AND bout_id=$3`,
      [job.id, this.workerId, job.boutId, JSON.stringify({
        capture: {
          objectKey: capture.objectKey,
          sizeBytes: capture.sizeBytes,
          checksum: capture.checksum,
          durationMs: capture.durationMs,
          fps: capture.fps,
          width: capture.width,
          height: capture.height,
          frameCount: capture.frameCount,
          normalized: capture.normalized,
        },
      })]);
      if (!completed.rowCount) throw new Error('Capture job lease was lost before completion');
    });
  }

  async fail(job: CaptureJob, error: string) {
    const finalAttempt = job.attempts >= this.maxAttempts;
    const delaySeconds = Math.min(60 * 60, this.retryBaseSeconds * (2 ** Math.max(0, job.attempts - 1)));
    await transaction(this.pool, async (client) => {
      const result = await client.query(`UPDATE ingestion_jobs SET
        state=$3, error=$4, available_at=CASE WHEN $3='failed' THEN available_at ELSE now() + ($5 * interval '1 second') END,
        checkpoint=checkpoint || $6::jsonb, locked_at=NULL, locked_by=NULL, updated_at=now()
        WHERE id=$1 AND locked_by=$2 AND state IN ('capturing','uploading')`,
      [job.id, this.workerId, finalAttempt ? 'failed' : 'discovered', error.slice(0, 4_000), delaySeconds,
        JSON.stringify({ stage: finalAttempt ? 'failed' : 'retrying', retryInSeconds: finalAttempt ? null : delaySeconds })]);
      if (!result.rowCount) return;
      if (finalAttempt) {
        await client.query(`UPDATE media_assets SET status='failed', updated_at=now() WHERE bout_id=$1 AND object_key IS NULL`, [job.boutId]);
      }
    });
  }
}
