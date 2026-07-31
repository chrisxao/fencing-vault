import 'dotenv/config';
import { requireAdmin } from './auth.ts';
import { deleteObject, listObjects } from './storage.ts';
import { ownerFromKey } from './media-routes.ts';

const intervalMs = Number(process.env.MEDIA_CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const derivedRetentionMs =
  Number(process.env.ANALYSIS_CLIP_RETENTION_HOURS ?? 168) * 60 * 60 * 1000;
const orphanGraceMs = Number(process.env.MEDIA_ORPHAN_GRACE_HOURS ?? 24) * 60 * 60 * 1000;
const enabled = /^(1|true|yes)$/i.test(process.env.MEDIA_CLEANUP_ENABLED ?? 'false');

async function scan(prefix: 'analysis/' | 'uploads/') {
  let continuationToken: string | undefined;
  do {
    const page = await listObjects(prefix, continuationToken);
    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.LastModified) continue;
      const age = Date.now() - object.LastModified.getTime();
      let shouldDelete = prefix === 'analysis/' && age >= derivedRetentionMs;
      if (prefix === 'uploads/' && age >= orphanGraceMs) {
        const parsed = ownerFromKey(object.Key);
        if (parsed) {
          const result = await requireAdmin().query({
            videos: {
              $: {
                where: {
                  id: parsed.videoId,
                  'owner.id': parsed.ownerId,
                  s3Key: object.Key,
                },
              },
            },
          });
          shouldDelete = result.videos.length === 0;
        }
      }
      if (shouldDelete) {
        if (enabled) await deleteObject(object.Key);
        console.log(JSON.stringify({ event: enabled ? 'media_deleted' : 'media_cleanup_dry_run', key: object.Key }));
      }
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

async function cleanup() {
  await scan('analysis/');
  await scan('uploads/');
}

await cleanup();
setInterval(() => cleanup().catch((error) => console.error('[cleanup-worker]', error)), intervalMs);
console.log(`[cleanup-worker] ready (${enabled ? 'delete enabled' : 'dry run'})`);
