import { describe, expect, it } from 'vitest';
import { mergeTargetedAnalysisFrames } from '../../src/services/clipAnalysis/targetedAnalysisMerge';
import { createStaleAnalysisRecoveryUpdate } from '../../src/services/clipAnalysis/clipAnalysisState';
import { FACE_ANALYSIS_MODEL_VERSION } from '../../src/services/faceAnalysis/modelCatalog';
import type {
  ClipAnalysis,
  FrameAnalysisData,
} from '../../src/types/clipMetadata';

function frame(
  timestamp: number,
  focus: number,
  personId?: string,
): FrameAnalysisData {
  return {
    timestamp,
    motion: focus,
    globalMotion: focus,
    localMotion: focus,
    focus,
    brightness: 0.5,
    faceCount: personId ? 1 : 0,
    faces: personId ? [{
      id: `face-${timestamp}`,
      personId,
      label: 'Person 1',
      confidence: 0.9,
      box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      landmarks: [],
    }] : undefined,
    faceModelVersion: personId ? FACE_ANALYSIS_MODEL_VERSION : undefined,
  };
}

describe('targeted clip-analysis merging', () => {
  it('replaces metrics in-range while preserving faces and out-of-range frames', () => {
    const current = [frame(1, 0.2, 'person-1'), frame(9, 0.4, 'person-2')];
    const generated = [frame(1, 0.95), frame(2, 0.8)];

    const merged = mergeTargetedAnalysisFrames(current, generated, 'metrics', [[1, 3]]);

    expect(merged.map(candidate => candidate.timestamp)).toEqual([1, 2, 9]);
    expect(merged[0]?.focus).toBe(0.95);
    expect(merged[0]?.faces?.[0]?.personId).toBe('person-1');
    expect(merged[2]).toBe(current[1]);
  });

  it('replaces faces in-range while preserving existing metrics', () => {
    const current = [frame(1, 0.73, 'person-old')];
    const generated = [frame(1, 0.1, 'person-new')];

    const [merged] = mergeTargetedAnalysisFrames(current, generated, 'faces', [[1, 2]]);

    expect(merged?.focus).toBe(0.73);
    expect(merged?.faces?.[0]?.personId).toBe('person-new');
  });

  it('removes stale face samples inside a rescanned face range', () => {
    const current = [
      frame(1.25, 0.73, 'person-stale'),
      frame(9, 0.4, 'person-outside'),
    ];
    const generated = [
      frame(1, 0.1, 'person-new-a'),
      frame(1.5, 0.2, 'person-new-b'),
    ];

    const merged = mergeTargetedAnalysisFrames(current, generated, 'faces', [[1, 2]]);

    expect(merged.find(candidate => candidate.timestamp === 1.25)?.faces).toBeUndefined();
    expect(merged.flatMap(candidate => candidate.faces ?? []).map(face => face.personId))
      .not.toContain('person-stale');
    expect(merged.find(candidate => candidate.timestamp === 9)?.faces?.[0]?.personId)
      .toBe('person-outside');
  });

  it('drops stale metrics but retains face anchors inside a rescanned metrics range', () => {
    const staleMetricsOnly = frame(1.25, 0.13);
    const faceAnchor = frame(1.75, 0.17, 'person-kept');
    const generated = [frame(1.5, 0.91), frame(2, 0.82)];

    const merged = mergeTargetedAnalysisFrames(
      [staleMetricsOnly, faceAnchor],
      generated,
      'metrics',
      [[1, 2]],
    );

    expect(merged.some(candidate => candidate.timestamp === 1.25)).toBe(false);
    const retainedAnchor = merged.find(candidate => candidate.timestamp === 1.75);
    expect(retainedAnchor?.focus).toBe(0.91);
    expect(retainedAnchor?.faces?.[0]?.personId).toBe('person-kept');
  });

  it('does not mark faces ready when only partial metrics survived a reload', () => {
    const metricsOnlyAnalysis: ClipAnalysis = {
      frames: [frame(1, 0.7)],
      sampleInterval: 500,
    };

    const recovery = createStaleAnalysisRecoveryUpdate({
      analysis: metricsOnlyAnalysis,
      analysisStatus: 'analyzing',
      analysisProgress: 30,
      faceAnalysisStatus: 'analyzing',
      faceAnalysisProgress: 20,
    });

    expect(recovery).toMatchObject({
      status: 'ready',
      progress: 30,
      faceStatus: 'none',
      faceProgress: 0,
    });
  });
});
