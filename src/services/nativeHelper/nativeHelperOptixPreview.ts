import type { NativeHelperCommandHost } from './nativeHelperClientTypes';
import type { OkResponse } from './protocol';
import { getErrorMessage } from './nativeHelperResponseUtils';

export interface OptixPreviewMetrics {
  width: number; height: number; samples: number; partialSample: number; segments: number;
  gpuMs: number; renderWallMs: number; buildMs: number; totalMs: number;
}
export function createOptixPreview(host: NativeHelperCommandHost) {
  const send = async (action: 'preview-open' | 'preview-load' | 'preview-frame' | 'preview-close', jobId?: string,
    extra: { samples?: number; frame?: number[]; reset?: boolean } = {}) => {
    const response = await host.send({ cmd: 'optix', id: host.nextId(), action, job_id: jobId, ...extra }, 35_000);
    if (!response.ok) throw new Error(getErrorMessage(response, 'Native preview failed'));
    return response as OkResponse;
  };
  return {
    open: async () => {
      const result = await send('preview-open');
      if (typeof result.jobId !== 'string' || typeof result.inputPath !== 'string') throw new Error('Invalid native preview session');
      return { jobId: result.jobId, inputPath: result.inputPath };
    },
    load: async (jobId: string) => { await send('preview-load', jobId); },
    frame: async (jobId: string, frame: ArrayBuffer, samples: number, reset: boolean) => {
      if (frame.byteLength !== 416) throw new Error('Invalid preview frame');
      const result = await send('preview-frame', jobId, { samples, reset, frame: Array.from(new Uint8Array(frame)) });
      const metrics = result.metrics as OptixPreviewMetrics | undefined;
      if (!metrics || !Number.isInteger(metrics.width) || !Number.isInteger(metrics.height) || metrics.width < 1 || metrics.width > 1920
        || metrics.height < 1 || metrics.height > 1080 || !Number.isInteger(metrics.samples) || metrics.samples < 0 || metrics.samples > 65536
        || !Number.isFinite(metrics.partialSample) || metrics.partialSample < 0 || metrics.partialSample >= 1 || typeof result.outputPath !== 'string') {
        throw new Error('Invalid native preview result');
      }
      const response = await host.fetchWithAuth(`${host.getHttpBaseUrl()}/file?path=${encodeURIComponent(result.outputPath)}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      if (!response.ok) throw new Error(`Cannot read native preview (${response.status})`);
      const buffer = await response.arrayBuffer(), pixels = metrics.width * metrics.height;
      if (buffer.byteLength !== pixels * 20) throw new Error('Truncated native preview');
      const color = new Float32Array(buffer, 0, pixels * 4), depth = new Float32Array(buffer, pixels * 16, pixels);
      return { color, depth, metrics };
    },
    close: async (jobId: string) => { await send('preview-close', jobId); },
  };
}
