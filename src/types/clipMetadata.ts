// Transcript word/chunk for speech-to-text
export interface TranscriptWord {
  id: string;
  text: string;
  start: number;        // Start time in seconds (relative to clip source)
  end: number;          // End time in seconds (relative to clip source)
  confidence?: number;  // 0-1 confidence score
  speaker?: string;     // Speaker label if diarization available
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
