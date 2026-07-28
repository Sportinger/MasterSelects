import { describe, expect, it, vi } from 'vitest';
import { handleGetClipFaceAnalysis } from '../../src/services/aiTools/handlers/analysis';
import type { TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/aiTools/aiFeedback', () => ({
  selectClipAndOpenTab: vi.fn(),
}));

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Faces.mp4',
    file: new File(['video'], 'Faces.mp4', { type: 'video/mp4' }),
    startTime: 10,
    duration: 5,
    inPoint: 2,
    outPoint: 7,
    source: { type: 'video', mediaFileId: 'media-1' },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      anchor: { x: 0.5, y: 0.5, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

function storeFor(clip: TimelineClip) {
  return {
    clips: [clip],
    tracks: [{ id: 'track-1', name: 'Video', type: 'video' }],
  } as never;
}

describe('getClipFaceAnalysis AI tool', () => {
  it('returns the persisted module error to the AI', async () => {
    const result = await handleGetClipFaceAnalysis(
      { clipId: 'clip-1' },
      storeFor(createClip({
        faceAnalysisStatus: 'error',
        faceAnalysisMessage: 'YuNet model integrity check failed.',
      })),
    );

    expect(result).toEqual({
      success: false,
      error: 'YuNet model integrity check failed.',
      data: { clipId: 'clip-1', status: 'error', progress: 0 },
    });
  });

  it('returns bounded anonymous boxes and never exposes embeddings', async () => {
    const face = {
      id: 'face-1',
      personId: 'person-1',
      label: 'Person 1',
      confidence: 0.94,
      box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      landmarks: [{ x: 0.2, y: 0.3 }],
    };
    const clip = createClip({
      analysisStatus: 'ready',
      faceAnalysisStatus: 'ready',
      analysis: {
        sampleInterval: 500,
        frames: [{
          timestamp: 3,
          motion: 0,
          globalMotion: 0,
          localMotion: 0,
          focus: 1,
          brightness: 0.5,
          faceCount: 1,
          faces: [face],
        }],
        faceAnalysis: {
          schemaVersion: 1,
          modelVersion: 'yunet-2026may+sface-2021dec-v1',
          detector: 'YuNet',
          recognizer: 'SFace',
          backend: 'wasm',
          observationCount: 1,
          people: [{
            id: 'person-1',
            label: 'Person 1',
            firstSeen: 3,
            lastSeen: 3,
            sampleCount: 1,
            averageConfidence: 0.94,
            maxConfidence: 0.94,
            appearances: [{ start: 3, end: 3 }],
          }],
        },
      },
    });

    const result = await handleGetClipFaceAnalysis(
      { clipId: 'clip-1', includeObservations: true, limit: 1 },
      storeFor(clip),
    );
    const serialized = JSON.stringify(result);

    expect(result.success).toBe(true);
    expect(serialized).toContain('"personId":"person-1"');
    expect(serialized).toContain('"timelineTime":11');
    expect(serialized).not.toContain('embedding');
    expect(serialized).toContain('raw biometric vectors are never exposed');
  });
});
