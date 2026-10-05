import type { NativeHelperCommandHost } from './nativeHelperClientTypes';
import type { OkResponse } from './protocol';
import { getErrorMessage } from './nativeHelperResponseUtils';
import { createOptixPreview } from './nativeHelperOptixPreview';

export interface OptixMetrics {
  backend: string; gpu: string; width: number; height: number; samples: number; segments: number;
  readMs: number; initializationMs: number; uploadMs: number; buildMs: number;
  gpuMs: number; renderWallMs: number; downloadMs: number; totalMs: number;
}
export function createOptixCommands(host: NativeHelperCommandHost) {
  const send = async (action: 'status' | 'begin' | 'render' | 'discard', jobId?: string, samples?: number) => {
    const response = await host.send({ cmd: 'optix', id: host.nextId(), action, job_id: jobId, samples }, action === 'render' ? 125_000 : 10_000);
    if (!response.ok) throw new Error(getErrorMessage(response, 'Native render failed'));
    return response as OkResponse;
  };
  return {
    preview: createOptixPreview(host),
    begin: async () => {
      const result = await send('begin');
      if (typeof result.jobId !== 'string' || typeof result.inputPath !== 'string') throw new Error('Invalid OptiX job response');
      return { jobId: result.jobId, inputPath: result.inputPath };
    },
    render: async (jobId: string, samples: number) => {
      const result = await send('render', jobId, samples);
      const metrics = result.metrics as OptixMetrics | undefined;
      if (!metrics || metrics.samples !== samples || !Number.isInteger(metrics.width) || !Number.isInteger(metrics.height)
        || metrics.width < 1 || metrics.height < 1 || metrics.width > 1920 || metrics.height > 1080 || typeof result.outputPath !== 'string') {
        throw new Error('Invalid OptiX result');
      }
      const response = await host.fetchWithAuth(`${host.getHttpBaseUrl()}/file?path=${encodeURIComponent(result.outputPath)}`,
        { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Cannot read native image (${response.status})`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== metrics.width * metrics.height * 16) throw new Error('Truncated native image');
      return { pixels: new Float32Array(buffer), metrics };
    },
    discard: async (jobId: string) => { await send('discard', jobId); },
  };
}
