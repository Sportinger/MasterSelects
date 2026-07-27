import { describe, expect, it } from 'vitest';
import { adaptLegacyAudioArtifacts } from '../../src/services/agentTimeline/adapters/audioArtifactLegacyAdapter';
import {
  adaptLegacySceneCuts,
  adaptLegacySceneDescriptions,
} from '../../src/services/agentTimeline/adapters/sceneLegacyAdapters';
import type { AudioAnalysisArtifact } from '../../src/services/audio/audioArtifactTypes';
import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
  SCENE_CUT_ANALYSIS_WIDTH,
  SCENE_CUT_DETECTOR_VERSION,
  type SceneCutAnalysis,
  type SceneCutPoint,
} from '../../src/types/sceneCutAnalysis';

function cut(timestamp: number, frameNumber: number): SceneCutPoint {
  return {
    timestamp,
    frameNumber,
    score: 0.8,
    changedRatio: 0.7,
    meanPixelDifference: 0.6,
    histogramDifference: 0.5,
    edgeChangeRatio: 0.4,
    motionCompensatedDifference: 0.3,
    confidence: 0.9,
  };
}

function cutAnalysis(cuts: SceneCutPoint[]): SceneCutAnalysis {
  return {
    schemaVersion: SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
    detectorVersion: SCENE_CUT_DETECTOR_VERSION,
    analysisWidth: SCENE_CUT_ANALYSIS_WIDTH,
    analysisHeight: SCENE_CUT_ANALYSIS_HEIGHT,
    sourceFrameCount: 900,
    expectedSourceFrameCount: 900,
    duration: 30,
    sourceFingerprint: { size: 1000, lastModified: 1 },
    cuts,
    completedAt: 1,
  };
}

function audioArtifact(
  id: string,
  overrides: Partial<AudioAnalysisArtifact> = {},
): AudioAnalysisArtifact {
  const reference = {
    artifactId: `${id}-payload`,
    hash: `${id}-hash`,
    size: 128,
    mimeType: 'application/json',
    encoding: 'json' as const,
    storage: { kind: 'project-cache' as const, projectRelativePath: `audio/${id}.json` },
    createdAt: '2026-07-26T10:00:00.000Z',
  };
  return {
    schemaVersion: 1,
    id,
    kind: 'loudness-envelope',
    mediaFileId: 'media-a',
    sourceFingerprint: 'source-a',
    decoderId: 'web-audio',
    decoderVersion: '1',
    analyzerVersion: '2',
    sampleRate: 48000,
    channelLayout: { kind: 'stereo', channelCount: 2 },
    duration: 30,
    payloadRefs: [reference],
    manifestRef: { ...reference, artifactId: `${id}-manifest` },
    createdAt: 1,
    stale: false,
    ...overrides,
  };
}

describe('legacy cut and scene adapters', () => {
  it('emits cuts as point events exactly once across adjacent half-open queries', () => {
    const analysis = cutAnalysis([cut(20, 600), cut(10, 300), cut(10, 300)]);
    const left = adaptLegacySceneCuts(analysis, {
      queryRange: { start: 0, end: 10 },
      profile: 'quick',
    });
    const right = adaptLegacySceneCuts(analysis, {
      queryRange: { start: 10, end: 20 },
      profile: 'quick',
    });

    expect(left.events).toEqual([]);
    expect(right.events).toHaveLength(1);
    expect(right.events[0]).toMatchObject({
      type: 'cut',
      time: { temporalKind: 'point', time: 10 },
      data: { score: 0.8, transition: 'unknown' },
      provenance: [{ analyzerVersion: SCENE_CUT_DETECTOR_VERSION }],
    });
  });

  it('returns deterministic cut events independent of monolithic input order', () => {
    const first = adaptLegacySceneCuts(cutAnalysis([cut(15, 450), cut(5, 150)]), {
      queryRange: { start: 0, end: 20 },
      profile: 'balanced',
    });
    const second = adaptLegacySceneCuts(cutAnalysis([cut(5, 150), cut(15, 450)]), {
      queryRange: { start: 0, end: 20 },
      profile: 'balanced',
    });

    expect(first.events).toEqual(second.events);
    expect(first.coverage).toEqual([{ start: 0, end: 20 }]);
  });

  it('keeps scene descriptions as typed legacy records instead of inventing scene-block semantics', () => {
    const view = adaptLegacySceneDescriptions([
      { id: 'scene-b', text: 'Second description', start: 5, end: 8 },
      { id: 'scene-a', text: 'First description', start: 0, end: 3 },
    ], {
      queryRange: { start: 2, end: 7 },
      profile: 'deep',
    });

    expect(view.events).toEqual([]);
    expect(view.records.map((record) => record.segmentId)).toEqual(['scene-a', 'scene-b']);
    expect(view.coverage).toEqual([{ start: 2, end: 3 }, { start: 5, end: 7 }]);
    expect(view.missing).toEqual([{ start: 3, end: 5 }]);
    expect(view.status).toBe('partial');
  });
});

describe('legacy audio artifact adapter', () => {
  it('references payloads without loading or fabricating audio events and groups rendered state separately', () => {
    const source = audioArtifact('source', { createdAt: 2 });
    const rendered = audioArtifact('rendered', {
      createdAt: 3,
      clipAudioStateHash: 'clip-audio-state',
    });
    const views = adaptLegacyAudioArtifacts([rendered, source], {
      queryRange: { start: 5, end: 10 },
      profile: 'balanced',
    });

    expect(views).toHaveLength(2);
    expect(views.map((view) => [view.timeDomain, view.stateHash])).toEqual([
      ['clip-rendered', 'clip-audio-state'],
      ['source', undefined],
    ]);
    for (const view of views) {
      expect(view.events).toEqual([]);
      expect(view.coverage).toEqual([{ start: 5, end: 10 }]);
      expect(view.limitations).toContain('payload-not-loaded');
      expect(view.records).toHaveLength(1);
    }
  });

  it('reports stale-only and missing audio artifacts honestly', () => {
    const stale = adaptLegacyAudioArtifacts([
      audioArtifact('stale', { stale: true }),
    ], {
      queryRange: { start: 0, end: 10 },
      profile: 'quick',
    });
    const missing = adaptLegacyAudioArtifacts(undefined, {
      queryRange: { start: 0, end: 10 },
      profile: 'quick',
    });

    expect(stale[0]).toMatchObject({
      status: 'stale',
      coverage: [],
      missing: [{ start: 0, end: 10 }],
    });
    expect(stale[0].limitations).toContain('stale-artifact');
    expect(missing[0].status).toBe('missing');
  });
});
