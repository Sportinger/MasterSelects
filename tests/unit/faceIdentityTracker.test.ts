import { describe, expect, it } from 'vitest';
import { FaceIdentityTracker, summarizeCachedFaces } from '../../src/services/faceAnalysis/faceIdentityTracker';
import type { FaceRuntimeDetection } from '../../src/services/faceAnalysis/types';

function detection(
  embedding: number[],
  x = 0.1,
  confidence = 0.9,
): FaceRuntimeDetection {
  return {
    confidence,
    box: { x, y: 0.2, width: 0.2, height: 0.3 },
    landmarks: [
      { x: x + 0.05, y: 0.3 },
      { x: x + 0.15, y: 0.3 },
      { x: x + 0.1, y: 0.36 },
      { x: x + 0.06, y: 0.43 },
      { x: x + 0.14, y: 0.43 },
    ],
    embedding: Float32Array.from(embedding),
  };
}

describe('FaceIdentityTracker', () => {
  it('keeps a SFace identity stable and separates a different embedding', () => {
    const tracker = new FaceIdentityTracker();

    const first = tracker.track(1, [detection([1, 0, 0])]);
    const second = tracker.track(1.5, [detection([0.99, 0.01, 0], 0.12)]);
    const third = tracker.track(2, [detection([0, 1, 0], 0.6)]);
    const summary = tracker.summarize('wasm');

    expect(first[0]?.personId).toBe('person-1');
    expect(second[0]?.personId).toBe('person-1');
    expect(third[0]?.personId).toBe('person-2');
    expect(summary.people).toHaveLength(2);
    expect(summary.observationCount).toBe(3);
    expect(summary.people[0]?.appearances).toEqual([{ start: 1, end: 1.5 }]);
  });

  it('reconstructs compact people summaries from cached observations', () => {
    const frames = [
      {
        timestamp: 4,
        faces: [{
          id: 'face-1',
          personId: 'person-1',
          label: 'Person 1',
          confidence: 0.8,
          box: { x: 0, y: 0, width: 0.2, height: 0.2 },
          landmarks: [],
        }],
      },
      {
        timestamp: 4.5,
        faces: [{
          id: 'face-2',
          personId: 'person-1',
          label: 'Person 1',
          confidence: 1,
          box: { x: 0, y: 0, width: 0.2, height: 0.2 },
          landmarks: [],
        }],
      },
    ];

    const summary = summarizeCachedFaces(frames);

    expect(summary.backend).toBe('cached');
    expect(summary.people[0]).toMatchObject({
      id: 'person-1',
      sampleCount: 2,
      averageConfidence: 0.9,
      appearances: [{ start: 4, end: 4.5 }],
    });
  });
});

