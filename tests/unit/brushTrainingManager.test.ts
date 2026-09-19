import { describe, expect, it, vi } from 'vitest';
import {
  BrushTrainingManager,
} from '../../src/services/photogrammetry/brushTrainingManager';
import type {
  BrushTrainingController,
  BrushTrainingSnapshot,
} from '../../src/services/photogrammetry/brushRuntime';

function snapshot(iteration: number): BrushTrainingSnapshot {
  return {
    phase: 'training',
    iteration,
    totalIterations: 1_500,
    splatCount: 9_965,
    trainViews: 31,
    evalViews: 0,
    elapsedMs: iteration * 10,
    psnr: null,
    ssim: null,
    warning: null,
  };
}

describe('BrushTrainingManager', () => {
  it('keeps the GPU job alive while panels unsubscribe and reattach', async () => {
    let emitUpdate: ((value: BrushTrainingSnapshot) => void) | undefined;
    const controller: BrushTrainingController = {
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      exportPly: vi.fn(async () => new Uint8Array([1, 2, 3])),
      finished: Promise.resolve(),
    };
    const starter = vi.fn(async (
      _files: File[],
      _preset: 'preview' | 'mobile' | 'balanced' | 'quality',
      onUpdate: (value: BrushTrainingSnapshot) => void,
    ) => {
      emitUpdate = onUpdate;
      onUpdate(snapshot(25));
      return controller;
    });
    const manager = new BrushTrainingManager(starter);
    const firstPanel = vi.fn();
    const unsubscribe = manager.subscribe(firstPanel);

    await manager.start([new File(['frame'], 'frame.jpg')], 'preview', 'dataset-002');
    unsubscribe();
    emitUpdate?.(snapshot(300));

    expect(controller.cancel).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      datasetName: 'dataset-002',
      isStarting: false,
      training: { iteration: 300 },
    });

    const reopenedPanel = vi.fn();
    manager.subscribe(reopenedPanel);
    emitUpdate?.(snapshot(325));
    expect(reopenedPanel).toHaveBeenCalledOnce();
    expect(manager.getSnapshot().training?.iteration).toBe(325);
  });
});
