import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
}

interface StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const config: Partial<StorageConfig> = {
  endpoint: firstEnv('AWS_ENDPOINT_URL', 'S3_ENDPOINT'),
  bucket: firstEnv('AWS_S3_BUCKET_NAME', 'S3_BUCKET'),
  region: firstEnv('AWS_DEFAULT_REGION', 'S3_REGION'),
  accessKeyId: firstEnv('AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID'),
  secretAccessKey: firstEnv('AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY'),
};

const required = [
  ['endpoint', 'AWS_ENDPOINT_URL (or S3_ENDPOINT)'],
  ['bucket', 'AWS_S3_BUCKET_NAME (or S3_BUCKET)'],
  ['region', 'AWS_DEFAULT_REGION (or S3_REGION)'],
  ['accessKeyId', 'AWS_ACCESS_KEY_ID (or S3_ACCESS_KEY_ID)'],
  ['secretAccessKey', 'AWS_SECRET_ACCESS_KEY (or S3_SECRET_ACCESS_KEY)'],
] as const satisfies ReadonlyArray<[keyof StorageConfig, string]>;

const missing = required.filter(([key]) => !config[key]).map(([, label]) => label);
if (missing.length) {
  throw new Error(`[storage] Missing required S3 configuration: ${missing.join(', ')}`);
}

const storageConfig = config as StorageConfig;
export const storageBucket = storageConfig.bucket;
export const forcePathStyle = /^(1|true|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? '');
export const s3 = new S3Client({
  endpoint: storageConfig.endpoint,
  region: storageConfig.region,
  credentials: {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  },
  forcePathStyle,
});

export function putObjectUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = 900,
) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn },
  );
}

export function getObjectUrl(key: string, expiresIn = 900) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: storageBucket, Key: key }),
    { expiresIn },
  );
}

export function headObject(key: string): Promise<HeadObjectCommandOutput> {
  return s3.send(new HeadObjectCommand({ Bucket: storageBucket, Key: key }));
}

export function deleteObject(key: string) {
  return s3.send(new DeleteObjectCommand({ Bucket: storageBucket, Key: key }));
}

export function listObjects(prefix: string, continuationToken?: string) {
  return s3.send(
    new ListObjectsV2Command({
      Bucket: storageBucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }),
  );
}
