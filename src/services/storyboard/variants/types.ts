import type {
  JsonObject,
  StoryboardFingerprint,
  TimelineVariantOption,
  TimelineVariantScope,
  TimelineVariantSet,
} from '../contracts';

export type VariantLinkedExpansionPolicy = 'none' | 'linked-clips';
export type VariantBoundaryMutationPolicy = 'preserve' | 'rebuild' | 'drop-with-warning';

export interface VariantSourceTrack {
  id: string;
  kind: 'video' | 'audio';
  payload: JsonObject;
}

export interface VariantSourceClip {
  id: string;
  /**
   * Stable identity retained by split fragments. Defaults to id at capture.
   */
  sourceClipId?: string;
  trackId: string;
  startTime: number;
  endTime: number;
  sourceStartSeconds?: number;
  linkedClipIds: string[];
  payload: JsonObject;
}

export interface VariantSourceTransition {
  id: string;
  trackId: string;
  time: number;
  fromClipId?: string;
  toClipId?: string;
  payload: JsonObject;
}

export interface VariantTimelineSourceSnapshot {
  schemaVersion: 1;
  compositionId: string;
  scope: TimelineVariantScope;
  boundaryPaddingSeconds: number;
  tracks: VariantSourceTrack[];
  clips: VariantSourceClip[];
  transitions: VariantSourceTransition[];
  globalState: JsonObject;
}

export type VariantClipRangeRelation =
  | 'inside'
  | 'crosses-start'
  | 'crosses-end'
  | 'covers-range';

export interface VariantClipSegment {
  clipId: string;
  sourceClipId: string;
  trackId: string;
  startTime: number;
  endTime: number;
  sourceStartSeconds?: number;
  payload: JsonObject;
}

export interface VariantCapturedClip {
  clipId: string;
  sourceClipId: string;
  trackId: string;
  relation: VariantClipRangeRelation;
  inside: VariantClipSegment;
  beforeRange?: VariantClipSegment;
  afterRange?: VariantClipSegment;
  linkedExpansion: boolean;
}

export interface VariantRangeSnapshot {
  schemaVersion: 1;
  compositionId: string;
  scope: TimelineVariantScope;
  boundaryPaddingSeconds: number;
  linkedExpansionPolicy: VariantLinkedExpansionPolicy;
  linkedExpansionClipIds: string[];
  linkedExpansionTrackIds: string[];
  capturedClips: VariantCapturedClip[];
  source: VariantTimelineSourceSnapshot;
}

export interface VariantFingerprintClipSegment {
  sourceClipId: string;
  trackId: string;
  startTime: number;
  endTime: number;
  sourceStartSeconds?: number;
  payload: JsonObject;
}

export interface VariantFingerprintTransition {
  id: string;
  trackId: string;
  time: number;
  fromSourceClipId?: string;
  toSourceClipId?: string;
  payload: JsonObject;
}

export interface VariantScopeFingerprintInput {
  schemaVersion: 1;
  kind: 'scope';
  compositionId: string;
  scope: TimelineVariantScope;
  linkedExpansionPolicy: VariantLinkedExpansionPolicy;
  linkedExpansionClipIds: string[];
  clipSegments: VariantFingerprintClipSegment[];
  transitions: VariantFingerprintTransition[];
}

export interface VariantBoundaryFingerprintInput {
  schemaVersion: 1;
  kind: 'boundary';
  compositionId: string;
  scope: TimelineVariantScope;
  boundaryPaddingSeconds: number;
  clipSegments: VariantFingerprintClipSegment[];
  transitions: VariantFingerprintTransition[];
}

export interface VariantOutsideFingerprintInput {
  schemaVersion: 1;
  kind: 'outside';
  compositionId: string;
  scope: TimelineVariantScope;
  boundaryPaddingSeconds: number;
  tracks: VariantSourceTrack[];
  clipSegments: VariantFingerprintClipSegment[];
  transitions: VariantFingerprintTransition[];
  globalState: JsonObject;
}

export interface VariantFingerprintInputs {
  scope: VariantScopeFingerprintInput;
  boundary: VariantBoundaryFingerprintInput;
  outside: VariantOutsideFingerprintInput;
}

export interface VariantSnapshotFingerprints {
  scope: StoryboardFingerprint;
  boundary: StoryboardFingerprint;
  outside: StoryboardFingerprint;
}

export interface StoryboardVariantWorkspaceState {
  schemaVersion: 1;
  variantSets: Record<string, TimelineVariantSet>;
  variantOptions: Record<string, TimelineVariantOption>;
  rangeSnapshots: Record<string, VariantRangeSnapshot>;
}

export type VariantIsolationViolationKind =
  | 'scope-changed'
  | 'linked-policy-changed'
  | 'stale-scope'
  | 'stale-boundary'
  | 'outside-mutation'
  | 'boundary-mutation';

export interface VariantIsolationViolation {
  kind: VariantIsolationViolationKind;
  message: string;
  expected?: string;
  actual?: string;
}

export type VariantIsolationResult =
  | {
      ok: true;
      before: VariantSnapshotFingerprints;
      after: VariantSnapshotFingerprints;
    }
  | {
      ok: false;
      before: VariantSnapshotFingerprints;
      after: VariantSnapshotFingerprints;
      violations: VariantIsolationViolation[];
    };
