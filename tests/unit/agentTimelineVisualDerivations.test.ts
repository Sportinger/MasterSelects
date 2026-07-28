import { describe, expect, it } from 'vitest';
import type {
  CameraMotionSample,
  ShotFaceFrameSample,
  VisualFaceObservation,
} from '../../src/types/agentTimeline/visualDerivations';
import { deriveCameraMotionSpans } from '../../src/services/agentTimeline/derivations/visual/cameraMotionDerivation';
import { deriveShotFramingEvents } from '../../src/services/agentTimeline/derivations/visual/shotFramingDerivation';

function motion(overrides: Partial<CameraMotionSample> = {}): CameraMotionSample {
  return { time: 0, globalMotion: 0.2, localMotion: 0.05, ...overrides };
}

function deriveMotion(samples: CameraMotionSample[]) {
  return deriveCameraMotionSpans(samples, { defaultSampleDuration: 1 });
}

function face(
  sourcePersonId: string,
  height: number,
  x = 0.4,
  confidence = 0.9,
  id = sourcePersonId,
): VisualFaceObservation {
  return {
    id,
    sourcePersonId,
    confidence,
    identityEligible: true,
    box: { x, y: 0.08, width: Math.min(0.3, height * 0.65), height },
  };
}

function frames(...faces: VisualFaceObservation[][]): ShotFaceFrameSample[] {
  return faces.map((frameFaces, index) => ({ time: index, faces: frameFaces }));
}

describe('cheap camera-motion derivation', () => {
  it('classifies static motion without requiring directional GPU statistics', () => {
    const [event] = deriveMotion([motion({ globalMotion: 0.01, localMotion: 0.02 })]);
    expect(event.data).toMatchObject({ motion: 'static', reason: 'below-static-thresholds' });
    expect(event.time).toEqual({ temporalKind: 'interval', timeDomain: 'source', start: 0, end: 1 });
    expect(event.confidence).toBeGreaterThan(0);
  });

  it('keeps moving legacy samples without directional measurements unknown', () => {
    const [event] = deriveMotion([motion({ globalMotion: 0.4, localMotion: 0.2 })]);
    expect(event.data).toMatchObject({ motion: 'unknown', reason: 'missing-directional-measurements' });
  });

  it('classifies coherent pan and tilt with an explicit vector convention', () => {
    const common = {
      meanMagnitude: 1,
      directionCoherence: 0.9,
      coverageRatio: 0.8,
    };
    const panRight = deriveMotion([motion({ ...common, meanX: 1, meanY: 0.1, vectorConvention: 'camera-motion' })])[0];
    const imageFlowLeft = deriveMotion([motion({ ...common, meanX: 1, meanY: 0.1, vectorConvention: 'image-flow' })])[0];
    const tiltUp = deriveMotion([motion({ ...common, meanX: 0.1, meanY: -1, vectorConvention: 'camera-motion' })])[0];
    expect(panRight.data).toMatchObject({ motion: 'pan', direction: 'right', reason: 'horizontal-coherent-flow' });
    expect(imageFlowLeft.data).toMatchObject({ motion: 'pan', direction: 'left' });
    expect(tiltUp.data).toMatchObject({ motion: 'tilt', direction: 'up', reason: 'vertical-coherent-flow' });
  });

  it('uses low coherence plus local activity for handheld and leaves diagonal flow unknown', () => {
    const handheld = deriveMotion([motion({
      localMotion: 0.7,
      meanMagnitude: 1,
      meanX: 0.4,
      meanY: 0.3,
      directionCoherence: 0.2,
      coverageRatio: 0.7,
      vectorConvention: 'camera-motion',
    })])[0];
    const diagonal = deriveMotion([motion({
      meanMagnitude: 1,
      meanX: 0.7,
      meanY: 0.7,
      directionCoherence: 0.9,
      coverageRatio: 0.7,
      vectorConvention: 'camera-motion',
    })])[0];
    expect(handheld.data).toMatchObject({ motion: 'handheld', reason: 'low-coherence-local-activity' });
    expect(diagonal.data).toMatchObject({ motion: 'unknown', reason: 'diagonal-or-weak-global-flow' });
  });

  it('excludes cuts, merges only adjacent equal spans and does not mutate samples', () => {
    const samples = [
      motion({ time: 2, globalMotion: 0.01, localMotion: 0.01 }),
      motion({ time: 0, globalMotion: 0.02, localMotion: 0.02 }),
      motion({ time: 1, globalMotion: 1, localMotion: 0, isSceneCut: true }),
    ];
    const snapshot = structuredClone(samples);
    const events = deriveCameraMotionSpans(samples, { defaultSampleDuration: 1, range: { start: 0.5, end: 3 } });
    expect(events.map((event) => [
      event.time.temporalKind === 'interval' ? event.time.start : -1,
      event.time.temporalKind === 'interval' ? event.time.end : -1,
      event.data.motion,
    ])).toEqual([
      [0.5, 1, 'static'],
      [1, 2, 'unknown'],
      [2, 3, 'static'],
    ]);
    expect(samples).toEqual(snapshot);
  });

  it('coalesces adjacent classifications into deterministic weighted spans', () => {
    const samples = [
      motion({ time: 0, globalMotion: 0.01, localMotion: 0.01 }),
      motion({ time: 1, globalMotion: 0.03, localMotion: 0.03 }),
    ];
    const forward = deriveMotion(samples);
    const reversed = deriveMotion(samples.toReversed());
    expect(reversed).toEqual(forward);
    expect(forward).toHaveLength(1);
    expect(forward[0].time).toEqual({ temporalKind: 'interval', timeDomain: 'source', start: 0, end: 2 });
    expect(forward[0].data.measurements.globalMotion).toBeCloseTo(0.02);
    expect(forward[0].id).toContain(':0:2:static:');
  });
});

