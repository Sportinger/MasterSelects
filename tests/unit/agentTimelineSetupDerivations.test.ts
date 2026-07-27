import { describe, expect, it } from 'vitest';
import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
} from '../../src/types/agentTimeline/sourceIdentity';
import type {
  CameraSetupDescriptor,
  SetupShotInput,
} from '../../src/types/agentTimeline/setupDerivations';
import { clusterCameraSetups } from '../../src/services/agentTimeline/derivations/setups/cameraSetupClustering';
import {
  compareSetupDescriptors,
} from '../../src/services/agentTimeline/derivations/setups/setupDescriptorSimilarity';
import { DEFAULT_SETUP_CLUSTERING_THRESHOLDS } from '../../src/services/agentTimeline/derivations/setups/cameraSetupClustering';

const SOURCE: SourceIdentity = {
  type: 'source-identity',
  version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks',
  hashAlgorithm: 'sha-256',
  hash: 'ef'.repeat(32),
  metadata: { size: 42_000, mediaType: 'video/mp4' },
};

function descriptor(perceptualHash: string, overrides: Partial<CameraSetupDescriptor> = {}): CameraSetupDescriptor {
  return { perceptualHash, ...overrides };
}

function shot(shotId: string, start: number, descriptorValue?: CameraSetupDescriptor, duration = 1): SetupShotInput {
  return {
    shotId,
    start,
    end: start + duration,
    keyframeSourceTime: start + duration / 2,
    descriptor: descriptorValue,
  };
}

