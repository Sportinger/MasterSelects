import { describe, expect, it } from 'vitest';
import { adaptLegacyClipAnalysis } from '../../src/services/agentTimeline/adapters/clipAnalysisLegacyAdapter';
import { adaptLegacyTranscript } from '../../src/services/agentTimeline/adapters/transcriptLegacyAdapter';
import type { ClipAnalysis, TranscriptWord } from '../../src/types/clipMetadata';

const request = {
  queryRange: { start: 1, end: 2 },
  profile: 'balanced' as const,
  artifactCoverage: [{ start: 0, end: 3 }],
  artifactRef: 'legacy/transcript.json',
};

describe('legacy transcript adapter', () => {
  it('uses half-open ranges and preserves transcript speakers without mutating words', () => {
    const words: TranscriptWord[] = [
      { id: 'end-boundary', text: 'before', start: 0, end: 1, speaker: 'A', confidence: 0.8 },
      { id: 'inside', text: 'hello', start: 1, end: 1.5, speaker: 'Speaker 2', confidence: 0.9 },
      { id: 'crossing', text: 'world', start: 1.75, end: 2.25, speaker: 'Speaker 2', confidence: 0.7 },
      { id: 'start-boundary', text: 'after', start: 2, end: 3, speaker: 'B', confidence: 0.6 },
    ];
    const snapshot = structuredClone(words);

    const view = adaptLegacyTranscript(words, request);

    expect(view.events.map((event) => event.data)).toEqual([
      { speakerId: 'Speaker 2', text: 'hello', wordCount: 1 },
      { speakerId: 'Speaker 2', text: 'world', wordCount: 1 },
    ]);
    expect(view.coverage).toEqual([{ start: 1, end: 2 }]);
    expect(view.missing).toEqual([]);
    expect(view.status).toBe('complete');
    expect(words).toEqual(snapshot);
  });

  it('distinguishes a missing transcript from known coverage with no speech', () => {
    const missing = adaptLegacyTranscript(undefined, request);
    const knownSilence = adaptLegacyTranscript([], request);

    expect(missing).toMatchObject({
      status: 'missing',
      events: [],
      coverage: [],
      missing: [{ start: 1, end: 2 }],
    });
    expect(knownSilence).toMatchObject({
      status: 'complete',
      events: [],
      coverage: [{ start: 1, end: 2 }],
      missing: [],
    });
  });

  it('reports unknown legacy coverage as partial instead of inferring it from word gaps', () => {
    const view = adaptLegacyTranscript(
      [{ id: 'word', text: 'known event', start: 1.1, end: 1.2 }],
      { queryRange: { start: 1, end: 2 }, profile: 'quick' },
    );

    expect(view.status).toBe('partial');
    expect(view.coverage).toEqual([]);
    expect(view.limitations).toContain('coverage-not-recorded');
    expect(view.events).toHaveLength(1);
  });
});

