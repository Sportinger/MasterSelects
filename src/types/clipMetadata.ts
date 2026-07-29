// Transcript word/chunk for speech-to-text
export interface TranscriptWord {
  id: string;
  text: string;
  start: number;        // Start time in seconds (relative to clip source)
  end: number;          // End time in seconds (relative to clip source)
  confidence?: number;  // 0-1 confidence score
  speaker?: string;     // Speaker label if diarization available
  speakerConfidence?: number; // 0-1 confidence in the diarized speaker label
  speakerSourceProvider?: TranscriptProviderId;
  sourceProvider?: TranscriptWordSource;
  agreement?: TranscriptWordAgreement;
  needsReview?: boolean;
  originalSpeaker?: string;
  alternatives?: TranscriptWordAlternative[];
  // Acoustically refined timings from the transcript-timing artifact.
  // start/end stay the provider-reported values and are never mutated.
  alignedStart?: number;
  alignedEnd?: number;
  alignmentConfidence?: number;
  alignmentMethod?: TranscriptAlignmentMethod;
  emphasis?: number; // 0..1, prosody-derived
}

export type TranscriptAlignmentMethod = 'acoustic-refine' | 'ctc-align' | 'whisperx';

export type TranscriptProviderId = 'deepgram' | 'openai';
export type TranscriptWordSource = TranscriptProviderId | 'consensus';
export type TranscriptWordAgreement = 'consensus' | 'primary-only' | 'secondary-only' | 'conflict';

export interface TranscriptWordAlternative {
  id: string;
  provider: TranscriptProviderId;
  text?: string;
  speaker?: string;
  confidence?: number;
}

export interface TranscriptProviderRun {
  id: string;
  provider: TranscriptProviderId;
  model: string;
  language: string;
  range: [number, number];
  createdAt: number;
  words: TranscriptWord[];
}

export type TranscriptConflictKind = 'text' | 'speaker' | 'insertion' | 'deletion';
export type TranscriptConflictStatus =
  | 'resolved-deterministic'
  | 'resolved-agent'
  | 'needs-review';

export interface TranscriptConflictCandidate {
  id: string;
  provider?: TranscriptProviderId;
  text?: string;
  speaker?: string;
  confidence?: number;
}

export interface TranscriptConflict {
  id: string;
  kind: TranscriptConflictKind;
  start: number;
  end: number;
  finalWordIds: string[];
  deepgramWordIds: string[];
  openaiWordIds: string[];
  candidates: TranscriptConflictCandidate[];
  status: TranscriptConflictStatus;
  selectedCandidateId?: string;
  confidence?: number;
  reason?: string;
}

export interface TranscriptPatch {
  id: string;
  conflictId: string;
  source: 'deterministic' | 'agent' | 'manual';
  operation: 'choose-text' | 'reassign-speaker' | 'insert-word' | 'delete-word';
  wordIds: string[];
  before: string;
  after: string;
  confidence: number;
  reason: string;
  createdAt?: number;
}

export interface TranscriptFusionAgentAudit {
  status: 'not-requested' | 'unavailable' | 'completed' | 'failed';
  model?: string;
  reviewedConflictIds?: string[];
  appliedConflictIds?: string[];
  error?: string;
}

export interface TranscriptFusionArtifact {
  schemaVersion: 1;
  primaryProvider: 'deepgram';
  createdAt: number;
  providerStatuses?: Record<TranscriptProviderId, TranscriptFusionProviderStatus>;
  rawRuns: TranscriptProviderRun[];
  words: TranscriptWord[];
  conflicts: TranscriptConflict[];
  patches: TranscriptPatch[];
  agent: TranscriptFusionAgentAudit;
}

export type TranscriptFusionStage =
  | 'transcribing'
  | 'aligning'
  | 'finalizing'
  | 'complete'
  | 'error';

export type TranscriptFusionProviderStatus = 'waiting' | 'running' | 'complete' | 'error';

export interface TranscriptProviderProgress {
  completedChunks: number;
  totalChunks: number;
  percent: number;
}

export interface TranscriptFusionProgress {
  stage: TranscriptFusionStage;
  range: [number, number];
  providers: Record<TranscriptProviderId, TranscriptFusionProviderStatus>;
  providerProgress?: Record<TranscriptProviderId, TranscriptProviderProgress>;
  mergeProgress?: number;
  conflictCount: number;
  resolvedCount: number;
  updatedAt: number;
}

