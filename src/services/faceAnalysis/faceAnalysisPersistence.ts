import type { AnalysisStatus, ClipAnalysis, FrameAnalysisData } from '../../types/clipMetadata';
import { summarizeCachedFaces } from './faceIdentityTracker';
import { FACE_ANALYSIS_MODEL_VERSION } from './modelCatalog';

export function hasCompatibleFaceAnalysis(analysis?: ClipAnalysis): boolean {
  return Boolean(
    analysis?.faceAnalysis?.modelVersion === FACE_ANALYSIS_MODEL_VERSION
    && analysis.frames.every(frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION),
  );
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
  return {
    ...analysis,
    frames: stripFaceDataFromFrames(analysis.frames),
    faceAnalysis: undefined,
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
  cached: { frames: unknown[]; sampleInterval: number },
  isExactRange: boolean,
): { analysis: ClipAnalysis; hasFaces: boolean } {
  const cachedFrames = cached.frames as FrameAnalysisData[];
  const hasFaces = isExactRange
    && cachedFrames.length > 0
    && cachedFrames.every(frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION);
  const frames = hasFaces ? cachedFrames : stripFaceDataFromFrames(cachedFrames);
  return {
    hasFaces,
    analysis: {
      frames,
      sampleInterval: cached.sampleInterval,
      faceAnalysis: hasFaces ? summarizeCachedFaces(frames) : undefined,
    },
  };
}
