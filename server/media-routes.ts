import crypto from 'node:crypto';
import type { Express, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from './auth.ts';
import { requireUser, type AuthedRequest } from './auth-middleware.ts';
import { deleteObject, getObjectUrl, headObject, listObjects, putObjectUrl } from './storage.ts';

const allowedTypes = new Set(
  (process.env.MEDIA_ALLOWED_TYPES ?? 'video/mp4,video/quicktime,video/webm,video/x-m4v')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
export const maxUploadBytes = Number(process.env.MEDIA_MAX_UPLOAD_BYTES ?? 2_147_483_648);
const uuid = z.string().uuid();
const requestSchema = z.object({
  videoId: uuid,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  contentLength: z.number().int().positive(),
});
const completeSchema = z.object({
  key: z.string(),
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});

function sanitizeName(value: string) {
  const name = (value.split(/[\\/]/).pop() ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return name.slice(-80) || 'video.mp4';
}

export function originalKey(ownerId: string, videoId: string, fileName: string) {
  return `uploads/${ownerId}/${videoId}/${crypto.randomUUID()}__${sanitizeName(fileName)}`;
}

export function ownerFromKey(key: string) {
  const match =
    /^(?:uploads|analysis)\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/[a-zA-Z0-9/_.-]+$/.exec(key);
  return match ? { ownerId: match[1], videoId: match[2] } : null;
}

function validateMedia(contentType: string, contentLength: number): string | null {
  if (!allowedTypes.has(contentType.toLowerCase())) return 'Unsupported video content type';
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return 'Invalid content length';
  if (contentLength > maxUploadBytes) {
    return `Video exceeds the ${Math.floor(maxUploadBytes / 1024 / 1024)} MB upload limit`;
  }
  return null;
}

async function assertVideoOwnership(userId: string, key: string, videoId?: string) {
  const result = await requireAdmin().query({
    videos: {
      $: {
        where: {
          ...(videoId ? { id: videoId } : {}),
          'owner.id': userId,
          s3Key: key,
        },
      },
    },
  });
  return result.videos.length === 1;
}

function parseOrReply<T>(
  schema: z.ZodType<T>,
  input: unknown,
  res: Response,
): T | undefined {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }
  return parsed.data;
}

export function registerMediaRoutes(app: Express) {
  app.post('/api/presign-upload', requireUser, async (req: AuthedRequest, res) => {
    const input = parseOrReply(requestSchema, req.body, res);
    if (!input) return;
    const mediaError = validateMedia(input.contentType, input.contentLength);
    if (mediaError) {
      res.status(413).json({ error: mediaError });
      return;
    }
    const key = originalKey(req.instantUser!.id, input.videoId, input.fileName);
    try {
      const uploadUrl = await putObjectUrl(key, input.contentType, input.contentLength);
      res.json({
        key,
        uploadUrl,
        storage: 's3',
        expiresIn: 900,
        requiredHeaders: { 'Content-Type': input.contentType },
      });
    } catch (error) {
      console.error('presign failed', error);
      res.status(500).json({ error: 'Failed to create upload URL' });
    }
  });

  app.post('/api/uploads/complete', requireUser, async (req: AuthedRequest, res) => {
    const input = parseOrReply(completeSchema, req.body, res);
    if (!input) return;
    const ownership = ownerFromKey(input.key);
    if (!ownership || ownership.ownerId !== req.instantUser!.id) {
      res.status(403).json({ error: 'Upload does not belong to this account' });
      return;
    }
    const mediaError = validateMedia(input.contentType, input.contentLength);
    if (mediaError) {
      await deleteObject(input.key).catch(() => undefined);
      res.status(413).json({ error: mediaError });
      return;
    }
    try {
      const head = await headObject(input.key);
      const actualType = head.ContentType?.toLowerCase();
      if (head.ContentLength !== input.contentLength || actualType !== input.contentType.toLowerCase()) {
        await deleteObject(input.key).catch(() => undefined);
        res.status(422).json({ error: 'Uploaded object did not match the declared type and size' });
        return;
      }
      res.json({
        ok: true,
        key: input.key,
        size: head.ContentLength,
        contentType: head.ContentType,
        checksum: head.ChecksumSHA256 ?? head.ETag?.replaceAll('"', '') ?? null,
      });
    } catch (error) {
      console.error('upload completion failed', error);
      res.status(422).json({ error: 'Upload was not found or is incomplete' });
    }
  });

  app.get('/api/playback-url', requireUser, async (req: AuthedRequest, res) => {
    const key = String(req.query.key ?? '');
    const ownership = ownerFromKey(key);
    if (ownership && ownership.ownerId !== req.instantUser!.id) {
      res.status(403).json({ error: 'Video does not belong to this account' });
      return;
    }
    try {
      if (!(await assertVideoOwnership(req.instantUser!.id, key, ownership?.videoId))) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }
      await headObject(key);
      res.json({ url: await getObjectUrl(key) });
    } catch (error) {
      console.error('playback-url failed', error);
      res.status(404).json({ error: 'Video file not found' });
    }
  });

  app.delete('/api/videos/:videoId', requireUser, async (req: AuthedRequest, res) => {
    const videoId = uuid.safeParse(req.params.videoId);
    if (!videoId.success) {
      res.status(400).json({ error: 'Invalid video id' });
      return;
    }
    const admin = requireAdmin();
    const data = await admin.query({
      videos: {
        $: { where: { id: videoId.data, 'owner.id': req.instantUser!.id } },
      },
    });
    const video = data.videos[0];
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    await admin.transact(admin.tx.videos[video.id].delete());

    const cleanupFailures: string[] = [];
    const sourceKey = String(video.s3Key);
    await deleteObject(sourceKey).catch((error) => {
      console.error('source media cleanup failed', error);
      cleanupFailures.push(sourceKey);
    });
    const prefix = `analysis/${req.instantUser!.id}/${video.id}/`;
    let continuationToken: string | undefined;
    do {
      const page = await listObjects(prefix, continuationToken).catch((error) => {
        console.error('analysis media listing failed', error);
        cleanupFailures.push(prefix);
        return null;
      });
      if (!page) break;
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        await deleteObject(object.Key).catch((error) => {
          console.error('analysis media cleanup failed', error);
          cleanupFailures.push(object.Key!);
        });
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken);

    res.json({ ok: true, cleanupPending: cleanupFailures.length > 0 });
  });

  app.delete('/api/media', requireUser, async (req: AuthedRequest, res) => {
    const key = String(req.query.key ?? '');
    const ownership = ownerFromKey(key);
    if (ownership && ownership.ownerId !== req.instantUser!.id) {
      res.status(403).json({ error: 'Media does not belong to this account' });
      return;
    }
    try {
      if (!ownership && !(await assertVideoOwnership(req.instantUser!.id, key))) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }
      await deleteObject(key);
      res.status(204).end();
    } catch (error) {
      console.error('media delete failed', error);
      res.status(500).json({ error: 'Failed to delete media' });
    }
  });
}
