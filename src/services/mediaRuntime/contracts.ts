export type MediaRuntimeKind = 'video' | 'audio' | 'image';

export type RuntimeSessionKey = string;

export type DecodeSessionPolicy =
  | 'interactive'
  | 'background'
  | 'export'
  | 'ram-preview';

declare const runtimeSourceIdBrand: unique symbol;

export type RuntimeSourceId = string & {
  readonly [runtimeSourceIdBrand]: 'RuntimeSourceId';
};

export type MediaAssetRefKind =
  | MediaRuntimeKind
  | 'model'
  | 'gaussian-avatar'
  | 'gaussian-splat'
  | 'motion'
  | 'signal'
  | 'unknown';

export type MediaAssetRefOrigin =
  | 'media-file'
  | 'signal-asset'
  | 'generated'
  | 'project-cache'
  | 'external'
  | 'unknown';

export interface MediaSourceMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  audioCodec?: string;
  container?: string;
  hasAudio?: boolean;
  mimeType?: string;
}

export interface MediaAssetFingerprint {
  fileHash?: string;
  fileSize?: number;
  fileLastModified?: number;
  sourcePath?: string;
  projectPath?: string;
}

export interface MediaFileAssetRef {
  origin: 'media-file';
  mediaFileId: string;
  kind: Exclude<MediaAssetRefKind, 'signal'>;
  fileName?: string;
  fingerprint?: MediaAssetFingerprint;
  metadata?: MediaSourceMetadata;
}

export interface SignalMediaAssetRef {
  origin: 'signal-asset';
  signalAssetId: string;
  signalRefId?: string;
  artifactId?: string;
  kind: 'signal';
  fileName?: string;
  fingerprint?: MediaAssetFingerprint;
  metadata?: MediaSourceMetadata;
}

export interface ExternalMediaAssetRef {
  origin: Exclude<MediaAssetRefOrigin, 'media-file' | 'signal-asset'>;
  assetId: string;
  kind: MediaAssetRefKind;
  fileName?: string;
  fingerprint?: MediaAssetFingerprint;
  metadata?: MediaSourceMetadata;
}

export type MediaAssetRef =
  | MediaFileAssetRef
  | SignalMediaAssetRef
  | ExternalMediaAssetRef;

export interface TimelineSourceRef {
  clipId: string;
  sourceType: string;
  assetRef: MediaAssetRef;
  mediaFileId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  sourcePath?: string;
  projectPath?: string;
}

export type MediaRuntimeLeaseStatus = 'pending' | 'active' | 'released';

export interface MediaRuntimeLease<RuntimeHandles = unknown> {
  runtimeSourceId: RuntimeSourceId;
  runtimeSessionKey?: RuntimeSessionKey;
  ownerId: string;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus;
  acquiredAt: number;
  releasedAt?: number;
  acquire(): MediaRuntimeLease<RuntimeHandles> | Promise<MediaRuntimeLease<RuntimeHandles>>;
  release(reason?: string): void | Promise<void>;
  getRuntimeHandles(): RuntimeHandles | null;
}
