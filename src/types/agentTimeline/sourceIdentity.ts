/**
 * Durable identity for a binary source used by Agent Timeline sidecars.
 *
 * `metadata` intentionally excludes browser-provided names and modification
 * timestamps: they do not describe the bytes and would make equivalent binary
 * sources differ.
 */
export const SOURCE_IDENTITY_SCHEMA_VERSION = 'agent-timeline-source-identity/v1' as const;

export type SourceIdentityStrategy = 'sampled-chunks' | 'full-stream';

export interface SourceIdentityMetadata {
  size: number;
  mediaType: string;
}

export interface SourceIdentity {
  type: 'source-identity';
  version: typeof SOURCE_IDENTITY_SCHEMA_VERSION;
  strategy: SourceIdentityStrategy;
  hashAlgorithm: 'sha-256';
  hash: string;
  metadata: SourceIdentityMetadata;
}
