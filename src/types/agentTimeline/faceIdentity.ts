import type { SourceIdentity } from './sourceIdentity';

export const FACE_IDENTITY_REMAP_SCHEMA_VERSION = 'agent-timeline-face-remap/v1' as const;
export const FACE_IDENTITY_ANNOTATION_SCHEMA_VERSION = 'agent-timeline-face-annotations/v1' as const;

export interface ShardFaceTrackRef {
  shardId: string;
  shardTrackId: string;
}

export interface ShardFaceMatchCandidate {
  target: ShardFaceTrackRef;
  confidence: number;
  method: 'numeric-prototype' | 'overlap-continuity' | 'legacy-source-cluster';
}

export interface ShardFaceTrack {
  ref: ShardFaceTrackRef;
  appearanceCount: number;
  candidates: ShardFaceMatchCandidate[];
}

export interface FaceIdentityThresholdPolicy {
  policyVersion: string;
  acceptConfidence: number;
  minimumMargin: number;
}

export interface FaceIdentityPrivacyPolicy {
  prototypePersistence: 'disabled' | 'metadata-only';
  allowProjectPersonLinks: boolean;
}

export interface FacePrototypeMetadata {
  dimensions: number;
  sampleCount: number;
  quantization: 'none' | 'int8' | 'float16';
}

export interface SourceFaceIdentity {
  sourcePersonId: string;
  memberTracks: ShardFaceTrackRef[];
  confidence: number;
  decision: 'new-source-track' | 'threshold-match' | 'previous-remap' | 'manual';
  supersededSourcePersonIds?: string[];
  prototypeMetadata?: FacePrototypeMetadata;
}

export interface FaceTrackRemap {
  track: ShardFaceTrackRef;
  sourcePersonId?: string;
  status: 'resolved' | 'unknown' | 'manual';
  confidence: number;
  reason: 'new-source-track' | 'threshold-match' | 'previous-remap' | 'low-confidence' | 'insufficient-margin' | 'manual';
}

export interface ProjectPersonLink {
  sourcePersonId: string;
  projectPersonId: string;
  annotationId: string;
}

export type FaceIdentityManualOperation =
  | {
      type: 'assign-track';
      track: ShardFaceTrackRef;
      targetSourcePersonId: string;
    }
  | {
      type: 'merge-source-identities';
      sourcePersonIds: string[];
      targetSourcePersonId: string;
    }
  | {
      type: 'split-tracks';
      tracks: ShardFaceTrackRef[];
      targetSourcePersonId: string;
    }
  | {
      type: 'link-project-person';
      sourcePersonId: string;
      projectPersonId: string;
    }
  | {
      type: 'unlink-project-person';
      sourcePersonId: string;
    };

export interface FaceIdentityManualAnnotation {
  id: string;
  createdAt: string;
  operation: FaceIdentityManualOperation;
}

export interface FaceIdentityAnnotationLayer {
  schemaVersion: typeof FACE_IDENTITY_ANNOTATION_SCHEMA_VERSION;
  sourceIdentity: SourceIdentity;
  annotations: FaceIdentityManualAnnotation[];
}

export interface FaceIdentityOrphanedAnnotation {
  annotation: FaceIdentityManualAnnotation;
  reason: 'source-identity-mismatch';
}

export interface FaceIdentityRemapLayer {
  schemaVersion: typeof FACE_IDENTITY_REMAP_SCHEMA_VERSION;
  sourceIdentity: SourceIdentity;
  generatedAt: string;
  thresholdPolicy: FaceIdentityThresholdPolicy;
  privacyPolicy: FaceIdentityPrivacyPolicy;
  sourceIdentities: SourceFaceIdentity[];
  trackRemaps: FaceTrackRemap[];
  projectPersonLinks: ProjectPersonLink[];
  appliedAnnotationIds: string[];
  orphanedAnnotations: FaceIdentityOrphanedAnnotation[];
}
