import { describe, expect, it } from 'vitest';

import {
  bitmapSnapshotMaxSizeForPresentation,
  resolveWorkerTargetResizeSize,
  WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE,
  WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE,
  WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
  type WorkerRenderTargetSizingRecord,
} from '../../src/services/render/workerPresentingRenderHostSizing';

function record(width: number, height: number): WorkerRenderTargetSizingRecord {
  return {
    target: {
      id: 'preview',
      compositionId: 'active',
      size: { x: width, y: height },
      devicePixelRatio: 1,
      showTransparencyGrid: false,
      presentation: 'offscreen-canvas',
    },
  };
}

describe('worker presenting render host sizing', () => {
  it('uses the active composition size only for previews that follow it', () => {
    expect(resolveWorkerTargetResizeSize({
      canvasHeight: 1920,
      canvasWidth: 1080,
      followsActiveComposition: true,
      requestedHeight: 540,
      requestedWidth: 960,
    })).toEqual({ x: 960, y: 540 });
  });

  it('preserves a portrait ratio for an independent preview', () => {
    expect(resolveWorkerTargetResizeSize({
      canvasHeight: 1920,
      canvasWidth: 1080,
      followsActiveComposition: false,
      requestedHeight: 540,
      requestedWidth: 960,
    })).toEqual({ x: 540, y: 960 });
  });

  it('uses a panel-sized viewport override without changing its ratio', () => {
    expect(resolveWorkerTargetResizeSize({
      canvasHeight: 1080,
      canvasWidth: 1920,
      followsActiveComposition: true,
      requestedHeight: 1920,
      requestedWidth: 1080,
      viewportOverride: { width: 420, height: 700 },
    })).toEqual({ x: 420, y: 700 });
  });

  it('keeps idle snapshots at full target size', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, false)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('bounds playback snapshots to the playback max edge', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, true)).toEqual({
      width: WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE,
      height: 720,
    });
  });

  it('uses a tighter playback bound for high-fps compositions', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, true, 60)).toEqual({
      width: WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE,
      height: 540,
    });
  });

  it('keeps small playback snapshots at target size', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(960, 540), false, true)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('uses the tighter scrub bound while scrubbing during playback', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), true, true)).toEqual({
      width: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
      height: 540,
    });
  });
});