describe('legacy clip analysis adapter', () => {
  it('returns raw range-bounded metrics and marks face identity source-wide and partial', () => {
    const analysis: ClipAnalysis = {
      sampleInterval: 1000,
      frames: [
        { timestamp: 2, motion: 0.2, globalMotion: 0.1, localMotion: 0.3, focus: 0.7, brightness: 0.6, faceCount: 0 },
        {
          timestamp: 1,
          motion: 0.6,
          globalMotion: 0.5,
          localMotion: 0.7,
          focus: 0.8,
          brightness: 0.4,
          faceCount: 1,
          faces: [{
            id: 'face-detection',
            personId: 'person-1',
            label: 'Person 1',
            confidence: 0.95,
            box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
            landmarks: [],
          }],
        },
        { timestamp: 0, motion: 0.1, globalMotion: 0.1, localMotion: 0.1, focus: 0.9, brightness: 0.5, faceCount: 0 },
      ],
      faceAnalysis: {
        schemaVersion: 1,
        modelVersion: 'face-model-1',
        detector: 'YuNet',
        recognizer: 'SFace',
        backend: 'cached',
        observationCount: 2,
        people: [{
          id: 'person-1',
          label: 'Person 1',
          firstSeen: 0.5,
          lastSeen: 2.5,
          sampleCount: 2,
          averageConfidence: 0.9,
          maxConfidence: 0.95,
          appearances: [{ start: 0.5, end: 1.5 }, { start: 2, end: 2.5 }],
        }],
      },
    };
    const snapshot = structuredClone(analysis);

    const views = adaptLegacyClipAnalysis(analysis, {
      queryRange: { start: 1, end: 2 },
      profile: 'balanced',
      artifactRef: 'legacy/clip-analysis.json',
    });

    expect(views.quality.records).toEqual([{
      kind: 'focus-brightness-sample',
      time: 1,
      focus: 0.8,
      brightness: 0.4,
    }]);
    expect(views.cameraMotion.records).toEqual([{
      kind: 'motion-sample',
      time: 1,
      motion: 0.6,
      globalMotion: 0.5,
      localMotion: 0.7,
    }]);
    expect(views.quality.events).toEqual([]);
    expect(views.cameraMotion.events).toEqual([
      expect.objectContaining({
        type: 'camera-motion',
        time: { temporalKind: 'interval', timeDomain: 'source', start: 1, end: 2 },
        data: expect.objectContaining({
          motion: 'unknown',
          reason: 'missing-directional-measurements',
        }),
      }),
    ]);
    expect(views.people.events).toHaveLength(1);
    expect(views.people.events[0]).toMatchObject({
      type: 'person-visible',
      time: { temporalKind: 'interval', start: 0.5, end: 1.5 },
      data: { personId: 'person-1' },
    });
    expect(views.people).toMatchObject({
      status: 'partial',
      rangeCapability: 'source-wide-only',
      coverage: [{ start: 1, end: 2 }],
      missing: [],
    });
    expect(views.people.limitations).toContain('face-identity-source-wide-only');
    expect(analysis).toEqual(snapshot);
  });

  it('marks people missing when frames contain no face analysis or detections', () => {
    const views = adaptLegacyClipAnalysis({
      sampleInterval: 1000,
      frames: [
        { timestamp: 0, motion: 0, globalMotion: 0, localMotion: 0, focus: 1, brightness: 0.5, faceCount: 0 },
      ],
    }, {
      queryRange: { start: 0, end: 1 },
      profile: 'quick',
    });

    expect(views.people.status).toBe('missing');
    expect(views.people.events).toEqual([]);
    expect(views.quality.status).toBe('complete');
  });

  it('publishes measured quality and directional camera events from persisted samples', () => {
    const views = adaptLegacyClipAnalysis({
      sampleInterval: 1000,
      frames: [{
        timestamp: 0,
        motion: 0.8,
        globalMotion: 0.8,
        localMotion: 0.1,
        motionMeanMagnitude: 1,
        motionMeanX: -1,
        motionMeanY: 0.05,
        motionDirectionCoherence: 0.9,
        motionCoverageRatio: 0.8,
        motionVectorConvention: 'image-flow',
        focus: 0.1,
        brightness: 0.01,
        faceCount: 0,
      }],
    }, {
      queryRange: { start: 0, end: 1 },
      profile: 'balanced',
      artifactRef: 'legacy/clip-analysis.json',
    });

    expect(views.cameraMotion.records[0]).toMatchObject({
      meanMagnitude: 1,
      meanX: -1,
      directionCoherence: 0.9,
      coverageRatio: 0.8,
      vectorConvention: 'image-flow',
    });
    expect(views.cameraMotion.events).toEqual([
      expect.objectContaining({
        type: 'camera-motion',
        data: expect.objectContaining({ motion: 'pan', direction: 'right' }),
      }),
    ]);
    expect(views.quality.events.map((event) => (
      event.type === 'quality-issue' ? event.data.issue : event.type
    ))).toEqual(['focus', 'black']);
    expect(views.quality.limitations).not.toContain('raw-measurement-not-classification');
  });
});