describe('recurring source-local camera setup clustering', () => {
  it('clusters recurring non-adjacent shots and keeps a distinct shot unique', () => {
    const result = clusterCameraSetups(SOURCE, [
      shot('shot-a', 0, descriptor('00000000')),
      shot('shot-b', 1, descriptor('11111111')),
      shot('shot-c', 2, descriptor('00000000')),
    ]);
    const recurring = result.clusters.find((cluster) => cluster.recurring);
    expect(recurring?.memberShotIds).toEqual(['shot-a', 'shot-c']);
    expect(result.events.find((event) => event.data.shotId === 'shot-b')?.data.setupStatus).toBe('unique');
    expect(result.events.find((event) => event.data.shotId === 'shot-c')).toMatchObject({
      time: { temporalKind: 'interval', timeDomain: 'source', start: 2, end: 3 },
      data: { setupStatus: 'recurring', setupReason: 'clustered-across-shots', clusterSize: 2 },
    });
  });

  it('uses stricter thresholds for adjacent and short transition shots', () => {
    const options = {
      thresholds: {
        minimumSimilarity: 0.7,
        adjacentShotMinimumSimilarity: 0.95,
        shortShotMinimumSimilarity: 0.95,
      },
    };
    const adjacent = clusterCameraSetups(SOURCE, [
      shot('a', 0, descriptor('00000000')),
      shot('b', 1, descriptor('00000001')),
    ], options);
    expect(adjacent.clusters.every((cluster) => !cluster.recurring)).toBe(true);

    const nonAdjacent = clusterCameraSetups(SOURCE, [
      shot('a', 0, descriptor('00000000')),
      shot('transition', 1, undefined),
      shot('c', 2, descriptor('00000001')),
    ], options);
    expect(nonAdjacent.clusters.find((cluster) => cluster.recurring)?.memberShotIds).toEqual(['a', 'c']);

    const short = clusterCameraSetups(SOURCE, [
      shot('short-a', 0, descriptor('00000000'), 0.4),
      shot('transition', 1, undefined),
      shot('short-c', 2, descriptor('00000001'), 0.4),
    ], options);
    expect(short.clusters.every((cluster) => !cluster.recurring)).toBe(true);
  });

  it('uses conservative complete-link clustering instead of transitive chaining', () => {
    const result = clusterCameraSetups(SOURCE, [
      shot('a', 0, descriptor('0000')),
      shot('b', 1, descriptor('0001')),
      shot('c', 2, descriptor('0011')),
    ], {
      thresholds: {
        minimumSimilarity: 0.7,
        adjacentShotMinimumSimilarity: 0.7,
        shortShotMinimumSimilarity: 0.7,
      },
    });
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.map((cluster) => cluster.memberShotIds)).toContainEqual(['a', 'b']);
    expect(result.clusters.map((cluster) => cluster.memberShotIds)).toContainEqual(['c']);
  });

  it('compares normalized compact histograms and face-layout signatures without pixels', () => {
    const left: CameraSetupDescriptor = {
      colorHistogram: [2, 1, 1],
      faceLayout: {
        faceCount: 1,
        centers: [{ x: 0.3, y: 0.4 }],
        dominantFaceHeight: 0.3,
        shotSize: 'medium',
        layout: 'single',
      },
    };
    const right: CameraSetupDescriptor = {
      colorHistogram: [4, 2, 2],
      faceLayout: {
        faceCount: 1,
        centers: [{ x: 0.31, y: 0.39 }],
        dominantFaceHeight: 0.31,
        shotSize: 'medium',
        layout: 'single',
      },
    };
    const comparison = compareSetupDescriptors(left, right, DEFAULT_SETUP_CLUSTERING_THRESHOLDS);
    expect(comparison?.signals).toEqual(['color-histogram', 'face-layout']);
    expect(comparison?.similarity).toBeGreaterThan(0.98);
    const result = clusterCameraSetups(SOURCE, [shot('a', 0, left), shot('gap', 1, undefined), shot('b', 2, right)]);
    expect(result.clusters[0].recurring).toBe(true);
  });

  it('reports missing and insufficient descriptor coverage explicitly', () => {
    const result = clusterCameraSetups(SOURCE, [
      shot('missing', 0, undefined),
      shot('too-thin', 1, { colorHistogram: [1, 1] }),
      shot('covered', 2, descriptor('00000000')),
    ]);
    expect(result.events.find((event) => event.data.shotId === 'missing')?.data).toMatchObject({
      setupStatus: 'unknown', setupReason: 'missing-descriptor',
    });
    expect(result.events.find((event) => event.data.shotId === 'too-thin')?.data).toMatchObject({
      setupStatus: 'unknown', setupReason: 'insufficient-comparable-signals',
    });
    expect(result.coverage).toEqual({
      coveredShotIds: ['covered'],
      missingShotIds: ['missing', 'too-thin'],
      coveredRanges: [{ start: 2, end: 3 }],
      missingRanges: [{ start: 0, end: 2 }],
    });
  });

  it('produces deterministic source-local IDs without mutating descriptors', () => {
    const shots = [
      shot('a', 0, descriptor('abcd')),
      shot('gap', 1, descriptor('ffff')),
      shot('c', 2, descriptor('abcd')),
    ];
    const snapshot = structuredClone(shots);
    const forward = clusterCameraSetups(SOURCE, shots);
    const reversed = clusterCameraSetups(SOURCE, shots.toReversed());
    expect(reversed).toEqual(forward);
    expect(shots).toEqual(snapshot);

    const otherSource = { ...SOURCE, hash: '12'.repeat(32) };
    const other = clusterCameraSetups(otherSource, shots);
    expect(other.clusters.map((cluster) => cluster.setupId)).not.toEqual(forward.clusters.map((cluster) => cluster.setupId));
    expect(forward.clusters.every((cluster) => cluster.setupId.startsWith('source-setup-'))).toBe(true);
    expect(JSON.stringify(forward)).not.toContain('projectPerson');
  });

  it('uses half-open keyframe validation and rejects colliding shot IDs', () => {
    const result = clusterCameraSetups(SOURCE, [{
      ...shot('a', 0, descriptor('00000000')),
      keyframeSourceTime: 1,
    }]);
    expect(result.events[0].keyframeSourceTime).toBeUndefined();
    expect(() => clusterCameraSetups(SOURCE, [
      shot('same', 0, descriptor('0000')),
      shot('same', 2, descriptor('1111')),
    ])).toThrow('unique shot IDs');
  });
});