// Scene description types for AI video analysis
export type SceneDescriptionStatus = 'none' | 'describing' | 'ready' | 'error';

export interface SceneSegment {
  id: string;
  text: string;
  start: number;        // Start time in seconds (relative to clip source)
  end: number;          // End time in seconds (relative to clip source)
}

// Transcript status
export type TranscriptStatus = 'none' | 'transcribing' | 'ready' | 'error';

// Analysis types for focus/motion/face detection
export type AnalysisStatus = 'none' | 'analyzing' | 'ready' | 'error';

export type FaceAnalysisStatus = AnalysisStatus;
export type FaceAnalysisBackend = 'webgpu' | 'wasm' | 'cached';

export interface FaceAnalysisPoint {
  x: number; // Normalized source coordinate (0-1)
  y: number; // Normalized source coordinate (0-1)
}

export interface FaceAnalysisBox extends FaceAnalysisPoint {
  width: number;  // Normalized source width (0-1)
  height: number; // Normalized source height (0-1)
}

export interface FaceFrameDetection {
  id: string;
  personId: string;
  label: string;
  /** False when YuNet found a face too small for dependable SFace grouping. */
  identityEligible?: boolean;
  /** Original identity when a user manually moves this observation. */
  manualSourcePersonId?: string;
  confidence: number;
  box: FaceAnalysisBox;
  landmarks: FaceAnalysisPoint[];
}

export interface FaceAppearanceRange {
  start: number; // Source time in seconds
  end: number;   // Source time in seconds
}

export interface FacePersonSummary {
  id: string;
  label: string;
  firstSeen: number;
  lastSeen: number;
  sampleCount: number;
  averageConfidence: number;
  maxConfidence: number;
  appearances: FaceAppearanceRange[];
}

export interface FaceAnalysisResult {
  schemaVersion: 1;
  modelVersion: string;
  detector: 'YuNet';
  recognizer: 'SFace';
  backend: FaceAnalysisBackend;
  observationCount: number;
  people: FacePersonSummary[];
}

export interface FrameAnalysisData {
  timestamp: number;      // Time in seconds (relative to clip source)
  motion: number;         // 0-1 overall motion score (legacy, kept for compatibility)
  globalMotion: number;   // 0-1 camera/scene motion (whole frame changes uniformly)
  localMotion: number;    // 0-1 object motion (localized changes within frame)
  motionMeanMagnitude?: number; // GPU optical-flow magnitude in analysis pixels
  motionMeanX?: number;   // Mean optical-flow X; see motionVectorConvention
  motionMeanY?: number;   // Mean optical-flow Y; see motionVectorConvention
  motionDirectionCoherence?: number; // 0-1 directional agreement
  motionCoverageRatio?: number; // 0-1 moving-pixel coverage
  motionVectorConvention?: 'camera-motion' | 'image-flow';
  focus: number;          // 0-1 focus/sharpness score
  brightness: number;     // 0-1 brightness/luminance score
  faceCount: number;      // Number of faces detected
  faces?: FaceFrameDetection[]; // YuNet boxes + anonymous SFace identity groups
  faceModelVersion?: string; // Cache compatibility marker
  isSceneCut?: boolean;   // True if this frame is likely a scene cut
}

export interface ClipAnalysis {
  frames: FrameAnalysisData[];
  sampleInterval: number; // Milliseconds between samples
  faceAnalysis?: FaceAnalysisResult;
}

/** Segment-based thumbnails for nested composition clips */
export interface ClipSegment {
  clipId: string;       // ID of the source clip in the nested composition
  clipName: string;     // Name for debugging
  startNorm: number;    // Normalized start position (0-1)
  endNorm: number;      // Normalized end position (0-1)
  thumbnails: string[]; // Thumbnails from this clip's content
  mediaFileId?: string; // Runtime/cache source for lazily loaded thumbnails
  sourceInPoint?: number;
  sourceOutPoint?: number;
  reversed?: boolean;
}

export type VideoBakeRegionScope = 'composition' | 'clip';
export type VideoBakeRegionStatus = 'marked' | 'baking' | 'baked' | 'error';

export interface VideoBakeRegion {
  id: string;
  scope: VideoBakeRegionScope;
  startTime: number;
  endTime: number;
  createdAt: number;
  status?: VideoBakeRegionStatus;
  progress?: number;
  bakedAt?: number;
  error?: string;
  clipId?: string;
  trackId?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
}

export interface ClipVideoState {
  bakeRegions?: VideoBakeRegion[];
}
