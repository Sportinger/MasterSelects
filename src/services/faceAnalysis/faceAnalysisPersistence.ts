import type {
  AnalysisStatus,
  ClipAnalysis,
  FaceAnalysisResult,
  FrameAnalysisData,
} from '../../types/clipMetadata';
import { summarizeCachedFaces } from './faceIdentityTracker';
import { FACE_ANALYSIS_MODEL_VERSION } from './modelCatalog';

export function hasCompatibleFaceAnalysis(analysis?: ClipAnalysis): boolean {
  if (analysis?.faceAnalysis?.modelVersion !== FACE_ANALYSIS_MODEL_VERSION) return false;
  const faceFrames = analysis.frames.filter(frame => (
    frame.faceModelVersion !== undefined || frame.faces !== undefined
  ));
  return faceFrames.length > 0
    && faceFrames.every(frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION);
}

export function stripFaceDataFromFrames(
  frames: readonly FrameAnalysisData[],
): FrameAnalysisData[] {
  return frames.map((frame) => {
    const sanitized = { ...frame };
    delete sanitized.faces;
    delete sanitized.faceModelVersion;
    return sanitized;
  });
}

export function sanitizePersistedFaceAnalysis(
  analysis?: ClipAnalysis,
): ClipAnalysis | undefined {
  if (!analysis || hasCompatibleFaceAnalysis(analysis)) return analysis;
  const frames = analysis.frames.map((frame) => (
    frame.faceModelVersion === undefined && frame.faces === undefined
      ? frame
      : frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION
        ? frame
        : stripFaceDataFromFrames([frame])[0]
  ));
  const hasFaces = frames.some(
    frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION,
  );
  return {
    ...analysis,
    frames,
    faceAnalysis: hasFaces ? summarizeCachedFaces(frames) : undefined,
  };
}

export function normalizePersistedFaceStatus(
  status: AnalysisStatus | undefined,
  analysis?: ClipAnalysis,
): AnalysisStatus {
  if (status === 'error') return 'error';
  return status === 'ready' && hasCompatibleFaceAnalysis(analysis) ? 'ready' : 'none';
}

export function restoreCachedClipAnalysis(
  cached: { frames: unknown[]; sampleInterval: number; faceAnalysis?: unknown },
): { analysis: ClipAnalysis; hasFaces: boolean } {
  const cachedFrames = cached.frames as FrameAnalysisData[];
  const frames = cachedFrames.map((frame) => (
    frame.faceModelVersion === undefined && frame.faces === undefined
      ? frame
      : frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION
        ? frame
        : stripFaceDataFromFrames([frame])[0]
  ));
  const hasFaces = frames.some(
    frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION,
  );
  const persistedFaceAnalysis = cached.faceAnalysis as FaceAnalysisResult | undefined;
  return {
    hasFaces,
    analysis: {
      frames,
      sampleInterval: cached.sampleInterval,
      faceAnalysis: hasFaces
        ? persistedFaceAnalysis?.modelVersion === FACE_ANALYSIS_MODEL_VERSION
          ? persistedFaceAnalysis
          : summarizeCachedFaces(frames)
        : undefined,
    },
  };
}
