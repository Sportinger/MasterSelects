import { Logger } from '../../../../services/logger';

const log = Logger.create('SplatVisibleCountReadback');

/** Queues the cull counter readback without tying its lifetime to the renderer frame. */
export function queueSplatVisibleCountReadback(
  device: GPUDevice,
  readbackBuffer: GPUBuffer,
  onCount: (count: number) => void,
): void {
  device.queue.onSubmittedWorkDone()
    .then(() => readbackBuffer.mapAsync(GPUMapMode.READ))
    .then(() => {
      const data = new Uint32Array(readbackBuffer.getMappedRange());
      onCount(data[0] ?? 0);
      readbackBuffer.unmap();
      readbackBuffer.destroy();
    })
    .catch((error) => {
      readbackBuffer.destroy();
      log.debug('Visible count readback failed during rapid frame changes', { error });
    });
}
