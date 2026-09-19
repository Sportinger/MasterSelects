import type { RenderOutputRouter } from '../contracts';
import { Logger } from '../../../services/logger';

const log = Logger.create('HeldCompositeRenderer');

export interface HeldCompositeRenderInput {
  device: GPUDevice;
  sourceView: GPUTextureView | null;
  sampler: GPUSampler | null;
  outputRouter: RenderOutputRouter;
  skipOutput: boolean;
}

/** Re-presents the last complete composite while a decoder or nested render stalls. */
export function renderHeldCompositeFrame(input: HeldCompositeRenderInput): boolean {
  if (!input.sourceView || !input.sampler || input.skipOutput) return false;
  const commandEncoder = input.device.createCommandEncoder();
  const snapshot = input.outputRouter.captureSnapshot();
  input.outputRouter.routeCompositeFrame({
    commandEncoder,
    sourceView: input.sourceView,
    sampler: input.sampler,
    snapshot,
    targetIds: snapshot.activeCompositionTargetIds,
  });
  try {
    input.device.queue.submit([commandEncoder.finish()]);
    return true;
  } catch (error) {
    log.warn('Failed to render held composite frame', error);
    return false;
  }
}
