import { stableHash } from '../analysis/domain.ts';

export type IngestionSourceType = 'upload' | 'youtube' | 'fencingtv';

export interface DiscoveredMedia {
  externalId: string;
  externalUrl?: string;
  title: string;
  metadata: Record<string, unknown>;
  dedupKey: string;
}

export interface DiscoveryResult {
  items: DiscoveredMedia[];
  checkpoint?: Record<string, unknown>;
}

export interface DiscoveryRequest {
  ownerId: string;
  checkpoint?: Record<string, unknown>;
  limit: number;
  dryRun: boolean;
}

export interface ExternalSourceAdapter {
  readonly type: IngestionSourceType;
  discover(request: DiscoveryRequest): Promise<DiscoveryResult>;
  materialize(item: DiscoveredMedia): Promise<{ s3Key: string }>;
}

function list(name: string) {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function ingestionPolicy(type: IngestionSourceType) {
  const globalEnabled = /^(1|true|yes)$/i.test(process.env.INGESTION_ENABLED ?? 'false');
  const sourceEnabled =
    type === 'upload' ||
    /^(1|true|yes)$/i.test(process.env[`INGESTION_${type.toUpperCase()}_ENABLED`] ?? 'false');
  return {
    enabled: type === 'upload' || (globalEnabled && sourceEnabled),
    dryRun:
      type !== 'upload' &&
      !/^(0|false|no)$/i.test(process.env.INGESTION_DRY_RUN ?? 'true'),
    quota: Number(process.env[`INGESTION_${type.toUpperCase()}_QUOTA`] ?? 0),
    allow: list(`INGESTION_${type.toUpperCase()}_ALLOW`),
    deny: list(`INGESTION_${type.toUpperCase()}_DENY`),
  };
}

class UploadAdapter implements ExternalSourceAdapter {
  readonly type = 'upload' as const;

  async discover(): Promise<DiscoveryResult> {
    return { items: [] };
  }

  async materialize(item: DiscoveredMedia) {
    const key = item.metadata.s3Key;
    if (typeof key !== 'string') throw new Error('Upload metadata is missing s3Key');
    return { s3Key: key };
  }
}

class DisabledExternalAdapter implements ExternalSourceAdapter {
  readonly type: 'youtube' | 'fencingtv';

  constructor(type: 'youtube' | 'fencingtv') {
    this.type = type;
  }

  async discover(_request: DiscoveryRequest): Promise<DiscoveryResult> {
    const policy = ingestionPolicy(this.type);
    if (!policy.enabled) {
      return {
        items: [],
        checkpoint: {
          disabled: true,
          source: this.type,
          inspectedAt: Date.now(),
        },
      };
    }
    throw new Error(
      `${this.type} discovery is feature-gated but no compliant discovery implementation is active`,
    );
  }

  async materialize(): Promise<{ s3Key: string }> {
    throw new Error(`${this.type} downloading is intentionally disabled`);
  }
}

export const ingestionAdapters: Record<IngestionSourceType, ExternalSourceAdapter> = {
  upload: new UploadAdapter(),
  youtube: new DisabledExternalAdapter('youtube'),
  fencingtv: new DisabledExternalAdapter('fencingtv'),
};

export function ingestionDedupKey(type: IngestionSourceType, externalId: string) {
  return stableHash({ type, externalId: externalId.trim().toLowerCase() });
}
