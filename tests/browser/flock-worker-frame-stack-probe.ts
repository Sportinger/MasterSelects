import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import { presentGpuFrameStack, releaseWorkerGpuVideoFrameCompositorResources } from '../../src/services/render/workerGpuVideoFrameCompositor';
import type { WorkerGpuTargetSurface } from '../../src/services/render/workerGpuTargetSurface';
import type { WorkerGpuNativeSceneLayer } from '../../src/services/render/workerGpuNativeSceneContract';
import { assertWorkerGpuPresentFrameStackCommand, type WorkerGpuPresentFrameStackCommand } from '../../src/services/render/workerGpuRuntimeCommands';

/** Production frame-stack compositor, persistent scene owner and exact readback. */
export async function renderNativeFrameStackProbe(surface: WorkerGpuTargetSurface): Promise<Uint8Array[]> {
  const images: Uint8Array[] = [];
  try {
    for (let frame = 0; frame < 5; frame++) {
      const time = frame === 3 ? 0.05 : 0.2;
      const { stack, admission, payload } = nativeSceneFixture(time, Date.now(), `native-frame-${frame}`);
      if (frame > 0) (payload.layers as WorkerGpuNativeSceneLayer[]).push({ kind: 'primitive', layerId: 'cube', clipId: 'cube',
        meshType: 'cube', opacity: 1, worldMatrix: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0.1, 0, 0, 0, frame === 1 ? 0.12 : 0.85, 1] });
      const command: WorkerGpuPresentFrameStackCommand = { type: 'gpu.presentFrameStack', commandId: stack.frame.requestId, admission, stack,
          readback: { readbackId: `native-readback-${frame}`, targetId: stack.frame.targetId, compositionId: stack.frame.compositionId,
            timelineTime: time, frameIndex: stack.frame.frameIndex, width: 256, height: 256, format: 'rgba8unorm', colorSpace: 'srgb' } };
      assertWorkerGpuPresentFrameStackCommand(command);
      const result = await presentGpuFrameStack(surface, { clock: Date.now, webCodecsFrames: new Map(), command });
      if (!result.ok || !result.readback) throw new Error(`Native frame-stack failed: ${JSON.stringify(result.diagnostics)}`);
      images.push(new Uint8Array(result.readback.pixels));
    }
    const green = images.slice(0, 3).map(pixels => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 20 && pixels[i + 1] > pixels[i] * 2 && pixels[i + 1] > pixels[i + 2] * 2) count++;
      return count;
    });
    if (green[0] < 100 || green[1] !== 0 || green[2] !== green[0]) throw new Error(`Frame-stack shared depth failed: ${green}`);
    if (images[0][2] < 100 || images[0][2] <= images[0][1] * 2) throw new Error('Native scene did not composite over the solid source');
    if (images[2].some((value, i) => value !== images[4][i])) throw new Error('Persistent frame-stack seek/replay changed pixels');
    return images;
  } finally { releaseWorkerGpuVideoFrameCompositorResources(surface); }
}
