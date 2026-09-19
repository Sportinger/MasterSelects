import { describe, expect, it } from 'vitest';
import { createColmapTextModel } from '../../src/services/photogrammetry/sfm/colmapText';
import { parseSolvedCameraPath } from '../../src/services/photogrammetry/cameraSolvePoses';
import type { CameraSolveDataset } from '../../src/services/photogrammetry/cameraSolvingContract';
import { planCameraSolve } from '../../src/services/photogrammetry/cameraSolveQuality';
import { planInitialPairCandidateOffsets } from '../../src/services/photogrammetry/sfm/reconstruction';
import {
  smoothSolvedCameraPoses,
  snapSolvedCameraPosesToFrames,
} from '../../src/services/photogrammetry/cameraSolvePathSmoothing';
import { cameraCenter, triangulateMatch } from '../../src/services/photogrammetry/sfm/geometry';
import type { CameraPose, FrameFeatures, SparseReconstruction } from '../../src/services/photogrammetry/sfm/types';

const origin: CameraPose = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: { x: 0, y: 0, z: 0 },
};

const translated: CameraPose = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: { x: -1, y: 0, z: 0 },
};

function frame(sourceIndex: number, name: string, x: number): FrameFeatures {
  return {
    sourceIndex,
    name,
    width: 960,
    height: 540,
    solveWidth: 480,
    solveHeight: 270,
    points: new Float32Array([x, 135]),
    colors: new Uint8Array([120, 80, 40]),
  };
}

describe('browser camera-solving geometry', () => {
  it('plans bounded solve quality from source duration and frame rate', () => {
    expect(planCameraSolve('fast', 'efficient', 16, 30)).toEqual({
      frameCount: 24,
      sourceImageMaxSide: 960,
      featureImageMaxSide: 512,
    });
    expect(planCameraSolve('maximum', 'balanced', 2, 30).frameCount).toBe(60);
    expect(planCameraSolve('maximum', 'full', 60, 60)).toEqual({
      frameCount: 96,
      sourceImageMaxSide: 8_192,
      featureImageMaxSide: 960,
    });
  });

  it('searches a wider initialization baseline for source-rate solves', () => {
    expect(planInitialPairCandidateOffsets(48)).toEqual([1, 2, 3, 4]);
    expect(planInitialPairCandidateOffsets(240)).toEqual([1, 4, 6, 9, 11, 14, 16, 19]);
  });

  it('triangulates a point from two solved cameras', () => {
    const point = triangulateMatch(
      origin,
      translated,
      { x: 240, y: 135 },
      { x: 170, y: 135 },
      350,
      { x: 240, y: 135 },
    );

    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(0, 5);
    expect(point?.y).toBeCloseTo(0, 5);
    expect(point?.z).toBeCloseTo(5, 5);
    const center = cameraCenter(translated);
    expect(center.x).toBeCloseTo(1, 8);
    expect(center.y).toBeCloseTo(0, 8);
    expect(center.z).toBeCloseTo(0, 8);
  });

  it('writes scaled intrinsics and observation tracks as COLMAP text', () => {
    const reconstruction: SparseReconstruction = {
      frames: [frame(0, 'frame-0001.jpg', 240), frame(1, 'frame-0002.jpg', 170)],
      poses: new Map([[0, origin], [1, translated]]),
      points: [{
        id: 1,
        position: { x: 0, y: 0, z: 5 },
        color: [120, 80, 40],
        error: 0.25,
        observations: [
          { frameIndex: 0, featureIndex: 0 },
          { frameIndex: 1, featureIndex: 0 },
        ],
      }],
      focalLength: 350,
      principalPoint: { x: 240, y: 135 },
    };

    const model = createColmapTextModel(reconstruction);
    expect(model.registeredSourceIndices).toEqual([0, 1]);
    expect(model.camerasText).toContain('1 SIMPLE_PINHOLE 960 540 700 480 270');
    expect(model.imagesText).toContain('1 1 0 0 0 0 0 0 1 frame-0001.jpg');
    expect(model.imagesText).toContain('2 1 0 0 0 -1 0 0 1 frame-0002.jpg');
    expect(model.pointsText).toContain('1 0 0 5 120 80 40 0.25 1 0 2 0');
  });

  it('converts COLMAP poses into timed editor camera keys', () => {
    const reconstruction: SparseReconstruction = {
      frames: [frame(0, 'frame-0001.jpg', 240), frame(1, 'frame-0002.jpg', 170)],
      poses: new Map([[0, origin], [1, translated]]),
      points: [],
      focalLength: 350,
      principalPoint: { x: 240, y: 135 },
    };
    const model = createColmapTextModel(reconstruction);
    const dataset: CameraSolveDataset = {
      id: 'solve-test',
      createdAt: 1,
      files: [],
      model: { datasetName: 'test', ...model },
      source: {
        sourceClipId: 'clip-1',
        sourceClipName: 'Orbit clip',
        clipStartTime: 5,
        clipDuration: 4,
        sampleTimes: [0.25, 3.75],
      },
    };

    const path = parseSolvedCameraPath(dataset);

    expect(path.poses).toHaveLength(2);
    expect(path.poses.map((pose) => pose.time)).toEqual([0.25, 3.75]);
    expect(path.poses[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(path.poses[1].position.x).toBeCloseTo(1, 8);
    expect(path.poses[1].rotation).toEqual({ x: 0, y: 0, z: 0 });
    expect(path.fovDegrees).toBeGreaterThan(40);
    expect(path.fovDegrees).toBeLessThan(50);
    expect(path.duration).toBe(4);
  });

  it('snaps solved poses to frames and filters isolated trajectory spikes', () => {
    const poses = [0, 1, 9, 3, 4].map((x, index) => ({
      sourceIndex: index,
      imageName: `frame-${index}.jpg`,
      time: index * 0.041,
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: x * 5, z: 0 },
    }));
    const smoothed = smoothSolvedCameraPoses(poses);
    const snapped = snapSolvedCameraPosesToFrames(smoothed, 24);

    expect(smoothed[0].position.x).toBeCloseTo(0, 8);
    expect(smoothed[2].position.x).toBeLessThan(5);
    expect(snapped.map((pose) => pose.time)).toEqual([0, 1 / 24, 2 / 24, 3 / 24, 4 / 24]);
  });
});