describe('cheap shot framing derivation', () => {
  it('keeps a shot without a reliable face unknown rather than calling it wide', () => {
    const [event] = deriveShotFramingEvents(
      [{ shotId: 'shot-1', start: 0, end: 2 }],
      frames([], []),
    );
    expect(event.data).toMatchObject({
      shotSize: 'unknown', layout: 'unknown', framingReason: 'no-reliable-face',
    });
    expect(event.confidence).toBe(0);
  });

  it.each([
    [0.7, 'extreme-close-up'],
    [0.5, 'close-up'],
    [0.3, 'medium'],
    [0.15, 'medium-wide'],
    [0.06, 'wide'],
  ] as const)('derives %s face height as %s', (height, expectedSize) => {
    const [event] = deriveShotFramingEvents(
      [{ shotId: `shot-${expectedSize}`, start: 0, end: 2 }],
      frames([face('person-a', height)], [face('person-a', height)]),
    );
    expect(event.data.shotSize).toBe(expectedSize);
    expect(event.data.layout).toBe('single');
  });

  it('derives two-shot/group layout after deduplicating the same person in a frame', () => {
    const twoShot = deriveShotFramingEvents(
      [{ shotId: 'two', start: 0, end: 2 }],
      frames(
        [face('person-a', 0.3, 0.1, 0.9, 'a-1'), face('person-a', 0.3, 0.1, 0.8, 'a-2'), face('person-b', 0.3, 0.7)],
        [face('person-a', 0.3, 0.1), face('person-b', 0.3, 0.7)],
      ),
    )[0];
    const group = deriveShotFramingEvents(
      [{ shotId: 'group', start: 0, end: 1 }],
      frames([face('a', 0.2, 0.05), face('b', 0.2, 0.4), face('c', 0.2, 0.75)]),
    )[0];
    expect(twoShot.data.layout).toBe('two-shot');
    expect(group.data.layout).toBe('group');
  });

  it('reports dominant position/headroom and requires stable face coverage', () => {
    const sparse = deriveShotFramingEvents(
      [{ shotId: 'sparse', start: 0, end: 3 }],
      frames([face('person-a', 0.3, 0.05)], [], []),
    )[0];
    expect(sparse.data).toMatchObject({
      shotSize: 'unknown', layout: 'unknown', framingReason: 'insufficient-face-coverage',
      reliableFaceFrameCoverage: 1 / 3,
    });

    const stable = deriveShotFramingEvents(
      [{ shotId: 'stable', start: 0, end: 2 }],
      frames([face('person-a', 0.3, 0.05)], [face('person-a', 0.3, 0.05)]),
    )[0];
    expect(stable.data).toMatchObject({
      dominantFacePosition: 'left', headroom: 0.08, framingReason: 'derived-from-face-boxes',
    });
    expect(stable.data.edgeProximity).toBeCloseTo(0.05);
  });

  it('uses half-open shot boundaries and remains deterministic/non-mutating', () => {
    const shotFrames = [
      { time: 2, faces: [face('person-at-end', 0.7)] },
      { time: 1, faces: [face('person-inside', 0.3)] },
      { time: 0, faces: [face('person-inside', 0.3)] },
    ];
    const snapshot = structuredClone(shotFrames);
    const shots = [{ shotId: 'shot', start: 0, end: 2 }];
    const forward = deriveShotFramingEvents(shots, shotFrames);
    const reversed = deriveShotFramingEvents(shots, shotFrames.toReversed());
    expect(reversed).toEqual(forward);
    expect(forward[0].data.shotSize).toBe('medium');
    expect(shotFrames).toEqual(snapshot);
  });
});
