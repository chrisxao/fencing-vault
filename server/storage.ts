import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.ts';

let client: S3Client | null = null;

export function storageConfigured() {
  return Boolean(
    config.s3.endpoint &&
      config.s3.bucket &&
      config.s3.accessKeyId &&
      config.s3.secretAccessKey,
  );
}

function s3() {
  if (!storageConfigured()) throw new Error('S3-compatible storage is not configured');
  client ??= new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
  return client;
}

function safeFilename(value: string) {
  const cleaned = value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'video.mp4').slice(-160);
}

export async function presignVideoUpload(input: {
  boutId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}) {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > config.maxUploadBytes) {
    throw new Error(`Video size must be between 1 byte and ${config.maxUploadBytes} bytes`);
  }
  if (!input.contentType.startsWith('video/')) throw new Error('Only video uploads are accepted');
  const objectKey = `source-videos/${input.boutId}/${crypto.randomUUID()}-${safeFilename(input.filename)}`;
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      Metadata: { boutId: input.boutId },
    }),
    { expiresIn: 15 * 60 },
  );
  return { objectKey, uploadUrl, expiresInSeconds: 15 * 60 };
}

export async function presignPlayback(objectKey: string) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey }),
    { expiresIn: 60 * 60 },
  );
}

export async function uploadVideoFile(input: {
  boutId: string;
  filePath: string;
  filename?: string;
  contentType?: string;
  checksum?: string;
  objectKey?: string;
}) {
  const stat = await fsp.stat(input.filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > config.maxUploadBytes) {
    throw new Error(`Captured video size must be between 1 byte and ${config.maxUploadBytes} bytes`);
  }
  const filename = safeFilename(input.filename ?? path.basename(input.filePath));
  const objectKey = input.objectKey ?? `source-videos/${input.boutId}/${crypto.randomUUID()}-${filename}`;
  if (!objectKey.startsWith(`source-videos/${input.boutId}/`) || objectKey.includes('..')) {
    throw new Error('Capture object key is outside the bout source-video prefix');
  }
  await s3().send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: objectKey,
    Body: fs.createReadStream(input.filePath),
    ContentType: input.contentType ?? 'video/mp4',
    ContentLength: stat.size,
    Metadata: {
      boutId: input.boutId,
      ...(input.checksum ? { sha256: input.checksum } : {}),
    },
  }));
  return { objectKey, sizeBytes: stat.size, filename };
}
