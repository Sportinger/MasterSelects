import { describe, expect, it } from 'vitest';
import {
  hasCompatibleFaceAnalysis,
  normalizePersistedFaceStatus,
  sanitizePersistedFaceAnalysis,
  stripFaceDataFromFrames,
} from '../../src/services/faceAnalysis/faceAnalysisPersistence';
import { FACE_ANALYSIS_MODEL_VERSION } from '../../src/services/faceAnalysis/modelCatalog';
import type { ClipAnalysis, FrameAnalysisData } from '../../src/types/clipMetadata';

function frame(version = FACE_ANALYSIS_MODEL_VERSION): FrameAnalysisData {
  return {
    timestamp: 1,
    motion: 0.2,
    globalMotion: 0.1,
    localMotion: 0.1,
    focus: 0.8,
    brightness: 0.5,
    faceCount: 1,
    faceModelVersion: version,
    faces: [{
      id: 'face-1',
      personId: 'person-scope-1',
      label: 'Person 1',
      confidence: 0.9,
      box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      landmarks: [],
    }],
  };
}

function analysis(version = FACE_ANALYSIS_MODEL_VERSION): ClipAnalysis {
  return {
    frames: [frame(version)],
    sampleInterval: 500,
    faceAnalysis: {
      schemaVersion: 1,
      modelVersion: version,
      detector: 'YuNet',
      recognizer: 'SFace',
      backend: 'cached',
      observationCount: 1,
      people: [],
    },
  };
}

describe('face analysis persistence', () => {
  it('accepts only current, consistently versioned face results', () => {
    expect(hasCompatibleFaceAnalysis(analysis())).toBe(true);
    expect(hasCompatibleFaceAnalysis(analysis('old-model'))).toBe(false);
  });

  it('strips biometric-derived fields while preserving generic metrics', () => {
    const [sanitized] = stripFaceDataFromFrames([frame('old-model')]);
    expect(sanitized.motion).toBe(0.2);
    expect(sanitized.faceCount).toBe(1);
    expect(sanitized.faces).toBeUndefined();
    expect(sanitized.faceModelVersion).toBeUndefined();

    const persisted = sanitizePersistedFaceAnalysis(analysis('old-model'));
    expect(persisted?.faceAnalysis).toBeUndefined();
    expect(persisted?.frames[0]?.faces).toBeUndefined();
  });

  it('never restores an interrupted or stale analysis as ready', () => {
    expect(normalizePersistedFaceStatus('analyzing', analysis())).toBe('none');
    expect(normalizePersistedFaceStatus('ready', analysis('old-model'))).toBe('none');
    expect(normalizePersistedFaceStatus('ready', analysis())).toBe('ready');
    expect(normalizePersistedFaceStatus('error', undefined)).toBe('error');
  });
});
